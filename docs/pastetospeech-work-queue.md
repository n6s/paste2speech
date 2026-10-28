# PasteToSpeech work queue

Updated October 28, 2026. These are pending items, not claims of implementation.

1. **Summary correctness:** fix the verified native-D1 retry-claim metadata mismatch and replace the raw active-account constraint error with clear waiting/admission behavior. Preserve successful summaries, immutable attempts, credits and duplicate-dispatch protection. Staging only; no blind real-document replay.
2. **Scoped staging validation:** finish the approved dependency-grounded test workflow and fresh timing comparison. Preserve full production/shared/unknown-impact coverage. Draft edits are paused while Summary correctness is addressed.
3. **Calmer playlist status wording:** remove messages such as “needs preparation” and other unnecessarily alarming internal-state labels for normal automatic preparation. Keep genuine actionable errors clear. No playlist behavior redesign. Requested by Roger October 28; queued behind the two items above. Not implemented.
