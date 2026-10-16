# ARGUS architecture

`server.py` composes HTTP transport, preferences, projects, files/media, plugins, logs and the persistent job queue. SQLite owns project revisions, history, queue records and settings. The application supports one process and one data volume, not multiple replicas sharing the database.

`core/jobs.py` serializes tool and connection jobs independently of browser polling. `core/actors.py` validates inputs, combines installation configuration with permitted per-node parameters and persists results through `core/actor_results.py`. Installation-wide source switches/order and settings-only/secrets cannot be overridden by stale node params. Result nodes retain provenance and group context. Failures create a connected error node; partial results retain successful findings and an explicit warning/error output.

`core/graph.py` owns schemas and conflict merge semantics. Canonicalization and migrations are explicit. Verification is a user assessment rather than a guarantee inferred from tool success. Remote images are verified/cached through `core/media.py`; previews use same-origin file/media endpoints. Files are collected conservatively with reference checks and a grace period.

`core/access.py` keeps same-origin sessions and CSRF checks. The current interface automatically establishes sessions and has no user-login/token-entry dialog. This is not user management. `core/secrets.py` encrypts credentials and VPN preferences with an installation-local key that must accompany backups. Structured system logs are separate from editable research documents and project execution history.

Community plugins use the worker broker included in the standard image. Its launcher uses explicit namespace/UID/resource boundaries and a public-destination-only egress proxy. If isolation is unavailable, those execution paths fail closed. Built-in adapters are trusted application code. See [worker runtime](docs/worker-runtime.md).

The integrated VPN controller starts as a privileged child of the container supervisor before the unprivileged app. They share the container network namespace, verified over a private Unix socket. The controller owns tunnel processes, IPv4/IPv6 OUTPUT filtering, persisted enabled state and candidate health checks. The queue takes/releases a connection lease; rotation waits for active tools and subsequent jobs wait for a healthy tunnel. [VPN documentation](docs/vpn.md) describes the container permissions, exceptions, supported profiles and the live checks still required.

Frontend source lives in `static/main.js`, feature factories under `static/app/` and shared controls/routing/form modules. The composition root passes named callbacks and domain stores explicitly. UI owns presentation, gestures and transient edits; the backend owns validation, persistence, research and execution. User-supplied JSON Transform JavaScript runs in a browser worker.

`npm run build` produces the checked-in production ESM bundle and source/hash manifest. Docker verifies the manifest without a Node runtime. Tests import the production feature factories or exercise the rendered bundle with fixture APIs. Shared UI geometry lives in `static/ui-rhythm.css` and the scoped alpha corrections in `static/alpha1.css` while existing component styles remain in the shared cascade.
