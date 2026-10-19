# Container security policies

The HTTP application runs as UID 10001. Root is reserved for the container supervisor, integrated VPN controller and fixed-command worker broker. Do not expose their private Unix sockets.

## Capability inventory

Compose drops every default capability and adds only:

| Capability | Consumer and reason |
| --- | --- |
| SYS_ADMIN | Broker mount/network/PID namespaces and private mounts; VPN namespace plumbing |
| NET_ADMIN | TUN interfaces, routes and IPv4/IPv6 kill-switch rules |
| SETPCAP | Remove the entire worker capability bounding set before changing UID |
| SETUID / SETGID | Supervisor app identity and separate per-job worker identities |
| CHOWN | Make private working files accessible to their per-job identity |
| KILL | Cancel a job whose descendants have a different UID |

NET_RAW is not granted. OpenVPN/WireGuard tunnel transports use ordinary UDP/TCP sockets and `/dev/net/tun`.

`seccomp-argus.json` derives from the Apache-2.0 Moby profiles default policy at commit `6fe7deb1b9fb7c0397a4593480d7d22b9ee8caef`. Its SYS_ADMIN exception is narrowed to namespace/mount setup; privileged BPF, perf, module and other kernel interfaces are not enabled by that exception. Keep the policy alongside `compose.yaml` when installing.

Inside each worker `core/worker_security.py` removes bounding/ambient/effective/permitted/inheritable capabilities, verifies the final identity and enables no-new-privileges. A second inherited filter denies namespace/mount manipulation, tracing, keyrings, BPF/perf, io_uring and raw/kernel sockets. It returns ENOSYS for clone3 so ordinary thread creation can fall back to clone. The outer layer is an allowlist; this inner layer is a targeted denial filter. Missing libseccomp or any failed hardening operation aborts the worker.

## Optional AppArmor

The image includes no MAC_ADMIN privilege. A host administrator may load the supplied profile with `sudo apparmor_parser -r deploy/apparmor-argus`, then set `ARGUS_APPARMOR_PROFILE=argus` before starting Compose. Review mount paths and audit denials on the actual Docker/kernel combination before relying on it. Policy grammar validation alone does not prove VPN, browser or worker compatibility. The portable default is `unconfined` for AppArmor, explicitly documented rather than silently presenting an untested MAC profile as enforced.

The managed Synology deployment has its own external Compose configuration. Source changes cannot grant missing host permissions; its health endpoint reports whether worker isolation is actually available. Never bypass that report with an unisolated subprocess fallback.
