"""Plugin output groups: explicit paths, deterministic nesting and roomy placement."""

from uuid import uuid4


def nested_outputs(outputs):
    nested = [o for o in outputs if o.get("group_path")]
    for output in nested:
        path = output["group_path"]
        if (
            not isinstance(path, list)
            or not 1 <= len(path) <= 12
            or any(
                not isinstance(p, dict)
                or not isinstance(p.get("id"), str)
                or not p["id"]
                or len(p["id"]) > 200
                or not isinstance(p.get("label"), str)
                or not p["label"]
                or len(p["label"]) > 200
                for p in path
            )
        ):
            raise ValueError("Ungültiger Ergebnisgruppen-Pfad.")
    return nested


def create_tree(outputs):
    roots = {}
    for output in outputs:
        tree = roots
        for part in output["group_path"]:
            node = tree.setdefault(
                part["id"], {"label": part["label"], "children": {}, "outputs": []}
            )
            tree = node["children"]
        node["outputs"].append(output)
    return roots


def measure(tree, bounds):
    own = [bounds({"type": o["type"], "data": o["data"]}) for o in tree["outputs"]]
    children = [measure(child, bounds) for child in tree["children"].values()]
    tree["w"] = max([220] + [b[2] + 40 for b in own] + [260 for c in children])
    tree["h"] = max(100, 62 + sum(b[3] + 28 for b in own) + len(children) * 111)
    return tree["w"], tree["h"]


def place(tree, x, y, positions):
    next_y = y + 42
    for output in tree["outputs"]:
        positions[id(output)] = (x + 20, next_y)
        next_y += (
            tree["_bounds"]({"type": output["type"], "data": output["data"]})[3] + 28
        )
    for child in tree["children"].values():
        child["_bounds"] = tree["_bounds"]
        place(child, x + 20, next_y, positions)
        next_y += 111


def append_groups(doc, outputs, node_ids, run_id):
    groups = {}
    for output in outputs:
        parent = None
        key = ()
        for part in output["group_path"]:
            key += (part["id"],)
            if key not in groups:
                group = {
                    "id": uuid4().hex,
                    "label": part["label"],
                    "members": [],
                    "collapsed": True,
                    "run_id": run_id,
                    "plugin": output.get("source", {}).get("plugin", ""),
                    "label_key": part["label"],
                }
                if parent:
                    group["parent_id"] = parent["id"]
                groups[key] = group
                doc["groups"].append(group)
            parent = groups[key]
        parent["members"].append(node_ids[id(output)])
    return {nid for group in groups.values() for nid in group["members"]}
