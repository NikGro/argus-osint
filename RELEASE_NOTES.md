# ARGUS – next beta (draft)

ARGUS now starts as a slim all-in-one container without research plugins. You install the plugins you need from the library, ARGUS downloads them and their tools, and runs them itself, several at once if you like.

## Read before updating

- **ARGUS is English-only now.** The language setting and both language packs are gone; interface, plugins, tool results and reports are written in English. Existing projects are converted once when opened: generated labels, relations, group names, error nodes and run warnings become English. Text you wrote yourself (renamed nodes, notes, your values) stays as typed.

- **After the update no plugins are installed.** Open **Plugins → Add plugins** and install the ones you use. Their settings, saved logins and node defaults are kept and apply again.
- Tools (Sherlock, Maigret, DeepFace, FlareSolverr and the others) are downloaded into the data volume (`/data/tools`) on install. Expect a few hundred MB to a few GB depending on the plugins.
- Use the updated Compose files: the container needs fewer privileges (no `SYS_ADMIN`, no seccomp or AppArmor profile) and the same file now works on Synology DSM, including the VPN.

## Plugins on demand

- ARGUS's own plugins are listed in the library and downloaded from this release's source on install; every file is checked against its SHA-256.
- The library shows each install step, failures with the reason and the installation log, and a retry. Removing a plugin asks for confirmation, keeps its settings and deletes tools no other plugin needs.
- Website catalogues for site selection are rebuilt from the tools that are installed.

## Audio and Dopplergeist

- New **Audio** data node (MP3, WAV, FLAC, OGG, M4A) with a player in the node details. Dropped audio files become audio nodes; MP3s with cover art are no longer mistaken for videos.
- New plugin **Locate audio with Dopplergeist**: estimates where a recording was made from passing aircraft and historical ADS-B flight tracks. Takes the recording start from its parameters or a connected date/time node; candidates become location nodes, an inconclusive analysis becomes an error node with the reason. Flight data (often many gigabytes) is cached until the plugin is removed. Dopplergeist is licensed for private, noncommercial use only. The tool node shows two input sockets (audio and date/time).
- New tool **Trim audio**: cuts a time range into a new AAC copy, with a player and start/end controls in the tool details. **Extract metadata** now also accepts audio and video nodes.

## Interface

- **Canvas:** the detail panel stays open and shows a project overview (counts, running tools, error nodes, report selection, data by type) when nothing is selected; only its toggle collapses it. Header, toolbar and side panels are more compact in canvas mode. *100 %* zoom is now a smaller working size (the former 70 %), leaving more room on the canvas; zoom goes up to 300 %.
- **Nodes:** tools that take a fixed set of inputs show one input socket per input.
- **Multiple selection:** besides *Include all in report* and *Delete*, the details panel offers the fields the selected nodes share — Quick Actions & Glances toggles, verification and tags — and applies changes to all of them.
- **Plugin library:** shows a loading state, hides the installed list while open, and puts *Add community repository* on the same row as *Close library*. Groups are named *Native plugins* and *Community plugins*. Tool sizes are measured once at installation instead of on every request, so the library opens quickly on NAS disks.
- **Report:** notes are always visible and the preview refreshes automatically; the report shows a readable timestamp. *Include in report* is highlighted in node details.
- **Databases:** actions align with the page title; deleting a database uses a red button.

## Fixes

- **Clear system logs** no longer shows an "Unexpected token" error. The request body was left unread, so the next request on the same connection failed; ARGUS now closes such connections.
- Settings and help in the header are spaced like the other buttons.
- Opening the plugin library no longer shows "y.filter is not a function".
- Plugins whose update or repair failed no longer disappear silently; the plugins page points to the library to retry.

## Clean-up

- Removed the outdated source manifest and export script, duplicate Compose files, the unused VPN sidecar Dockerfile and archived test specifications. Dated review documents moved to `docs/archive`.
- The plugin manager is split by responsibility: catalogue and settings, native installation, community repositories and settings upgrades.

## Supply chain

- Every Python research tool installs only from a hash-pinned lock (`core/tool_locks/`, `pip --require-hashes`); a changed or substituted package fails the installation. GitHub sources stay pinned to a commit, PhoneInfoga to its published checksum. Existing tool installations are reinstalled once from the locks after the update.

## Execution

- No more overall time limits for tools; a tool runs until it finishes or you cancel it. Per-request timeouts stay.
- **Settings → Parallel tools** sets how many tools run at the same time. **Detect system resources** reads cores and free memory and sets a recommendation. Parallel tools share the VPN connection; a rotation waits until none is running.
- Plugins, tools and community plugins run without a sandbox as the unprivileged application user. Community plugins therefore have all of ARGUS's permissions; the install warning says so. The namespace/seccomp worker isolation and its egress proxy were removed.

# ARGUS 26.10.4 Beta 1

This beta adds an official Compose file for hosts without seccomp support, such as Synology DSM. It includes everything from 26.10.3 Beta 1 (below). Existing data volumes remain compatible.

## Synology and hosts without seccomp

- New `compose.synology.yaml` runs ARGUS unprivileged as UID 10001 with no extra capabilities. Select it with `COMPOSE_FILE=compose.synology.yaml` in `.env`; add `BIND_ADDRESS=0.0.0.0` for access from the home network.
- On these hosts the integrated VPN, community plugins and the built-in browser stay disabled, and `/api/health` reports `worker_isolation: false`. The default `compose.yaml` is unchanged for hosts that support seccomp.
- README and `.env.example` describe the setup.

## Included from 26.10.3 Beta 1

This beta hardens the worker boundary, makes the interface consistently German or English, and leaves React as the only user interface layer. Existing graphs, databases and uploaded files remain compatible. Retain the complete data volume, including encryption keys, when updating.

### Security and runtime

- The isolated worker proxy accepts public HTTP(S) destinations on ports 80 and 443 only, checks Unix peer credentials against the reserved worker identities and logs rejections without URL paths or secrets. Broker connect, upload and polling have separate time limits; transport failures cancel the job instead of surfacing raw socket errors.
- Before starting services, the privileged supervisor verifies the complete worker identity, capability and seccomp transition in a disposable probe. Each worker re-checks its kernel state before running untrusted code. Failures abort startup; there is still no unrestricted fallback.
- Community plugins stay opt-in. Adding a repository and installing a plugin each ask for confirmation, naming the repository and pinned commit and stating that ARGUS does not review community code. `SECURITY.md` describes private vulnerability reporting and the intended private, self-hosted deployment.
- Manual cancellation is no longer swallowed by provider aggregation, deep research or Instagram collection. Narrower error recovery keeps programming defects from looking like ordinary fallback results.
- Request headers and identifiers derive their version from `VERSION`.

### Interface

- React is the only view layer. About 5,500 lines of retired imperative UI code and unused modules were removed; domain modules no longer read or write application markup.
- German and English no longer mix: generated tool labels, warnings, errors, run states, group titles and reports are translated, and plugin text falls back to its own language. Locale contract tests guard against regressions.
- The plugin library has an **Add community repository** button with a confirmation, spaced cards and a repository list.
- Help is an icon button next to Settings. The interface appears only after the language pack has loaded, so no raw translation keys flash during startup.
- Node details use one spacing unit between a label and its control and two units before the next label; the database column for Search database and DeepFace follows the same layout. DeepFace shows a translated "Maximum comparisons" label.
- Multi-selection details separate the count, **Include all in report** and **Delete nodes** into their own sections.
- DeepFace accepts a total timeout of 0 to disable the deadline for long database comparisons; the default remains 300 seconds.

### Fixes and maintenance

- A tool failure is no longer lost when the project is saved while the tool runs; the error node, failed run and tool status are kept.
- Reports translate type labels, group titles, relationships, run history and generated error text.
- Tool execution and result materialization were refactored for readability without behaviour changes (verified against the previous implementation with randomized synthetic results).
- CI runs `ruff check .`; tests that need ExifTool or Holehe skip explicitly outside the container image, while the image gate requires them.

### Deployment note

Hosts whose kernel lacks seccomp (for example Synology DSM) cannot run the integrated VPN and isolated workers. ARGUS then starts unprivileged, as before, and reports `worker_isolation: false`.
