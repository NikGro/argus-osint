# Optional VPN gateway

The VPN is a separate Linux network gateway. `compose.vpn.yaml` starts the app with `network_mode: service:vpn`, so app traffic, built-in subprocesses and browser engines share the gateway's network namespace. The app refuses VPN activation when the control socket is absent or its reported namespace differs from the app's own namespace. If VPN is already saved as enabled, app startup also requires an enabled gateway in that same namespace; accidentally starting the app without its VPN stack must not restore ordinary egress.

**Deployment status:** the implementation has offline configuration, state, queue and firewall-rule tests. A live VPN-provider connection and a real disconnect/leak test have not been performed for this alpha. Do those checks on the intended host before relying on the deployment. The existing managed Synology installation does not acquire a VPN just by updating the application image; its lifecycle controller must be adapted to the gateway stack by the host operator.

## Installation

Requirements: Linux Docker, Docker Compose, `/dev/net/tun`, the listed `NET_ADMIN`, `NET_RAW` and `CHOWN` capabilities for the gateway, IPv4/IPv6 netfilter support and (for WireGuard) a host kernel with WireGuard support. The application itself remains unprivileged in the supplied VPN stack. Browser/community worker isolation is a separate deployment option.

Back up the entire existing app data volume, including encryption keys. Stop the existing app before replacing its deployment; never run two app instances against the same SQLite data volume. Using the same directory and Compose project name reuses the standalone stack’s `argus-data` volume. For an existing custom installation, explicitly map `argus-data` to the existing volume using a reviewed Compose override. Do not delete the original volume.

```sh
docker compose -f compose.vpn.yaml up -d --build
```

Open http://127.0.0.1:8080/ and go to **Settings → VPN**. The default binding is localhost. `BIND_ADDRESS` changes the gateway's published address when a trusted LAN deployment is intended.

The managed Synology MCP lifecycle methods used during development can rebuild/recreate only the existing app service. They cannot deploy the new gateway service or rewrite the running controller's baked service policy. The host operator must install this stack and update that controller before enabling VPN on that managed installation. When replacing the gateway container, recreate the app with it so both attach to the same network namespace.

## Profiles and rotation

Import or paste multiple OpenVPN (`.ovpn`) or WireGuard (`.conf`) client profiles. Give each a name. Optional OpenVPN username/password fields are stored with the profile. App settings are encrypted in the data volume; gateway settings are separately encrypted in `vpn-state`. Profile text, private keys and passwords are not returned by the settings list or written to system logs.

Supported profiles are standalone full-tunnel clients. OpenVPN requires one IPv4-capable remote and inline CA/certificate/key material rather than external file paths; script hooks, plugins and arbitrary file options are rejected. WireGuard supports one Interface/Peer pair with `AllowedIPs` including `0.0.0.0/0`; hooks/custom routing are rejected. This alpha uses IPv4 VPN transport endpoints. Unsupported IPv6 egress is blocked rather than allowed outside the tunnel. Hostnames are resolved when the gateway accepts an enabled configuration; compiled endpoint addresses are retained with it. Re-import a changed endpoint/profile if its cached address becomes obsolete.

Enable **Use VPN** after the gateway is available. Optional rotation can use a time interval (1–1,440 minutes) or run after each completed tool attempt. Time-based rotation waits for a running tool to release its connection. Interactive input/challenge requests do not rotate between prompt and continuation. **Switch VPN now** requests the next profile.

Each candidate must pass an HTTPS request bound to the tunnel interface before being marked connected. Failed profiles are skipped. If none works, egress stays blocked and the gateway retries later. Queued tools wait, show **Waiting for VPN** in the toolbar and can be cancelled. A timer switch does not intentionally interrupt an active tool; an actual tunnel failure can still cause the running tool to time out or return partial results.

## Killswitch and DNS

When enabled, the gateway installs an OUTPUT firewall chain for both IPv4 and IPv6. It allows loopback, the tunnel interface, replies from the app's published HTTP port, and explicitly marked encrypted transport packets to configured VPN endpoints. Other egress is rejected, including fallback routes after the tunnel disappears. The rules are updated atomically within each address family and remain installed if the control worker or VPN process fails. A disabled or absent tunnel is not permission to use the ordinary internet connection.

The supplied stack binds `deploy/vpn-resolv.conf` into both containers. Its public DNS servers are reached through the tunnel while VPN is enabled; it avoids Docker's embedded DNS resolver bypassing the container's egress policy. The enabled firewall additionally rejects the embedded resolver address `127.0.0.11` before allowing other loopback traffic. VPN transport packets and inbound UI replies are necessary exceptions. The gateway does not control links explicitly opened in the user's separate browser or unrelated containers on the host.

Disabling VPN is an explicit user action that opens normal egress again. The disabled preference is committed before the gateway can open egress, so the saved setting cannot still promise protection after normal routing is restored. Before migrating back to a standalone stack, disable VPN while the original gateway is still available. Configuration changes and profile removal are refused while a tool holds a gateway lease. The UI reports the active profile and state. System logs record state/profile IDs, not configuration secrets.

## Host verification checklist

With a valid test-provider profile, verify that the app's public source address changes; confirm DNS egress uses the tunnel; interrupt the tunnel and prove an external request cannot succeed over the host route; verify IPv6 cannot escape; confirm a queued tool waits and cancellation works; restore the connection and verify the next queued tool resumes. Repeat with an invalid profile before a valid profile. A missing device, unsupported kernel or failed firewall installation must block activation/startup rather than silently remove the killswitch.

Protocol references: [WireGuard quick start](https://www.wireguard.com/quickstart/), [wg-quick manual](https://git.zx2c4.com/wireguard-tools/about/src/man/wg-quick.8), [OpenVPN 2.6 manual](https://openvpn.net/community-docs/community-articles/openvpn-2-6-manual.html).
