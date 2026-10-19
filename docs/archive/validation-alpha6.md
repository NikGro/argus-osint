# Alpha 6 – UI correction batch

Central React controls now use the established #ff9d45 accent, #4dbdff selection and consistent 16 px inspector section padding. Removed native SVG focus rectangles, the extra logs back button and optional provider move buttons; drag sorting remains. The workspace owns viewport overflow and protects its header from pinch-wheel page zoom. Graph resize preserves the preceding visible world rectangle by reducing zoom when necessary (15% minimum).

Shared searchable selectors have inset options; phone prefixes display only the selected code. Country and code controls share 36 px height. Date/time and compact color popovers are themed; timezone options include date-aware UTC offsets. Manual email fields retain invalid drafts without saving them as node values.

Maps remain same-origin. A failed/unavailable isolated Google preview falls back to the built-in server-rendered OpenStreetMap view with its actual attribution. Geocoding and map tiles are requested by ARGUS, never directly by the browser. No host isolation policy or VPN routing was bypassed. Google browser launch permissions remain an external prerequisite. The map frame is rounded and 16:10; requests are debounced and cached.

Verification: frontend production build and ESLint passed; modified Python files parsed. Bounded synthetic browser visual inspection found no page errors, no root overflow at 1600x1000, closed +49 prefix, 36 px country/code controls, themed calendar and color popovers. No automated test suite, real-person research, face comparison or GitHub release was run for this batch. See TEST_QUEUE.md for pending functional coverage.

Live deployment: application/database healthy, queue worker alive, no worker error. Map tile retrieval is blocked by container outbound connection errors (502 external_request_failed/OSError); no working map or VPN routing is claimed. Preview now probes a central cached tile before emitting HTML, so blocked egress shows the localized unavailable state instead of broken images. Host routing/capability resolution remains required.
