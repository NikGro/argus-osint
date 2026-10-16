# Validation: 1.0.0-alpha.1

Date: 2026-10-16. Checks were batched at the explicit request of the maintainer. No real-person research, face inference or real VPN connection was started.

## Passed

- Production frontend lint and source/hash manifest verification.
- Python lint for the changed backend and application services; formatting of changed files.
- 14 production frontend contracts and 3 new alpha contracts (nested grouping, fixed sockets, work-step arrangements and background markers).
- 4 new Python alpha contracts and English error/validation translation contracts.
- Rendered desktop UI with synthetic APIs: fixed input slots, marker, translated error text/mobile guard, multi-selection report checkbox, centered plugin chevrons, sticky saved status, VPN profile list/placement, interval alignment, log auto-refresh/follow and centered project-create content.
- Existing rendered view checks: keyboard navigation, dialogs, toolbar at 1024 px, logs, report, plugin states and settings.
- npm audit: zero reported vulnerabilities in the resolved frontend development dependency graph at check time.
- Current stable direct versions checked against PyPI, npm and upstream GitHub APIs. The updated image installed its research runtimes, imported DeepFace/ONNX without creating models, and generated provider/profile catalogues successfully. Upstream-pinned transitive requirements remain under upstream constraints.
- Full Linux image suite: **199 tests, 193 passed, 4 skipped, 2 failed**. The two failures run the same historical browser fixture, which still waits for the intentionally removed token-login dialog. The skips require a running isolated worker; the offline test container deliberately has none. The later fixed Node runner was not reached after the Python failure; its production contract entry was independently checked locally.

## Open validation debt

- Retire or update the old v0.19 browser fixture for automatic sessions, current tag controls and dropdown actions. Do not rerun the whole suite after every UI edit.
- Five historical JavaScript test entry points still reference retired `tests/fixtures/frontend-manifest.json` files. Current contracts import the shipped production bundle. These older entry points are not counted as passed.
- The first full Windows run also encountered Linux-only process APIs, POSIX permission checks, missing Linux tools and Windows temporary SQLite cleanup behavior. Linux image results above are the relevant runtime results; changed-behavior assertions were updated for error nodes, the marker type, recovery sections and current source defaults.
- Verify VPN public IPv4/DNS/IPv6 and deliberate tunnel interruption with a maintainer-supplied provider profile on the target host. No provider credentials are included.
- Exercise browser/community execution once the target container is launched with the supplied namespace/TUN permissions. Supported challenge handling does not guarantee that interactive CAPTCHA, account restrictions or upstream rate limits can be solved.
- Verify Google map previews against live map responses on the configured host. Empty location nodes do not request a preview, Google no longer silently falls back to OSM, and successful Google previews are cached.

## NAS deployment

The application and database report healthy at version `1.0.0-alpha.1`. The pre-existing NAS management launcher does not grant the namespace privileges required by the integrated supervisor (`unshare: Operation not permitted`). The image therefore defaults to the unprivileged application; unavailable isolated features fail closed. Enabling saved VPN without its controller still blocks startup.

The public `compose.yaml` / `compose.standalone.yaml` starts the single-container supervisor with the required capabilities, seccomp/AppArmor configuration and TUN device. No VPN sidecar or browser/community installation is needed. The existing MCP lifecycle service uses an immutable private launcher configuration and cannot apply these host start options. An administrator must apply those options once to the existing ARGUS service. This limitation is not described as a successful VPN or worker validation.

No new GitHub Release was created. This update publishes source and documentation on the default branch.
