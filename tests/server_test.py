import asyncio
import unittest
import httpx
from server.app import app

class FakeEngine:
    def synthesize(self, job):
        return b'RIFFtest'

class ServerTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        app.state.engine = FakeEngine()
        app.state.busy = False
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://localhost')

    async def asyncTearDown(self):
        await self.client.aclose()

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

if __name__ == '__main__':
    unittest.main()
