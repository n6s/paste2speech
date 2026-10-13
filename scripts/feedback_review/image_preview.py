"""Runs only inside the network/filesystem-isolated preview subprocess."""
from pathlib import Path
import subprocess
import sys
import warnings
from PIL import Image,ImageOps

Image.MAX_IMAGE_PIXELS=20_000_000
warnings.simplefilter('error',Image.DecompressionBombWarning)
folder=Path('/work');source=folder/'input-scan.bin';mime=sys.argv[1]
if mime=='application/pdf':
    subprocess.run(['/usr/bin/pdftoppm','-f','1','-l','3','-scale-to','1600','-png',str(source),str(folder/'preview')],
        stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,check=True,timeout=20)
    images=sorted(folder.glob('preview-*.png'))[:3]
elif mime in {'image/png','image/jpeg','image/webp'}:images=[source]
else:raise ValueError('unsupported_preview')
for number,path in enumerate(images,1):
    with Image.open(path) as original:
        image=ImageOps.exif_transpose(original)
        image.thumbnail((1600,1600),Image.Resampling.LANCZOS)
        clean=Image.new('RGB',image.size,'white');clean.paste(image.convert('RGB'),mask=image.getchannel('A') if 'A' in image.getbands() else None)
        clean.save(folder/f'preview-{number}.png','PNG')
# Remove any padded PDF outputs after rewriting the three fixed preview names.
for path in folder.glob('preview-*.png'):
    if path.name not in {f'preview-{n}.png' for n in range(1,len(images)+1)}:path.unlink()
