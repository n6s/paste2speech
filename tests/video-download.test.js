import test from 'node:test';
import assert from 'node:assert/strict';
import {planPlaylist, joinCaptions, videoArguments, generatedLabel} from '../public/playlist-plan.js';
import {chunkText} from '../public/text.js';
import {validateInput} from '../cloudflare/prepared/job.js';
import {PlaylistSession} from '../public/playlist-session.js';

test('paragraphs stay whole, and no submitted part exceeds the provider ceiling', () => {
  const paragraphs = ['Alpha. '.repeat(1600), 'Beta. '.repeat(1600), 'Gamma. '.repeat(1600)];
  const parts = planPlaylist(paragraphs.join('\n\n'));
  assert.equal(parts.length, 2);
  assert.deepEqual(parts[0].chunks, [...chunkText(paragraphs[0]), ...chunkText(paragraphs[1])]);
  for (const part of parts) validateInput({voice: 'en-US-Wavenet-F', chunks: part.chunks});
  assert.deepEqual(parts.flatMap(p => p.chunks), paragraphs.flatMap(p => chunkText(p)));
});
test('small testing limit, oversized paragraph, Unicode, and unbroken tokens preserve text', () => {
  for (const text of ['Hello there. '.repeat(400), '😀'.repeat(500), 'x'.repeat(1001), 'First paragraph.\n\n' + 'Long word '.repeat(100)]) {
    const parts = planPlaylist(text, 100);
    assert.ok(parts.every(p => p.characters <= 100));
    assert.equal(parts.flatMap(p => p.chunks).join('').replace(/\s/g, ''), text.replace(/\s/g, ''));
    assert.ok(parts.flatMap(p => p.chunks).every(c => c.isWellFormed()));
    parts.forEach(p => validateInput({voice: 'en-US-Wavenet-F', chunks: p.chunks}));
  }
  assert.deepEqual(planPlaylist('  \n\n'), []);
  assert.throws(() => planPlaylist('hello', 20001));
});
test('subtitle joining uses precise audio offsets and preserves escaped text', () => {
  const one = 'WEBVTT\n\n1\n00:00:00.000 --> 00:00:01.001\nA &amp; B\n';
  const result = joinCaptions([one, one], [1.0008, 1.0008]);
  assert.match(result, /2\n00:00:01.001 --> 00:00:02.002\nA &amp; B/);
  assert.equal((result.match(/WEBVTT/g) || []).length, 1);
  assert.throws(() => joinCaptions([one], [.5]));
  assert.equal(generatedLabel(new Date('2026-09-24T16:44:59Z')), 'generated 2026-09-24 16:44 UTC');
  assert.ok(videoArguments(2).includes('mov_text'));
});
test('lost creation reply recovers the original ID; another Prepare never buys speech again', async () => {
  let posts = 0, saved;
  const session = new PlaylistSession([{chunks:['Hello']}], 'en-US-Wavenet-F', {
    save: records => {saved = structuredClone(records);},
    fetcher: async (url, options = {}) => {
      if (url === '/api/billing/session') return Response.json({});
      if (url === '/api/readings') { posts++; assert.equal(options.headers['Idempotency-Key'], saved[0].id); throw Error('lost reply'); }
      return Response.json({state:'ready', duration:3});
    }
  });
  await session.prepare(); await session.prepare(); assert.equal(posts, 1);
  assert.equal(session.records[0].state, 'ready');
});
test('uncertain status never creates a replacement; failed part prevents later admissions', async () => {
  let posts = 0;
  const session = new PlaylistSession([{chunks:['A']}, {chunks:['B']}], 'en-US-Wavenet-F', {
    fetcher: async url => {
      if (url === '/api/billing/session') return Response.json({});
      if (url === '/api/readings') { posts++; return Response.json({}); }
      return new Response('', {status:404});
    }
  });
  await assert.rejects(session.prepare()); await assert.rejects(session.prepare()); assert.equal(posts, 1);
});
test('stop during create cancels its late acknowledgement and never starts the next part', async () => {
  let posts = 0, deletes = 0, reply;
  const session = new PlaylistSession([{chunks:['A']}, {chunks:['B']}], 'en-US-Wavenet-F', {
    fetcher: async (url, options = {}) => {
      if (url === '/api/billing/session') return Response.json({});
      if (options.method === 'DELETE') {deletes++; return Response.json({});}
      if (url === '/api/readings') {posts++; return new Promise(r => {reply = r;});}
      throw Error('No polling after stop');
    }
  });
  const pending = session.prepare();
  while (!reply) await new Promise(r => setTimeout(r, 0));
  session.stop(); reply(Response.json({})); await pending; await session.cancelPending();
  assert.equal(posts, 1); assert.equal(deletes, 1); assert.equal(session.records[0].state, 'cancelled');
});
