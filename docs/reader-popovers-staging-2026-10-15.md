# Staging presentation correction

Roger reviewed 95ca054 in the browser and requested a second presentation pass.
The reader now presents Edit, Read and a split Summary action with an attached
caret. The caret opens supported Brief, Standard and Detailed choices; selecting
one changes the next explicit Summary action without generating or charging.
Standard remains the initial choice. The main action retains its quoted credit
cost. Provider, source/output limits and retention are available through Info in
the choices popup. Existing 24,000-byte source/512-token output bounds remain;
Detailed is the existing short-summary setting. No new engines or meeting feature.

Six Info controls (input, file processing, Summary, playback, voice and cleanup)
share a fixed 32px icon style and native top-layer popovers. Content is constrained
to the visual viewport, scrolls internally, and retains a compact close control.
Escape restores visible trigger focus; keyboard Tab reaches the popup controls;
outside clicks dismiss. Dismissal cannot click through to a paid action, including
a long touch; safe controls such as Pause can still act. Popovers do not change
page height or editor position. Summary Info returns focus to its visible caret.

The old Open documents & images section is removed from the durable staging UI.
Only selected-file context appears at the input: filename, compact Info, current
upload/price/provider action, cancellation and relevant result/export controls.
Selection still does not upload. The disclosed Cloudflare upload and subsequent
exact Mistral page quote remain separate foreground actions. Identity/lease/cache,
ledger, uncertain-attempt and credit handling are unchanged. Open file uses the
same quiet typography, target, spacing and hover/focus treatment as the input
header's Clear and Paste actions.

The old bottom-page formatted-paste/provider paragraph is removed. Paste/original
editing details live in input Info. WaveNet provider/24-hour retention and the
browser speech internet caveat live in voice Info. Playback Info retains the
legend and pause/preparation guidance. Existing speed-adjusted timeline code and
source-time seeking are preserved.

Validation includes the full release gates plus synthetic desktop/mobile visual
captures for all six Info controls closed/open, Summary choices and the corrected
screen. Checks cover fixed icon dimensions, no layout shift, viewport constraints,
keyboard/focus/Escape/outside/long-touch handling, and no generation from choosing
a type or dismissing Info. Native OCR, cache, cancellation, feedback, timing,
interruption and wallet regressions retain their synthetic/provider-free checks.
Private evidence is under work/ui-popover-correction-2026-10-15/.
Only staging is authorized for this correction. No installed extension rebuild,
production deployment, payments or paid provider calls are part of this work.
