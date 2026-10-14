import {mkdir, copyFile, writeFile, rm} from 'node:fs/promises';
const outputIndex = process.argv.indexOf('--output');
if (outputIndex !== -1 && !process.argv[outputIndex + 1]) throw new Error('--output requires a directory');
const output = outputIndex === -1 ? 'dist/chrome-extension' : process.argv[outputIndex + 1];
const targets = {production: 'https://pastetospeech.com', staging: 'https://staging.pastetospeech.com'};
for (const [environment, origin] of Object.entries(targets)) {
  const root = `${output}/${environment}`;
  await rm(root, {recursive: true, force: true}); await mkdir(root, {recursive: true});
  for (const file of ['background.js', 'controller.js', 'selection.js', 'content.js', 'popup.html', 'popup.js', ...[16,32,48,128].map(size => `icon-${size}.png`)]) await copyFile(`extension/${file}`, `${root}/${file}`);
  await writeFile(`${root}/config.js`, `export const ORIGIN = ${JSON.stringify(origin)};\n`);
  await writeFile(`${root}/manifest.json`, JSON.stringify({
    manifest_version: 3, name: `PasteToSpeech${environment === 'staging' ? ' — Staging' : ''}`, version: '0.1.1', minimum_chrome_version: '112',
    description: 'Read highlighted text aloud with PasteToSpeech using your saved voice and speed.',
    icons: Object.fromEntries([16,32,48,128].map(size => [size, `icon-${size}.png`])),
    permissions: ['contextMenus', 'storage', 'activeTab', 'scripting'], host_permissions: [origin + '/*'],
    background: {service_worker: 'background.js', type: 'module'},
    action: {default_title: 'PasteToSpeech', default_popup: 'popup.html'},
    content_scripts: [{matches: [origin + '/'], js: ['content.js'], run_at: 'document_idle'}],
    incognito: 'not_allowed',
  }, null, 2) + '\n');
  console.log(`${environment}: ${root}`);
}
