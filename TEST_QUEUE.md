# Current release: V26.10.1 Beta 1

The full backend suite and current frontend suite were run for this release. See [validation](docs/validation-beta1.md) for results and remaining host-dependent checks. Entries below are historical iteration records, not the current test status.

# Development iteration – UI and Consensus (2026-10-15)

This is an incremental development deployment. At the owner's request, checks are targeted; the full release suite is deferred and tracked below. Earlier v0.23 test results further down describe the previous baseline, not this entire iteration.

## Implemented

- Matching home action/tab widths and a separator below the introduction.
- Panel tabs anchored outside the actual panel border, including collapsed/mobile layouts.
- Toolbar groups reflow into justified rows; task controls reserve their real footprint without a forced extra full-width activity row. Group/delete menus preserve command IDs; all toolbar menus have arrows, outside-click dismissal and Escape support.
- Password autosave retains the typed password field and its actual length. Saved-mask placeholders select on focus. Instagram connection buttons show a spinner and reject duplicate clicks; the existing durable challenge protocol opens the actual code modal.
- Consensus OSINT v0.4.2 pinned at commit 6cd61891bf5ba3ade7788b4033cf751cac5551ed, installed in a separate environment with retained license notices. Username/email/phone discovery use its confirmed account identities only. Streamed checkpoints preserve partial results at deadlines. Automatic upstream updates are disabled.
- A one-time settings migration enables Consensus and disables overlapping Sherlock/Maigret/User Scanner/Holehe/Ignorant discovery sources where present. Sources remain installed/re-enableable; PhoneInfoga, Blackbird and Generic Deep Research remain available. Existing per-actor overrides remain explicit overrides.
- Successful runs with warnings also produce a visible error node containing redacted incompleteness diagnostics; findings are retained. Blackbird stdout/stderr rate-limit, timeout and error messages enter that path.
- Blackbird AI intentionally excluded after the owner's clarification: upstream AI infers patterns from names of at least three confirmed sites; it neither discovers extra accounts nor collects profile metadata. No unused API key was created.

## Targeted checks completed

- Six Python tests: confirmed-only parsing, no discovery metadata nodes, retained partial findings, input validation before execution, incompleteness-node presentation, and one-time settings migration without changing Deep Research.
- Real local Chromium with all API responses mocked and external traffic blocked: home widths; panel tabs; toolbar at 1440/1024/760/390px; stable height when tasks start; dropdown/keyboard behavior; password autosave; animated login and an actual confirmation-code modal. All passed.
- Existing lightweight frontend module checks: 14 passed. ESLint, relevant Python Ruff/Black checks and deterministic local frontend build/manifest check passed.
- Container build/install and deployment are the next steps; record their outcomes below.

## Tests deliberately pending before a release

- Full Python regression suite and existing full Chromium workflows against the integrated app; dropdown-aware smoke helper has been adapted but that full suite has not run for this iteration.
- Controlled live Consensus CLI lookups for username, email and phone, provider coverage/false positives, rate limits and actual process cancellation. Parser/checkpoint tests do not certify every external provider. Do not remove legacy tool installations before this acceptance.
- Integrated Blackbird partial-failure diagnostics against representative real tool fixtures and quotas.
- Real Instagram login and live confirmation challenges with the owner's account, if desired; the current check uses fake credentials and mocked job responses.
- Manual visual acceptance on the owner's devices, especially translated labels and long queue counts.
- The three host isolation/egress/cleanup areas below remain blocked by the same operator activation step. Health currently reports worker_isolation=false; this iteration does not claim to resolve that runtime boundary.

---

# Verification – v0.23

Verified on 2026-10-15 with the user's authorization to finish v0.23 and update the container.

## Completed

- Recovered the missing/inconsistent authored frontend modules from the existing readable v0.23 production bundle, restored explicit imports, and rebuilt the bundle and source manifest together. Local originals were retained before recovery. Source/bundle consistency is enforced by the Docker build.
- Fixed a regression in secret detection: conservative treatment of undeclared text fields applies to community plugins. Public built-in runtime values such as merge choices/fingerprints and Transform code survive save/reload; explicit secrets and legacy credential names remain protected. Added a persistence regression test.
- Corrected Chromium fixture selectors to target the open login dialog and wait for asynchronous controls. Failures now include diagnostics from the temporary fixture only.
- Python Docker suite: **160 tests, 156 passed, 4 explicitly skipped**, no failures (job `fcd9c1dc60a641239dc4d76de60233e8`). Includes the real Chromium UI workflows, ExifTool cases, access/CSRF/Host checks, history, jobs, credential handling and existing regressions. Temporary data only; no owner's DB or live accounts.
- Production frontend suite in the restricted Node container: **14 passed**, no failures, no skips (same job).
- Running development-controller suite: **9 passed**, no failures (job `53763df4fe494926a32a969bdae41dce`). This verifies the currently installed controller, not deployment of the changed controller source.
- Production Python Ruff check, Black check across the documented 79 files, ESLint and Prettier passed. Eight test files received formatting-only changes after the successful functional suite.
- Frontend rebuild/reproducibility checked locally with the pinned esbuild/Prettier versions and an explicit workspace file loader for Windows sandbox access; Docker independently verified all manifest hashes.
- Final image `sha256:6a23ff078e3728e3be40e172798d06b86107cffbad6965f2c2f97981f0414998` built successfully; container recreated by job `c53e9be54da04837936558cf136d344c`. `trace-workbench-1` is running/healthy with zero restarts. Live `/api/health` returned HTTP 200, version 0.23 and database ok. The live browser snapshot confirmed the v0.23 label and authentication dialog. The controller's `networkidle` navigation wait timed out on the polling page; this is recorded rather than treating that tool call as a successful navigation check. Authenticated workflows passed against the temporary Chromium fixture, not the owner's projects. The existing data volume was retained.
- Live health explicitly reports `worker_isolation: false`; the host boundary below remains pending.

## Four skipped tests / three host verification areas

The three community execution tests and embedded-browser self-test require an enabled namespace broker. The restricted test container has no broker or elevated namespace capabilities; it must not fall back to app-identity execution.

These host areas remain unverified:

1. Real namespace isolation: plugin UID, hidden data/keys/sessions, selected-file-only access, process and mount boundaries.
2. Real Chromium egress: redirects/subrequests/loopback/private DNS denial through the Unix proxy, including the pinned FlareSolverr runtime.
3. Broker cancellation/timeouts/cleanup and controller recreation with the new runtime policy.

The installed MCP controller cannot rebuild itself or change its baked runtime policy. The operator procedure is in `docs/worker-runtime.md`. An ordinary healthy app and unit mocks do not count as verification of these areas. Browser/community execution remains unavailable until that step is completed. This is not an unconditional release-ready or fully isolated deployment claim.


## 1.0.0-alpha.1 — 2026-10-16

Explicitly requested batch completed. See docs/validation-alpha1.md. Linux: 193 passed, 4 skipped, 2 obsolete-token-dialog browser failures. Current frontend contracts/UI checks pass. Keep open: historical browser/JS harness migration; real VPN disconnect/DNS/IPv6; isolated browser/community on NAS after launch-permission correction; live Google preview. No further tests or GitHub Releases without an explicit request.

## Alpha 2 — pending explicit test request
- Video upload/probe validation and malformed/oversize intake, 128 MB limit.
- HTTP range seeking, suffix/open ranges, invalid ranges and interrupted streams.
- Accurate FFmpeg trim with/without audio, boundaries, timeouts/cancellation, original preservation.
- CPU fusion on synthetic subpixel shifts, motion/rejection, textureless failure, frame/size/duration limits. No face inference or real-person research.
- Video player retains playback state across viewport pan/zoom and graph rerenders; export/import/report links.
- Coalesced drag final-pointer flush, pan/zoom, group dragging and edge control gaps.
- n8n-style forward Bezier and backwards rounded detour, including multiple input slots and groups.
No test suite was run for this batch. Build checks and bounded UI/performance inspection are separate.

## Alpha 3 — requested complete audit/test batch
- Complete Linux suite run once: 205 tests, 199 passed, 4 isolated-worker skips, 2 calls of the same stale browser harness failed.
- Synthetic FFmpeg trim/fusion, original preservation, HTTP ranges and live artifact budget passed in that image.
- Current production frontend contracts: 21 passed after viewport/settings fixes.
- Actual wheel pan, Ctrl-wheel zoom and Space-drag browser assertions passed; UI views suite passed.
- GET logging and missing optional Unix-socket capability have targeted regressions.
- Pending: migrate 5 legacy JS entrypoints that still require retired fixtures; rerun Linux browser fixture during the next complete requested suite. VPN leak/interruption and isolated workers still need enabled host capabilities and a supplied provider profile.

## Alpha 4 — pending explicit test request

The frontend now renders through React 19.3.1. Existing domain commands are retained; legacy DOM-rendering fixtures are not proof of React coverage. No automated test suite was run for this batch. Production build/module-loading checks and bounded browser inspection were performed separately.

- Port frontend/browser fixtures to React component contracts, including keyboard graph navigation, selection, drag/drop, grouping, undo, clipboard, tool execution/input prompts and reconciliation.
- Verify SVG element/media identity across drag, pan, zoom and autosave; performance on larger graphs.
- Synthetic image crop: EXIF rotation, alpha/palette formats, edge rectangles, invalid ranges, 40 MP/128 MB bounds and original preservation.
- Synthetic video graphical start/end, full-source seeking, 600-second range, rotated input, crop precision/even pixels, audio retention and cancellation.
- Per-project uploads/tool artifacts, cross-project links, URL download/cache provenance, deletion/GC leases and missing files.
- Plugin autosave/defaults, provider-local profiles, source ordering, masked secret input, connection-code dialogs; global settings serialization.
- Queue recovery after infrastructure/VPN cleanup errors; readiness reporting.
- Existing host VPN/browser/community isolation and leak checks remain pending host capabilities; no DeepFace inference was run.


## Alpha 5 — explicitly requested batch

See docs/validation-alpha5.md for exact results and limitations. Linux current image: 220 tests, 214 passed, 4 skipped, 2 wrappers of the same browser script failed before the UI fix. Targeted real-backend Chromium retries subsequently passed all 10 workflow checks across the affected scenarios. Production frontend contracts 21/21; six React integration scenario groups passed, with the final sortable correction rechecked separately. No further full backend rerun after the UI-only corrections.

Application factory/lifecycle, streaming upload intake/body admission, shared result contracts and the reusable React library are implemented. Still external: enabled host isolation capabilities, live Google browser preview, real provider VPN disconnect/DNS/IPv6 checks. Future engineering follow-ups: historical source-extraction harness conversion, further large-collector decomposition and transitive lock/SBOM work. No real-person research or face inference was run.


## Alpha 6 — pending explicit test request

No automated suites run. Production build/lint, Python syntax and bounded visual inspection only. Pending: inspector actual content-to-divider geometry across node types; keyboard/focus/Escape and nested dialog handling for calendar/time/color popovers; invalid email draft/autosave; timezone DST/seconds; searchable dropdown phone/country states; checkbox optical alignment; node/edge focus styling; header touch pinch and graph resize both directions including rapid toggles/minimum zoom; logs single-back navigation. Verify server-side map geocoding/tiles, fallback/cache and blocked/active VPN behavior with enabled host capabilities. Historical browser assertions expecting native input[type=color] must be migrated to the themed shared picker.


## Alpha 7 — pending explicit test request

No automated suite run. Pending regressions: public-network Content-Length/chunked/EOF/redirect/timeout/size handling; HEVC/unsupported audio fallback, immutable original, working-copy ranges/parallel generation/failure/GC; dual-handle trim keyboard/pointer limits; crop resize corners and section spacing; repeated left/right panel collapse after manual pan/zoom and viewport changes; reload persistence of all three separators; palette compatibility/rank/category/filter active states; per-tool preflight/running/queued animation. Bounded visual inspection and direct live diagnostics are documented in docs/validation-alpha7.md. VPN interruption/leak checks still require configured host runtime and profile.


## Alpha 8 — pending explicit test request

No full automated suite. Pending: action enablement for mixed nested group/node/edge selections and detachment pruning; shared group report inclusion; SVG label masks for very long/near-vertical/backwards paths and keyboard focus; adjacent bundled-edge highlights and selected connector colors; locale aliases/ambiguous labels, custom title preservation, automatic group/node labels after reload/language switch; global plugin dirty/save/error status including overlapping saves; all parameter section checkbox/limit layouts and common 36 px control heights; map glance geometry/theme at multiple scales; centered 620 px settings and VPN controls on narrower desktop windows. Historical curve-gap contract is retained for legacy callers; React uses exact label masks.
