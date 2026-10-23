"""Explicit provider-scoped enrichment; never rediscover unrelated accounts."""

import copy
import json
from pathlib import Path
import re
import sys
from plugins import _extra_sources as extra, holehe, maigret
from plugins._process import bounded_run
from plugins._profile import provider_key, profile_url, recipes
from plugins._research import deduplicate, fact_outputs
from core.provider_registry import label as provider_label, services
from core.build_info import user_agent
from core.errors import AppError

PLUGIN = {
    "id": "deep_research",
    "name": "Generic Deep Research",
    "category": "Recherche",
    "icon": "argus",
    "description": "Zusatzangaben gezielt zu einem Profil abrufen und als einzelne Daten-Nodes gruppieren.",
    "actions": [
        {
            "id": "lookup",
            "name": "Generic Deep Research",
            "inputs": ["profile"],
            "generic_profile": True,
            "external": True,
            "external_notice": "Die Profilkennung wird nur für den ausgewählten Anbieter an die aktivierten Quellen übergeben.",
            "default_params": {
                "use_argus": True,
                "argus_browser_enabled": True,
                "argus_browser_timeout": 60,
                "use_maigret": True,
                "use_user_scanner": True,
                "use_blackbird": True,
                "use_holehe": True,
                "use_ignorant": True,
                "source_order": [
                    "argus",
                    "user_scanner",
                    "maigret",
                    "blackbird",
                    "holehe",
                    "ignorant",
                ],
                "identifier_kind": "auto",
                "request_timeout": 12,
                "run_timeout": 300,
                "max_results": 500,
            },
        }
    ],
}
TOOLS = {
    "argus": "Argus Web",
    "user_scanner": "User Scanner",
    "maigret": "Maigret",
    "blackbird": "Blackbird",
    "holehe": "Holehe",
    "ignorant": "Ignorant",
}


def as_image(item):
    """Media URLs are image nodes; don't fetch or load them until requested by the user."""
    name = str(item.get("fact_key") or item.get("label", "")).casefold()
    if item.get("type") == "url" and re.search(
        "avatar|picture|photo|image|pfp|portrait|profilbild|vorschaubild", name
    ):
        url = item["data"]["value"]
        item = {
            **item,
            "type": "image",
            "data": {"filename": item.get("label", "Bild"), "file_id": "", "url": url},
        }
    return item


class _Completed(Exception):

    def __init__(self, value):
        self.value = value


class ProfileEnrichment:

    def __init__(self, action, inputs, params, context):
        self.action = action
        self.inputs = inputs
        self.params = params
        self.context = context

    def execute(self):
        try:
            self.prepare()
            self.collect()
            self.finish()
        except _Completed as finished:
            return finished.value

    def prepare(self):
        if (
            self.action != "lookup"
            or len(self.inputs) != 1
            or self.inputs[0]["type"] != "profile"
        ):
            raise ValueError("Genau ein Profil anschließen.")
        self.profile = self.inputs[0]
        self.data = self.profile["data"]
        self.provider = provider_label(self.data.get("provider", "")).strip()
        self.identifier = str(self.data.get("identifier", "")).strip()
        self.url = profile_url(self.data.get("url", ""))
        if not self.provider or not (self.identifier or self.url):
            raise ValueError(
                "Profil benötigt einen Anbieter und mindestens eine gültige Profil-URL oder einen Identifier."
            )
        self.timeout = int(self.params.get("run_timeout", 300))
        self.request = int(self.params.get("request_timeout", 12))
        self.limit = int(self.params.get("max_results", 500))
        if (
            not 10 <= self.timeout <= 300
            or not 2 <= self.request <= 30
            or (not 1 <= self.limit <= 1000)
        ):
            raise ValueError("Ungültige Recherchelimits.")
        self.order = self.params.get("source_order", list(TOOLS))
        if (
            not isinstance(self.order, list)
            or any((name not in TOOLS for name in self.order))
            or len(set(self.order)) != len(self.order)
        ):
            raise ValueError("Ungültige Quellenreihenfolge.")
        if any(
            (
                not isinstance(self.params.get("use_" + name, True), bool)
                for name in TOOLS
            )
        ):
            raise ValueError("Quellen müssen ein- oder ausgeschaltet sein.")
        self.enabled = [
            name
            for name in self.order + [n for n in TOOLS if n not in self.order]
            if self.params.get("use_" + name, True)
        ]
        if not self.enabled:
            raise _Completed(
                empty_result(
                    self.profile,
                    "Keine Quelle aktiviert",
                    "Mindestens eine Deep-Research-Quelle in den Plugin-Einstellungen aktivieren.",
                    True,
                )
            )
        self.saved = recipes(self.profile)
        self.outputs = []
        self.warnings = []
        self.logs = []
        self.attempts = 0
        self.success = 0
        self.fallback_kind = str(self.params.get("identifier_kind", "auto"))
        if self.fallback_kind not in ("auto", "username", "email", "phone", "id"):
            raise ValueError("Identifier-Typ: auto, username, email, phone oder id.")
        if self.fallback_kind == "auto":
            self.fallback_kind = (
                self.saved[0]["kind"]
                if self.saved
                else (
                    "email"
                    if "@" in self.identifier and (not self.identifier.startswith("@"))
                    else "id" if self.identifier.isdecimal() else "username"
                )
            )
        if not self.identifier:
            self.fallback_kind = "id"

    def collect(self):
        for self.tool in self.enabled:
            self.recipe = next(
                (r for r in self.saved if r.get("tool") == TOOLS[self.tool]), None
            )
            self.kind = self.recipe["kind"] if self.recipe else self.fallback_kind
            self.value = self.recipe["value"] if self.recipe else self.identifier
            self.targets = services(self.data.get("provider", ""), self.tool, self.kind)
            self.service = (
                self.recipe["service"]
                if self.recipe
                else self.targets[0] if self.targets else ""
            )
            if self.tool not in ("argus", "maigret") and (not self.service):
                continue
            self.node = {
                "id": self.profile["id"],
                "type": self.kind,
                "data": {"value": self.value},
            }
            self.p = {
                **self.params,
                "identity_only": False,
                "deep": True,
                "run_timeout": self.timeout,
                "request_timeout": self.request,
                "max_results": min(self.limit, 300),
                "service": self.service,
                "sites": [self.service],
            }
            try:
                self.result = self.query_source()
                if self.result is None:
                    continue
                self.success += 1
                self.warnings.extend(
                    (
                        TOOLS[self.tool] + ": " + str(w)
                        for w in self.result.get("warnings", [])
                    )
                )
                self.logs.append(
                    TOOLS[self.tool] + "\n" + str(self.result.get("log", ""))
                )
                for self.original in self.result.get("outputs", []):
                    if self.original.get("relation") in (
                        "Suchprotokoll",
                        "Anbieter",
                        "Registrierungsbefund",
                        "Benutzername gefunden",
                        "Profil gefunden",
                    ):
                        continue
                    self.item = copy.deepcopy(self.original)
                    self.source = self.item.get("source", {})
                    if self.source.get("service") and provider_key(
                        self.source["service"]
                    ) != provider_key(self.provider):
                        continue
                    self.item = as_image(self.item)
                    self.item["source_input"] = self.profile["id"]
                    self.item["group"] = self.provider
                    self.item["group_id"] = "deep:" + self.profile["id"]
                    self.item["source"] = {
                        **self.source,
                        "service": self.provider,
                        "profile": copy.deepcopy(self.data),
                    }
                    self.outputs.append(self.item)
            except Exception as _caught_1:
                # Provider boundary: retain partial results, but never consume cancellation.
                if (
                    isinstance(_caught_1, AppError)
                    and _caught_1.code == "actor_cancelled"
                ):
                    raise
                self.exc = _caught_1
                self.warnings.append(TOOLS[self.tool] + ": " + str(self.exc))
                self.logs.append(TOOLS[self.tool] + ": " + str(self.exc))

    def query_source(self):
        if self.tool == "argus":
            if not self.url:
                return None
            self.attempts += 1
            self.browser_timeout = int(self.params.get("argus_browser_timeout", 60))
            if not 10 <= self.browser_timeout <= 120:
                raise ValueError("Browser-Zeitlimit: 10–120 Sekunden.")
            self.stdout, self.stderr = bounded_run(
                [
                    sys.executable,
                    "-I",
                    str(Path(__file__).with_name("_argus_web_runner.py")),
                ],
                self.timeout,
                {
                    "url": self.url,
                    "request_timeout": self.request,
                    "browser_enabled": self.params.get("argus_browser_enabled", True),
                    "browser_timeout": self.browser_timeout,
                },
            )
            self.payload = json.loads(self.stdout)
            self.common = {
                "source_input": self.profile["id"],
                "source": {
                    "tool": "Argus Web",
                    "service": self.provider,
                    "url": self.url,
                },
            }
            self.result = {
                "outputs": [
                    o
                    for key, value in self.payload.get("facts", {}).items()
                    for o in fact_outputs(value, str(key), self.common)
                ],
                "warnings": self.payload.get("warnings", []),
                "log": self.stdout,
            }
        elif self.tool == "maigret":
            if self.url:
                self.attempts += 1
                self.stdout, self.stderr = bounded_run(
                    [
                        sys.executable,
                        "-I",
                        str(Path(__file__).with_name("_profile_extract_runner.py")),
                    ],
                    self.timeout,
                    {
                        "url": self.url,
                        "request_timeout": self.request,
                        "user_agent": user_agent("public profile research"),
                    },
                )
                self.facts = json.loads(self.stdout)
                self.common = {
                    "source_input": self.profile["id"],
                    "source": {
                        "tool": "Maigret / socid_extractor",
                        "service": self.provider,
                        "url": self.url,
                    },
                }
                self.result = {
                    "outputs": [
                        o
                        for key, value in self.facts.items()
                        if key != "_extractor"
                        for o in fact_outputs(value, str(key), self.common)
                    ],
                    "log": self.stdout,
                }
            elif self.kind == "username" and self.value:
                import maigret as package

                self.package = package
                from maigret.sites import MaigretDatabase

                self.MaigretDatabase = MaigretDatabase
                self.database = self.MaigretDatabase().load_from_path(
                    str(Path(self.package.__file__).parent / "resources" / "data.json")
                )
                self.matches = [
                    site.name
                    for site in self.database.sites
                    if site.name == self.service
                ]
                if not self.matches and self.targets:
                    self.matches = [
                        site.name
                        for site in self.database.sites
                        if site.name == self.targets[0]
                    ]
                if len(self.matches) != 1:
                    self.warnings.append(
                        "Maigret: Anbieter nicht eindeutig unterstützt."
                    )
                    return None
                self.attempts += 1
                self.result = maigret.run(
                    "search",
                    [self.node],
                    {**self.p, "sites": self.matches},
                    self.context,
                )
            else:
                return None
        elif (
            self.tool in ("user_scanner", "blackbird")
            and self.kind in ("username", "email")
            and self.value
        ):
            self.attempts += 1
            self.result = getattr(extra, self.tool)(
                self.kind, [self.node], self.p, self.context
            )
        elif self.tool == "holehe" and self.kind == "email" and self.value:
            self.attempts += 1
            self.result = holehe.run("lookup", [self.node], self.p, self.context)
        elif self.tool == "ignorant" and self.kind == "phone" and self.value:
            self.attempts += 1
            self.result = extra.ignorant([self.node], self.p, self.context)
        else:
            return None
        return self.result

    def finish(self):
        if not self.attempts:
            raise _Completed(
                empty_result(
                    self.profile,
                    "Keine passende Quelle",
                    "Keine aktivierte Quelle unterstützt diese Profilkennung. Identifier-Typ prüfen oder eine öffentliche Profil-URL ergänzen.",
                    True,
                )
            )
        if not self.success:
            raise _Completed(
                empty_result(
                    self.profile,
                    "Profil konnte nicht ausgelesen werden",
                    "; ".join(self.warnings) or "Alle Quellen sind fehlgeschlagen.",
                    True,
                    self.logs,
                )
            )
        self.outputs = deduplicate(self.outputs)
        for self.item in self.outputs:
            self.item["group"] = self.provider
            self.item["group_id"] = "deep:" + self.profile["id"]
        if len(self.outputs) > self.limit:
            self.warnings.append(
                "Trefferlimit erreicht; vollständiger Abruf in den Logs."
            )
        if not self.outputs:
            raise _Completed(
                empty_result(
                    self.profile,
                    "Keine zusätzlichen Daten gefunden",
                    "Die ausgewählten Quellen lieferten keine Zusatzangaben. Das bedeutet nicht, dass das Profil nicht existiert."
                    + (
                        " Hinweise: " + "; ".join(self.warnings)
                        if self.warnings
                        else ""
                    ),
                    False,
                    self.logs,
                )
            )
        raise _Completed(
            {
                "outputs": self.outputs[: self.limit],
                "group_outputs": True,
                "warnings": self.warnings,
                "log": "\n\n".join(self.logs),
            }
        )


def run(action, inputs, params, context):
    return ProfileEnrichment(action, inputs, params, context).execute()


def empty_result(profile, title, message, failed=False, logs=None):
    return {
        "outputs": [
            {
                "type": "error",
                "label": title,
                "data": {"title": title, "message": message},
                "relation": "Recherchehinweis",
                "source_input": profile["id"],
                "source": {"tool": "Argus", "profile": copy.deepcopy(profile["data"])},
            }
        ],
        "group_outputs": False,
        "failed": failed,
        "error": message if failed else None,
        "warnings": [message],
        "log": "\n\n".join(logs or [message]),
    }
