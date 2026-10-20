# Error boundaries

Expected recovery in a helper should catch the errors that recovery can handle.
An unexpected programming error should reach the HTTP/job/tool boundary, where
it becomes an observable failure. Do not turn arbitrary exceptions into a
successful empty response, an unnecessary browser retry or a checkpoint result.

Cancellation is control flow. Provider aggregation and enrichment re-raise
`AppError("actor_cancelled")` immediately; Instagram process recovery also lets
AppError propagate. A cancelled provider must not start the next provider.
Other independent provider failures can retain already collected results with
an incompleteness warning.

## Narrow recovery

| Area | Expected recovery |
| --- | --- |
| Google snapshot preview | Known transport, application and malformed-response errors fall back to server-side map tiles; a structured event records the exception type without URLs, payloads or raw messages. |
| Map HTTP endpoint | Expected map errors produce the localized unavailable view. Unexpected exceptions reach normal HTTP failure handling. |
| Uploaded-file MIME detection | Unsupported files or unavailable image support retain the binary MIME fallback. Unrelated programming errors propagate. |
| Repository refresh | Network, decoding and descriptor-validation errors retain the previous manifest and expose a repository error. Malformed manifest shapes are validated explicitly. |
| Instagram/Consensus process checkpoints | Expected process/I/O/JSON failures can retain partial results. Cancellation and unrelated programming errors are not treated as checkpoints. |
| Public-page enrichment | Known transport or page-validation failures can request a browser pass. Unexpected errors do not trigger another expensive request. |
| Browser screenshot during shutdown | WebDriver errors may omit the optional image; driver cleanup continues. Other exceptions are not silently swallowed. |
| Address providers | Known transport and malformed-record errors produce a per-provider warning. |

## Retained broad boundaries

Some interfaces deliberately accept arbitrary third-party code or coordinate
long-lived work. Catching Exception there remains necessary to contain a
failed operation; it is not a substitute for validation in lower-level helpers.

| Boundary | Observable outcome / reason |
| --- | --- |
| `core/actors.py`, request dispatch and job execution | Persisted failed runs/error nodes or classified HTTP/job failures. |
| HTTP thread launch | Releases its admission slot and re-raises; no fallback success. |
| Queue infrastructure/recovery and VPN cleanup | Error logs and interrupted/failed job state; the queue can continue. |
| Plugin connection invocation | Arbitrary plugin exceptions become credential-scrubbed diagnostics. |
| File garbage collection | Bounded recurring task logs failure and can retry later. |
| Logging handler | Delegates to logging's `handleError`; recursive logging is avoided. |
| VPN controller request/tick and worker broker | Error response/unhealthy state. Tick failures now emit a structured event containing only the exception type. |
| Provider aggregation and third-party collectors | Per-source warnings/errors and partial results; cancellation is handled separately. This includes Holehe, Ignorant, User Scanner, profile extraction, Instagram sections and Toutatis. |
| DeepFace inference/overlay and database comparison adapters | Unknown upstream exceptions produce explicit failed-comparison counts or overlay warnings; they must not become a claimed match. |
| Instagram alternate endpoint | If it also fails, the original library failure is preserved for the next fallback or raised to the collector's error boundary. |
| Supervisor VPN readiness polling | Bounded retry during startup, followed by a startup failure if readiness is not reached. |

Do not catch BaseException for these operations. Diagnostics must omit secrets;
log stable event/category and exception type when raw errors might contain
credentials. Keep behavior tests for cancellation, retained partial results and
unexpected failures. This policy does not claim every upstream parser or future
plugin is free of defects.
