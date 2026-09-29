# Cached WaveNet test audio

Previously generated synthetic US/UK WaveNet samples for private offline reader
tests. Text and timing metadata are in `scripts/wavenet-worker-proof/fixture.json`.
These files contain no user reading or account data. The private reader build
copies them for the local fixture backend; staging cannot select fixture mode.
No credentials or new speech requests are needed to build or run these tests.
