# Integrated browser and community runtime

The standard ARGUS image includes Chromium, ChromeDriver, Xvfb, FlareSolverr and isolated community workers. They run in the same container as ARGUS, supervised by the entrypoint. No separate service or installation is needed. Use the supplied Compose file so the container receives the required Linux capabilities; the app itself runs as UID 10001.

Browser/community jobs run in separate network, mount and PID namespaces under temporary identities. User data and the app process table are hidden. Their only egress is a restricted proxy in the main container network namespace, so enabling VPN also protects worker traffic. Community scripts cannot access saved ARGUS credentials.

The built-in browser renders JavaScript and handles supported challenge pages. Website challenges, account restrictions, interactive reCAPTCHA and upstream rate limits cannot be guaranteed to succeed automatically. ARGUS retains partial results and emits warnings/errors rather than reporting blocked pages as genuine matches. Do not repeatedly retry a site that refuses access.

`worker_isolation` in `/api/health` reports whether the internal worker socket is ready. Starting without the supplied Compose configuration leaves the app unprivileged and isolated features unavailable. Explicitly requesting the supervisor with insufficient namespace permissions fails at startup. There is no unrestricted worker fallback. No external browser listener or community execution endpoint is exposed.

## Worker egress policy and diagnostics

The worker proxy accepts public HTTP(S) destinations on ports 80 and 443 only,
including CONNECT tunnels. The existing numeric-IP pinning and private/mixed-DNS
rejection remain in force. This is a destination/port policy, not a guarantee
that a remote service on an allowed port speaks a particular protocol. Trusted
built-in application transports are separate from the restricted worker proxy.

The Unix proxy socket permits connections from the distinct per-job identities;
Linux SO_PEERCRED checks reserve its use to worker UIDs 20000–59999 before HTTP
parsing. Other identities and unavailable peer-credential checks are rejected.
Socket mode 0666 therefore does not provide anonymous proxy use.

Rejections and transport failures produce structured `argus.egress` warning
events in the supervisor/container logs. They include the parsed destination
host/port when available and the failure type, never URL paths, query strings,
credentials, request bodies or raw exception messages.

Broker connections have a five-second connection limit and a separate bounded
30-second upload limit for payloads up to 24 MiB. The 0.5-second timeout is used
only when polling for results/cancellation after upload. Transport failures map
to application error codes and request cancellation; no unisolated retry occurs.
