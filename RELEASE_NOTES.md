# ARGUS v1.0.0-alpha.1

- One container includes VPN, Chromium and isolated community research workers; encrypted VPN profiles support rotation and fail-closed egress.
- Log auto-refresh and follow controls; successful HTTP polling no longer floods system logs and idle job polling backs off.
- Expanded English translations, including the mobile desktop-mode screen; consistent tool terminology.
- Fixed left inputs/right outputs, visible required input slots and group-level visual connectors that preserve original node ownership.
- Work-step grids/circles, hierarchical crossing reduction, preserved nested groups and a resizable color marker node.
- Sticky header, settings save status, corrected icons/chevrons, uniform quick actions and multi-selection report checkboxes.
- Updated upstream packages and Consensus; project README includes synthetic UI screenshots and credits.

No real-person research, face comparisons or real-provider VPN connections are performed by automated validation. See the validation record in docs/validation-alpha1.md for checked and pending items.

---

# ARGUS v0.29.0-alpha.1

First public, vibe-coded alpha of the desktop OSINT graph workbench. Original ARGUS source is MIT licensed; upstream tools, icons and model weights retain their respective terms, including Blackbird's noncommercial license.

Includes typed nodes/tools, provenance, nested groups, project archiving/renaming, reports, search-profile lists, ordered research providers, Generic/Instagram enrichment, DeepFace comparison/overlay integration, cached images, German/English UI, and searchable/exportable system logs.

Recent fixes align conventional control spacing, square icon buttons, header status/settings placement, consistent destructive colors, rounded scrollbar tracks, larger orange group arrows, green/red connection-port hover states, and compact grid/circle layouts. Research sources/order are plugin-wide. DeepFace supports two-image selection/drop wiring and asks about a reduced working copy for oversized inputs. Error details have one title editor.

An optional VPN gateway supplies encrypted profiles, interval/per-tool rotation, candidate health checks, queue waiting and a network-level IPv4/IPv6 killswitch. Its separate deployment is required; it is not enabled merely by updating the app container. Live VPN connection/disconnect/leak checks remain required on the target host. Offline tests use fake transports, and no face-model inference is performed by the development checks.

This is experimental software. Provider responses may be partial or unavailable. Browser/community execution requires host worker isolation; there is currently no user login/user-management screen. Read README.md, docs/plugins.md, docs/vpn.md and THIRD_PARTY.md before deploying.
