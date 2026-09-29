"""Package the production extension for Chrome Web Store (manifest at ZIP root)."""
from hashlib import sha256
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import json

root = Path(__file__).resolve().parents[2]
source = root / 'dist/chrome-extension/production'
manifest = json.loads((source / 'manifest.json').read_text())
assert manifest['name'] == 'PasteToSpeech'
assert manifest['host_permissions'] == ['https://pastetospeech.com/*']
files = ['manifest.json', 'config.js', 'background.js', 'controller.js', 'content.js',
         'popup.html', 'popup.js', 'icon-16.png', 'icon-32.png', 'icon-48.png', 'icon-128.png']
assert {p.name for p in source.iterdir()} == set(files), 'Unexpected extension files'
assert '__readSelection' not in (source / 'background.js').read_text(), 'Test entry point must not ship'
output = root / 'dist/chrome-extension/store'
output.mkdir(parents=True, exist_ok=True)
target = output / f'pastetospeech-{manifest["version"]}-webstore.zip'
with ZipFile(target, 'w', ZIP_DEFLATED) as archive:
    for name in sorted(files):
        archive.write(source / name, name)
with ZipFile(target) as archive:
    assert archive.testzip() is None
    assert set(archive.namelist()) == set(files)
    for name in files:
        assert archive.read(name) == (source / name).read_bytes()
(output / 'package-sha256.txt').write_text(f'{sha256(target.read_bytes()).hexdigest()}  {target.name}\n')
print(target)
print('Verified: production only, manifest at ZIP root, no staging files or test entry point.')
