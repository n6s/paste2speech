import asyncio
import io
import json
import struct
import subprocess
import unittest
import wave
from unittest.mock import patch
from fastapi import FastAPI
from fastapi.testclient import TestClient
from server import readings


def wav(samples):
    data=io.BytesIO()
    with wave.open(data,'wb') as out:
        out.setnchannels(1);out.setsampwidth(2);out.setframerate(24000)
        out.writeframes(struct.pack('<'+'h'*len(samples),*samples))
    return data.getvalue()

class ReadingsTests(unittest.TestCase):
    def tearDown(self):
        for recording in readings.jobs.values():recording.dispose()
        readings.jobs.clear()

    def test_one_clock_paragraph_gaps_captions_and_mp3_delay(self):
        recording=readings.Recording(['Houthi & <test>.','Second sentence.'],'af_heart',{1})
        readings.jobs[recording.id]=recording
        # Sharp onset after 100 ms measures actual MP3 delay; paragraph boundary
        # has no trailing silence, so add 150 ms beside the next 100 ms lead-in.
        pcm=wav([0]*2400+[10000]*2400)
        from server.app import Speech
        readings.synthesize_recording(recording,lambda job:pcm,Speech)
        self.assertEqual(recording.state,'ready')
        self.assertAlmostEqual(recording.starts[0],readings.MP3_DELAY)
        self.assertAlmostEqual(recording.starts[1],.35+readings.MP3_DELAY)
        decoded=subprocess.check_output(['ffmpeg','-v','error','-i',str(recording.path),'-f','s16le','pipe:1'])
        samples=struct.unpack('<'+'h'*(len(decoded)//2),decoded)
        onset=next(i for i,v in enumerate(samples) if abs(v)>5000)
        self.assertLess(abs(onset-(2400+1105)),10)
        self.assertIn('Houthi &amp; &lt;test&gt;.',readings.captions(recording))
        self.assertIn('00:00:00.046 --> 00:00:00.396',readings.captions(recording))
        self.assertGreaterEqual(recording.duration,.55+readings.MP3_DELAY)

    def test_failed_chunk_never_becomes_downloadable(self):
        from server.app import Speech
        recording=readings.Recording(['one','two'],'af_heart',set());readings.jobs[recording.id]=recording
        def fail(job):raise RuntimeError('private source text')
        readings.synthesize_recording(recording,fail,Speech)
        self.assertEqual(recording.state,'failed')
        self.assertNotIn('private source',recording.error)
        app=FastAPI();app.include_router(readings.router)
        response=TestClient(app).get(f'/readings/{recording.id}/download/mp3')
        self.assertEqual(response.status_code,409)

    def test_validation_and_private_access_before_synthesis(self):
        app=FastAPI();app.include_router(readings.router);app.state.busy=False
        client=TestClient(app);origin={'Origin':'https://pop-os.tailbd091c.ts.net'}
        data={'chunks':['Hello.'],'voice':'af_heart'}
        self.assertEqual(client.post('/api/readings',json=data).status_code,403)
        for patch_data in [{'chunks':['x'*601]},{'chunks':[' ']},{'voice':'invalid'},{'paragraphStarts':[1]},{'rate':2}]:
            self.assertEqual(client.post('/readings',json=data|patch_data,headers=origin).status_code,422)
        self.assertEqual(client.post('/readings',content='x'*4_000_001,headers=origin|{'Content-Type':'application/json'}).status_code,413)
        recording=readings.Recording(['secret'],'af_heart',set());readings.jobs[recording.id]=recording
        self.assertEqual(client.get('/readings/'+recording.id,headers={'Sec-Fetch-Site':'cross-site'}).status_code,403)
        self.assertNotIn('secret',client.get('/readings/'+recording.id).text)
        self.assertEqual(client.delete('/readings/'+recording.id).status_code,403)
        self.assertEqual(client.delete('/readings/'+recording.id,headers=origin).status_code,204)
        self.assertFalse(recording.path.parent.exists())

    def test_download_ranges_and_expiry(self):
        recording=readings.Recording(['One.'],'af_heart',set());readings.jobs[recording.id]=recording
        recording.path.write_bytes(b'0123456789');recording.state='ready';recording.starts=[.046];recording.duration=1
        app=FastAPI();app.include_router(readings.router);client=TestClient(app)
        response=client.get(f'/api/readings/{recording.id}/audio',headers={'Range':'bytes=2-5'})
        self.assertEqual(response.status_code,206);self.assertEqual(response.content,b'2345')
        self.assertIn('attachment',client.get(f'/readings/{recording.id}/download/mp3').headers['content-disposition'])
        self.assertTrue(client.get(f'/readings/{recording.id}/download/vtt').text.startswith('WEBVTT'))
        recording.touched-=readings.TTL+1;readings.expire_recordings()
        self.assertNotIn(recording.id,readings.jobs);self.assertFalse(recording.path.parent.exists())

    def test_generation_lifecycle_busy_and_cancel(self):
        import threading
        from types import SimpleNamespace
        entered,release=threading.Event(),threading.Event()
        def synthesize(job):
            entered.set();release.wait(5)
            return wav([1000]*4800)
        app=FastAPI();app.include_router(readings.router);app.state.busy=False
        app.state.engine=SimpleNamespace(synthesize=synthesize)
        origin={'Origin':'https://pop-os.tailbd091c.ts.net'}
        with TestClient(app) as client:
            response=client.post('/readings',json={'chunks':['one','two'],'voice':'af_heart'},headers=origin)
            self.assertEqual(response.status_code,200);key=response.json()['id']
            self.assertTrue(entered.wait(2))
            self.assertEqual(client.post('/readings',json={'chunks':['other'],'voice':'af_heart'},headers=origin).status_code,503)
            self.assertEqual(client.get(f'/readings/{key}').json()['state'],'generating')
            # Signal cancellation while synthesis is in progress; deletion must
            # wait for that worker before allowing another job onto the GPU.
            readings.jobs[key].cancelled.set();release.set()
            self.assertEqual(client.delete('/readings/'+key,headers=origin).status_code,204)
            self.assertFalse(app.state.busy)
            self.assertEqual(client.get('/readings/'+key).status_code,404)

    def test_hosted_input_limits_and_provider_selection(self):
        from types import SimpleNamespace
        import time
        from unittest.mock import Mock
        app=FastAPI();app.include_router(readings.router);app.state.busy=False
        local=Mock(side_effect=AssertionError('Must not use local GPU'))
        app.state.engine=SimpleNamespace(synthesize=local)
        origin={'Origin':'https://pop-os.tailbd091c.ts.net'}
        with TestClient(app) as client:
            for data in [{'provider':'unknown','voice':'af_heart','chunks':['Hello']},
                         {'provider':'deepinfra','voice':'am_fenrir','chunks':['Hello']},
                         {'provider':'deepinfra','voice':'af_heart','chunks':['x'*500]*41}]:
                self.assertEqual(client.post('/readings',json=data,headers=origin).status_code,422)
            hosted=SimpleNamespace(synthesize=lambda job:wav([1000]*2400))
            with patch('server.deepinfra.DeepInfraEngine',return_value=hosted):
                response=client.post('/readings',json={'provider':'deepinfra','voice':'bf_emma','chunks':['Hello.']},headers=origin)
                self.assertEqual(response.status_code,200);key=response.json()['id']
                for _ in range(100):
                    result=client.get('/readings/'+key).json()
                    if result['state']!='generating':break
                    time.sleep(.01)
                self.assertEqual(result['state'],'ready');self.assertEqual(result['provider'],'deepinfra')
                local.assert_not_called()
                client.delete('/readings/'+key,headers=origin)

    def test_finished_recordings_do_not_block_replacement_and_retention_is_bounded(self):
        from types import SimpleNamespace
        import time
        app=FastAPI();app.include_router(readings.router);app.state.busy=False
        app.state.engine=SimpleNamespace(synthesize=lambda job:wav([1000]*2400))
        old=[]
        for i in range(3):
            r=readings.Recording(['old'],'af_heart',set());r.state='ready';r.touched=time.monotonic()-10+i
            readings.jobs[r.id]=r;old.append(r)
        old[0].readers=1
        with TestClient(app) as client, patch.object(readings,'MAX_RETAINED',3):
            response=client.post('/readings',json={'chunks':['new'],'voice':'af_heart'},headers={'Origin':'https://pop-os.tailbd091c.ts.net'})
            self.assertEqual(response.status_code,200)
            self.assertIn(old[0].id,readings.jobs) # active playback preserved
            self.assertNotIn(old[1].id,readings.jobs) # oldest idle download retired
            self.assertIn(old[2].id,readings.jobs)
            self.assertEqual(len(readings.jobs),3)
