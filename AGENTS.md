# ARGUS working agreements

- Preserve the established ARGUS interface and reuse existing list, icon, field and dropdown components.
- Call actors **tools** in all user-visible text. Internal API identifiers may remain unchanged.
- Locally run focused checks for changed behavior; batch the full suite for requested releases. CI always runs the complete lint, format, frontend-build, Python and browser/runtime checks on every push and pull request. GitHub releases require an explicit user request and successful CI.
- When tests are requested, batch changes first and run the requested suite once. Rerun only failed or materially affected checks after fixes. Do not repeat the complete suite after small changes.
- Pushing code and creating a GitHub Release are separate actions. Use GitHub MCP for repository publication.
- Versions follow the user-selected calendar scheme: 26.10.2-beta.1 (V26.10.2 Beta 1), then later calendar releases.
- Never initiate face comparisons or real-person research. Tests use synthetic fixtures and mocked inference.
- Standard deployment is a single slim ARGUS image with the VPN controller and system libraries. Plugins (including ARGUS's own) and their research tools are installed on demand into the data volume and run unsandboxed as the unprivileged application user (user decision, Nov 2026). Keep the VPN fail-closed: when the controller stops, the application stops.
- Native plugin code changes require `python scripts/build_plugin_manifest.py` (updates `plugins/native.json` and `.dockerignore`). Tool version changes require `python scripts/lock_tools.py <tool>` and a new recipe version in `core/tools.py`.
- ARGUS is English-only: write all user-visible text in English where it is produced; there is no translation layer.
