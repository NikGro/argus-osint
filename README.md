**Vibe-coded alpha:** ARGUS was built through iterative, AI-assisted development. It is experimental software, with rough edges and changing interfaces. Review the code and test it in your own environment before relying on its results.

# ARGUS

A desktop-first, self-hosted OSINT graph workbench. Turn individual facts into connected research steps, keep provenance beside the results, and choose what belongs in a report.

**First public alpha: v0.29.0-alpha.1.** Original ARGUS code is [MIT licensed](LICENSE). Research engines, icons, model weights and other dependencies keep their own licenses; see [credits and licensing](THIRD_PARTY.md). In particular, the included Blackbird version has a noncommercial license.

## What it does

- A zoomable graph with typed data nodes, tool nodes, connections, nested groups, grid/circle/hierarchical layouts, verification status and custom tags.
- Project creation, renaming, archiving, autosave, revision reconciliation, execution history and a persistent tool queue.
- Username, email and phone discovery with selectable providers, deduplication and per-provider search profiles. Discovery produces profiles; separate deep-research tools enrich a chosen profile.
- Generic and Instagram deep research, local metadata extraction, location normalization, data merging and a browser-side JSON transform.
- A local two-image DeepFace adapter with configurable parameters, scores and separately stored detection overlays. Large images can use an optional working copy while originals stay unchanged.
- Plugin settings separated into installation-wide configuration and defaults that can be changed on individual tool nodes. Data-node plugins can configure quick actions and inline previews.
- German and English UI, same-origin image caching, HTML reports, searchable project logs and searchable/exportable system logs.
- An experimental optional OpenVPN/WireGuard gateway with profile rotation, health checks, queue coordination and a network-level killswitch. It requires the separate [VPN deployment](docs/vpn.md); saving profiles alone does not enable a VPN.

The interface targets desktop browsers. Small-screen access is hidden behind a desktop-mode notice; a browser's desktop mode can intentionally bypass that notice.

## Run locally with Docker

A Linux Docker host and Docker Compose are required. The image includes several research engines and Chromium, so the initial build can take a while and uses substantially more space than the application source.

```sh
git clone https://github.com/NikGro/argus-osint.git
cd argus-osint
docker compose up -d --build
```

Open **http://127.0.0.1:8080/**. The public `compose.yaml` contains only ARGUS, not the private development/MCP infrastructure used to work on it. Configuration examples are in [.env.example](.env.example).

There is currently **no user login or token-entry screen**. Anyone who can reach the interface can use the installation. The default binding is localhost; keep deployment within a trusted environment. Same-origin sessions and CSRF checks remain in place, but they are not user management.

The default standalone Compose file starts a supervisor with explicitly listed capabilities for the optional isolated worker. It fails if the required Linux namespace support is unavailable. See [worker runtime](docs/worker-runtime.md) for an unprivileged deployment option and its feature limits. Do not use `privileged: true` as a workaround.

Project data, uploaded files, plugin credentials and sessions live in the data volume. Back up the **whole volume**, including encryption keys, before changing deployments. Never remove that volume as an update step.

```sh
docker compose up -d --build
```

For the separate VPN stack, use [docs/vpn.md](docs/vpn.md) instead of starting a second copy against the same project database.

## Basic workflow

1. Create a project and add a data node, such as a username or email.
2. Select a compatible tool or drag it onto a data node. With multiple compatible data nodes selected, dropping a tool onto one of them connects the selected inputs together.
3. Set installation-wide sources and source order under **Plugins**. In the project detail panel, adjust the tool's run parameters and search profiles. An empty search-profile list means no profile restriction for that provider.
4. Start the tool explicitly. Results retain their input/tool provenance. Failures produce an error node; partial results keep successful findings together with a warning/error node.
5. Review findings, apply verification/tags and choose which nodes should appear in the report.

For DeepFace, select one image to create a tool and attach its second input, or select two images and drop the tool onto either image. A comparison starts only when the user runs the tool. The development checks do not run model inference.

## Plugins and integrations

See the [plugin guide](docs/plugins.md) for inputs, outputs, provider settings, search profiles and credentials. Developers should also read the [plugin contract](docs/PLUGIN_CONTRACT.md), [architecture](ARCHITECTURE.md) and runnable examples under [examples](examples).

ARGUS integrates work by many upstream maintainers, including [Consensus OSINT](https://github.com/OSINT-Experts-Society/Consensus-OSINT), [Sherlock](https://github.com/sherlock-project/sherlock), [Holehe](https://github.com/megadose/holehe), [Maigret](https://github.com/soxoj/maigret), [User Scanner](https://github.com/kaifcodec/user-scanner), [Ignorant](https://github.com/megadose/ignorant), [PhoneInfoga](https://github.com/sundowndev/phoneinfoga), [Blackbird](https://github.com/p1ngul1n0/blackbird), [FlareSolverr](https://github.com/FlareSolverr/FlareSolverr), [instagrapi](https://github.com/subzeroid/instagrapi), [Toutatis](https://github.com/megadose/toutatis) and [DeepFace](https://github.com/serengil/deepface). These are independent projects, not ARGUS endorsements or partnerships. Exact pins, license notes and additional runtime/UI credits are listed in [THIRD_PARTY.md](THIRD_PARTY.md).

## Alpha limits

Provider APIs and sites change, return incomplete data, require authentication or rate-limit requests. A positive tool result is a research lead, not automatic verification. A result can be partial even when other findings succeeded. Instagram only returns masked contact/recovery fields when its response actually includes them.

Community and browser research execution require the isolated worker. If the host does not provide it, those paths fail closed. Built-in trusted adapters run within the app's deployment boundary. The optional VPN gateway has offline state/firewall tests; a real-provider connection and disconnect/leak test is still required for each target deployment. Its UI refuses activation if the gateway is absent or in a different network namespace.

Model-specific licenses and first-use downloads apply to DeepFace weights. No model weights or third-party executables are committed to this repository. The alpha is not a security certification or a completed audit of every transitive dependency.

## Development

Production runs Python and the checked-in browser bundle; Node is used only for frontend development.

```sh
python -m pip install -r requirements.txt -r requirements-core.txt -r requirements-dev.txt
npm ci
npm run lint
npm run build
npm run test:frontend
python -m unittest discover -s tests -p 'test_*.py'
```

Some integration tests require tools available in the Docker image and are skipped when absent. Browser fixture tests use Playwright and a locally served `static/` directory; they substitute API responses and do not perform real-person research. See [CONTRIBUTING.md](CONTRIBUTING.md) for the validation workflow.
