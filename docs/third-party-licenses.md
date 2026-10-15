# Third-party licensing review

Reviewed 2026-10-15 against `e112832ad43b8521276a3f66c1204dcfc959c2b1`.
This is an inventory and release recommendation, **not a first-party license
grant or a certification that every possible combined binary is cleared**.
The [machine-readable inventory](dependency-license-inventory.json) records 191
npm lockfile entries, 100 observed CPU-environment distributions, 115 observed
CUDA-environment distributions, and 18 verified encoder source archives. Input
hashes identify the exact manifests reviewed. Recheck after dependency changes.

## Recommended first-party license

Recommend [MIT](https://opensource.org/license/mit) for Roger's original source
and documentation, subject to approval. MIT permits commercial use and reuse
with its copyright/permission notice. It does not change third-party rights,
service terms, trademarks or ownership of other people's input documents.
No root LICENSE or package license field has been applied during preparation.

Use explicit third-party exceptions: `vendor/phonemize.js` remains Apache-2.0;
models, engines, fonts, third-party libraries and any unverified branding/audio
remain under their applicable terms. An MIT grant for our contributions must
not be presented as MIT-only licensing of a combined GPL-containing build.
Where a distributed combination is subject to GPL, retain our MIT notice and
satisfy the combination's GPL requirements. Choosing GPL for our code instead
would not resolve missing engine source/build provenance.

## Code, models and browser engines

| Component / actual use | Evidence and terms | Required handling / review result |
| --- | --- | --- |
| Vendored `vendor/phonemize.js` | Byte-identical to [upstream Kokoro helper at `e0bf641`](https://github.com/hexgrad/kokoro/blob/e0bf641def52db8471d4330d04948056e08e2248/kokoro.js/src/phonemize.js); upstream Apache-2.0, retained `vendor/KOKORO-LICENSE` | Attribute upstream authors, retain license/notices and mark any future changes; exclude from first-party MIT. See `vendor/README.md`. |
| Kokoro Python 0.9.4 and Misaki 0.9.4 | Installed Apache-2.0 license texts; [Kokoro upstream license](https://github.com/hexgrad/kokoro/blob/main/LICENSE) | Preserve Apache license and applicable notices when redistributing. Python packages are installed dependencies, not tracked application source. |
| Kokoro ONNX weights, tokenizer and six voice embeddings | `browser/model.js` pins `1939ad2a8e416c0acfeecc08a694d14ef25f2231`; [that model card](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/blob/1939ad2a8e416c0acfeecc08a694d14ef25f2231/README.md) declares Apache-2.0 | Downloaded from Hugging Face, not committed. Preserve that license and model provenance on redistribution; the declaration is not an audit of training-data or voice/personality rights. A first-party license does not relicense weights. |
| `@huggingface/transformers` 3.8.1 | Installed Apache-2.0 LICENSE; [official repository](https://github.com/huggingface/transformers.js) | Retain license/notices, including any upstream NOTICE; mark modifications. Its conditional Node/native packages need their own terms. |
| `onnxruntime-web` / common and native runtime entries | Locked versions in JSON; [official MIT license](https://github.com/microsoft/onnxruntime/blob/main/LICENSE), [third-party notices](https://github.com/microsoft/onnxruntime/blob/main/ThirdPartyNotices.txt) | Generic browser build copies WASM/MJS runtime files; retain MIT and third-party notices with redistributed runtime. Package metadata alone is not a complete binary-notice inventory. |
| `phonemizer` 1.2.1 wrapper + embedded eSpeak engine/data | npm publisher commit `6835144b7ee9043129222549c1ed2f6a27216278`; wrapper declares Apache-2.0, [upstream eSpeak COPYING is GPLv3](https://github.com/espeak-ng/espeak-ng/blob/master/COPYING); [open provenance/license issue](https://github.com/xenova/phonemizer.js/issues/6) | **Unresolved binary distribution item.** Wrapper metadata does not clear embedded GPL code. Exact engine revision, runtime/toolchain and corresponding build sources/notices were not established. Do not call this assembled dependency Apache-only/MIT-only. Obtain matching source/build records or use a verified replacement before distributing that optional browser engine as cleared. |
| `pdfjs-dist` 6.3.289 | Installed Apache-2.0 LICENSE; [PDF.js](https://github.com/mozilla/pdf.js) | Current builds copy the PDF worker and bundle the parser; distribute applicable Apache license/notices with those artifacts. Font exceptions are below. |
| `pdf-lib` 1.17.1; `fflate` 0.8.3 | Installed MIT licenses; [pdf-lib](https://github.com/Hopding/pdf-lib), [fflate](https://github.com/101arrowz/fflate) | Retain copyright/permission notices in source/binary distributions. Staging already copies `word-LICENSE.txt` for fflate. |
| npm transitive / development tools | Every one of 191 lock entries declares a license; exact versions/dev/optional flags in JSON | MIT, Apache, BSD, ISC, BlueOak, Zlib, CC0/0BSD and LGPL declarations are represented. Metadata is a locator, not proof of embedded-code clearance. esbuild/Playwright/Wrangler are build/test tools, not automatically part of a shipped reader. LGPL libvips/native image packages are conditional; preserve their own notices/source/relinking rights if redistributing them. |

The current shared Cloudflare reader build excludes LocalKokoro and its model
implementation. The older generic `npm run build` bundles the browser Kokoro
worker. The unresolved embedded-eSpeak issue therefore must be scoped to the
artifact being distributed, not used to declare every hosted reader GPL or every
file in this repository unpublishable.

## ffmpeg.wasm, codecs and matching source

`@ffmpeg/ffmpeg` 0.12.15 is the MIT JavaScript wrapper. `@ffmpeg/core` 0.12.10 is
GPL-2.0-or-later in the installed metadata. The retained upstream Dockerfile
contains `--enable-gpl`; do not substitute the license of a minimal LGPL-only
FFmpeg build. [ffmpeg.wasm's FAQ](https://ffmpegwasm.netlify.app/docs/faq/) explains
that the core follows FFmpeg and external-library terms; [FFmpeg's official
licensing page](https://ffmpeg.org/legal.html) distinguishes LGPL/GPL builds.

Video-enabled builds ship the wrapper, worker, generated core JS and WASM split
into segments. Splitting/reassembling the binary does not remove its license.
`cloudflare/reader/licenses/` retains GPL/MIT text, a license page, build notes,
the upstream Dockerfile and a source manifest. `copyEncoderSources()` verifies
and serves all 18 pinned archives next to the binary. All 18 cached archives
matched their recorded SHA-256 hashes in this review. The evidence JSON lists
license-file locations within each archive.

| Source group | Terms requiring preservation |
| --- | --- |
| ffmpeg.wasm integration/wrapper | MIT wrapper/integration; engine and linked libraries keep their terms |
| FFmpeg, x264, x265 | GPL licensing applies to this enabled core; retain each upstream COPYING and corresponding source |
| LAME; FriBidi | Library/Lesser GPL texts (LAME archive includes Library GPL v2; FriBidi LGPL 2.1); retain notices and applicable source/relinking rights |
| libvpx, Ogg, Theora, Opus, Vorbis, libwebp | Upstream permissive copyright/disclaimer and any patent notices; inspect included COPYING/LICENSE files |
| FreeType | Its `docs/LICENSE.TXT` explains FTL/GPL alternatives; preserve the chosen branch's complete notices/conditions rather than assuming MIT |
| HarfBuzz; libass; zlib; zimg | Upstream MIT-like/ISC, Zlib and WTFPL terms respectively; zlib notice is in its README, not a missing LICENSE file |

For executable distribution, supply the complete corresponding source required
by the applicable GPL version: exact covered engine/library sources, changes,
interface/build/install scripts and relevant notices. For the current download
method, keep source archives equivalently accessible alongside the binary and
retain the GPL license/warranty notices; a link to an arbitrary current upstream
tree is not a matching-source substitute. If modifying GPL-covered code, mark
changes and apply the relevant GPL requirements to the covered combination.
Do not add EULA terms that remove those freedoms.

The existing archives are provenance against the upstream recipe, **not a
byte-for-byte reproducibility proof or exhaustive legal certification**. Confirm
that archive/build records correspond to the exact redistributed binary before
claiming binary-release compliance. Retain all embedded library notices, even
where the enabled core is GPL overall. No new binary release or deployment was
made during this review. Codec-patent questions are separate from copyright
licensing; this preparation does not claim patent clearance.

## Optional Python/native/CUDA environment

The JSON includes observed distribution versions, metadata license summaries and
installed license-file paths for both environments. These observations are
separate from version requirements; metadata can be incomplete or abbreviated.

- FastAPI/Uvicorn and spaCy/model packages have their own permissive licenses;
  Torch's base package is BSD-3-Clause and Transformers is Apache-2.0. Retain
  package and bundled third-party notices if shipping those distributions.
- `num2words` 0.5.14's installed COPYING is LGPL 2.1, not an MIT dependency.
  SoundFile is BSD, while its bundled libsndfile has separate LGPL terms in
  `_soundfile_data/COPYING`. Installed/native libraries are not relicensed by
  a proposed MIT application license. Redistributing them requires the applicable
  notices, corresponding source and modification/relinking provisions.
- **`espeakng-loader` 0.2.4 remains unresolved:** installed and PyPI license fields
  are absent and no license file was found. Its code loads an included native
  `libespeak-ng` plus engine data. Establish loader ownership/license and exact
  native-source/build provenance; upstream eSpeak GPL terms cannot be ignored.
- The CUDA environment includes proprietary NVIDIA wheels alongside open-source
  components. Do not describe the environment as entirely MIT/BSD or vendor it
  under the project license. Check each NVIDIA redistribution agreement before
  shipping wheels, containers or native libraries. Requirement files alone are
  not redistribution of those binaries; no environment is committed here.

## Fonts, icons, audio and other assets

- Application CSS/canvas uses system fonts; no standalone TTF/OTF/WOFF font file
  is tracked and no web-font download is configured. System font rendering does
  not imply that their font files can be bundled under our license.
- The installed PDF.js package includes `standard_fonts/LICENSE_FOXIT`
  (PDFium BSD-style notice) and `LICENSE_LIBERATION` (**GPLv2 with font/document
  embedding exceptions**, in this installed version—not a presumed OFL license).
  Current build scripts do not copy that directory. If redistributing those font
  files, preserve their actual notices, exceptions and applicable source terms.
- Text-to-sound SVG/PNG/ICO site and extension artwork appears in project history
  as approved custom artwork. External provenance/ownership has not independently
  been proven. Obtain Roger's confirmation before granting reuse rights over
  branding; a software license is not permission to imply service endorsement.
- Four WaveNet previews and sixteen cached test MP3s have documented generation
  and input text in `assets/voice-previews/` and the fixture manifests. They are
  synthetic speech, not recordings of customers. Confirm the passage rights and
  relevant provider output-use terms before putting audio under a broad reuse
  grant; no claim of exclusive rights over a provider's voice is made here.
- OCR PDFs reviewed are labeled synthetic proof documents. No real customer scan
  or feedback screenshot was found in the tracked history. User-provided reading
  content is not licensed by this repository.

## Publication versus artifact-release checklist

1. Approve an explicit license for original source; retain the vendored helper's
   Apache terms and distinct asset/model/third-party exceptions.
2. Keep required upstream licenses/copyrights and any NOTICE files; mark changes
   to Apache/GPL-covered files. Preserve notices in minified and worker bundles,
   not only in this source-level inventory.
3. Before distributing binaries, include a complete notice set for what was
   actually bundled/copied. The generic build currently copies the Kokoro license;
   do not assume that alone covers ONNX, PDF.js, phonemizer or their embedded code.
4. Clear the eSpeak binary/build provenance gaps or explicitly omit those binary
   distributions until resolved. Do not claim a license change fixes provenance.
5. Verify and retain the applicable corresponding-source delivery for ffmpeg and
   other copyleft binaries. Recheck whenever binaries, flags or dependencies change.
6. Confirm first-party source/asset authority and voice-passage rights. Keep
   generated environments, model caches, credentials and private user material out
   of source uploads. Do not bundle proprietary CUDA wheels by accident.

Publishing dependency declarations and our readable source is distinct from
redistributing every optional downloaded binary. These unresolved distribution
items are recorded transparently; they are not a finding of a live credential
leak, proof of infringement, or a reason to rewrite the accepted project history.
