# Explicit math wording preview — staging prototype

On staging, new readings convert explicit math locally before Read mode and Play.
The editable original and exports remain unchanged. Older saved audio keeps its
original wording. Open Text cleanup, then Math wording preview, to inspect or
copy wording without starting speech. No OCR or provider call is made by preview.

The preview uses official pinned MathJax 4.1.3 TeX-to-MathML and Speech Rule Engine
4.1.5 ClearSpeak English. MathJax parses the math; no custom algebra parser,
simplification or general inline-math detection is added. The isolated worker
uses a non-rendering DOM/XPath adapter and bundled base/English rules. It has no
remote rules, font fetch, TeX autoload or executable HTML surface.

Supported initial inputs: explicit `$...$`, `$$...$$`, `\(...\)`, `\[...\]`, selected
TeX environments and a safe basic MathML subset. Ordinary text such as `x^2`,
`1/2x`, currency and escaped dollars remains literal. Code/URL literals are
excluded. A narrow preview-only delimiter classifier admits OCR polynomials such
as `$ax^2 + bx + c$`; ordinary reader cleanup keeps its existing recognition.

Skip math notation wins in this preview and does not load the worker. This does
not expand or replace the current reader's Skip math behavior. Unsupported or
malformed formulas are kept exactly as written, with a warning. Missing engine,
cancellation, source/cleanup changes and timeout preserve the original.

Limits: 100,000 source characters, 64 formulas, 2,048 TeX characters per formula,
8,192 MathML characters, 512 XML nodes and 32 nesting levels. The worker is
terminated after eight seconds or cancellation, and after successful completion.
Entity declarations, processing instructions, foreign namespaces, scripts,
styles/URLs, unknown commands and dynamic macros are rejected. Only base/AMS TeX
packages are enabled. Large explicit spacing (quad/qquad) at the expression's
outer level becomes a semicolon between independently generated speech segments;
nested fractions/groups are not split.

Representative actual output:

- `$a^2-b^2$`: “a squared minus b squared”
- `$ax^2+bx+c$`: “a x squared plus b x plus c”
- `$a\cdot c$`: “a times c”
- `$$1^2=1\quad 6^2=36$$`: “1 squared equals 1; 6 squared equals 36”
- `\sqrt{x+1}`: “the square root of x plus 1 end root”
- The sample array: “2 lines Line 1: 2 x plus 5 equals 9 Line 2: 2 x equals 4”
- The factoring fraction: “the fraction with numerator 8 x squared plus 20 x and
  denominator 4 x equals 8 x squared over 4 x plus 20 x over 4 x”

Measured desktop worker: about 1,260,113 bytes raw / 282,607 bytes gzip, with
61 ms engine initialization and 177 ms cold wall time for ten formulas in one
recorded run. These are measurements, not mobile guarantees. The optional bundle
loads only after Preview wording and is excluded from the ordinary offline app
shell; unavailable/offline loading fails safely. No physical Pixel or audible
provider test is claimed.

`MATH_SPEECH_PREVIEW=1` applies only to staging. Public/trial builds exclude the UI
and worker asset even if their configuration contains the flag. Tests cover
actual worker execution under strict CSP, security inputs, currency, source
preservation, cancellation/stale callbacks, timeout and narrow mobile layout.
No new dependency advisory was introduced; existing Wrangler/Miniflare/Undici
advisories are outside this prototype and were not fixed through broad upgrades.

References:
https://docs.mathjax.org/en/latest/advanced/build/custom.html
https://github.com/Speech-Rule-Engine/speech-rule-engine
https://docs.mathjax.org/en/latest/options/input/tex.html

## Reader integration follow-up

New staging readings use speech-text version 5. Entering Read mode or pressing Play prepares explicit math wording locally before constructing the shared displayed/submitted chunks. Edit retains the original. Prepared wording is stored with new reading metadata so reload/offline recovery does not require loading the optional engine or changing the paid audio identity. Older saved readings retain their prior speech-text version and audio.

The explicit formula parser also accepts indented formulas outside fenced/inline code and balanced doubled-backslash clipboard parentheses containing math syntax. It does not decode arbitrary escaped prose. The exact bytes of Roger's original failing clipboard sample were not available; these are independently reproduced variants, not proof of which variant he used. Currency remains literal.

Conversion is bounded and fails without starting speech on engine failure. Pause, Stop, editing and stale-source checks supersede pending playback intent. No live provider calls are used by the reader parity regression.
