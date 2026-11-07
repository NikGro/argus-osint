# ARGUS 26.11.1 Beta 1

ARGUS now ships as one slim container without research plugins. Install the plugins you need from the library; ARGUS downloads them with their tools, verifies them and runs several tools at once if you want. This beta also adds audio support, makes ARGUS English-only and refreshes the canvas.

## Read before updating

- **No plugins are installed after the update.** Open **Plugins → Add plugins** and install the ones you use. Their settings, saved logins and node defaults are kept and apply again.
- **Tools are downloaded on install** into the data volume (`/data/tools`): a few hundred MB to a few GB, depending on the plugins. Keep the complete data volume, including the encryption keys.
- **Use the updated Compose files.** The container needs fewer privileges (no `SYS_ADMIN`, no seccomp or AppArmor profile); `compose.synology.yaml` now also runs the VPN on Synology DSM.
- **ARGUS is English-only.** The language setting and language packs are gone. Existing projects are converted once when opened: generated labels, relations, group names, errors and run warnings become English; text you typed yourself stays as written.
- **Community plugins run without a sandbox** as the unprivileged application user and therefore have ARGUS's permissions. Install only code you trust.

## Plugins on demand

- ARGUS's own plugins are downloaded from this release's source when you install them; every file is checked against its SHA-256 hash.
- Python research tools install only from hash-pinned locks (`pip --require-hashes`). GitHub sources stay pinned to a commit and PhoneInfoga to its published checksum. Existing tools are reinstalled once from the locks.
- The library shows each install step, errors with the installation log and a retry. Removing a plugin asks first, keeps its settings and deletes tools no other plugin needs.

## Running tools

- Tools have no overall time limit anymore; they run until they finish or you cancel them. Per-request timeouts remain.
- **Settings → Parallel tools** sets how many tools run at once; **Detect system resources** suggests a value. Parallel tools share the VPN connection, and a VPN rotation waits until no tool is running.

## Audio

- New **Audio** data node with players in the node and in node details.
- New **Trim audio** tool. **Extract metadata** now also reads audio and video files.
- New **Dopplergeist** plugin: estimates where a recording was made from passing aircraft and historical ADS-B flight data. Connect the audio file and a date/time node with the recording start; candidates become location nodes. Flight data is cached until the plugin is removed. Dopplergeist is licensed for noncommercial use only.

## Workspace

- The details panel stays open and shows a project overview when nothing is selected. Canvas mode is more compact, and the default zoom leaves more room for the graph.
- Node details name the kind of node under a *Tool* or *Data* label. Selecting several nodes lets you change their shared settings (glances, quick actions, verification, tags) together.
- Results from research and metadata tools use the matching data types — usernames, email addresses, phone numbers, links and dates — so they can feed the next tool directly.
- Notes, error messages and transform code are edited in resizable multi-line fields; error nodes show their full message.
- The report preview refreshes automatically and notes are always visible.
- Wide database tables have a scrollbar above the table too.

## Fixes

- *Clear system logs* no longer fails with "Unexpected token".
- The plugin library opens without errors and loads quickly on NAS storage.
- Plugins whose update or repair failed stay visible with a retry instead of disappearing.

## Clean-up

- Removed the namespace/seccomp worker isolation with its egress proxy, the outdated source manifest, duplicate Compose files and the unused VPN sidecar.
- The plugin manager is split into catalogue, native installation, community repositories and settings upgrades. Documentation, help and the community plugin example are updated.

Earlier release notes are on the [releases page](https://github.com/NikGro/argus-osint/releases).
