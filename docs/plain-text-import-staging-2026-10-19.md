# Local TXT import trial — October 19, 2026

Roger approved local TXT import and staging deployment, including the existing
Open, Open & Play, next and end-of-queue actions. Production promotion and other
export-format importers are not authorized by that approval.

`LOCAL_TEXT_IMPORT=1` enables the trial in staging. The builder independently
forces it off for production, even if the variable is accidentally present there.
The picker adds `.txt` and `text/plain`. TXT names accept text/plain, empty MIME,
and application/octet-stream; extensionless text/plain is also recognized.
A TXT name with a conflicting MIME is rejected rather than routed into image/PDF
scanning. Other unsupported extensions remain unsupported.

`public/plain-text.js` reads a bounded stream on the device: at most 20 MiB of
source bytes and 20,000,000 decoded UTF-16 code units, consistent with existing
local Word bounds. It supports UTF-8 with/without BOM and BOM-marked UTF-16LE/BE,
including BOMs/code points split across chunks. Decoding is fatal on malformed
sequences; it does not guess legacy code pages. UTF-32, binary controls, empty,
blank, truncated and oversized inputs fail without replacing existing text.
CRLF/CR are normalized to LF; Unicode, tabs and paragraph breaks are retained.
No markup is parsed, executed or fetched, and no file text is stored or logged.

TXT branches before scan diagnostics, OCR signature validation, quotes, uploads,
provider requests or debit. It does not need OCR consent, credit, or a successful
OCR configuration lookup. Page initialization can still read ordinary account /
OCR capability metadata; it sends no file content. There is no paid OCR fallback
when decoding fails. Any previously active scan retains its existing lifecycle
and cancellation rules.

The decoded string enters the existing intake/accept pathway. Ordinary Open loads
the editor without autoplay; Open & Play respects the selected voice/action.
Next/end imports resolve their original queue items without replacing current
editor text or interrupting playback. Explicit cloud speech still follows its
normal confirmation/credit rules when that action starts; free import is not a
free-speech entitlement. Cancellation, Clear, removed queue items, changed editor
text and a newer file prevent stale decoded text from committing.

Verification uses synthetic documents, mobile-emulated isolated Chrome, mocked
speech and intercepted APIs. Physical Android file-picker behavior and Roger's
private Life Review document are not claimed as tested. The focused browser
checks cover MIME variants, UTF-16, literal markup, zero balance, remembered scan
consent, signed-out/config-failure operation, all four input actions, queue order,
invalid/binary/oversized files and abort/stale-read races. Public-build checks
confirm the picker and routing remain off. Release gates include this browser
check when the staging flag is enabled. No database migration or dependency change
is required. Evidence: ignored `work/plain-text-import-staging-2026-10-19/`.

## Google Docs export formats

Current support and proposed priorities below are separate from implementation
permission. Only TXT is added in this trial.

| Export | Current app support | Recommendation / main considerations |
| --- | --- | --- |
| Word `.docx` | Local text extraction already supported, including paragraphs/tables; embedded images are reported but not OCRed automatically. | Good existing choice for ordinary Google Docs exports. Layout/floating content can affect reading order. |
| PDF `.pdf` | Existing local text extraction within its local limits; scanning is a separate disclosed, credited action when needed. | Good existing layout-preserving choice. Columns, scanned pages and weak text layers require care. |
| Plain Text `.txt` | New staging-only local decoding in this change. | Best small addition for a text-focused export; Unicode/encoding fidelity and local bounds are covered above. |
| OpenDocument `.odt` | Unsupported. | First follow-up candidate: a bounded ZIP/XML text importer, with manifest checks, paragraph/table order, entity/external-reference rejection, expansion limits, and explicit handling of encrypted files. |
| EPUB `.epub` | Unsupported. | Second candidate: useful for long reading, but must follow publication spine order, handle navigation/notes carefully, and extract text without scripts, remote resources or DRM circumvention. |
| Rich Text `.rtf` | Unsupported. | Lower priority while DOCX is available. Needs a real bounded parser for nested groups, escaped text, Unicode/code-page rules and embedded objects; regex stripping would corrupt some text. |
| Web Page `.html` zipped | Unsupported. | Defer until a separately reviewed inert archive importer exists. Must select intended pages, preserve reading order, constrain ZIP paths/expansion and discard active content/external fetches. Never mount exported HTML as a live page. |

The ODT and EPUB recommendations are engineering judgments, based on their
container and document structures: [OASIS OpenDocument packages](https://docs.oasis-open.org/office/OpenDocument/v1.3/os/part2-packages/OpenDocument-v1.3-os-part2-packages.html)
and [W3C EPUB 3.3](https://www.w3.org/TR/epub-33/). EPUB's spine specifies reading
order and its content can include scripting/media. RTF's control-language and
embedded-object requirements are documented in [Microsoft RTF 1.9.1](https://officeprotocoldoc.z19.web.core.windows.net/files/Archive_References/%5BMSFT-RTF%5D.pdf).
