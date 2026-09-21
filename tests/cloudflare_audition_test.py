import base64
import io
import json
import unittest
import urllib.error
from unittest.mock import patch
from fastapi import FastAPI
from fastapi.testclient import TestClient
from server import cloudflare_audition as audition

app = FastAPI()
app.include_router(audition.router)
client = TestClient(app)
origin = {'Origin': 'https://pop-os.tailbd091c.ts.net'}

class Reply(io.BytesIO):
    def __init__(self, data, mime):
        super().__init__(data)
        self.headers = {'Content-Type': mime}

class AuditionTests(unittest.TestCase):
    def test_rejects_untrusted_origin_and_invalid_inputs_before_generation(self):
        payload = {'model': 'melo', 'voice': 'en', 'text': 'Hello.'}
        with patch.object(audition, 'generate') as generate:
            self.assertEqual(client.post('/api/audition/speech', json=payload).status_code, 403)
            for change in [{'model':'other'}, {'voice':'invalid'}, {'text':' '}, {'text':'a'*2001}]:
                self.assertEqual(client.post('/api/audition/speech', json=payload | change, headers=origin).status_code, 422)
            self.assertEqual(client.post('/api/audition/speech', content='x'*12001, headers=origin | {'Content-Type':'application/json'}).status_code,413)
            generate.assert_not_called()

    def test_tailscale_prefix_stripping_routes(self):
        self.assertEqual(client.get('/audition').status_code, 200)
        self.assertEqual(client.get('/audition.js').status_code, 200)
        self.assertEqual(client.post('/audition/speech',json={}).status_code, 403)

    def test_audio_route_returns_binary_and_timing(self):
        with patch.object(audition, 'generate', return_value=(b'ID3audio', 'audio/mpeg', 125)):
            result=client.post('/api/audition/speech',json={'model':'aura1','voice':'asteria','text':'Hello.'},headers=origin)
        self.assertEqual(result.content,b'ID3audio')
        self.assertEqual(result.headers['x-generation-ms'],'125')

    def test_provider_payloads_and_json_audio(self):
        for model,voice in [('melo','en'),('aura1','asteria'),('aura2','luna')]:
            data=b'ID3sample'
            response=Reply(json.dumps({'result':{'audio':base64.b64encode(data).decode()},'success':True}).encode(),'application/json') if model=='melo' else Reply(data,'audio/mpeg')
            with patch.object(audition.Path,'read_text',return_value='test-secret'), patch.object(audition.urllib.request,'urlopen',return_value=response) as call:
                result=audition.generate(audition.Audition(model=model,voice=voice,text='Hello.'))
                payload=json.loads(call.call_args.args[0].data)
                self.assertEqual(payload,{'prompt':'Hello.','lang':'en'} if model=='melo' else {'text':'Hello.','speaker':voice,'encoding':'mp3'})
                self.assertEqual(result[:2],(data,'audio/mpeg'))

    def test_upstream_errors_do_not_expose_credentials(self):
        for code,expected in [(401,503),(403,503),(429,429),(500,502)]:
            with patch.object(audition.Path,'read_text',return_value='test-secret'),patch.object(audition.urllib.request,'urlopen',side_effect=urllib.error.HTTPError('url',code,'test-secret',{},None)):
                with self.assertRaises(audition.HTTPException) as raised:
                    audition.generate(audition.Audition(model='melo',voice='en',text='Hello.'))
                self.assertEqual(raised.exception.status_code,expected)
                self.assertNotIn('test-secret',raised.exception.detail)

    def test_deepinfra_dictionary_payload_and_provider_cost(self):
        for model in ['kokoro', 'kokoro-corrected']:
            result={'audio':'data:audio/mpeg;base64,'+base64.b64encode(b'ID3sample').decode(),
                    'inference_status':{'status':'succeeded','cost':0.00012}}
            with patch.object(audition.Path,'read_text',return_value='private-key') as read, patch.object(audition.urllib.request,'urlopen',return_value=Reply(json.dumps(result).encode(),'application/json')) as call:
                response=client.post('/audition/speech',json={'model':model,'voice':'bf_emma','text':'Houthi https://example.org/Houthis'},headers=origin)
                self.assertEqual(response.status_code,200)
                self.assertEqual(response.content,b'ID3sample')
                self.assertEqual(response.headers['x-provider-cost'],'0.00012')
                payload=json.loads(call.call_args.args[0].data)
                self.assertEqual(payload['preset_voice'],['bf_emma'])
                self.assertEqual(payload['service_tier'],'default')
                self.assertTrue(payload['text'].endswith('https://example.org/Houthis'))
                self.assertEqual('[Houthi](/' in payload['text'],model=='kokoro-corrected')

    def test_deepinfra_payment_failure_and_invalid_audio(self):
        for failure in [urllib.error.HTTPError('url',402,'private-key',{},None),None]:
            reply=Reply(json.dumps({'audio':'https://untrusted.example/audio','inference_status':{'status':'succeeded'}}).encode(),'application/json')
            with patch.object(audition.Path,'read_text',return_value='private-key'), patch.object(audition.urllib.request,'urlopen',side_effect=failure,return_value=reply):
                with self.assertRaises(audition.HTTPException) as raised:
                    audition.generate_deepinfra(audition.Audition(model='kokoro',voice='af_heart',text='Hello.'))
                self.assertEqual(raised.exception.status_code,402 if failure else 502)
                self.assertNotIn('private-key',raised.exception.detail)
