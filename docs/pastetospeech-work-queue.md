# PasteToSpeech work queue

Updated October 28, 2026.

- **Summary correctness:** delivered to staging at `bcb9e559`. Native D1 claims use exact attempt ownership rather than trigger-inclusive change counts. Competing presets wait clearly. Results, audit records and credits are preserved; no paid replay or ledger repair was performed.
- **Scoped staging validation:** implemented in `33ce0d4` and `46c8a3f`. Fresh measured Summary-only preparation took 27.4 seconds versus 549.3 seconds full, retaining all 832 unit tests and required Summary/native-D1/public-billing coverage. Shared/unknown impact and production retain full validation. See `docs/reader-release.md`.
- **Calmer playlist wording:** current staging release candidate removes “Needs preparation” and “Partly saved” labels for ordinary automatic preparation, without replacement filler. Genuine errors, active processing and verified offline readiness remain visible. This is presentation only; no playlist behavior redesign. Deployment verification is recorded separately in release evidence.
