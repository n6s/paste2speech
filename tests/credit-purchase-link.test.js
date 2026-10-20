import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('insufficient-credit purchase link keeps the reading tab open and isolates billing', () => {
 const html = readFileSync('public/index.html', 'utf8');
 const actions = html.match(/<div id="credit-actions"[^>]*>([\s\S]*?)<\/div>/)?.[1];
 assert.ok(actions, 'credit recovery controls exist');
 const link = actions.match(/<a\b([^>]*)>/)?.[1];
 assert.ok(link, 'top-up remains a native link');
 assert.match(link, /href="\/api\/billing"/);
 assert.match(link, /target="_blank"/);
 assert.match(link, /rel="noopener noreferrer"/);
 assert.match(actions, /id="credit-resume"/);
 assert.match(actions, /id="credit-browser"/);
});
