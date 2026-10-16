"""Materialize already-collected actor results into a graph snapshot. No I/O."""

import copy
from uuid import uuid4
from core.graph import TYPES, NODE_DEFAULTS, group_node_ids
from result_groups import nested_outputs, create_tree, measure, place, append_groups


class ResultBuilder:
    def __init__(self, bounds, now):
        self.bounds = bounds
        self.now = now

    def apply(
        self,
        doc,
        actor,
        inputs,
        result,
        plugin_id,
        action_name,
        started,
        schemas,
        display_defaults,
    ):
        if not isinstance(result.get("outputs"), list) or len(result["outputs"]) > 5000:
            raise ValueError("Aktion muss höchstens 5000 Ausgabeknoten liefern.")

        nested = nested_outputs(result["outputs"])
        nested_ids = {id(o) for o in nested}
        # Explicit provider groups apply consistently to all actor outputs.
        for output in result["outputs"]:
            if (
                id(output) not in nested_ids
                and output.get("type") != "profile"
                and not output.get("group")
                and output.get("source", {}).get("service")
            ):
                output["group"] = str(output["source"]["service"])
            if output.get("group"):
                result["group_outputs"] = True
        run_id, members = uuid4().hex, []
        output_types = (TYPES | set(schemas)) - {"actor"}
        output_groups = {}
        output_units = {}
        for output in result["outputs"]:
            if (
                not isinstance(output, dict)
                or output.get("type") not in output_types
                or not isinstance(output.get("data"), dict)
            ):
                raise ValueError("Ungültiges Aktorergebnis.")
            if id(output) in nested_ids:
                continue
            key = (
                ("group", str(output.get("group_id") or output["group"]))
                if result.get("group_outputs", True) and output.get("group")
                else ("node", len(output_units))
            )
            output_units.setdefault(key, []).append(output)
        hidden_ids = {
            id
            for group in doc["groups"]
            if group.get("collapsed")
            for id in group_node_ids(doc, group)
        }
        occupied = [self.bounds(n) for n in doc["nodes"] if n["id"] not in hidden_ids]
        for group in doc["groups"]:
            if group.get("parent_id"):
                continue
            group_members = group_node_ids(doc, group)
            nodes = [n for n in doc["nodes"] if n["id"] in group_members]
            if not nodes:
                continue
            x = min(n.get("x", 0) for n in nodes) - 20
            y = min(n.get("y", 0) for n in nodes) - 42
            occupied.append(
                (
                    x,
                    y,
                    (
                        220
                        if group.get("collapsed")
                        else max(n.get("x", 0) + self.bounds(n)[2] for n in nodes)
                        - x
                        + 20
                    ),
                    (
                        76
                        if group.get("collapsed")
                        else max(n.get("y", 0) + self.bounds(n)[3] for n in nodes)
                        - y
                        + 20
                    ),
                )
            )
        placement = {}
        next_y = actor.get("y", 0)
        for unit_outputs in output_units.values():
            gap = max(
                200,
                min(
                    520,
                    max(
                        len(str(o.get("relation", "Ergebnis"))) * 7 + 115
                        for o in unit_outputs
                    ),
                ),
            )
            x = actor.get("x", 0) + self.bounds(actor)[2] + gap
            y = next_y
            grouped = result.get("group_outputs", True) and bool(
                unit_outputs[0].get("group")
            )
            width = max(
                250,
                max(
                    self.bounds({"type": o["type"], "data": o["data"]})[2]
                    for o in unit_outputs
                )
                + 40,
            )
            height = (
                62
                + sum(
                    self.bounds({"type": o["type"], "data": o["data"]})[3] + 29
                    for o in unit_outputs
                )
                if grouped
                else max(
                    self.bounds({"type": o["type"], "data": o["data"]})[3]
                    for o in unit_outputs
                )
            )
            if not placement and not grouped:
                y = actor.get("y", 0) + (self.bounds(actor)[3] - height) / 2
            for _ in range(1100):
                hits = [
                    r
                    for r in occupied
                    if x < r[0] + r[2] + 25
                    and x + width > r[0] - 25
                    and y < r[1] + r[3] + 25
                    and y + height > r[1] - 25
                ]
                if not hits:
                    break
                y = max(r[1] + r[3] + 35 for r in hits)
            occupied.append((x, y, width, height))
            next_y = y + height + 40
            offset = 42 if grouped else 0
            for o in unit_outputs:
                placement[id(o)] = (x + 20 if grouped else x, y + offset)
                if grouped:
                    offset += (
                        self.bounds({"type": o["type"], "data": o["data"]})[3] + 29
                    )
        for tree in create_tree(nested).values():
            width, height = measure(tree, self.bounds)
            tree["_bounds"] = self.bounds
            x = actor.get("x", 0) + self.bounds(actor)[2] + 220
            y = (
                next_y
                if placement
                else actor.get("y", 0) + (self.bounds(actor)[3] - 76) / 2
            )
            for _ in range(1100):
                hits = [
                    r
                    for r in occupied
                    if x < r[0] + r[2] + 25
                    and x + 220 > r[0] - 25
                    and y < r[1] + r[3] + 25
                    and y + 76 > r[1] - 25
                ]
                if not hits:
                    break
                y = max(r[1] + r[3] + 35 for r in hits)
            occupied.append((x, y, 220, 76))
            place(tree, x, y, placement)
            next_y = y + 116
        output_node_ids = {}
        for idx, output in enumerate(result["outputs"]):
            if (
                not isinstance(output, dict)
                or output.get("type") not in output_types
                or not isinstance(output.get("data"), dict)
            ):
                raise ValueError("Ungültiges Aktorergebnis.")
            if output["type"] == "profile":
                d = output["data"]
                if not str(d.get("provider", "")).strip() or not (
                    str(d.get("url", "")).strip()
                    or str(d.get("identifier", "")).strip()
                ):
                    raise ValueError(
                        "Profil benötigt Anbieter und URL oder Identifier."
                    )
            nid = uuid4().hex
            node = {
                "id": nid,
                "type": output["type"],
                "label": str(output.get("label", output["type"]))[:1000],
                "data": output["data"],
                "x": placement[id(output)][0],
                "y": placement[id(output)][1],
                "evidence": {
                    "run_id": run_id,
                    "plugin": plugin_id,
                    "retrieved_at": self.now(),
                    "source": output.get("source", {}),
                },
                "display": copy.deepcopy(display_defaults.get(output["type"], {})),
                "verification": "unverified",
                "tags": output.get("tags", []),
            }
            doc["nodes"].append(node)
            output_node_ids[id(output)] = nid
            members.append(nid)
            if (
                id(output) not in nested_ids
                and result.get("group_outputs", True)
                and output.get("group")
            ):
                output_groups.setdefault(
                    (
                        str(output.get("group_id") or output["group"])[:200],
                        str(output["group"])[:200],
                    ),
                    [],
                ).append(nid)
            doc["edges"].append(
                {
                    "id": uuid4().hex,
                    "source": actor["id"],
                    "target": nid,
                    "label": output.get("relation", "Ergebnis"),
                    "run_id": run_id,
                }
            )
            if output.get("source_input"):
                node["evidence"]["source_input"] = output["source_input"]
                if output["type"] == "location":
                    for choice in result.get("candidates", []):
                        if choice["input_id"] == output["source_input"]:
                            choice["source_input"] = choice["input_id"]
                            choice["input_id"] = nid
        for update in result.get("updates", []):
            target = next((n for n in inputs if n["id"] == update["id"]), None)
            if target:
                target["data"] = {
                    **copy.deepcopy(NODE_DEFAULTS.get(target["type"], {})),
                    **target["data"],
                    **update["data"],
                }
                target["evidence"] = {
                    **target.get("evidence", {}),
                    **update.get("evidence", {}),
                    "last_update": {
                        "run_id": run_id,
                        "plugin": plugin_id,
                        "at": self.now(),
                    },
                }
        nested_members = append_groups(doc, nested, output_node_ids, run_id)
        if output_groups:
            for (_, label), group_members in output_groups.items():
                doc["groups"].append(
                    {
                        "id": uuid4().hex,
                        "label": label,
                        "members": group_members,
                        "collapsed": True,
                        "run_id": run_id,
                    }
                )
            remaining = [
                nid
                for nid in members
                if nid not in nested_members
                and not any(nid in ids for ids in output_groups.values())
                and next(n for n in doc["nodes"] if n["id"] == nid)["type"] != "profile"
            ]
            if len(remaining) > 1:
                doc["groups"].append(
                    {
                        "id": uuid4().hex,
                        "label": "Suchprotokoll",
                        "members": remaining,
                        "collapsed": False,
                        "run_id": run_id,
                    }
                )
        elif (
            not nested_members
            and len(members) > 1
            and result.get("group_outputs", True)
        ):
            doc["groups"].append(
                {
                    "id": uuid4().hex,
                    "label": action_name + " · " + started[:19],
                    "members": members,
                    "collapsed": False,
                    "run_id": run_id,
                }
            )
        return run_id, members
