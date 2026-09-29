# Natural voice previews

These four Google WaveNet MP3s read the passage in `manifest.json` at normal speed.
They are public demo assets, separate from staging playback fixtures. The reader
serves them without creating a speech request, account, or credit deduction.

Generation: `.venv/bin/python scripts/generate-voice-previews.py` from the project
root. Requires google-auth and the existing local Google TTS credentials. Each
voice's attempt record is written before synthesis. Existing audio is reused;
a recorded attempt without audio stops generation for manual inspection. Never
remove attempts to trigger unattended retries. Initial generation processed 1,020
characters total. Preview playback does not call Google.

Both reader builds copy these assets and include their hashes in release metadata.
`npm run check:reader:previews` checks free playback, errors, account messaging,
and preserving prepared readings in real Chrome with fixture speech APIs.
