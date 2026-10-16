# ARGUS working agreements

- Preserve the established ARGUS interface and reuse existing list, icon, field and dropdown components.
- Call actors **tools** in all user-visible text. Internal API identifiers may remain unchanged.
- Tests and GitHub releases require an explicit user request. Collect pending coverage and manual checks in TEST_QUEUE.md between requests.
- When tests are requested, batch changes first and run the requested suite once. Rerun only failed or materially affected checks after fixes. Do not repeat the complete suite after small changes.
- Pushing code and creating a GitHub Release are separate actions. Use GitHub MCP for repository publication.
- Versions follow 1.0.0-alpha.1, 1.0.0-alpha.2, and so on.
- Never initiate face comparisons or real-person research. Tests use synthetic fixtures and mocked inference.
- Standard deployment is a single ARGUS image containing VPN, browser and isolated community workers. Keep the application unprivileged behind its internal supervisor; do not replace fail-closed isolation with unrestricted fallback execution.
