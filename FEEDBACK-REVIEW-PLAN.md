# Feedback gatekeeper — version 1

Status: implementation authorized on 2026-09-18. See FEEDBACK-REVIEW.md for the
implemented version and operational controls. The first version supplies source
evidence to a tool-disabled Codex run rather than exposing a shell to the agent.

## Outcome

A systemd user timer on Roger's workstation checks Feedback form submissions every
30 minutes. A local Codex investigation assesses new reports and sends Roger a
short, useful summary through the existing `@paste2speech_bot`. Roger returns to
this repository in Codex to discuss a report by ID and authorize any changes.
Telegram is outgoing only. No automatic fixes, deployments, or visitor replies.

## Existing pieces, verified in source

- `cloudflare/worker.js` stores reports in D1 before sending raw Telegram notices.
  Immediate delivery and the five-minute retry job both call `deliver()`.
- Reports have UUIDs, timestamps, optional email, and bounded diagnostics including
  public/private environment, engine, voice, release, browser/device and playback.
- Existing `status`, `attempts`, and `lease_until` describe raw Telegram delivery,
  not investigation. A previously sent report may still need review.
- D1 deletes reports after 90 days. The existing privacy disclosure covers Telegram
  copies; it needs review for automated analysis through Codex before activation.
- `shared/pronunciations.json` supplies Kokoro overrides; browser voices and the
  two Kokoro environments must be distinguished when assessing a report.
- `~/workarea/rogercodexbot2` demonstrates local Codex subprocess management,
  JSONL parsing, environment filtering, process-group cancellation, and systemd
  operation. Reuse those patterns without changing that bot or its Telegram polling.
  Its `--approve-for-me` execution policy is not appropriate for this read-only job.

## Architecture and boundaries

1. A small local Python controller retrieves bounded, paginated D1 rows through
   authenticated Cloudflare tooling. No public inbox endpoint is added. Initially
   use the installed Wrangler command with JSON output behind a replaceable adapter;
   validate unattended authentication and actual output shape during implementation.
2. The controller owns credentials, SQLite state, retries, and Telegram delivery.
   Codex receives report text, non-contact diagnostics, and a sanitized source
   snapshot. Do not pass email addresses or delivery credentials to the model.
3. Run fresh, bounded `codex exec` investigations with read-only shell permissions,
   no interactive approvals, no inherited connectors/hooks, and structured output.
   Use the installed CLI's supported configuration, verified during implementation.
   Keep authentication available without inheriting the general user's tool access.
4. Supply only relevant tracked project files and controller-collected diagnostic
   evidence. Exclude `.dev.vars`, local configuration, credentials, and unrelated
   home files. A read-only policy alone does not restrict reading secrets: verify
   filesystem visibility and connector isolation with adversarial tests before use.
   If that boundary cannot be enforced, do not activate unattended processing.
5. The controller validates results, saves a readable report, builds the Telegram
   message from bounded fields, and sends it to the fixed owner chat. The model
   cannot choose recipients, invoke Telegram, modify code, or authorize itself.

Codex non-interactive execution supports JSONL events and JSON-schema-constrained
final output: [official documentation](https://learn.chatgpt.com/docs/non-interactive-mode).
This is a new local agent run with supplied project context, not a wake-up of this
particular conversation. Persistent report files provide continuity here.

## Review behavior

Classify reports as appreciation, dissatisfaction, bug, suggestion, pronunciation,
or spam/abuse, allowing multiple labels. Negative opinions are not automatically
spam. Save every accepted submission's disposition; suppress obvious spam notices
and group repetitive low-value reports when practical, retaining individual IDs.

For appreciation or non-actionable criticism, a short summary is enough. For a
technical report, inspect relevant implementation and available diagnostics;
distinguish observed facts, plausible causes, and missing evidence. Only claim a
reproduction or test when it actually ran. Version 1 does static investigation by
default; executable reproduction requires an explicitly isolated approved harness.
Never execute a visitor-supplied command or follow their links automatically.

Pronunciation recommendations include the reported word/phrase, affected engine,
proposed spoken form, likely implementation location, possible ambiguities, and
validation needed. Browser voice problems may not be fixed by the Kokoro dictionary.
Phoneme changes still require listening checks across relevant voices; desktop
results do not establish mobile behavior.

Result schema: report ID, category, short summary, evidence, hypothesis, uncertainty,
recommended action, approval needed, related report IDs, and validation performed
or still required. Store source commit, reported release, prompt/schema version,
run time, and available usage metadata alongside the result.

## State, cadence, and recovery

- Private durable state: `~/.local/state/paste2speech-feedback/`, with SQLite and
  per-report JSON/Markdown records. Owner-only permissions; never commit raw reports.
  Add a repository command such as `feedback-review show <ID>` and document the
  location so future Codex sessions can retrieve records directly.
- Keep the original UUID as the authoritative reference in Telegram and local files.
  Short IDs are optional display aliases, with collision checking and full-ID lookup.
- Local states: imported, investigating, reviewed, notification_pending, notified,
  suppressed, needs_attention. Track attempts and timestamps for each stage separately.
- Import transactions and UUID uniqueness prevent duplicate work. A poll cursor
  advances only after rows are saved. Use a timestamp/ID cursor plus overlapping
  reconciliation scans of retained rows to recover ties, restarts, and late imports.
- Use a process lock, atomic file writes, and stale-run recovery. Save the validated
  result and outgoing message before attempting Telegram; retry delivery without
  repeating a completed investigation.
- Initial limits: five investigations per tick, five minutes per investigation,
  25 minutes per service run, and three investigation attempts before needs_attention.
  Keep excess work queued. Authentication/rate-limit failures back off rather than
  generating repeated model runs or Telegram noise.
- Telegram acknowledgments store message IDs. Ambiguous send failures can produce
  duplicates; retain a stable report ID and label a retried notice where appropriate.
  Do not promise exactly-once delivery across the Telegram/database boundary.
- Use a oneshot user service and calendar timer at :00 and :30, persistent catch-up,
  bounded stop time, and process-group cleanup. Verify user lingering if operation
  while logged out is desired. A sleeping/offline workstation catches up when back;
  this is not a guarantee of review within 30 minutes.
- No message when there is no new feedback. Send one actionable failure notice per
  failure episode when Telegram works, with a recovery notice when resolved. If
  delivery itself fails, preserve local health/error state and retry with backoff.
- Apply the existing 90-day horizon to local raw input, model output containing
  quotes, and diagnostic records, measured from submission time. Use ephemeral
  model sessions and bounded/scrubbed logs so hidden transcripts do not defeat
  retention. Keep useful longer-term issue summaries only after removing personal
  information and unnecessary original text. Telegram retains its own copies.

## Telegram experience

Aim for one short message per actionable report; batch simple sentiments if needed.
Include the category, report reference, finding, uncertainty, and next action.
Example (illustrative, not a real finding):

> Paste to Speech · pronunciation · Report <ID>
>
> A visitor says “ExampleName” sounds wrong with on-device Kokoro. I found no
> dictionary override. A targeted override may help, but the intended pronunciation
> and an audio check are still needed.
>
> No changes made. When ready, ask Codex in paste2speech: “Review feedback <ID>.”

Appreciation should remain human and brief. Do not turn every opinion into a bug
or repeat offensive language unnecessarily. Telegram messages need not include
reply addresses. No incoming message polling or approval buttons in version 1.

## Implementation slices

1. **Controller and records:** add `scripts/feedback_review/` modules for import,
   state, report lookup, and dry-run operation. Include fixtures for existing D1
   rows with and without diagnostics. Fetch retained history into an explicit
   baseline; by default archive pre-cutover rows without notifying, with targeted
   replay available. Import independently of old delivery status.
2. **Investigation:** add the prompt, output schema, isolated runner, timeouts,
   validation, and deterministic message rendering. Test on synthetic appreciation,
   criticism, bug, pronunciation, and malicious-instruction submissions.
3. **Delivery and scheduling:** add the Telegram adapter and
   `deploy/paste2speech-feedback-review.service` / `.timer`, plus install, status,
   dry-run, retry, and lookup instructions. Keep installation inactive until rollout.
4. **Worker switch:** introduce a documented delivery mode, defaulting to today's
   direct notifications. In review mode, both immediate and scheduled raw delivery
   are disabled while D1 ingestion and retention continue. Review state stays local;
   old delivery columns retain their existing meaning. Update privacy wording and
   `RELEASE.md`; do not alter the public Feedback form's basic interaction.
5. **Prove and cut over:** complete the checks below, review one synthetic Telegram
   summary with Roger, then obtain approval for the concrete Worker release and timer
   activation. Record the baseline/cutover, switch delivery mode, enable the timer,
   and verify a post-cutover sample through the whole path. Reconcile submissions
   arriving during the transition; preserve any uncertain entries for review.

## Acceptance checks

- Quiet empty polls and restart-safe import; correct pagination/timestamp ties.
- Historical reports already marked sent are not mistaken for investigated reports.
- Locking prevents overlap; killed runs recover; invalid output and timeouts do not
  discard feedback; queued reports eventually get their turn.
- A saved investigation survives failed Telegram delivery without another model run.
- Injection fixtures cannot access secrets, write project files, activate inherited
  tools, send messages, or change the recipient. Verify effective isolation, not
  just prompt wording or an empty environment.
- Existing feedback validation, diagnostics, deduplication, and retention still pass.
  Both raw-send paths honor review mode. Test rollback mode as well.
- Read back stored records and compare the delivered summary/reference. A fresh
  interactive session can locate the complete report by the Telegram reference.
- Verify timer schedule, missed-run behavior, auth failure reporting, retention,
  and actual user-service environment. Do not consume real feedback in tests.

Rollback: stop the local timer and restore direct Worker notifications. Preserve
local records. Reconcile review-era raw statuses before restarting direct delivery
so already summarized reports are not blindly resent; send remaining unnotified
reports through the restored path. No feedback deletion is needed for rollback.

## Decisions to confirm through implementation

The desired behavior is settled: one-way Telegram, 30-minute polling, proposals
only, interactive decisions here. Remaining technical checks are unattended
Cloudflare/Codex authentication, effective isolation, and a suitable explicit model
configuration using Roger's existing access. No paid API-key setup is assumed.
The proposed limits and historical baseline policy above are defaults, not blockers
to building and reviewing the implementation.
