# Resumable Summary documents — staging

The staging-only Summary document journal replaces the whole-source 24,000-byte
barrier. Original editor text is unchanged. Brief, Standard and Detailed retain the
existing split action and result box. Ordinary use stays one click. Info gives a
general cost expectation rather than a per-document token/price wall. Work whose
maximum exceeds six credits gets a concise maximum-price cue before a second
explicit click; six is an ordinary UX range, not a document or tariff ceiling.

Source is split locally at paragraph/sentence boundaries within a model-specific
67,712-byte safety envelope. That is a conservative byte-token upper bound, **not**
the provider's token limit or a whole-document cap. Unicode is preserved, including
chunk boundaries. Merkle proofs bind each incremental source section to one stable
account/source/preset/model-version identity. No full source is stored server-side.
A tab-local account-scoped IndexedDB draft supports reload; unavailable storage
leaves the editor usable and the same source can be pasted again to recover work.
Local drafts and server-generated sections have 24-hour retention.

The adapter uses the existing `@cf/meta/llama-3.2-3b-instruct`, raw Llama prompt
format, explicit wrapper budget and neutralized literal role-token prefixes. The
model has an 80,000-token context. Requests reserve prompt, output and context
headroom. Up to four notes combine per reduction stage. Each saved note has a
source-section range. Brief/Standard return the root overview; Detailed returns
that overview plus ordered original-section notes, avoiding a single tiny output
for a large document. This is lossy summarization, not guaranteed fact extraction.
No live model quality claim follows from the synthetic tests.

Map output budgets are 512/768/1,024 tokens. Single-pass final budgets are
512/1,024/1,536; multi-pass final budgets 512/1,024/2,048. Truncated output is not
silently accepted as complete. No tools or external retrieval are enabled.

## Credits and interruption

The server recomputes and reserves one maximum for all stages. The one-credit job
minimum remains. Above that, cumulative retail units are
`ceil(5 * provider_nanodollars / 10000)`, where one credit is 1,000 units. Model
pricing is $0.051/million input and $0.335/million output tokens; fivefold includes
operating/margin headroom, not an asserted payment-fee agreement. Quotes use safe
upper bounds; settlement uses validated returned usage. There is no per-section
minimum or rounding inflation. A variable-price job with missing usage keeps the
usable note without charging the unknown amount, stops further work and releases
unused reservation. It never calls a maximum quote an actual measured charge.

Reusable source notes are accessible in the result box and charged cumulatively.
Internal merge work is charged only when a usable final root is delivered. Pause
allows an in-flight operation to finish, exposes its usable section, and releases
unused credits. Summary resumes saved stages. Unknown provider outcomes are
retained and never blindly retried. Authoritative capacity/daily rejections permit
explicit later resume. Double clicks, lost acknowledgements and account changes
cannot create duplicate dispatches. Accepted legacy one-credit summaries reopen
without another hold or inference. Unresolved legacy requests remain protected.
Completion copy reports actual completed passes and settled credits; reopening
says no new charge.

Workers Free remains in effect: 10,000 shared neurons/day and the existing global
inference lease/circuit. No paid capacity upgrade or live model probe is included.
A large document may pause when real capacity is exhausted. Resume is explicit;
there is no automatic paid retry or promise of unlimited free capacity.

## Release and preservation

`0018_summary_documents.sql` is additive and staging-guarded, with immutable
financial/attempt journals. Rehearse against a fresh private staging backup:
compare every prior table's row hashes/counts, capacity, integrity and foreign
keys. Then apply only this SQL to staging before deploying the schema-enabled
Worker. Never apply it to production or restore an old wallet backup over newer
activity. Code rollback leaves the additive receipts in place; reconcile any
in-flight job and release unused holds through the journal-aware coordinator,
not by deleting receipts or overwriting balances.

Production client builds stub the new controller and production server routes
reject it. Translation, math, saved audio and podcast state remain separate.
Required gates include `tests/summary-documents-browser.mjs`, real synthetic
SQLite-ledger route tests and planner/provider fault tests, plus existing release
checks. Hosted UI tests intercept all Summary/provider calls and use isolated
browser profiles. Physical Pixel and real-model wording remain unverified here.

Official references:
- https://developers.cloudflare.com/workers-ai/models/llama-3.2-3b-instruct/
- https://developers.cloudflare.com/workers-ai/platform/pricing/
- https://github.com/meta-llama/llama3/blob/main/llama/tokenizer.py

## Partial-result status and failure diagnostics

Active progress names the current pass (starting at one) in the shared processing
indicator. Partial/error status always includes completed passes and settled
credits; a saved partial is not presented as a finished whole-document summary.
Its label identifies how many source parts have been covered, and its reader
action explicitly says partial. Opening a saved job refreshes the balance even
when no new work can start. Existing source and result identity rules still apply.

New failures retain an allowlisted category in the existing `reason` field and a
safe diagnostic phase in authenticated responses: provider response/HTTP status,
malformed response, output limit/empty/invalid output, unverified usage, dispatch
or settlement acknowledgement, or deadline. No provider message, prompt, source,
credential, token or response-body copy is added to failure diagnostics. Normal
usable generated results retain their existing private 24-hour storage. This does
not relax retry safeguards. Existing `uncertain` records stay unclassified; no
new cause is inferred or backfilled into old jobs. No schema migration or new
Worker variable is required for these categories.


## Confirmed output-limit recovery (0019, staging only)

The provider model has an 80,000-token context ([model documentation](https://developers.cloudflare.com/workers-ai/models/llama-3.2-3b-instruct/)). Source partitions remain 67,712 UTF-8/model bytes so existing source proofs and saved notes retain identity. Intermediate factual notes receive 4,096 output tokens independent of final Brief/Standard/Detailed length. A confirmed output-limit response permits one enlargement to 8,192; source/prompt/output plus reserved template headroom still fit context. Final output initially retains its chosen presentation budget, with one bounded doubling when confirmed truncated. Output is never silently accepted as complete at the limit.

The whole-job reservation includes the largest usable output at each stage. Only accepted reusable output with validated usage is settled, cumulatively; discarded truncated output is not charged. Failed attempt overhead is bounded and absorbed within the existing retail margin. Ordinary one-credit jobs remain one credit, including successful recovery. Unknown outcomes do not retry. Cancellation/pause wins before the next attempt. Archived dispatch records remain immutable.

Migration 0019 is additive and changes no existing job, attempt, result, balance or expiry. A previously blocked **classified output_limit** job can be recovered only after a fresh explicit Summary action, with an atomic approved budget revision and a normal remaining-credit hold. Saved successful work is reused. Unclassified/unknown outcomes cannot use this path. Expiry stays anchored to original addition; no deployment-time replay occurs.

Spinner and result status both count **completed** passes, including during recovery. A failed attempt never increments completion. Final status distinguishes complete from partial and shows actual settled credits. No real-book/provider validation is implied by synthetic tests.
