# Feedback reviewer operations

The workstation runs `paste2speech-feedback-review.timer` at :00 and :30. It
imports the retained D1 inbox, reviews up to five new reports, and sends one-way
summaries through `@paste2speech_bot`. Offline time delays review until the
workstation returns. User lingering is enabled on the installed workstation.

## Continue a report in Codex

Tell Codex in this repository: **Review feedback <UUID>**. Retrieve its record with:

```sh
python3 -m scripts.feedback_review show <UUID>
```

Private records live in `~/.local/state/paste2speech-feedback/feedback.sqlite3` and
`reports/<UUID>.json` / `.md`. JSON includes the original message, diagnostics,
assessment, source commit, model, usage, and delivery state. The optional email
field stays in D1 and is not imported. Do not commit private reports to Git.
Reports and local review records expire 90 days after submission. Telegram copies
have separate retention. No visitor replies or Telegram reply polling are enabled.

## Controls

```sh
python3 -m scripts.feedback_review status
python3 -m scripts.feedback_review dry-run
systemctl --user status paste2speech-feedback-review.timer
systemctl --user start paste2speech-feedback-review.service
journalctl --user -u paste2speech-feedback-review.service -n 30
systemctl --user stop paste2speech-feedback-review.timer
```

`dry-run` checks D1 without importing or sending anything. `retry <UUID>` explicitly
queues a fresh investigation (including a previously baselined report); it does not
run until the next service start. `self-test` reviews and saves a labeled synthetic
report; only `self-test --send` sends it. `self-test --probe` checks available model
tools with a synthetic isolation request. Never use real credentials as canaries.
The local baseline is initialized once with `baseline`; existing reports are saved
without producing retrospective notices. New records are selected by timestamp,
independently of the old raw-notification delivery status.

## Investigation limits

Version 1 does **static source review**, not executable reproduction or live-log
analysis. The controller supplies bounded report diagnostics and an immutable
snapshot of tracked reader, browser, speech-server, dictionary, and Worker source
from the recorded Git commit. No reading content or audio is available unless the
visitor voluntarily includes text in their report. The source may differ from the
visitor's deployed release; the reviewer must state relevant uncertainty.

The Codex CLI runs with an isolated temporary home inside Bubblewrap. Host home,
repository, credentials, sockets, and general user configuration are not mounted.
Only a temporary copy of Codex authentication is provided for the CLI transport.
Shell, browser, connectors, plugins, hooks, memories, image, and multi-agent tools
are disabled. Hosted web search is disabled. Output is schema-checked; unexpected
action events reject the result. The model cannot select a Telegram destination.
Authentication expiry fails visibly and preserves the queue; refresh the normal
Codex login before retrying. The runner uses existing ChatGPT CLI access, not a
separate paid API key. It uses gpt-6-astra with low reasoning, matching the account's
current configured model at installation. A run is limited to five minutes per
report and 25 minutes for the service. Three failed attempts flag the report for
interactive attention. No claims of audio/device verification are made.

The CLI may emit a fixed warning that its Code Mode host is disabled; that is
intentional and fails closed. Other model errors reject the run. Temporary CLI
history/auth files are removed at completion; abrupt host shutdown can leave
`~/.local/state/paste2speech-feedback/runs/run-*` directories. The controller
cleans these private generated run directories on its next invocation. Controller logs contain only fixed
error classes/counts; report content lives only in private records.

## Installation and cutover

Files: `scripts/feedback_review/`, the two units in `deploy/`, and the Worker
`FEEDBACK_DELIVERY_MODE` variable. The default/unset Worker mode is `direct`, which
preserves legacy raw notices. `review` suppresses both immediate and scheduled raw
notices, preserving ingestion and 90-day D1 cleanup. The five-minute Worker cron
continues retention only in review mode.

Validate Python tests, Worker tests, service syntax, a live isolated model review,
and a synthetic Telegram summary before enabling the timer. Install both unit
files in `~/.config/systemd/user/` and reload systemd. Record the baseline, deploy
review mode, enable the timer, then verify a labeled post-cutover form submission.
Owner credentials remain under `~/.config/paste2speech/`; Wrangler uses the normal
authenticated local installation. The units pin the current Node directory and
must be updated if that runtime is removed.

## Recovery and rollback

Completed investigations are committed to SQLite before delivery. Failed sends
retry without another model run. A crash or ambiguous Telegram acknowledgment can
cause a repeated notice with the same report ID; exactly-once sending is not
promised. A lock prevents concurrent controller runs. Persistent failures generate
one general alert per episode; exhausted reports receive their own actionable
notice. If Telegram itself is unavailable, local status records the failure.

For rollback, stop the timer and wait for/stop the service. Preserve local records.
Before returning the Worker to `direct`, reconcile reports successfully summarized
in local state against D1's raw-delivery status: mark those specific IDs as sent
with their recorded Telegram message IDs. Leave unsummarized reports pending so
the existing delivery job picks them up. Review suppressed spam separately rather
than blindly forwarding it. Set `FEEDBACK_DELIVERY_MODE` to `direct`, commit and
release. No report deletion or database migration is needed.
