from plugins import phoneinfoga
from plugins import _extra_sources as extra
from plugins._research import aggregate
from plugins import _consensus

PLUGIN = {
    "id": "phone",
    "name": "Telefonnummer",
    "category": "Recherche",
    "description": "Gemeinsame Recherche mit einzeln aktivierbaren Quellen und Dublettenerkennung.",
    "actions": [
        {
            "id": "lookup",
            "name": "Telefonnummer recherchieren",
            "inputs": ["phone", "value"],
            "external": True,
            "external_notice": "Die Eingabe wird an die aktivierten Recherchequellen gesendet.",
            "settings_only": [
                "consensus_sites",
                "disabled_scanners",
                "numverify_api_key",
                "googlecse_api_key",
                "googlecse_cx",
            ],
            "default_params": {
                "search_profiles": {},
                "use_consensus": True,
                "consensus_sites": [],
                "use_phoneinfoga": True,
                "use_ignorant": False,
                "source_order": ["consensus", "phoneinfoga", "ignorant"],
                "request_timeout": 12,
                "run_timeout": 300,
                "max_results": 500,
                "phone_region": "",
                "disabled_scanners": [],
                "numverify_api_key": "",
                "googlecse_api_key": "",
                "googlecse_cx": "",
            },
        }
    ],
}


def run(action, inputs, params, context):
    if action != "lookup":
        raise ValueError("Unbekannte Aktion.")
    return aggregate(
        "phone",
        {
            "consensus": lambda i, p, c: _consensus.run("phone", i, p, c),
            "phoneinfoga": lambda i, p, c: phoneinfoga.run(
                "scan",
                i,
                {**p, "run_timeout": min(int(p.get("run_timeout", 300)), 180)},
                c,
            ),
            "ignorant": extra.ignorant,
        },
        inputs,
        params,
        context,
    )
