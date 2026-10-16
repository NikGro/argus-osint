from plugins import profiles, maigret
from plugins import _extra_sources as extra
from plugins._research import aggregate
from plugins import _consensus

PLUGIN = {
    "id": "username",
    "name": "Username",
    "category": "Recherche",
    "description": "Profile finden; zusätzliche Angaben erst über Generic Deep Research abrufen.",
    "actions": [
        {
            "id": "lookup",
            "name": "Username recherchieren",
            "inputs": ["username"],
            "external": True,
            "external_notice": "Die Eingabe wird an die aktivierten Recherchequellen gesendet.",
            "settings_only": [
                "consensus_sites",
                "sherlock_sites",
                "maigret_sites",
                "top_sites",
            ],
            "default_params": {
                "search_profiles": {},
                "use_consensus": True,
                "consensus_sites": [],
                "use_sherlock": False,
                "use_maigret": False,
                "use_user_scanner": False,
                "use_blackbird": False,
                "sherlock_sites": [],
                "maigret_sites": [],
                "top_sites": 100,
                "source_order": [
                    "consensus",
                    "sherlock",
                    "maigret",
                    "user_scanner",
                    "blackbird",
                ],
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
        "username",
        {
            "consensus": lambda i, p, c: _consensus.run("username", i, p, c),
            "sherlock": lambda i, p, c: profiles.run(
                "search",
                i,
                {
                    **p,
                    "sites": p.get("sherlock_sites", []),
                    "max_results": min(int(p.get("max_results", 500)), 300),
                    "run_timeout": min(int(p.get("run_timeout", 300)), 180),
                },
                c,
            ),
            "maigret": lambda i, p, c: maigret.run(
                "search",
                i,
                {
                    **p,
                    "sites": p.get("maigret_sites", []),
                    "max_results": min(int(p.get("max_results", 500)), 300),
                },
                c,
            ),
            "user_scanner": lambda i, p, c: extra.user_scanner("username", i, p, c),
            "blackbird": lambda i, p, c: extra.blackbird("username", i, p, c),
        },
        inputs,
        params,
        context,
    )
