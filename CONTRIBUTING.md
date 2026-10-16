# Development

Python 3.12+, Docker Compose v2 and, for frontend tooling, Node.js 22+.

```sh
python -m pip install -r requirements.txt -r requirements-core.txt -r requirements-dev.txt
npm ci
npm run lint
npm run format:check
python -m black --check server.py core plugins plugin_manager.py provider_registry.py result_groups.py node_metadata.py community_runner.py tests examples scripts/build_provider_catalogue.py scripts/verify_frontend.py
python -m ruff check server.py core plugins plugin_manager.py provider_registry.py result_groups.py node_metadata.py community_runner.py
npm run test:frontend
```

Run Python tests in the built Docker image: it includes real CLI tools, ExifTool and Chromium. Use a temporary `DATA_DIR`, mount `tests/` read-only, then `python -m unittest discover -s tests -p 'test_*.py' -v`. The browser smoke script starts its own temporary app. Tests must not use the owner's data directory or real accounts. Missing local dependencies can skip tests; only a complete container run certifies the suite.

The restricted Synology Node runner mounts `static/app.js` and `tests/`. The active runner imports the actual production ESM bundle through `tests/frontend_contracts.cjs`; copied fixtures and regex-extracted functions are historical material. Edit modules under `static/app/` and their explicit wiring in `static/main.js`, then run `npm run build`, `npm run build:check`, and `npm run test:frontend`. Commit the source modules, bundle and `static/build-manifest.json` together. The Docker build rejects stale sources or bundle hashes. Do not add new source-string assertions.

## Working rules

- Add a view/interaction feature under `static/app/`, declare its callbacks and compose it in `static/main.js`. Keep research and authoritative rules in backend services/plugins.
- Reuse shared UI primitives, searchable selects, icons and parameter sections. No browser prompt/confirm, user content through `innerHTML` or new application globals.
- Schema fields, inputs, provider IDs and provenance follow the plugin contract. The backend validates every request independently.
- Secrets belong in plugin settings; transient codes stay separate from project params, logs and clipboard.
- Preserve CSS cascade and inspect narrow panels, touch, keyboard focus, selection and reduced motion when changing styles.
- Prefer behavior tests over assertions about formatting/file sizes. A refactor is verified only when its queued regressions run.

Use focused behavior checks while iterating and batch broader regressions before a release. Record what actually ran and what remains unverified; never describe skipped or unavailable host checks as passed. Tests must use temporary projects, local fixture services and simulated tool responses. Do not add real-account queries or face-model inference to automatic tests.

The VPN tests use fake transports and verify state transitions, queue gating, encrypted persistence and firewall-rule policy. They do not prove a target host's real tunnel/DNS/IPv6 behavior; complete the deployment checks in docs/vpn.md before relying on its killswitch.
