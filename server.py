"""ARGUS entry point. Importing this module has no service-start side effects."""

import logging
import os
from core import application as _application
from core.application import create_app, get_default_application
from core.http_server import ApplicationServer, Handler

# Retain the former public server name with bounded admission and application ownership.
ThreadingHTTPServer = ApplicationServer


def __getattr__(name):
    # Compatibility for plugins/tests using the former service facade.
    if name.startswith("__"):
        raise AttributeError(name)
    app = get_default_application()
    if hasattr(app, name):
        return getattr(app, name)
    return getattr(_application, name)


def main():
    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", "8080"))
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    with (
        create_app() as app,
        ApplicationServer((host, port), Handler, app=app) as server,
    ):
        print(f"Argus listening on {host}:{port}", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
