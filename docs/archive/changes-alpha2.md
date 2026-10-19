# 1.0.0-alpha.2

- Video data node: upload, stable embedded player, file quick action, inspector preview, reports and byte-range serving.
- Video trimming creates an accurately re-encoded MP4 copy; original is preserved.
- CPU ECC/robust multi-frame fusion, 0.2–3 seconds, 2–32 PNG frames, bounded 1280×720 working resolution. See [video tools](video.md). Jamy-L was evaluated and replaced with the explicitly selected CPU implementation.
- Connection paths now follow n8n's forward Bezier and backwards rounded-detour rules. Label collision handling chooses a location on the path; it no longer changes the connection into an orthogonal forward route. Text and edit/delete controls are retained.
- Coalesced drag rendering, viewport-only pan/zoom, cached font/width measurement, shared obstacle sizing and incoming-edge indices. Removed synchronous SVG text boxes and large per-edge masks.

## Verification status

No test suite or GitHub Release was requested or run for this batch. A bounded, synthetic browser performance inspection compared the same 12-step pointer sequence: before 548–1082 ms, after 236–397 ms on the local machine. No >50 ms long task was recorded in that small fixture. This does not claim a large-graph or Synology browser benchmark. Build manifest/syntax and a single rendered video/UI inspection are separate build/implementation checks. Functional coverage is collected in TEST_QUEUE.md pending an explicit test request. No face inference or real-person research was performed.
