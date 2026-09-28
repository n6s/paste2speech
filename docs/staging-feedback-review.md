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

Activation verified September 28, 2026: all four retained reports reviewed as
benign tests and notified once (Telegram message IDs 26–29). Latest report
28a36aee-8183-4636-93b5-b16c3a883db8 delivered as message 29. A second service
run imported zero rows, stayed healthy and left every delivery_attempts count at
one. All 16 reviewer tests passed. Production service and state were untouched;
no Worker deployment or billing configuration change was required.
