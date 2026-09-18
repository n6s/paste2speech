import json
import tempfile
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch
from scripts.feedback_review import __main__ as c
from scripts.feedback_review import runner


def report(timestamp=None):
    return {'id':str(uuid.uuid4()), 'created_at': timestamp or c.now_ms(),
            'message':'Please improve the voice pronunciation.', 'context':'{}', 'email':'do-not-import@example.test'}


def review(payload, **kwargs):
    result={k:'' for k in runner.FIELDS}
    result.update(report_id=payload['id'],category='pronunciation',summary='A pronunciation needs review.',
                  approval_needed=True,recommended_action='Confirm the intended pronunciation.')
    return {'result':result,'source_commit':'test'}


class ControllerTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.state=Path(self.temp.name)
        self.db=c.connect(self.state)
        with self.db:c.set_meta(self.db,'cutover_ms',c.now_ms()-10000)
    def tearDown(self):
        self.db.close();self.temp.cleanup()
    def test_import_dedup_and_baseline_independent_of_delivery(self):
        old=report(c.now_ms()-20000);new=report();new['status']='sent'
        self.assertEqual(c.import_rows(self.db,[old,new]),2)
        self.assertEqual(c.import_rows(self.db,[old,new]),0)
        self.assertEqual(dict(self.db.execute('SELECT id,status FROM reports')),
                         {old['id']:'baseline',new['id']:'imported'})
        self.assertNotIn('do-not-import',self.db.execute('SELECT payload FROM reports LIMIT 1').fetchone()[0])
    def test_delivery_retry_does_not_repeat_review(self):
        r=report();c.import_rows(self.db,[r]);calls=[]
        def reviewer(p,**kw):calls.append(p['id']);return review(p)
        c.run_reviews(self.db,self.state,reviewer)
        def fail(_):raise RuntimeError('offline')
        self.assertFalse(c.deliver_pending(self.db,self.state,fail))
        c.run_reviews(self.db,self.state,reviewer)
        self.assertEqual(calls,[r['id']])
        with self.db:self.db.execute('UPDATE reports SET next_attempt=0')
        sent=[]
        c.deliver_pending(self.db,self.state,lambda text:sent.append(text) or 42)
        self.assertEqual(len(sent),1);self.assertIn('Delivery retry',sent[0])
        self.assertEqual(self.db.execute('SELECT status FROM reports').fetchone()[0],'notified')
        c.deliver_pending(self.db,self.state,lambda _:self.fail('duplicate'))
        self.assertTrue((self.state/'reports'/f"{r['id']}.json").is_file())
    def test_stale_and_exhausted_runs(self):
        r=report();c.import_rows(self.db,[r])
        with self.db:self.db.execute("UPDATE reports SET status='investigating',attempts=3")
        c.run_reviews(self.db,self.state,lambda *_:self.fail('exhausted'))
        self.assertEqual(self.db.execute('SELECT status FROM reports').fetchone()[0],'needs_attention')
        self.assertIn('failed after three attempts',self.db.execute('SELECT message FROM reports').fetchone()[0])
    def test_invalid_output_and_timeout_preserve_report(self):
        r=report();c.import_rows(self.db,[r])
        def fail(*a,**kw):raise RuntimeError('investigation_timeout')
        for _ in range(3):
            with self.db:self.db.execute('UPDATE reports SET next_attempt=0')
            c.run_reviews(self.db,self.state,fail)
        row=self.db.execute('SELECT * FROM reports').fetchone()
        self.assertEqual(row['attempts'],3);self.assertEqual(row['status'],'needs_attention')
        self.assertIn(r['message'],row['payload'])
    def test_pagination_and_reconciliation(self):
        rows=sorted([report() for _ in range(3)],key=lambda r:(r['created_at'],r['id']))
        pages=iter([rows[:2],rows[2:]])
        with patch.object(c,'PAGE_SIZE',2):self.assertEqual(c.poll(self.db,lambda _:next(pages)),3)
        self.assertEqual(json.loads(c.meta(self.db,'scan_cursor')),[0,''])
        self.assertEqual(c.poll(self.db,lambda _:rows),0)
    def test_expiry_and_report_files(self):
        r=report(c.now_ms()-c.RETENTION-1000);c.import_rows(self.db,[r]);c.export(self.db,r['id'],self.state)
        c.expire(self.db,self.state)
        self.assertEqual(self.db.execute('SELECT count(*) FROM reports').fetchone()[0],0)
        self.assertEqual(list((self.state/'reports').iterdir()),[])
    def test_validation(self):
        r=report();result=review(r)['result'];runner.validate(result,r['id'])
        with self.assertRaises(ValueError):runner.validate({**result,'report_id':'wrong'},r['id'])
        with self.assertRaises(ValueError):runner.validate({**result,'summary':'x'*4001},r['id'])
        with self.assertRaises(ValueError):runner.validate({**result,'approval_needed':'yes'},r['id'])
    def test_lock(self):
        with c.locked(self.state):
            with self.assertRaises(RuntimeError):
                with c.locked(self.state):pass
    def test_failure_notice_once_and_recovery(self):
        notices=[];sender=lambda text:notices.append(text) or 1
        c.health(self.db,'authentication',sender);c.health(self.db,'authentication',sender)
        c.health(self.db,None,sender);c.health(self.db,None,sender)
        self.assertEqual(len(notices),2)
    def test_short_plain_telegram_without_contact_field(self):
        r=report();message=c.render(review(r))
        self.assertLess(len(message),3500);self.assertIn(r['id'],message)
        self.assertNotIn(r['email'],message)


if __name__=='__main__':unittest.main()

class IsolationTests(unittest.TestCase):
    def test_namespace_does_not_mount_host_home_or_sockets(self):
        with tempfile.TemporaryDirectory() as temp:
            args=runner.namespace(Path('/fake/codex'),Path(temp))
            self.assertIn('--clearenv',args)
            self.assertNotIn('/home/roger',args)
            self.assertNotIn('/run/user',args)
            self.assertNotIn(str(runner.ROOT),args)
            self.assertIn('shell_tool',runner.DISABLED)
            self.assertIn('apps',runner.DISABLED)
            self.assertIn('plugins',runner.DISABLED)
    def test_empty_poll_has_no_model_or_telegram_calls(self):
        with tempfile.TemporaryDirectory() as temp:
            db=c.connect(Path(temp))
            with db:c.set_meta(db,'cutover_ms',c.now_ms())
            self.assertEqual(c.poll(db,lambda _:[]),0)
            c.run_reviews(db,Path(temp),lambda *_:self.fail('model called'))
            c.deliver_pending(db,Path(temp),lambda *_:self.fail('Telegram called'))
            db.close()
