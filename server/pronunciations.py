"""Shared speech-boundary dictionary for local and hosted Kokoro."""
import json
import re
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent

# Kokoro/Misaki phonemes: explicit pronunciations, independent of capitalization.
PRONUNCIATIONS = json.loads((ROOT / "shared" / "pronunciations.json").read_text())


def pronunciation_text(text, voice):
    entries = PRONUNCIATIONS[voice[0]]
    pattern = r'\b(?:' + '|'.join(re.escape(word) for word in entries) + r')\b'
    def correct(part):
        return re.sub(pattern, lambda match: f'[{match[0]}](/{entries[match[0].lower()]}/)', part, flags=re.I)
    # Apply only at the synthesis boundary, after pause planning and cleanup.
    return ''.join(part if re.match(r'(?:https?://|www\.)', part, re.I) else correct(part)
                   for part in re.split(r'((?:https?://|www\.)[^\s]+)', text, flags=re.I))

