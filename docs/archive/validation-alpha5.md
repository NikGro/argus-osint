# Alpha 5 validation

Requested batch, 2026-10-18. No external account research or face inference.

## Changes

- Internal React library with one public entry point and separate controls, searchable selects, fields, sortable lists, dialogs and layout/media primitives. Provider, search-profile and VPN lists share the same row implementation and optional slots.
- Home card trailing actions, centered checkbox marks, restored provider details, animated row displacement/whole-row drag image, yellow scrollbars/actions, sidebar boundaries/category labels and blue graph selection.
- Bounded rounded image/video glances, actual native video playback, color/date/time/timezone pickers, country/code row and composite phone input.
- Consolidated report/provenance/delete sections; no node-detail SaveState. Note focus release, Delete, touch pinch and symmetric sidebar viewport compensation.
- Dialog-local select portals and labelled choice values, found by the real-backend browser workflow. Tag rename drafts no longer disappear when temporarily empty during typing.
- Explicit backend resource factory/lifecycle and HTTP adapter. Imports create no services. Streaming file intake with 64 KiB chunks, exact-length checks and four concurrent body parsers/uploads. Shared typed tool-result validation/state precedence.

## Evidence

- Valid Linux full backend run: job `5e43a60030484e14aec648a41da4830b`, 220 tests: **214 passed, four skipped, two failed**. Both failures invoke the same browser script; it stopped at the dialog portal bug. Backend factory, streaming, crop, media, queue, security, persistence and locale checks passed.
- After fixing the browser-discovered defects, targeted real-backend Chromium retries on Windows passed the first nine workflow checks and then the remaining Instagram notice/settings/password check separately. Ten checks total; no login or research request was made. The two Linux wrapper tests were not rerun as a complete suite.
- Current production frontend contracts: **21/21 passed**.
- Shipped React bundle integration: all six scenario groups passed. Synthetic image/video rendering and playback, media identity on pan, inspector fields/sections, note focus/Delete, pinch and both panels. Provider drag was rechecked separately after the animation fix and passed.
- ESLint across maintained static sources passed; modified library/settings lint passed after final fixes. Ruff and Black checks/formatting passed for the changed backend files. The image build verifies the complete frontend source/bundle manifest.
- Real rendered screenshots inspected for home/workspace/plugins; card alignment and media/badge geometry also measured in browser assertions.

One initial test job accidentally used the old Alpha 4 image because the fixed MCP test runner mounts only tests. Its result is excluded from the valid counts above. The image was built before the valid run. Subsequent changes were confined to the failed browser path and sortable UI; no complete backend rerun followed these UI fixes.

## Remaining external boundary

The installed controller still starts the application without the capabilities needed by the embedded namespace broker. Google map previews cannot run there; the iframe now shows a localized status panel rather than raw JSON. Genuine VPN interruption/DNS/IPv6 and isolated browser/community tests need the documented host launch policy and a supplied VPN profile. They are not counted as passed. See `worker-runtime.md`.

Historical source-extraction test files are not evidence of current React behavior. Their remaining migration, larger collector decomposition and fully locked transitive dependency/SBOM work remain engineering follow-ups; this batch does not claim those future review recommendations are complete.
