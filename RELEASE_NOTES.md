# ARGUS 26.10.3 Beta 1

This beta hardens the worker boundary, makes the interface consistently German or English, and leaves React as the only user interface layer. Existing graphs, databases and uploaded files remain compatible. Retain the complete data volume, including encryption keys, when updating.

## Security and runtime

- The isolated worker proxy accepts public HTTP(S) destinations on ports 80 and 443 only, checks Unix peer credentials against the reserved worker identities and logs rejections without URL paths or secrets. Broker connect, upload and polling have separate time limits; transport failures cancel the job instead of surfacing raw socket errors.
- Before starting services, the privileged supervisor verifies the complete worker identity, capability and seccomp transition in a disposable probe. Each worker re-checks its kernel state before running untrusted code. Failures abort startup; there is still no unrestricted fallback.
- Community plugins stay opt-in. Adding a repository and installing a plugin each ask for confirmation, naming the repository and pinned commit and stating that ARGUS does not review community code. `SECURITY.md` describes private vulnerability reporting and the intended private, self-hosted deployment.
- Manual cancellation is no longer swallowed by provider aggregation, deep research or Instagram collection. Narrower error recovery keeps programming defects from looking like ordinary fallback results.
- Request headers and identifiers derive their version from `VERSION`.

## Interface

- React is the only view layer. About 5,500 lines of retired imperative UI code and unused modules were removed; domain modules no longer read or write application markup.
- German and English no longer mix: generated tool labels, warnings, errors, run states, group titles and reports are translated, and plugin text falls back to its own language. Locale contract tests guard against regressions.
- The plugin library has an **Add community repository** button with a confirmation, spaced cards and a repository list.
- Help is an icon button next to Settings. The interface appears only after the language pack has loaded, so no raw translation keys flash during startup.
- Node details use one spacing unit between a label and its control and two units before the next label; the database column for Search database and DeepFace follows the same layout. DeepFace shows a translated "Maximum comparisons" label.
- Multi-selection details separate the count, **Include all in report** and **Delete nodes** into their own sections.
- DeepFace accepts a total timeout of 0 to disable the deadline for long database comparisons; the default remains 300 seconds.

## Fixes and maintenance

- A tool failure is no longer lost when the project is saved while the tool runs; the error node, failed run and tool status are kept.
- Reports translate type labels, group titles, relationships, run history and generated error text.
- Tool execution and result materialization were refactored for readability without behaviour changes (verified against the previous implementation with randomized synthetic results).
- CI runs `ruff check .`; tests that need ExifTool or Holehe skip explicitly outside the container image, while the image gate requires them.

## Deployment note

Hosts whose kernel lacks seccomp (for example Synology DSM) cannot run the integrated VPN and isolated workers. ARGUS then starts unprivileged, as before, and reports `worker_isolation: false`.
