# Integrated VPN

ARGUS 1.0 alpha bundles OpenVPN, WireGuard (with a userspace fallback), rotation, health checks and the VPN controller in the same image. No sidecar or host package installation is required. Start the supplied `compose.yaml`; it grants the Linux capabilities and `/dev/net/tun` device needed for VPN and isolated browser/community workers.

## Configuration

Open **Settings → VPN**, add standalone OpenVPN `.ovpn` or WireGuard `.conf` profiles, optionally enter OpenVPN credentials, and enable VPN. Drag profile handles to set failover order. Arrow keys on a handle also reorder profiles. Expand a profile to rename it; remove and add it again to replace credentials. Profiles and credentials are encrypted in the persistent data volume and never returned in API responses.

OpenVPN certificates and keys must be inline. Arbitrary hooks, scripts and external file references are rejected. WireGuard profiles must have one Interface and one Peer with a full IPv4 tunnel. ARGUS blocks ordinary IPv6 egress rather than letting it bypass VPN. Container deployment still requires a Linux host that supports network namespaces, TUN and firewall rules; Docker Desktop provides its Linux VM.

## Rotation and killswitch

Enable rotation by interval or after each tool. Connections are checked before accepting work. Unreachable profiles are skipped. While changing VPN or waiting for a working profile, queued tools wait and the toolbar shows **Waiting for VPN**.

When VPN is enabled, IPv4 and IPv6 firewall rules reject ordinary egress outside the VPN interface. Only marked VPN transport packets to configured endpoints and replies to inbound ARGUS HTTP connections are allowed outside it. Docker embedded DNS is blocked; public DNS uses the tunnel. Browser and community workers use an egress proxy in the same protected namespace. If a connection drops, tools cannot continue over the ordinary interface. Existing TCP requests can fail; queued work waits for reconnection. Disabling VPN explicitly permits ordinary egress.

The controller starts and restores the persisted firewall before the application starts. The application runs as an unprivileged user. If the controller exits, the supervisor stops the application. Profile state persists under `/data/.vpn-private`; back up the data volume, including the encryption keys, together.

## Deployment validation

Offline firewall/state tests do not replace a real-provider leak test. On a new host, verify public IPv4, IPv6 and DNS while enabled; interrupt the tunnel and confirm outbound requests fail; restore it and confirm queued work resumes. Test rotation with one unreachable profile. No provider credentials are included and no real VPN profile is activated by automated tests.
