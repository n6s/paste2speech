import asyncio
import unittest
from unittest.mock import patch
import os
import httpx
from server.app import app, Engine, Speech, speech_phrases

class FakeEngine:
    device = 'cuda'
    def synthesize(self, job):
        return b'RIFFtest'

class ServerTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        app.state.engine = FakeEngine()
        app.state.busy = False
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://localhost')

    async def asyncTearDown(self):
        await self.client.aclose()

    async def test_pdf_extracts_text_and_reports_empty_pages(self):
        # A real two-page PDF: one text page and one blank page.
        stream = b'BT /F1 12 Tf 72 720 Td (Hello PDF reader.) Tj ET'
        objects = [
            b'<< /Type /Catalog /Pages 2 0 R >>',
            b'<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>',
            b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
            b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
            b'<< /Length ' + str(len(stream)).encode() + b' >>\nstream\n' + stream + b'\nendstream',
            b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>',
        ]
        pdf = bytearray(b'%PDF-1.4\n')
        offsets = [0]
        for number, obj in enumerate(objects, 1):
            offsets.append(len(pdf))
            pdf.extend(f'{number} 0 obj\n'.encode() + obj + b'\nendobj\n')
        start = len(pdf)
        pdf.extend(f'xref\n0 {len(offsets)}\n0000000000 65535 f \n'.encode())
        for offset in offsets[1:]:
            pdf.extend(f'{offset:010d} 00000 n \n'.encode())
        pdf.extend(f'trailer\n<< /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{start}\n%%EOF\n'.encode())
        response = await self.client.post('/pdf-text', content=bytes(pdf), headers={'content-type': 'application/pdf'})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json(), {'text': 'Hello PDF reader.', 'pages': 2, 'emptyPages': 1})
        blank = bytes(pdf).replace(b'Hello PDF reader.', b'                 ')
        response = await self.client.post('/pdf-text', content=blank, headers={'content-type': 'application/pdf'})
        self.assertEqual(response.status_code, 422)
        self.assertIn('no OCR', response.json()['detail'])

    async def test_invalid_pdf_and_foreign_origin(self):
        response = await self.client.post('/pdf-text', content=b'not a pdf', headers={'content-type': 'application/pdf'})
        self.assertEqual(response.status_code, 422)
        response = await self.client.post('/pdf-text', content=b'%PDF-broken', headers={'content-type': 'application/pdf'})
        self.assertEqual(response.status_code, 422)
        response = await self.client.post('/pdf-text', content=b'%PDF-', headers={'content-type': 'application/pdf', 'origin': 'https://unrelated.example'})
        self.assertEqual(response.status_code, 403)

    async def test_health_reports_engine_device(self):
        response = await self.client.get('/api/health')
        self.assertEqual(response.json()['device'], 'cuda')

    async def test_valid_speech_and_headers(self):
        response = await self.client.post('/speech', json={'text':'Hello', 'voice':'af_heart','speed':1.0})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers['cache-control'],'no-store')
        self.assertEqual(response.headers['content-type'],'audio/wav')

    async def test_invalid_input_is_bounded_and_does_not_echo_text(self):
        for job in ({'text':'x'*601},{'text':'  '},{'text':'test','voice':'../../bad'},{'text':'test','speed':4},{'text':123}):
            response = await self.client.post('/speech',json=job)
            self.assertEqual(response.status_code,422)
            self.assertNotIn('test',response.text)
        self.assertEqual((await self.client.post('/speech',content=b'x'*8193,headers={'content-type':'application/json'})).status_code,413)

    async def test_foreign_origins_and_non_json_rejected(self):
        self.assertEqual((await self.client.post('/speech',json={'text':'hello'},headers={'origin':'https://unrelated.example'})).status_code,403)
        self.assertEqual((await self.client.post('/speech',content='hello')).status_code,415)

    async def test_busy_service_does_not_queue_unbounded_work(self):
        app.state.busy = True
        self.assertEqual((await self.client.post('/speech',json={'text':'hello'})).status_code,503)


class DeviceTests(unittest.TestCase):
    def test_cuda_unavailable_fails_explicitly(self):
        with patch.dict(os.environ, {'P2S_DEVICE': 'cuda'}), patch('torch.cuda.is_available', return_value=False):
            with self.assertRaisesRegex(RuntimeError, 'CUDA-enabled'):
                Engine()

    def test_invalid_device_is_rejected(self):
        with patch.dict(os.environ, {'P2S_DEVICE': 'unknown'}):
            with self.assertRaisesRegex(ValueError, 'cpu or cuda'):
                Engine()



class ColonPauseTests(unittest.TestCase):
    def synthesize(self, text, trailing=0, leading=0):
        import io
        import numpy as np
        import soundfile as sf
        import torch
        calls = []
        def pipeline(phrase, **kwargs):
            calls.append(phrase)
            yield None, None, torch.tensor(np.concatenate([np.zeros(leading), np.full(240, .5), np.zeros(trailing)]), dtype=torch.float32)
        engine = Engine.__new__(Engine)
        engine.pipelines = {'a': pipeline}
        audio = engine.synthesize(Speech(text=text))
        return calls, sf.read(io.BytesIO(audio))[0]

    def test_labels_and_whitespace_have_real_pcm_pause(self):
        for whitespace in [' ', '\t', '\n', '\r\n', '\n\n']:
            calls, pcm = self.synthesize('Nate:' + whitespace + 'Ask AI for a deck.')
            self.assertEqual(calls, ['Nate:', 'Ask AI for a deck.'])
            self.assertEqual(len(pcm), 240 + 6000 + 240)
            self.assertTrue((pcm[240:6240] == 0).all())
            self.assertGreater(pcm[6240], 0)

    def test_times_urls_and_no_space_colons_stay_intact(self):
        text = 'At 10:30 see https://example.com and A:B.'
        calls, pcm = self.synthesize(text)
        self.assertEqual(calls, [text])
        self.assertEqual(len(pcm), 240)

    def test_existing_pause_is_topped_up_not_stacked(self):
        for trailing in [2400, 6000, 8000]:
            calls, pcm = self.synthesize('Nate:', trailing)
            self.assertEqual(len(pcm), 240 + max(trailing, 6000))

    def test_multiple_labels_preserve_every_word(self):
        calls, pcm = self.synthesize('Nate: Try this: a simple deck.')
        self.assertEqual(calls, ['Nate:', 'Try this:', 'a simple deck.'])
        self.assertEqual(len(pcm), 3 * 240 + 2 * 6000)


class QuotePauseTests(unittest.TestCase):
    synthesize = ColonPauseTests.synthesize

    def test_quote_boundaries_have_short_pcm_pauses(self):
        for opening, closing in [('“', '”'), ('"', '"'), ('‘', '’')]:
            calls, pcm = self.synthesize(f'Its own {opening}responsibility and incentive{closing} for safety.')
            self.assertEqual(calls, ['Its own', f'{opening}responsibility and incentive{closing}', 'for safety.'])
            self.assertEqual(len(pcm), 3 * 240 + 2 * 1800)
            self.assertTrue((pcm[240:2040] == 0).all())
            self.assertTrue((pcm[2280:4080] == 0).all())

    def test_punctuation_and_nested_quotes_do_not_stack(self):
        self.assertEqual(speech_phrases('He said: “Try ‘this’ first,” then left.'),
                         [['He said:', 6000], ['“Try ‘this’ first,”', 1800], ['then left.', 0]])
        self.assertEqual(speech_phrases('He said “Done.”'), [['He said', 1800], ['“Done.”', 0]])
        calls, pcm = self.synthesize('He said “Done,” then left.', trailing=4000)
        self.assertEqual(len(pcm), 3 * (240 + 4000))

    def test_apostrophes_measurements_and_unpaired_quotes_are_unchanged(self):
        for text in ["Amodei's essay isn't here.", 'Amodei’s essay isn’t here.', 'A 12" board and 6" ruler.', 'An unmatched “quote here.', 'A closing quote” here.']:
            self.assertEqual(speech_phrases(text), [[text, 0]])

    def test_silence_on_both_sides_counts_toward_target(self):
        calls, pcm = self.synthesize('Before “quoted” after.', trailing=1500, leading=1500)
        self.assertEqual(len(pcm), 3 * (1500 + 240 + 1500))
        calls, pcm = self.synthesize('Label: “quoted” after.')
        self.assertEqual(len(pcm), 3 * 240 + 6000 + 1800)

    def test_repeated_quotes_preserve_all_content(self):
        self.assertEqual(speech_phrases('A “first” and “second” example.'),
                         [['A', 1800], ['“first”', 1800], ['and', 1800], ['“second”', 1800], ['example.', 0]])


if __name__ == '__main__':
    unittest.main()
