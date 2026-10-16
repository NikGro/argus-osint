"""One browser per CLI invocation. No externally listening port or separate service."""

import contextlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile

ROOT = Path("/opt/argus-tools/flaresolverr")


def run(payload, self_test=False):
    if os.getenv("ARGUS_ISOLATED_WORKER") != "1":
        sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
        from core.isolation import invoke

        return invoke(
            "browser_self_test" if self_test else "browser",
            payload,
            timeout=int(payload.get("timeout", 60)) + 25,
        )
    if not self_test:
        spec = importlib.util.spec_from_file_location(
            "argus_public_page", Path(__file__).with_name("_argus_web_runner.py")
        )
        page = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(page)
        from urllib.parse import urlsplit

        if urlsplit(payload["url"]).scheme not in ("http", "https"):
            raise ValueError("Public HTTP(S) page required")
    sys.path.insert(0, str(ROOT / "src"))
    import utils
    import flaresolverr_service as service
    from dtos import V1RequestBase

    # Upstream's startup normally caches User-Agent. Its borrowed-driver path otherwise quits that driver.
    original_agent = utils.get_user_agent

    def user_agent(driver=None):
        if driver is None:
            return original_agent()
        if utils.USER_AGENT is None:
            utils.USER_AGENT = driver.execute_script("return navigator.userAgent")
        return utils.USER_AGENT

    utils.get_user_agent = user_agent
    original_chrome = utils.uc.Chrome
    screenshots = []

    class ArgusChrome(original_chrome):
        def __init__(self, *args, **kwargs):
            kwargs["use_subprocess"] = True
            options = kwargs.get("options")
            if options:
                options.add_argument(
                    "--proxy-server=" + os.environ["ARGUS_WORKER_PROXY"]
                )
                options.add_argument("--proxy-bypass-list=<-loopback>")
                options.add_argument("--disable-quic")
                options.add_argument(
                    "--force-webrtc-ip-handling-policy=disable_non_proxied_udp"
                )
                options.add_argument("--disable-background-networking")
            # Upstream Chromium flags remain inside a separate network/PID/mount namespace.
            # The proxy is the only egress; /data and the app's process table are absent.
            super().__init__(*args, **kwargs)

        def quit(self, *args, **kwargs):
            if payload.get("screenshot"):
                try:
                    self.set_window_size(720, 480)
                    screenshots.append(self.get_screenshot_as_base64())
                except Exception:
                    pass
            return super().quit(*args, **kwargs)

    utils.uc.Chrome = ArgusChrome
    os.environ["HEADLESS"] = "true"
    os.environ["BROWSER_WAIT_TIMEOUT"] = "2"
    os.environ["LANG"] = "en_US"
    with tempfile.TemporaryDirectory(prefix="argus-browser-") as folder:
        driver = Path(folder) / "chromedriver"
        shutil.copyfile("/usr/bin/chromedriver", driver)
        driver.chmod(0o700)
        utils.PATCHED_DRIVER_PATH = str(driver)
        utils.CHROME_EXE_PATH = "/usr/bin/chromium"
        try:
            req = V1RequestBase(
                {
                    "cmd": "request.get",
                    "url": payload["url"],
                    "maxTimeout": int(payload.get("timeout", 60)) * 1000,
                    "disableMedia": True,
                }
            )
            result = utils.object_to_dict(service.controller_v1_endpoint(req))
            if result.get("status") != "ok":
                raise ValueError(result.get("message", "Browserabruf fehlgeschlagen."))
            solution = result.get("solution", {})
            html = solution.get("response", "")
            if len(html.encode()) > 4 * 1024 * 1024:
                raise ValueError("Browserseite größer als 4 MiB.")
            return {
                **({"image_base64": screenshots[-1]} if screenshots else {}),
                "html": html,
                "url": solution.get("url") or payload["url"],
                "status": solution.get("status", 200),
            }
        finally:
            if utils.XVFB_DISPLAY is not None:
                utils.XVFB_DISPLAY.stop()
                utils.XVFB_DISPLAY = None


if __name__ == "__main__":
    self_test = "--self-test" in sys.argv
    payload = (
        {
            "url": 'data:text/html,<html><head><title>Argus local fixture</title></head><body><div id="result"></div><script>document.getElementById("result").textContent="ARGUS_BROWSER_OK"</script></body></html>',
            "timeout": 30,
        }
        if self_test
        else json.load(sys.stdin)
    )
    with contextlib.redirect_stdout(sys.stderr):
        result = run(payload, self_test)
    if self_test:
        if (
            not result.get("javascript")
            and "ARGUS_BROWSER_OK</div>" not in result["html"]
        ):
            raise ValueError("Browser did not execute local fixture JavaScript.")
        result = {"status": "ok", "javascript": True, "external_requests": False}
    json.dump(result, sys.stdout, ensure_ascii=False)
