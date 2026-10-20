# Tests by behavior

Use Python 3.12+ and the dependencies in CONTRIBUTING.md. The Python suite uses
unittest; pytest is not needed to run it. Importing production `server.py` does
not create an application. Integration cases explicitly use `runtime_fixture`
and temporary data; unit cases create their own resources.

| Behavior | Active tests |
| --- | --- |
| HTTP, lifecycle, persistence and file intake | `test_application_transport.py`, `test_architecture.py`, `test_project_updates_plugins.py`, `test_workbench.py` |
| Source routing, profiles and provenance | `test_source_routing.py`, `test_search_profiles.py`, `test_research_provenance.py`, `test_discovery_adapters.py` |
| Request identity, cancellation and bounded recovery | `test_error_boundaries.py`, `test_public_network_streaming.py` |
| Credentials and plugin connections | `test_plugin_connections.py` |
| VPN policy and queue behavior | `test_vpn.py`, `test_security_and_jobs.py` |
| Worker security | `test_worker_security.py`, the dedicated root-container `worker_runtime_probe.py` |
| Images, video and synthetic DeepFace responses | `test_image_overlays_failures.py`, `test_video.py`, `test_deepface_adapter.py` |
| Databases, imports and record outputs | `test_datasets.py` |
| Localization | `test_locales.py` |
| Production frontend contracts | `npm run test:frontend` imports the production ESM bundle |
| Real browser interaction | `test_browser_workflows.py` runs `browser_workspace.py` with temporary data and mocked research |

The table is a navigation aid, not an exhaustive coverage guarantee. Add tests
beside the relevant behavior. Old iteration-specific frontend specifications
are text files in `history/` and do not count as passing checks. The fixed Node
runner entry `test_frontend_uuid.cjs` remains an adapter for existing tooling;
its imported contract files are named by behavior.

## Local and container runs

Run a changed Python module with, for example:

```sh
python -m unittest discover -s tests -p 'test_error_boundaries.py' -v
python -m ruff check .
```

Outside the image, real ExifTool and Holehe integration tests skip with explicit
reasons if their required tools/modules are unavailable. Mocked adapter tests
still run. Linux-only `resource` and namespace/seccomp checks need Linux.
Record skips as unverified; they are not passed checks.

CI runs on pushes and pull requests. It checks formatting/lint, frontend build
freshness and production contracts, then builds the image for the complete
offline Python/browser suite and the privileged worker probe. Before discovery,
it requires ExifTool and imports Holehe/httpx/trio in the test image: those
dependencies being missing fails CI instead of turning into green skips.
The image includes the other application tools; a local dependency skip does
not certify container integration. A release remains a separate, explicit action.

Never use owner projects, real accounts or real face inference in these tests.
Keep mock failures and partial-result assertions alongside success cases; see
[error handling](../docs/error-handling.md).
