# Staging feedback review

The staging reviewer polls only private-wavenet-reader-staging with the staging
Wrangler configuration. P2S_FEEDBACK_ENVIRONMENT=staging selects a separate
SQLite queue, lock, reports and temporary review directory under
~/.local/state/paste2speech-feedback-staging. The existing production service,
queue, database and schedule remain unchanged.

Install deploy/paste2speech-feedback-review-staging.{service,timer} in the user's
systemd directory and enable the timer. The service runs from the shared release
checkout; it reviews committed Cloudflare/frontend sources, excludes the unrelated
Python server and bounds source input to 350,000 characters. Tool-disabled
review isolation, retry/deduplication and no automatic fixes are retained.
Notifications go to Roger's existing Telegram destination, clearly prefixed
PasteToSpeech · staging. Benign pipeline tests use the test category.

Initial activation imports the four retained staging reports, including Roger's
September 28 test. Future scans run at :05 and :35 each hour; empty scans are quiet.
Staging reports are not merged into production, and no billing data is modified.
