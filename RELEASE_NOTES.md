# ARGUS 26.10.2 Beta 1

This beta combines database workflows with a maintainability and worker-security review. Existing graphs and uploaded files remain compatible. Retain the complete data volume, including encryption keys, when updating.

## Databases and investigation workflows

- Create shared databases with editable typed fields, JSON values, image/file attachments and paged records.
- Preview CSV, TSV, XLSX, ODS, JSON, JSONL, XML and text imports; select sheets and map or skip source columns before an atomic commit. Create a database or extend an existing one. Image batches can become separate rows or one attachment collection.
- Connect a Database node and a reference value to Search database. Exact, contains and prefix matching return complete matching records as groups with database, row and field provenance.
- DeepFace accepts a reference image plus a database image column, alongside two-image comparison. Column selection, comparison limits, partial-result warnings and matching-record groups are supported. Automated validation uses mocked inference only.
- A searchable Help tab documents core workflows. Report previews use softer screen colors while retaining white A4 print output. Nested evidence uses flat field paths to avoid progressively compressed tables.
- Profile dragging avoids inspector rebuilding during movement. Profile/map badge spacing, zoom control sizing and the English group-collapse label are corrected.

## Worker security

- Drop and verify the entire capability bounding set before changing worker UID; clear and verify all remaining capability sets and enforce no-new-privileges.
- Require an inherited libseccomp filter. After bootstrap, deny namespace/mount manipulation, tracing, BPF/perf, keyrings, io_uring and raw/kernel sockets. Any failed hardening step aborts execution.
- Replace the standalone Compose unconfined seccomp setting with an adapted, pinned Moby allowlist. Remove NET_RAW and document every retained capability.
- Supply an optional host-loaded AppArmor policy with explicit target-host validation requirements.
- Preserve SSRF destination pinning, origin/CSRF protection, plugin integrity checks, secret redaction, VPN fail-closed behavior and the prohibition on unisolated worker fallback.

## Architecture and development

- Split Instagram collection, generic enrichment, actor execution and result materialization into named per-run phases.
- Dispatch HTTP requests through a method/path table, retaining the common security guard and streamed upload handling.
- Move application modules into core; reduce server.py to an entry point and remove its compatibility facade.
- Remove inactive imperative canvas renderers and UI bindings. React and production-bundle tests share one domain composition.
- Introduce stable first-party UI translation identifiers and validation codes; retain aliases for saved graphs and third-party metadata.
- Rename iteration tests by responsibility, archive historical specifications and document architecture decisions. Narrow expected I/O catches while retaining explicit plugin/job/transport failure boundaries.
- Run Ruff, Black, ESLint, Prettier, build consistency, frontend contracts, Python tests and real Chromium workflows on every push and pull request. Publication requires successful CI, with separate test-only dependencies.

## Deployment notes and limits

The application runs as UID 10001. The supervisor, VPN controller and namespace broker retain documented elevated setup permissions. The managed Synology configuration is external to this repository and currently reports worker isolation unavailable. Community/browser execution stays blocked there rather than falling back to application identity. This release cannot grant missing host capabilities.

AppArmor must be loaded and validated by the host administrator; it is not automatically enabled or claimed as universally verified. VPN interruption/rotation needs verification with the actual provider. Upstream availability, authentication, first-use model downloads and third-party licenses continue to apply.

See [validation](docs/validation.md), [architecture](ARCHITECTURE.md), [security policy setup](deploy/README.md), [database imports](docs/databases.md) and [credits](THIRD_PARTY.md).
