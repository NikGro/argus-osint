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

## Privilege boundary and startup checks

The privileged supervisor is trusted infrastructure for VPN and namespace setup;
it does not execute community modules or render pages. Before starting services
or exposing the worker broker, it checks both namespace support and the complete
worker identity/capability/seccomp transition in a disposable subprocess. If the
host cannot load the required filter, privileged startup fails rather than
advertising a ready broker whose jobs cannot be safely launched.

Each job independently repeats hardening and verifies the resulting kernel
state before starting its proxy thread or plugin/browser child: real, effective
and saved UIDs/GIDs must all equal the reserved worker identity, supplementary
groups must be empty, all five capability sets must be zero, no-new-privileges
must be enabled, and seccomp filter mode must be active. Any missing state or
failed check aborts the job. This includes bounding capabilities, so a later
executable cannot reacquire supervisor capabilities through file capabilities.

The worker filter denies new namespace creation through unshare/setns/clone
flags, rejects clone3 with ENOSYS (ordinary threads can fall back to clone), and
blocks keyrings, BPF/perf, io_uring and other privileged kernel interfaces.
Workers do not currently have a separate user namespace. AppArmor remains an
optional host-loaded layer; the portable default is unconfined for AppArmor,
not for seccomp. These boundaries reduce exposure but are not equivalent to a
separate VM or a claim of protection against every kernel vulnerability. See
[deployment policy](../deploy/README.md) for capabilities and host requirements.
