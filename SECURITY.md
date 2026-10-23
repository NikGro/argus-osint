# Security policy

## Reporting a vulnerability

Please report security issues privately through GitHub:
**Security → Report a vulnerability** in this repository
([direct link](https://github.com/NikGro/argus-osint/security/advisories/new)).

Do not open a public issue for vulnerabilities. Include the affected version or
commit, reproduction steps and, if possible, a suggested fix. You will receive a
reply as soon as the maintainer has reviewed the report.

## Supported versions

ARGUS is a beta. Only the latest release and the current `main` branch receive
security fixes.

## Intended deployment

ARGUS is designed for private, self-hosted use: a single person, or a small
trusted team on an internal network. It has no user accounts and must not be
exposed to the internet or to untrusted networks.

Community plugins are optional and never installed by default. ARGUS does not
review their code. They run in an isolated worker, which is an additional
safeguard rather than protection against malicious code, so install only
repositories you have reviewed and whose author you trust.
