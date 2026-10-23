# Development

Python 3.12+, Docker Compose v2 and, for frontend tooling, Node.js 22+.

```sh
python -m pip install -r requirements.txt -r requirements-core.txt -r requirements-dev.txt -r requirements-test.txt
npm ci
npm run lint
npm run format:check
python -m black --check core plugins scripts tests server.py
python -m ruff check .
npm run test:frontend
```

Every push and pull request runs the complete CI workflow. Publication is gated on its quality and runtime jobs. Run Python tests in the built Docker image: it includes real CLI tools, ExifTool and Chromium. Use a temporary `DATA_DIR`, mount `tests/` read-only, then `python -m unittest discover -s tests -p 'test_*.py' -v`. The browser smoke script starts its own temporary app. Tests must not use the owner's data directory or real accounts. Missing local dependencies can skip tests; only a complete container run certifies the suite.

The restricted Synology Node runner mounts `static/app.js` and `tests/`. The active runner imports the actual production ESM bundle through `tests/frontend_contracts.cjs`; copied fixtures and regex-extracted functions are historical material. The React entry point is `static/react/main.jsx`, shared components live in `static/react/ui/`, and domain modules remain under `static/app/`. After frontend changes, run `npm run build`, `npm run build:check`, and `npm run test:frontend`. Commit the source modules, bundle and `static/build-manifest.json` together. The Docker build rejects stale sources or bundle hashes. Do not add new source-string assertions.

See [tests by behavior](tests/README.md) for focused runs and dependency skips, and [error boundaries](docs/error-handling.md) for cancellation and recovery rules. CI requires ExifTool/Holehe integration dependencies before running the suite, so their absence cannot silently turn into passing container validation.

## Working rules

- Add React views and shared components under `static/react/`; reuse the domain modules in `static/app/`. Keep research and authoritative rules in backend services/plugins.
- Reuse shared UI primitives, searchable selects, icons and parameter sections. No browser prompt/confirm, user content through `innerHTML` or new application globals.
- Schema fields, inputs, provider IDs and provenance follow the plugin contract. The backend validates every request independently.
- Secrets belong in plugin settings; transient codes stay separate from project params, logs and clipboard.
- Preserve CSS cascade and inspect narrow panels, touch, keyboard focus, selection and reduced motion when changing styles.
- Prefer behavior tests over assertions about formatting/file sizes. A refactor is verified only when its queued regressions run.

Use focused behavior checks while iterating and batch broader regressions before a release. Record what actually ran and what remains unverified; never describe skipped or unavailable host checks as passed. Tests must use temporary projects, local fixture services and simulated tool responses. Do not add real-account queries or face-model inference to automatic tests.

The VPN tests use fake transports and verify state transitions, queue gating, encrypted persistence and firewall-rule policy. They do not prove a target host's real tunnel/DNS/IPv6 behavior; complete the deployment checks in docs/vpn.md before relying on its killswitch.
