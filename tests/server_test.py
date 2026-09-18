import asyncio
import unittest
from unittest.mock import patch
import os
import httpx
from server.app import app, Engine, Speech, speech_phrases, spoken_text, pronunciation_text, PRONUNCIATIONS

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

    def test_times_expand_without_adding_colon_pauses(self):
        text = 'At 10:30 see https://example.com and A:B.'
        calls, pcm = self.synthesize(text)
        self.assertEqual(calls, [spoken_text(text)])
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
            self.assertEqual(len(pcm), 3 * 240 + 2 * 1200)
            self.assertTrue((pcm[240:1440] == 0).all())
            self.assertTrue((pcm[1680:2880] == 0).all())

    def test_punctuation_and_nested_quotes_do_not_stack(self):
        self.assertEqual(speech_phrases('He said: “Try ‘this’ first,” then left.'),
                         [['He said:', 6000], ['“Try ‘this’ first,”', 1200], ['then left.', 0]])
        self.assertEqual(speech_phrases('He said “Done.”'), [['He said', 1200], ['“Done.”', 0]])
        calls, pcm = self.synthesize('He said “Done,” then left.', trailing=4000)
        self.assertEqual(len(pcm), 3 * 240 + 2 * 1200 + 4000)

    def test_apostrophes_measurements_and_unpaired_quotes_are_unchanged(self):
        for text in ["Amodei's essay isn't here.", 'Amodei’s essay isn’t here.', 'A 12" board and 6" ruler.', 'An unmatched “quote here.', 'A closing quote” here.']:
            self.assertEqual(speech_phrases(text), [[text, 0]])

    def test_silence_on_both_sides_counts_toward_target(self):
        calls, pcm = self.synthesize('Before “quoted” after.', trailing=1500, leading=1500)
        self.assertEqual(len(pcm), 3 * 240 + 2 * 1200 + 3000)
        calls, pcm = self.synthesize('Label: “quoted” after.')
        self.assertEqual(len(pcm), 3 * 240 + 6000 + 1200)

    def test_long_quote_silence_is_capped_without_losing_speech(self):
        import numpy as np
        calls, pcm = self.synthesize('Before “quoted” after.', trailing=9000, leading=6000)
        self.assertEqual(len(pcm), 3 * 240 + 2 * 1200 + 6000 + 9000)
        self.assertEqual(int(np.count_nonzero(pcm)), 3 * 240)
        edges = np.diff(np.r_[False, pcm == 0, False].astype(int))
        runs = [(a, b) for a, b in zip(np.where(edges == 1)[0], np.where(edges == -1)[0]) if a > 0 and b < len(pcm)]
        self.assertEqual([b - a for a, b in runs], [1200, 1200])
        # Longer colon pauses retain their established behavior.
        calls, pcm = self.synthesize('Label: content.', trailing=9000, leading=6000)
        self.assertEqual(len(pcm), 2 * (6000 + 240 + 9000))

    def test_repeated_quotes_preserve_all_content(self):
        self.assertEqual(speech_phrases('A “first” and “second” example.'),
                         [['A', 1200], ['“first”', 1200], ['and', 1200], ['“second”', 1200], ['example.', 0]])


class SpokenTextTests(unittest.TestCase):
    synthesize = ColonPauseTests.synthesize

    def test_measurements_and_decimal_digits(self):
        self.assertEqual(spoken_text('50 lb. and 7.2-ft. shelves'), '50 pounds and 7 point two feet shelves')
        self.assertEqual(spoken_text('1 lb, 2 lbs, 50lb and 7 ft.'), '1 pound, 2 pounds, 50 pounds and 7 feet.')
        self.assertEqual(spoken_text('7.02 and 0.5; 7.2.'), '7 point zero two and 0 point five; 7 point two.')
        self.assertEqual(spoken_text('50 lb. Next sentence.'), '50 pounds. Next sentence.')

    def test_grouped_square_foot_measurements(self):
        sentence = 'The 150,700-sq-ft plant just began production'
        expected = 'The one hundred fifty thousand seven hundred square feet plant just began production'
        self.assertEqual(spoken_text(sentence), expected)
        calls, pcm = self.synthesize(sentence)
        self.assertEqual(calls, [expected])
        for unit in ['sq-ft', 'sq ft', 'sq. ft.', 'sqft', 'SQ-FT']:
            self.assertEqual(spoken_text('150,700-' + unit + ' plant'), 'one hundred fifty thousand seven hundred square feet plant')
        self.assertEqual(spoken_text('1,234,567 and 1,200.5 lb.'), 'one million two hundred thirty four thousand five hundred sixty seven and one thousand two hundred point five pounds.')
        from misaki import en
        for british in [False, True]:
            g2p = en.G2P(british=british)
            self.assertEqual(g2p(spoken_text('150,700-sq-ft'))[0], g2p('one hundred fifty thousand seven hundred square feet')[0])

    def test_grouped_quantities_are_cardinals_but_years_stay_numeric(self):
        text = 'UBTECH sold 1,079 humanoids in 2025 and 921 in H1 2026, generating $88M in first-half category revenue, but still posted a ~ $48M net loss for the period.'
        expected = text.replace('1,079', 'one thousand seventy nine')
        self.assertEqual(spoken_text(text), expected)
        calls, _ = self.synthesize(text)
        self.assertEqual(calls, [pronunciation_text(expected, 'af_heart')])
        self.assertEqual(spoken_text('1,079, 2025; 2,025.'), 'one thousand seventy nine, 2025; two thousand twenty five.')
        self.assertEqual(spoken_text('1,079.02'), 'one thousand seventy nine point zero two')
        from misaki import en
        for british in [False, True]:
            g2p = en.G2P(british=british)
            self.assertEqual(g2p(spoken_text('1,079'))[0], g2p('one thousand seventy nine')[0])
            self.assertEqual(spoken_text('2025'), '2025')

    def test_grouping_does_not_change_lists_identifiers_or_urls(self):
        text = '1,2,3 12,34 1,2345 v150,700 https://example.com/150,700-sq-ft'
        self.assertEqual(spoken_text(text), text)

    def test_one_to_one_ratio_is_a_narrow_speech_only_rule(self):
        text = 'Siemens software built a 1:1 digital twin of the factory, letting engineers simulate material flows and AGV routes before changing the physical line.'
        expected = text.replace('1:1', 'one to one')
        self.assertEqual(spoken_text(text), expected)
        calls, pcm = self.synthesize(text)
        self.assertEqual(calls, [expected])
        self.assertEqual(spoken_text('(1:1), 1:1.'), '(one to one), one to one.')
        self.assertNotIn('one to one', spoken_text('0.1:1 1:1.5'))
        unchanged = '11:1 1:1:30 v1:1 1:1pm https://example.com/1:1 www.example.com/1:1'
        self.assertEqual(spoken_text(unchanged), unchanged)

    def test_identifiers_and_urls_are_not_decimal_numbers(self):
        text = 'v7.2 1.2.3 192.168.1.1 https://example.com/7.2 www.example.com/50lb soft ftps'
        self.assertEqual(spoken_text(text), text)

    def test_exact_robot_sentence_and_dash_audio(self):
        text = 'It can lift 50 lb. and reach 7.2-ft. shelves, with its battery giving 90 min runtime on just 9 min of charge — fast enough, Agility says, for 20+ hours of work per day.'
        calls, pcm = self.synthesize(text)
        self.assertEqual(calls, ['It can lift 50 pounds and reach 7 point two feet shelves, with its battery giving 90 min runtime on just 9 min of charge', 'fast enough, Agility says, for 20+ hours of work per day.'])
        self.assertEqual(len(pcm), 2 * 240 + 3600)
        calls, pcm = self.synthesize('Before—after.', leading=6000, trailing=9000)
        self.assertEqual(calls, ['Before', 'after.'])
        self.assertEqual(len(pcm), 2 * 240 + 6000 + 9000 + 3600)

    def test_dash_boundaries_merge_and_keep_other_hyphens(self):
        self.assertEqual(speech_phrases('Before — — after.'), [['Before', 3600], ['after.', 0]])
        self.assertEqual(speech_phrases('Label: — after.'), [['Label:', 6000], ['after.', 0]])
        self.assertEqual(speech_phrases('A well-known 7.2-ft shelf.'), [['A well-known 7.2-ft shelf.', 0]])


class PronunciationTests(unittest.TestCase):
    def test_dictionary_applies_case_insensitively_and_keeps_possessives(self):
        for word in ['WAYMO', 'Waymo', 'waymo', 'robotaxi', 'robotaxis', 'Robotaxis', 'UBTECH', 'Ubtech', 'ubtech', 'demos', 'Demos', 'DEMOS']:
            for voice in ['af_heart', 'bf_emma']:
                phones = PRONUNCIATIONS[voice[0]][word.lower()]
                self.assertEqual(pronunciation_text(word, voice), f'[{word}](/{phones}/)')
        self.assertEqual(pronunciation_text("Waymo's robotaxis", 'af_heart'), "[Waymo](/wˈAmO/)'s [robotaxis](/rˈObOtˌæksiz/)")

    def test_urls_and_longer_words_stay_unchanged(self):
        text = 'https://waymo.com/robotaxis www.waymo.com waymology robotaxism https://ubtech.com/UBTECH ubtechnology'
        self.assertEqual(pronunciation_text(text, 'af_heart'), text)

    def test_installed_phonemizer_uses_explicit_sounds(self):
        from misaki import en
        for dialect, voice in [(False, 'af_heart'), (True, 'bf_emma')]:
            g2p = en.G2P(british=dialect)
            for word, expected in PRONUNCIATIONS[voice[0]].items():
                phones, _ = g2p(pronunciation_text(word, voice))
                self.assertEqual(phones, expected)

    def test_demos_in_the_robot_benchmark_sentence(self):
        text = 'Robocurve raised a $10M seed round to build independent, real-world benchmarks for robot AI, testing models on practical tasks rather than relying on polished demos.'
        calls, _ = ColonPauseTests.synthesize(self, text)
        self.assertEqual(calls, [text.replace('demos', '[demos](/dˈɛmOz/)')])
        unchanged = 'demonstrations demographics https://example.com/demos'
        self.assertEqual(pronunciation_text(unchanged, 'af_heart'), unchanged)

    def test_overrides_reach_synthesis_after_pause_planning(self):
        calls, pcm = ColonPauseTests.synthesize(self, 'WAYMO: “robotaxis” arrive.')
        self.assertEqual(calls, ['[WAYMO](/wˈAmO/):', '“[robotaxis](/rˈObOtˌæksiz/)”', 'arrive.'])


class AnswerLabelTests(unittest.TestCase):
    synthesize = ColonPauseTests.synthesize

    def test_labels_have_short_pauses_without_stacking_silence(self):
        for label in ['A', 'B', 'D', 'Z']:
            calls, pcm = self.synthesize(label + ') The answer.', leading=6000, trailing=9000)
            self.assertEqual(calls, [label + ')', 'The answer.'])
            self.assertEqual(len(pcm), 2 * 240 + 6000 + 9000 + 3600)
        calls, pcm = self.synthesize('A) The answer.')
        self.assertEqual(len(pcm), 2 * 240 + 3600)

    def test_correct_answer_and_adjacent_quote_boundary(self):
        self.assertEqual(speech_phrases('Correct Answer: B) Building trust.'), [['Correct Answer:', 6000], ['B)', 3600], ['Building trust.', 0]])
        self.assertEqual(speech_phrases('A) “Quoted answer” continues.'), [['A)', 3600], ['“Quoted answer”', 1200], ['continues.', 0]])

    def test_normal_parentheses_are_unchanged(self):
        for text in ['The company (founded in 2020) makes robots.', 'The interface (API) supports it.', 'Pick option A) if needed.', 'a) Lowercase.', 'AB) Two letters.']:
            self.assertEqual(speech_phrases(text), [[text, 0]])


if __name__ == '__main__':
    unittest.main()

class EmptySpeechTests(unittest.TestCase):
    def test_formatting_only_sections_return_seekable_silence(self):
        import io
        import soundfile as sf
        engine = Engine.__new__(Engine)
        engine.pipelines = {'a': lambda *args, **kwargs: iter(())}
        for text in ('*', '**', '…', '---'):
            pcm, rate = sf.read(io.BytesIO(engine.synthesize(Speech(text=text))))
            self.assertEqual(rate, 24000)
            self.assertGreater(len(pcm), 0)
            self.assertTrue((pcm == 0).all())

    def test_missing_audio_for_real_words_is_still_an_error(self):
        engine = Engine.__new__(Engine)
        engine.pipelines = {'a': lambda *args, **kwargs: iter(())}
        with self.assertRaisesRegex(ValueError, 'No speech generated'):
            engine.synthesize(Speech(text='Actual words'))

class ClockSpeechTests(unittest.TestCase):
    def test_shared_clock_examples(self):
        import json
        from pathlib import Path
        cases = json.loads((Path(__file__).resolve().parents[1] / 'shared/time-speech-cases.json').read_text())
        for source, expected in cases:
            with self.subTest(source=source):
                self.assertEqual(spoken_text(source), expected)
