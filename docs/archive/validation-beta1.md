# V26.10.1 Beta 1 validation

2026-10-19. Synthetic inputs and mocked research; no real-person searches or face comparisons.

- Full restricted-container Python suite: 222 tests, 218 passed, 4 skipped. Both real-backend Chromium workflow wrappers passed.
- Current production-bundle Node suite: 30 passed, none skipped. Includes three reversible group-disclosure regressions, composition/dependency ownership and six domain contracts.
- React/Chromium integration: six scenario groups passed across the complete run and targeted retries: project-card alignment, media geometry/playback, inspector controls, note focus/deletion, touch/panel transforms and provider expansion/reordering. The panel fixture was corrected to select a node before opening details; opening empty details is intentionally disabled.
- ESLint passed. Source formatting and deterministic bundle verification are recorded with the release artifacts.
- Five obsolete source-extraction entrypoints are retained as text under tests/history. Their retired flat-controller assumptions are not current product failures; archiving does not claim one-to-one replacement of every historical assertion.

The four Python skips are environment/capability-dependent; the suite does not certify real upstream accounts, CAPTCHA success, downloaded model accuracy or host VPN failover. The Synology reports worker_isolation=false; its missing host capability remains a deployment limitation, not a bypass.
