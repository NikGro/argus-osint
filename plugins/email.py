from plugins import holehe
from plugins import _extra_sources as extra
from plugins._research import aggregate
from plugins import _consensus

PLUGIN = {
    "id": "email",
    "name": "E-Mail",
    "category": "Recherche",
    "description": "Profile finden; zusätzliche Angaben erst über Generic Deep Research abrufen.",
    "actions": [
        {
            "id": "lookup",
            "name": "E-Mail recherchieren",
            "inputs": ["email"],
            "external": True,
            "external_notice": "Die Eingabe wird an die aktivierten Recherchequellen gesendet.",
            "settings_only": ["consensus_sites", "holehe_sites"],
            "default_params": {
                "search_profiles": {},
                "use_consensus": True,
                "consensus_sites": [],
                "use_holehe": False,
                "use_user_scanner": False,
                "use_blackbird": False,
                "holehe_sites": [],
                "source_order": ["consensus", "holehe", "user_scanner", "blackbird"],
                "request_timeout": 12,
                "run_timeout": 300,
                "max_results": 500,
            },
        }
    ],
}


def run(action, inputs, params, context):
    if action != "lookup":
        raise ValueError("Unbekannte Aktion.")
    return aggregate(
        "email",
        {
            "consensus": lambda i, p, c: _consensus.run("email", i, p, c),
            "holehe": lambda i, p, c: holehe.run(
                "lookup", i, {**p, "sites": p.get("holehe_sites", [])}, c
            ),
            "user_scanner": lambda i, p, c: extra.user_scanner("email", i, p, c),
            "blackbird": lambda i, p, c: extra.blackbird("email", i, p, c),
        },
        inputs,
        params,
        context,
    )
