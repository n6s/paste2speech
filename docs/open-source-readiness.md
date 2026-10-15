# Single-repository publication readiness

Preparation date: 2026-10-15. Existing repository: `n6s/paste2speech`.
Publication is pending; this document grants no license. No separate curated
repository, history rewrite, force-push, deployment or visibility change is part
of this preparation.

Roger authorized preparation with the real history intact and explicitly
accepted the historical contact addresses and operational records remaining
visible. Those records are retained. Deployment identifiers, personal commit
email, private hostnames and testing grants are intentional disclosures, not
credentials or newly created entitlements.

## Review coverage and result

At source revision `e112832ad43b8521276a3f66c1204dcfc959c2b1`, the review scanned
324 reachable commits, 2,087 distinct blobs (22,178,039 bytes), all commit metadata
and 540 historical paths. Both GitHub branch tips were locally reachable; there
were no remote tags, pull requests, issues or releases. Current GitHub visibility
was private. Dangling/reflog-only objects and private ignored workspace contents
were outside the publication-history scan.

Recognizable credential, key, JWT, signed-capability URL and high-entropy literal
checks found no confirmed live credential. Private-key markers were deliberately
invalid test fixtures; other candidates resolved to checksums, public product
identifiers, synthetic cookies, diagnostic prose or a credential-file path.
Manual review of tracked OCR PDFs found synthetic proof content. Tracked raster
images were site/extension branding; MP3s are documented generated previews and
fixtures. No tracked customer scan or feedback screenshot was identified.
This is a bounded review, not proof that arbitrary secrets cannot exist.

Before changing visibility, rerun the review if source, refs or repository
attachments have changed. Inspect staged additions separately. Keep local
credential/feedback/backup files ignored; do not force-add them. No credential
rotation or removal of historic operational records is indicated by this review.

## Prepared items

- README entry points and provider-free unit/browser-fixture instructions, with
  the obsolete raw-static startup recipe explicitly identified.
- Architecture and trust-boundary map, with concrete regression-test examples.
- Locked npm and observed CPU/CUDA dependency inventories, including embedded
  engine, model, font and asset exceptions.
- Upstream provenance/attribution for the vendored phonemization helper.
- Additional ignore patterns for future local environment/key files.

## Decisions still required

1. Approve a project license. Recommendation: **MIT for original code and
   documentation**, explicitly excluding third-party code/materials and
   branding/audio rights not yet confirmed. No LICENSE file or package license
   declaration has been added. See the [licensing review](third-party-licenses.md).
2. Confirm ownership/reuse authority for first-party source, branding and the
   input passages used for generated demo audio. Commit authorship alone does
   not prove all underlying rights; no outside contributor agreement is assumed.
3. Decide how to handle binary redistribution whose embedded-engine provenance
   remains unresolved, especially optional browser Kokoro/phonemizer and the
   Python eSpeak loader. This is distinct from publishing our readable source
   and dependency declarations. Do not label every assembled build MIT.
4. Before shipping new binaries, satisfy the notices/corresponding-source
   checklist in the licensing review. Existing ffmpeg archives are hash-pinned,
   but byte-for-byte reproduction of the upstream binary has not been proven.
5. Obtain the separate publication approval and confirm GitHub remains on the
   intended existing repository. Public copies/forks cannot reliably be recalled.

No live billing or provider authorization should depend on repository secrecy.
Public source must not weaken the existing server-enforced checks.
