# Worker runtime

The app works as a single Python service with a persistent queue. Built-in trusted adapters operate inside its deployment boundary. Community Python and browser-backed research require the optional isolated-worker broker.

The public standalone Compose file explicitly starts the supervisor as root with the listed Linux capabilities. The supervisor checks namespace support, starts its local Unix-socket broker/egress proxy and runs the app as UID/GID 10001. If namespace creation fails, it exits. `/api/health` reports `worker_isolation`; it must be `true` before those execution paths are available. Never replace the check with unrestricted execution or `privileged: true`.

On hosts unable to supply this boundary, run the app as `10001:10001` with all capabilities dropped. Built-in functionality remains subject to each adapter's requirements; community and browser research fail closed. The existing managed development installation uses this reduced mode until its host operator updates the lifecycle controller's policy.

The optional VPN Compose stack is also unprivileged on the app side. Its gateway is a separate network control boundary, not a substitute for worker isolation. See [vpn.md](vpn.md).

There is currently no token-entry/pairing dialog. Browser sessions are automatically established with same-origin and CSRF checks. This does not provide multiuser authentication. Keep the service bound to localhost or a trusted private environment. Preserve the whole data volume, including its encryption keys, during migration and backup.

There is one application process and one persistent execution queue, not a multi-replica distributed scheduler. A restart marks unfinished jobs interrupted rather than replaying external operations. Cancellation cannot undo a request already sent to a provider. Community code receives its selected inputs and own configured parameters; namespace/resource separation is not a guarantee against every kernel or dependency vulnerability.
