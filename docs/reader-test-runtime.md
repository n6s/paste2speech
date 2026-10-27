# Fresh reader gate optimization — October 27, 2026

On the same workstation, with Node 24.22.1 and Chrome 156.0.8078.47:

| Fresh staging preparation | Wall time | Receipt reuse |
| --- | ---: | ---: |
| Serial baseline `8947bb9` | 698.97 s (11:39) | None |
| Bounded scheduling `c1319ac` | 507.04 s (8:27) | None |

Saved **191.93 seconds (27.46%)** in this comparable pair. This is a
point-in-time shared-workstation measurement, not a statistical average or a CI
performance guarantee. A preceding serial preparation also took about 700 seconds.
Both ran the same complete gate catalog and Worker dry run. No app was deployed.
The optional profiler was identical in both runs. Logs and raw profiles remain in
`work/test-optimization/`, with a machine-readable `comparison.json`.

The catalog has **67 top-level gates** (unit suite plus 66 integration gates).
Previously counting log PASS lines gave 73 because receipt-unit fixtures print six
additional PASS messages. The catalog comparison excludes those nested fixtures.
All 753 original unit tests remained; six runner tests brought the benchmark to
759. Subsequent runner-interruption/receipt tests add further coverage.

## Evidence and decision

The baseline's 72 browser launches totalled 6.03 seconds. Browser navigation totalled
21.08 seconds. Sharing browsers therefore offered little saving and increased
cross-suite state risk. The long gates were resume (61.30 s), recovery (55.63 s),
translation documents (53.05 s), clipboard (35.65 s), and persistent-audio UI
(28.85 s). Assertions involving actual media time remain intact.

The baseline spent roughly 501 seconds in the conservatively serialized lane and
195 seconds in audited lightweight suites. Overlapping those lanes produced the
measured improvement. Every browser retains its own profile, server and fixtures;
built site assets are immutable during the gates. Heavy audio, video and large
storage work never overlaps another heavy suite. Unknown suites default to heavy,
and shared output families and repeated variants have locks.

No existing assertion, fixture duration or timeout threshold was relaxed. Runner
tests cover resource locks, first-failure propagation, draining/cancellation,
owned Chrome/server teardown, serial mode, already-canceled admissions and async
receipt completion/invalidation. Credential environment and external preload
changes invalidate receipts without writing their values into receipt files.

## Repeating the measurement

Run `npm run release:reader:staging` for fresh bounded scheduling, or add
`-- --serial-gates` for the serial control. Do not pass `--reuse-gates` in a fresh
benchmark. Both commands prepare locally unless `--deploy` is explicitly supplied.
The public runner uses the same scheduler and its own unchanged gate catalog.

Optional profiling, with the output directory changed for each run:

```sh
NODE_OPTIONS="--import=$PWD/scripts/profile-reader-tests.mjs" \
READER_PROFILE_DIR=work/reader-gates/profile-run \
/usr/bin/time -p npm run release:reader:staging
```

The profiler records browser startup/navigation/explicit waits, Node CPU and RSS;
it does not record document content or credentials. Per-gate logs and timings are
under `work/reader-gates/`. Keep those artifacts before a later preparation replaces
latest-run summaries. Remaining costs are predominantly serialized integration and
real playback checks; reducing those further requires targeted test-design work,
not deleting coverage or globally shortening waits.
