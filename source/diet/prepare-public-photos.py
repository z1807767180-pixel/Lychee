"""Fetch the eight pinned public Nutrition5k test photos. No model requests are made."""
import hashlib
import io
import json
from pathlib import Path
from urllib.request import urlopen

from PIL import Image

here = Path(__file__).resolve().parent
out = here.parent / '.local/v7-evidence/meal-reference'
out.mkdir(parents=True, exist_ok=True)
manifest = json.loads((here / 'nutrition5k-check.json').read_text(encoding='utf8'))
for sample in manifest['cases']:
    filename = out / (sample['id'] + '.jpg')
    if filename.exists() and hashlib.sha256(filename.read_bytes()).hexdigest() == sample['jpeg_sha256']:
        continue
    url = ('https://storage.googleapis.com/nutrition5k_dataset/nutrition5k_dataset/'
           f'imagery/realsense_overhead/{sample["id"]}/rgb.png')
    with urlopen(url, timeout=30) as response:
        raw = response.read()
    if hashlib.sha256(raw).hexdigest() != sample['rgb_sha256']:
        raise ValueError('Public source has changed: ' + sample['id'])
    buffer = io.BytesIO()
    Image.open(io.BytesIO(raw)).convert('RGB').save(buffer, 'JPEG', quality=90)
    encoded = buffer.getvalue()
    if hashlib.sha256(encoded).hexdigest() != sample['jpeg_sha256']:
        raise ValueError('JPEG differs from the reviewed sample: ' + sample['id'])
    filename.write_bytes(encoded)
print(f'{len(manifest["cases"])} public photos ready')
