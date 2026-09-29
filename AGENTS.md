# PasteToSpeech workspace

- Canonical source: `/home/roger/workarea/paste2speech`, branch `main`. The released
  reader history was merged here on September 28, 2026. Older memory and reports
  pointing to `.codex/worktrees/reader-shared-release` are superseded for new work.
- Keep project source and permanent artifacts under this project directory.
  Temporary isolated worktrees may live under `work/worktrees/`; integrate tested
  completed work into `main`. Never make an installed extension or a running
  service depend on a temporary checkout.
- Chrome loads `dist/chrome-extension/production` directly. Preserve
  `dist/chrome-extension/` when rebuilding the private site. Extension source is
  `extension/`; use `npm run build:extension` to rebuild packages.
- Follow `docs/reader-release.md`. Staging and public production use the same clean
  commit, with separate environment configurations and hosted asset verification.
  `release:reader:production` is the historical owner-only trial command; the live
  site uses `release:reader:public`. A repository merge is not deployment approval.
- Preserve unrelated edits, existing account/financial state, and private ignored
  files. Commit validated work. Retain older worktrees until their users and
  installations no longer depend on them; do not prune them automatically.
