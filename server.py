"""ARGUS entry point. Importing this module has no service-start side effects."""

import logging
import os
from core.application import create_app
from core.http_server import ApplicationServer, Handler


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
