"""Actual Chromium against a temporary local Argus app; no outside research or user DB."""

import json
import os
import sys
import tempfile
import time
import urllib.request
import subprocess
import socket
import signal
from pathlib import Path
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.common.action_chains import ActionChains
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.chrome.service import Service
import shutil
from selenium.common.exceptions import StaleElementReferenceException

ROOT = Path(__file__).resolve().parents[1]
temp = tempfile.TemporaryDirectory()
sock = socket.socket()
sock.bind(("127.0.0.1", 0))
port = sock.getsockname()[1]
sock.close()
base = "http://127.0.0.1:" + str(port)
logfile = tempfile.TemporaryFile()
process = subprocess.Popen(
    [
        os.environ.get(
            "ARGUS_APPLICATION_PYTHON",
            (
                "/usr/local/bin/python"
                if Path("/usr/local/bin/python").exists()
                else sys.executable
            ),
        ),
        str(ROOT / "server.py"),
    ],
    env={**os.environ, "DATA_DIR": temp.name, "HOST": "127.0.0.1", "PORT": str(port)},
    stdout=logfile,
    stderr=logfile,
    start_new_session=True,
)
for attempt in range(100):
    try:
        with urllib.request.urlopen(base + "/api/health", timeout=0.3) as response:
            if response.status == 200:
                break
    except Exception:
        time.sleep(0.1)
else:
    process.terminate()
    process.wait()
    logfile.seek(0)
    raise RuntimeError(
        "Temporary Argus server did not start: "
        + logfile.read().decode(errors="replace")[-8000:]
    )


def api(path, body=None):
    request = urllib.request.Request(
        base + path,
        data=json.dumps(body).encode() if body is not None else None,
        headers={
            "Content-Type": "application/json",
            "Authorization": "Bearer "
            + (Path(temp.name) / ".access-key").read_text().strip(),
        },
    )
    with urllib.request.urlopen(request, timeout=10) as response:
        return json.load(response)


def person(id, **data):
    return {
        "id": id,
        "type": "person",
        "label": id,
        "data": data,
        "x": 20,
        "y": 50 if id == "a" else 250,
    }


doc = {
    "nodes": [
        person("a", first_name="Ada"),
        person("b", first_name="Grace", last_name="Lovelace"),
        {
            "id": "u",
            "type": "url",
            "label": "Fixture URL",
            "data": {"value": "https://example.invalid/profile"},
            "x": 20,
            "y": 440,
        },
        {
            "id": "m",
            "type": "actor",
            "label": "Merge",
            "data": {"plugin": "merge", "action": "merge", "params": {}},
            "x": 440,
            "y": 150,
        },
    ],
    "edges": [
        {"id": "e1", "source": "a", "target": "m", "label": "Eingabe"},
        {"id": "e2", "source": "b", "target": "m", "label": "Eingabe"},
    ],
    "groups": [],
    "runs": [],
}
project = api(
    "/api/projects", {"title": "Current UI regression fixture", "document": doc}
)
pid = project["id"]
checks = []
options = webdriver.ChromeOptions()
options.binary_location = os.environ.get(
    "ARGUS_BROWSER_EXECUTABLE", "/usr/bin/chromium"
)
for arg in (
    "--headless=new",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--window-size=1500,1050",
    "--no-proxy-server",
):
    options.add_argument(arg)
options.set_capability("goog:loggingPrefs", {"browser": "ALL"})
driver_path = shutil.which("chromedriver")
driver = webdriver.Chrome(
    service=Service(driver_path) if driver_path else Service(), options=options
)
driver.set_page_load_timeout(25)
wait = WebDriverWait(driver, 18, ignored_exceptions=(StaleElementReferenceException,))


def css(selector):
    return wait.until(lambda d: d.find_element(By.CSS_SELECTOR, selector))


def click(selector):
    if selector == "#settingsTab" and (not css("#workspace").get_attribute("hidden")):
        click("#back")

    def attempt(driver):
        try:
            target = driver.find_element(By.CSS_SELECTOR, selector)
            for menu in target.find_elements(By.XPATH, "./ancestor::details"):
                if not menu.get_attribute("open"):
                    menu.find_element(By.CSS_SELECTOR, "summary").click()
            if not target.is_displayed() or not target.is_enabled():
                return False
            target.click()
            return True
        except StaleElementReferenceException:
            return False

    wait.until(attempt)
    if selector == "#settingsTab":
        wait.until(lambda d: d.find_element(By.ID, "settingsView").is_displayed())


def text_button(label, context=None):
    root = context or driver
    selector = (
        ".//button[normalize-space()=" + json.dumps(label, ensure_ascii=False) + "]"
    )
    return wait.until(
        lambda _: next(
            (
                button
                for button in root.find_elements(By.XPATH, selector)
                if button.is_displayed() and button.is_enabled()
            ),
            False,
        )
    )


def choose(label):
    wait.until(
        lambda d: any(
            (
                b.text == label
                for b in d.find_elements(
                    By.CSS_SELECTOR, ".react-select-popup [role=option]"
                )
            )
        )
    )
    next(
        (
            b
            for b in driver.find_elements(
                By.CSS_SELECTOR, ".react-select-popup [role=option]"
            )
            if b.text == label
        )
    ).click()


def select_node(id):
    click("#fit")
    element = css('.node[data-id="' + id + '"] > rect:first-child')
    box = element.rect
    ActionChains(driver).move_to_element_with_offset(
        element, -box["width"] / 2 + 40, -box["height"] / 2 + 20
    ).click().perform()


def select_group(id):
    rect = css('[data-group="' + id + '"] > rect:first-child')
    box = rect.rect
    ActionChains(driver).move_to_element_with_offset(
        rect, -box["width"] / 2 + 90, -box["height"] / 2 + 18
    ).click().perform()


try:
    driver.get(base)
    wait.until(
        lambda d: d.find_elements(By.CSS_SELECTOR, '[data-project="' + pid + '"]')
    )
    if os.environ.get("ARGUS_BROWSER_SCENARIO") != "instagram":
        click("#settingsTab")
        text_button("Tag hinzufügen").click()
        field = css("dialog[open] input[type=text]")
        field.send_keys("NSFW")
        click("dialog[open] button[type=submit]")
        wait.until(lambda d: len(api("/api/settings")["settings"]["tags"]) == 1)
        checks.append("global tag create/autosave")
        click("#settingsView .react-field [role=combobox]")
        search = css(".react-select-popup input")
        assert driver.switch_to.active_element == search
        search.send_keys("English")
        choose("English")
        wait.until(
            lambda d: api("/api/settings")["settings"]["language"] == "en"
            and d.find_element(By.TAG_NAME, "html").get_attribute("lang") == "en"
        )
        click("#settingsView .react-field [role=combobox]")
        css(".react-select-popup input").send_keys("Deutsch")
        choose("Deutsch")
        wait.until(
            lambda d: api("/api/settings")["settings"]["language"] == "de"
            and d.find_element(By.TAG_NAME, "html").get_attribute("lang") == "de"
        )
        checks.append("searchable language dropdown and immediate typing")
        click("#brandHome")
        click('[data-project="' + pid + '"] .primary')
        select_node("a")
        wait.until(
            lambda d: d.find_elements(
                By.CSS_SELECTOR, ".verification-section [role=combobox]"
            )
        )
        click(".verification-section [role=combobox]")
        css(".react-select-popup input").send_keys("verifiziert")
        choose("Verifiziert")
        click(".node-tags-section [role=combobox]")
        choose("NSFW")
        wait.until(
            lambda d: any(
                (
                    n.get("verification") == "verified" and n.get("tags")
                    for n in api("/api/projects/" + pid)["document"]["nodes"]
                    if n["id"] == "a"
                )
            )
        )
        assert "NSFW" in css('.node[data-id="a"] .node-badges').text
        checks.append("node verification, visible tags and autosave")
        css('[data-edge-hit="e1"]').send_keys(Keys.ENTER)
        path = css('[data-edge-path="e1"][data-has-arrow="true"]')
        assert "arrowSelected" in path.value_of_css_property("marker-end")
        edge_color = path.value_of_css_property("stroke")
        assert edge_color not in ("none", "transparent", "rgba(0, 0, 0, 0)")
        css('[data-edge-hit="e1"]').send_keys(Keys.ENTER)
        assert css("#inspector .danger-filled svg")
        checks.append("consistent edge and arrowhead highlighting with delete icon")
        select_node("m")
        text_button("Tool ausführen", css("#inspector")).click()
        wait.until(
            lambda d: d.find_elements(By.CSS_SELECTOR, ".manual-dialog [role=combobox]")
        )
        click(".manual-dialog [role=combobox]")
        css(".react-select-popup input").send_keys("Grace")
        choose("b: Grace")
        text_button("Fortsetzen", css(".manual-dialog")).click()
        wait.until(lambda d: len(api("/api/projects/" + pid)["document"]["nodes"]) == 5)
        merged = next(
            (
                n
                for n in api("/api/projects/" + pid)["document"]["nodes"]
                if n["type"] == "person" and n["id"] not in ("a", "b")
            )
        )
        assert (
            merged["data"]["first_name"] == "Grace"
            and merged["data"]["last_name"] == "Lovelace"
        )
        assert merged["verification"] == "unverified" and merged["tags"]
        checks.append(
            "merge conflict modal, complete new node and original nodes retained"
        )
        select_node("u")
        action = css("#inspector .node-display-section > .primary")
        width = action.rect["width"]
        inner = driver.execute_script(
            'const e=document.getElementById("inspector"),s=getComputedStyle(e);return e.clientWidth-parseFloat(s.paddingLeft)-parseFloat(s.paddingRight)'
        )
        assert abs(width - inner) < 3
        for id in ("leftResize", "rightResize"):
            handle = css("#" + id)
            assert handle.value_of_css_property("border-left-width") == "0px"
            assert handle.value_of_css_property("border-right-width") == "0px"
            assert handle.value_of_css_property("cursor") == "ew-resize"
        checks.append("single sidebar borders and full-width detail Quick Actions")
        click("#actorSortToggle")
        assert "Kategorie" in css("#actorSort").text
        click("#actorSort")
        choose("A–Z")
        assert not driver.find_elements(
            By.CSS_SELECTOR, "#actorPalette .palette-category-divider"
        )
        checks.append("category default and dividers only for category sorting")
        click("#settingsTab")

        def rename_tag(driver):
            try:
                name = driver.find_element(
                    By.CSS_SELECTOR, ".tag-manager-row input:not([type=color])"
                )
                name.clear()
                name.send_keys("Sensitive")
                return name.get_attribute("value") == "Sensitive"
            except StaleElementReferenceException:
                return False

        wait.until(rename_tag)
        click(".tag-manager-row .color-swatch")
        click('.picker-popover button[aria-label="#b38aff"]')
        driver.switch_to.active_element.send_keys(Keys.ESCAPE)
        wait.until(
            lambda d: api("/api/settings")["settings"]["tags"][0]["name"] == "Sensitive"
            and api("/api/settings")["settings"]["tags"][0]["color"] == "#b38aff"
        )
        click("#brandHome")
        click('[data-project="' + pid + '"] .primary')
        wait.until(
            lambda d: "Sensitive"
            in d.find_element(By.CSS_SELECTOR, '.node[data-id="a"] .node-badges').text
        )
        click("#settingsTab")
        click(".tag-manager-row .danger-filled")
        wait.until(lambda d: not api("/api/settings")["settings"]["tags"])
        click("#brandHome")
        click('[data-project="' + pid + '"] .primary')
        wait.until(
            lambda d: "Sensitive"
            not in d.find_element(
                By.CSS_SELECTOR, '.node[data-id="a"] .node-badges'
            ).text
        )
        checks.append("global tag rename, color and removal across project reopening")
        current = api("/api/projects/" + pid)
        current["document"]["groups"] = [
            {
                "id": "fixture-group",
                "label": "Fixture group",
                "members": ["u"],
                "collapsed": False,
            }
        ]
        api(
            "/api/projects/" + pid,
            {
                "title": current["title"],
                "document": current["document"],
                "revision": current["revision"],
            },
        )
        driver.refresh()
        click('[data-project="' + pid + '"] .primary')
        select_group("fixture-group")
        assert driver.find_element(By.ID, "ungroupNodes").is_enabled()
        click("#ungroupNodes")
        wait.until(lambda d: not api("/api/projects/" + pid)["document"]["groups"])
        assert any(
            (n["id"] == "u" for n in api("/api/projects/" + pid)["document"]["nodes"])
        )
        assert css("#groupNodes").find_element(By.XPATH, "..") != css(
            "#deleteSelected"
        ).find_element(By.XPATH, "..")
        current = api("/api/projects/" + pid)
        current["document"]["groups"] = [
            {
                "id": "fixture-group",
                "label": "Fixture group",
                "members": ["u"],
                "collapsed": False,
            }
        ]
        api(
            "/api/projects/" + pid,
            {
                "title": current["title"],
                "document": current["document"],
                "revision": current["revision"],
            },
        )
        driver.refresh()
        click('[data-project="' + pid + '"] .primary')
        select_node("u")
        click("#detachNodes")
        wait.until(lambda d: not api("/api/projects/" + pid)["document"]["groups"])
        assert any(
            (n["id"] == "u" for n in api("/api/projects/" + pid)["document"]["nodes"])
        )
        checks.append(
            "toolbar ungroup/detach preserve contents and separate deletion section"
        )
    current = api("/api/projects/" + pid)
    current["document"]["nodes"] += [
        {
            "id": "ig-profile",
            "type": "profile",
            "label": "Instagram fixture",
            "data": {
                "provider": "instagram",
                "identifier": "fixture",
                "url": "https://www.instagram.com/fixture/",
            },
            "x": 700,
            "y": 50,
        },
        {
            "id": "ig-actor",
            "type": "actor",
            "label": "Instagram Deep Research",
            "data": {"plugin": "instagram", "action": "lookup", "params": {}},
            "x": 1050,
            "y": 50,
        },
    ]
    current["document"]["edges"].append(
        {
            "id": "ig-edge",
            "source": "ig-profile",
            "target": "ig-actor",
            "label": "Eingabe",
        }
    )
    api(
        "/api/projects/" + pid,
        {
            "title": current["title"],
            "document": current["document"],
            "revision": current["revision"],
        },
    )
    driver.refresh()
    click('[data-project="' + pid + '"] .primary')
    click("#fit")
    select_node("ig-actor")
    click("#inspector .tool-run-section>.primary")
    wait.until(lambda d: d.find_elements(By.CSS_SELECTOR, "dialog[open].manual-dialog"))
    css("dialog[open] input[type=checkbox]").click()
    text_button("Plugin-Einstellungen", css("dialog[open]")).click()
    wait.until(
        lambda d: not d.find_element(By.ID, "pluginsView").get_attribute("hidden")
    )
    wait.until(
        lambda d: api("/api/projects/" + pid)["document"]
        .get("preferences", {})
        .get("instagram_anonymous_notice_dismissed")
    )
    assert not any(
        (
            r["plugin"] == "instagram"
            for r in api("/api/projects/" + pid)["document"]["runs"]
        )
    )
    user = css('[data-plugin-row="instagram"] input[data-field="login_username"]')
    password = css('[data-plugin-row="instagram"] input[data-field="login_password"]')
    user.send_keys("fixture-user")
    password.send_keys("fixture-password")
    wait.until(
        lambda d: next(
            (p for p in api("/api/plugins")["plugins"] if p["id"] == "instagram")
        )["actions"][0]["default_params"]["login_password"]
        == "••••••••"
    )
    public = json.dumps(api("/api/plugins"))
    assert "fixture-password" not in public
    user.send_keys(Keys.CONTROL, "a")
    user.send_keys(Keys.BACKSPACE)
    password.send_keys(Keys.CONTROL, "a")
    password.send_keys(Keys.BACKSPACE)
    wait.until(
        lambda d: next(
            (p for p in api("/api/plugins")["plugins"] if p["id"] == "instagram")
        )["actions"][0]["default_params"]["login_password"]
        == ""
    )
    checks.append(
        "anonymous notice/settings/project preference and password masking without live login"
    )
    browser_logs = driver.get_log("browser")
    assert not [
        entry
        for entry in browser_logs
        if entry["level"] == "SEVERE"
        and (
            not ("/api/auth/session" in entry["message"] and "401" in entry["message"])
        )
    ], "Browser console errors: " + json.dumps(browser_logs)
    print(json.dumps({"status": "ok", "checks": checks, "external_requests": False}))
except Exception:
    print(
        json.dumps(
            {
                "completed_checks": checks,
                "visible_ui": driver.find_element(By.TAG_NAME, "body").text[-6000:],
                "browser_errors": driver.get_log("browser"),
                "jobs": api("/api/jobs"),
                "runs": api("/api/projects/" + pid)["document"]["runs"],
            },
            ensure_ascii=False,
        ),
        file=sys.stderr,
    )
    raise
finally:
    driver.quit()
    if hasattr(os, "killpg"):
        os.killpg(process.pid, signal.SIGTERM)
    else:
        process.terminate()
    process.wait(timeout=5)
    logfile.close()
    temp.cleanup()
