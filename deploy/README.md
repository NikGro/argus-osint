# Container permissions

The application, its plugins and their tools run as UID 10001. Root is used
only by the container supervisor to prepare the data folders and by the
integrated VPN controller. Do not expose the controller's private Unix socket.

## Capability inventory

Compose drops every default capability and adds only:

| Capability | Consumer and reason |
| --- | --- |
| NET_ADMIN | TUN interfaces, routes and IPv4/IPv6 kill-switch rules |
| NET_RAW | OpenVPN and WireGuard transport sockets |
| SETUID / SETGID | Start the application as UID 10001 |
| CHOWN | Give the data, tool and plugin folders to UID 10001 |
| KILL | Stop the application when the VPN controller stops |

`/dev/net/tun` is needed for the VPN. `no-new-privileges` is set. No seccomp or
AppArmor profile is required, so the same Compose file works on Synology DSM.

## Synology

`compose.synology.yaml` uses the same permissions with fixed names for
Container Manager (`ARGUS` container, `argus:local` image, `argus_argus-data`
volume). Set `BIND_ADDRESS=0.0.0.0` in `.env` for access from the home network.
