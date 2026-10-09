# Provider limits and the free/paid Summary boundary

Verified October 9, 2026. Roger clarified that free summaries are best effort;
future paid summaries should accommodate agreed large inputs end to end, within
reason. This audit does not approve a model switch, plan upgrade or billing change.

| Path | Current app boundary | Provider boundary / implication |
| --- | --- | --- |
| Free Summary | 24,000 UTF-8 source bytes, 150,000 request bytes, 512 output tokens, 30 seconds; one concurrent request | Cloudflare's hosted Llama 3.2 3B advertises 80,000 context tokens. The app cap is deliberately smaller, not the model maximum. Bytes, characters and tokens are different units. |
| Retail OCR | Pinned `mistral-ocr-4-1`, 6 MiB file, 10 pages, 90-second provider timeout, bounded 16 MiB response | Mistral supports PDF and images. Its documented upload limit must not be confused with the OCR processing limit. The current rendered official FAQ did not expose the numerical processing limit; do not adopt third-party 50 MB/1,000-page claims without verification. |
| WaveNet | Sentence/word chunks normally 500 JavaScript string units; each submitted chunk checked against 5,000 UTF-8 bytes; private preparation 20,000 string units and 32 MiB audio | Google fixes content at 5,000 bytes per request, including SSML. Its default general quota is 1,000 requests/minute/project; actual project quotas can differ. Long-reading orchestration is separate from a single preparation. |
| Workers runtime | Bounded parsing, response sizes and deadlines | Free has 10 ms CPU and 128 MB isolate memory. Network waiting is not CPU time. HTTP can continue while connected; `waitUntil` extends up to 30 seconds after response/disconnection. Larger files require profiling and resumable jobs, not merely higher constants. |

Free v1 retains the transparent 24,000-byte source cap and shared upstream daily
allowance. Oversized sources are rejected/disabled without truncation. Summary
does not replace the reader source until the user explicitly chooses Use summary;
the original remains restorable. OCR text and its downloadable saved result are
separate from Summary, and OCR credits do not buy an LLM entitlement. Saved OCR
results expire after 24 hours; download complete text before expiry. Free reading
and paid speech retain their own limits and eligibility.

Before selling a paid Summary tier, choose an explicit maximum document size and
output length, then budget prompt + output tokens with the selected tokenizer.
Show an estimate and obtain consent before paid work. Preserve full source/page
order; persist per-chunk progress and deduplicate uncertain attempts. Documents
outside one context window need explicit section/hierarchical processing with
coverage checks and resumable results. Never silently summarize only a prefix.
Expose the separate free Summary limit before paid OCR processing; the current
OCR consent notice describes OCR/speech accounting, and that extra Summary
disclosure remains a future UX task before a paid combined journey is sold.

GLM 4.7 Flash is currently listed with 131,072 context tokens and a different
response schema; its larger window alone does not validate quality, latency,
availability or paid economics. The attempted Gemma 3 12B hosted URL redirected
to an unavailable-model catalog, so that exact hosted model is not a verified
candidate. Select and verify a currently offered exact Gemma model before design.

Sources:

- [Cloudflare hosted Llama](https://developers.cloudflare.com/workers-ai/models/llama-3.2-3b-instruct/)
- [Workers AI pricing and free allowance](https://developers.cloudflare.com/workers-ai/platform/pricing/)
- [Workers runtime limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Mistral OCR](https://docs.mistral.ai/studio/document-processing/basic_ocr)
- [Mistral upload limitations](https://docs.mistral.ai/resources/known-limitations)
- [Google TTS quotas](https://cloud.google.com/text-to-speech/quotas)
- [Hosted GLM 4.7 Flash](https://developers.cloudflare.com/workers-ai/models/glm-4.7-flash/)
- [Attempted Gemma model](https://developers.cloudflare.com/workers-ai/models/gemma-3-12b-it/)
