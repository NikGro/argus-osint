"""Make incomplete successful runs visible without discarding their evidence."""


def include_warning_node(result, inputs, tool, capacity=5000):
    # ActorService has already redacted warnings before this presentation step.
    outputs = result.get("outputs", [])
    if (
        result.get("warnings")
        and not result.get("input_request")
        and (not outputs or any(output.get("type") != "error" for output in outputs))
        and len(outputs) < min(5000, capacity)
    ):
        result = {
            **result,
            "outputs": [
                *outputs,
                {
                    "type": "error",
                    "label": "Unvollständige Recherche",
                    "data": {
                        "title": "Ergebnisse möglicherweise unvollständig",
                        "message": "\n".join(dict.fromkeys(result["warnings"]))[:12000],
                    },
                    "relation": "Recherchehinweis",
                    "source_input": inputs[0]["id"] if inputs else None,
                    "source": {"tool": tool, "incomplete": True},
                },
            ],
        }
    return result
