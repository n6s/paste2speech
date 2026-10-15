# License scope and asset provenance

Roger approved MIT on 2026-10-15. The [MIT license](LICENSE) applies to original
PasteToSpeech code, documentation and original sample text, subject to the
third-party exceptions below. Dependencies retain their own licenses; this is
not an MIT-only claim for every assembled binary or downloaded artifact.

## Artwork

Roger confirms the text-to-sound artwork was generated at his request and no
third-party artwork was copied. This covers the project artwork in
`public/favicon.svg`, `public/favicon.ico`, `public/favicon.png`,
`public/apple-touch-icon.png` and `extension/icon-*.png`.
To the extent Roger holds rights he can license in that artwork, it is included
under the project MIT permission. This does not assert exclusive human-authored
copyright, guarantee copyrightability of generated output, or grant rights Roger
does not hold. Use of the artwork does not imply endorsement by the hosted service.

## Original sample text and synthesized audio

The repository/generation records establish the following provenance without
requiring another owner confirmation:

| Tracked assets | Source and generation evidence | Scope |
| --- | --- | --- |
| Four `assets/voice-previews/*.mp3` | Passage/voices in `manifest.json`, generator `scripts/generate-voice-previews.py`, introduction commit `1893195`; all four `.attempt.json` records match the passage and byte length and record completion | Existing Google WaveNet output for the original project demo passage; served by both reader builds |
| Sixteen `tests/fixtures/wavenet/*.mp3` | Eight synthetic `SECTIONS` in `scripts/wavenet-mp3-proof/generate.py`; identical text in both voices in `scripts/wavenet-worker-proof/fixture.json`; probe/fixture history includes `f10d27c`, `24f5b18` and their preserved merged equivalents | Generated US/UK WaveNet test recordings; reused by tests and fixture-enabled builds |

These passages are fixed project examples, not customer submissions, readings
from an identified third-party publication, or recordings of a human narrator.
The original passage text is covered by MIT. The existing records establish
provenance; they do not prove exclusive rights over generated sound or Google's
underlying voices/models.

**The twenty synthesized MP3 recordings are not represented as blanket
MIT-licensed audio.** Their use remains subject to applicable
[Google Cloud terms](https://cloud.google.com/terms) and
[service-specific terms](https://cloud.google.com/terms/service-terms).
The generator uses Google's documented
[`text:synthesize` audio-file workflow](https://docs.cloud.google.com/text-to-speech/docs/create-audio).
A separate unrestricted sublicensing permission for the recordings themselves
was not established by this review. No voice/model/service rights, voice-cloning
rights or training permissions are granted here. This is the precise remaining
audio-rights limitation; the files are tracked recordings, not merely optional
runtime downloads. No audio was regenerated during licensing preparation.

## Third-party exceptions

- `vendor/phonemize.js` is upstream Apache-2.0 code, with
  [provenance and retained license](vendor/README.md); it is not relicensed MIT.
- npm/Python libraries and ffmpeg/ONNX/eSpeak engines retain their own terms.
  [The inventory and obligations](docs/third-party-licenses.md) distinguish
  source publication from distributing binary combinations.
- Kokoro weights, tokenizers and voice embeddings are downloaded runtime
  artifacts under their published model terms, not tracked first-party code.
- Fonts in third-party packages, optional native/CUDA libraries and their
  associated rights are not included in the first-party MIT grant.
- User-submitted documents, recordings, private feedback and other third-party
  content are not licensed by this repository.

The optional embedded eSpeak binary/build provenance remains unresolved. No new
compiled package is cleared or published by applying MIT to original code.
Repository visibility still requires separate final publication confirmation.
