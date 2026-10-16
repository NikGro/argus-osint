# Integrated browser and community runtime

The standard ARGUS image includes Chromium, ChromeDriver, Xvfb, FlareSolverr and isolated community workers. They run in the same container as ARGUS, supervised by the entrypoint. No separate service or installation is needed. Use the supplied Compose file so the container receives the required Linux capabilities; the app itself runs as UID 10001.

Browser/community jobs run in separate network, mount and PID namespaces under temporary identities. User data and the app process table are hidden. Their only egress is a restricted proxy in the main container network namespace, so enabling VPN also protects worker traffic. Community scripts cannot access saved ARGUS credentials.

The built-in browser renders JavaScript and handles supported challenge pages. Website challenges, account restrictions, interactive reCAPTCHA and upstream rate limits cannot be guaranteed to succeed automatically. ARGUS retains partial results and emits warnings/errors rather than reporting blocked pages as genuine matches. Do not repeatedly retry a site that refuses access.

`worker_isolation` in `/api/health` reports whether the internal worker socket is ready. Starting without the supplied Compose configuration leaves the app unprivileged and isolated features unavailable. Explicitly requesting the supervisor with insufficient namespace permissions fails at startup. There is no unrestricted worker fallback. No external browser listener or community execution endpoint is exposed.
