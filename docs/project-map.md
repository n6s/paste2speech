# Project map

The project is one repository with shared reader logic, deployment variants,
optional local inference, and an extension. The live service is
https://pastetospeech.com; cloning this repository does not grant hosted accounts,
credits, provider credentials or deployment access.

| Area | Entry points | Purpose |
| --- | --- | --- |
| Reader UI | `public/app.js`, `public/text.js`, `public/paste.js` | Editing, cleanup, paragraph/list preservation and speech controls |
| Prepared playback | `public/mse-buffer-player.js`, `public/staging-player.js`, `public/long-reading.js` | Progressive/file playback, retained audio, seeking, native interruption and explicit recovery |
| Extension | `extension/background.js`, `extension/selection.js`, `extension/controller.js` | Gesture-scoped selection capture, exact-origin reader discovery and acknowledged handoff |
| Cloud service | `cloudflare/reader/worker.js`, `cloudflare/reader/ledger.js`, `cloudflare/reader/webhooks.js` | Sessions, reservations/settlement, signed payment events and admission policy |
| OCR and Summary | `cloudflare/reader/ocr-job.js`, `cloudflare/reader/summary.js` | Consent-bound jobs, bounded source capabilities, uncertain-attempt handling and credit accounting |
| Browser inference | `browser/kokoro-worker.js`, `browser/model.js`, `vendor/phonemize.js` | Optional model/voice downloads and local synthesis; distinct dependency terms |
| Workstation service | `server/app.py`, `server/requirements*.txt` | Optional private Python/Kokoro deployment |
| Tests and release | `tests/`, `scripts/reader-parity/`, `docs/reader-release.md` | Unit, real-browser and native fixture checks; deployment gates |

Browser voices are available in the live reader. The current shared HTML and
modules are assembled by its build; use the README fixture checks to validate
locally without cloud credentials.
The shared cloud builds exclude the browser Kokoro engine; the older generic
build includes it. Video-enabled builds additionally deliver ffmpeg.wasm and
its pinned source archives. See the licensing review before redistributing
compiled artifacts or model/native-library bundles.

## Engineering examples to inspect

- Selection extraction and tab ownership: `tests/extension-selection.test.js`
  and `tests/extension.test.js` exercise whitespace, stale captures, restricted
  pages, cross-environment isolation and reuse of an existing pinned reader.
- Playback interruptions: `tests/playback-interruption.test.js` covers native
  pauses and the race before a queued pause event; the browser counterpart
  verifies controls, saved position and one-click Resume with real fixture MP3s.
- Server charging: reservations and immutable ledger events separate admission
  from settlement. Provider failures and ambiguous paid attempts need explicit
  handling rather than an automatic retry that might spend twice.
- Release evidence distinguishes browser simulation from actual device checks.
  A desktop media-pause test is not a physical Android Bluetooth test.

## Trust boundaries

Client-side controls and published source are never entitlement checks. The
server must authenticate the account, authorize each job/result/source read,
reserve available credit, validate provider/payment environment and signatures,
and settle idempotently. Provider and webhook secrets belong in server-side
secret storage. Price IDs and deployment identifiers are not substitute secrets.

Treat `work/`, local databases, feedback records, Access caches, credentials,
`node_modules/`, Python environments and generated builds as private/local
artifacts, not source releases. Existing deployment configurations and historical
notes are retained intentionally; fork operators must provision their own
resources and replace those identifiers before deployment.
