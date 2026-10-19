# ARGUS working agreements

- Preserve the established ARGUS interface and reuse existing list, icon, field and dropdown components.
- Call actors **tools** in all user-visible text. Internal API identifiers may remain unchanged.
- Locally run focused checks for changed behavior; batch the full suite for requested releases. CI always runs the complete lint, format, frontend-build, Python and browser/runtime checks on every push and pull request. GitHub releases require an explicit user request and successful CI.
- When tests are requested, batch changes first and run the requested suite once. Rerun only failed or materially affected checks after fixes. Do not repeat the complete suite after small changes.
- Pushing code and creating a GitHub Release are separate actions. Use GitHub MCP for repository publication.
- Versions follow the user-selected calendar scheme: 26.10.2-beta.1 (V26.10.2 Beta 1), then later calendar releases.
- Never initiate face comparisons or real-person research. Tests use synthetic fixtures and mocked inference.
- Standard deployment is a single ARGUS image containing VPN, browser and isolated community workers. Keep the application unprivileged behind its internal supervisor; do not replace fail-closed isolation with unrestricted fallback execution.
