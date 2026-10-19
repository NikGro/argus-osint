"""Materialize already-collected actor results into a graph snapshot. No I/O."""

from core.errors import DomainError
import copy
from uuid import uuid4
from core.graph import TYPES, NODE_DEFAULTS, group_node_ids
from core.result_groups import (
    nested_outputs,
    create_tree,
    measure,
    place,
    append_groups,
)


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
        return _Materialization(
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
        ).build()


class _Materialization:

    def __init__(
        self,
        service,
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
        self.service = service
        self.doc = doc
        self.actor = actor
        self.inputs = inputs
        self.result = result
        self.plugin_id = plugin_id
        self.action_name = action_name
        self.started = started
        self.schemas = schemas
        self.display_defaults = display_defaults

    def build(self):
        self.prepare_units()
        self.plan_positions()
        self.create_nodes()
        self.apply_updates()
        return self.create_groups()

    def prepare_units(self):
        if (
            not isinstance(self.result.get("outputs"), list)
            or len(self.result["outputs"]) > 5000
        ):
            raise DomainError("validation.e0b36ee5da")
        self.nested = nested_outputs(self.result["outputs"])
        self.nested_ids = {id(o) for o in self.nested}
        for self.output in self.result["outputs"]:
            if (
                id(self.output) not in self.nested_ids
                and self.output.get("type") != "profile"
                and (not self.output.get("group"))
                and self.output.get("source", {}).get("service")
            ):
                self.output["group"] = str(self.output["source"]["service"])
            if self.output.get("group"):
                self.result["group_outputs"] = True
        self.run_id, self.members = (uuid4().hex, [])
        self.output_types = (TYPES | set(self.schemas)) - {"actor"}
        self.output_groups = {}
        self.output_units = {}
        for self.output in self.result["outputs"]:
            if (
                not isinstance(self.output, dict)
                or self.output.get("type") not in self.output_types
                or (not isinstance(self.output.get("data"), dict))
            ):
                raise DomainError("validation.6e3580e33a")
            if id(self.output) in self.nested_ids:
                continue
            self.key = (
                ("group", str(self.output.get("group_id") or self.output["group"]))
                if self.result.get("group_outputs", True) and self.output.get("group")
                else ("node", len(self.output_units))
            )
            self.output_units.setdefault(self.key, []).append(self.output)
        self.hidden_ids = {
            id
            for group in self.doc["groups"]
            if group.get("collapsed")
            for id in group_node_ids(self.doc, group)
        }
        self.occupied = [
            self.service.bounds(n)
            for n in self.doc["nodes"]
            if n["type"] != "marker" and n["id"] not in self.hidden_ids
        ]
        for self.group in self.doc["groups"]:
            if self.group.get("parent_id"):
                continue
            self.group_members = group_node_ids(self.doc, self.group)
            self.nodes = [n for n in self.doc["nodes"] if n["id"] in self.group_members]
            if not self.nodes:
                continue
            self.x = min((n.get("x", 0) for n in self.nodes)) - 20
            self.y = min((n.get("y", 0) for n in self.nodes)) - 42
            self.occupied.append(
                (
                    self.x,
                    self.y,
                    (
                        220
                        if self.group.get("collapsed")
                        else max(
                            (
                                n.get("x", 0) + self.service.bounds(n)[2]
                                for n in self.nodes
                            )
                        )
                        - self.x
                        + 20
                    ),
                    (
                        76
                        if self.group.get("collapsed")
                        else max(
                            (
                                n.get("y", 0) + self.service.bounds(n)[3]
                                for n in self.nodes
                            )
                        )
                        - self.y
                        + 20
                    ),
                )
            )

    def plan_positions(self):
        self.placement = {}
        self.next_y = self.actor.get("y", 0)
        for self.unit_outputs in self.output_units.values():
            self.gap = max(
                200,
                min(
                    520,
                    max(
                        (
                            len(str(o.get("relation", "Ergebnis"))) * 7 + 115
                            for o in self.unit_outputs
                        )
                    ),
                ),
            )
            self.x = (
                self.actor.get("x", 0) + self.service.bounds(self.actor)[2] + self.gap
            )
            self.y = self.next_y
            self.grouped = self.result.get("group_outputs", True) and bool(
                self.unit_outputs[0].get("group")
            )
            self.width = max(
                250,
                max(
                    (
                        self.service.bounds({"type": o["type"], "data": o["data"]})[2]
                        for o in self.unit_outputs
                    )
                )
                + 40,
            )
            self.height = (
                62
                + sum(
                    (
                        self.service.bounds({"type": o["type"], "data": o["data"]})[3]
                        + 29
                        for o in self.unit_outputs
                    )
                )
                if self.grouped
                else max(
                    (
                        self.service.bounds({"type": o["type"], "data": o["data"]})[3]
                        for o in self.unit_outputs
                    )
                )
            )
            if not self.placement and (not self.grouped):
                self.y = (
                    self.actor.get("y", 0)
                    + (self.service.bounds(self.actor)[3] - self.height) / 2
                )
            for self._ in range(1100):
                self.hits = [
                    r
                    for r in self.occupied
                    if self.x < r[0] + r[2] + 25
                    and self.x + self.width > r[0] - 25
                    and (self.y < r[1] + r[3] + 25)
                    and (self.y + self.height > r[1] - 25)
                ]
                if not self.hits:
                    break
                self.y = max((r[1] + r[3] + 35 for r in self.hits))
            self.occupied.append((self.x, self.y, self.width, self.height))
            self.next_y = self.y + self.height + 40
            self.offset = 42 if self.grouped else 0
            for self.o in self.unit_outputs:
                self.placement[id(self.o)] = (
                    self.x + 20 if self.grouped else self.x,
                    self.y + self.offset,
                )
                if self.grouped:
                    self.offset += (
                        self.service.bounds(
                            {"type": self.o["type"], "data": self.o["data"]}
                        )[3]
                        + 29
                    )
        for self.tree in create_tree(self.nested).values():
            self.width, self.height = measure(self.tree, self.service.bounds)
            self.tree["_bounds"] = self.service.bounds
            self.x = self.actor.get("x", 0) + self.service.bounds(self.actor)[2] + 220
            self.y = (
                self.next_y
                if self.placement
                else self.actor.get("y", 0)
                + (self.service.bounds(self.actor)[3] - 76) / 2
            )
            for self._ in range(1100):
                self.hits = [
                    r
                    for r in self.occupied
                    if self.x < r[0] + r[2] + 25
                    and self.x + 220 > r[0] - 25
                    and (self.y < r[1] + r[3] + 25)
                    and (self.y + 76 > r[1] - 25)
                ]
                if not self.hits:
                    break
                self.y = max((r[1] + r[3] + 35 for r in self.hits))
            self.occupied.append((self.x, self.y, 220, 76))
            place(self.tree, self.x, self.y, self.placement)
            self.next_y = self.y + 116

    def create_nodes(self):
        self.output_node_ids = {}
        for self.idx, self.output in enumerate(self.result["outputs"]):
            if (
                not isinstance(self.output, dict)
                or self.output.get("type") not in self.output_types
                or (not isinstance(self.output.get("data"), dict))
            ):
                raise DomainError("validation.6e3580e33a")
            if self.output["type"] == "profile":
                self.d = self.output["data"]
                if not str(self.d.get("provider", "")).strip() or not (
                    str(self.d.get("url", "")).strip()
                    or str(self.d.get("identifier", "")).strip()
                ):
                    raise DomainError("validation.0dbed61b46")
            self.nid = uuid4().hex
            self.node = {
                "id": self.nid,
                "type": self.output["type"],
                "label": str(self.output.get("label", self.output["type"]))[:1000],
                "data": self.output["data"],
                "x": self.placement[id(self.output)][0],
                "y": self.placement[id(self.output)][1],
                "evidence": {
                    "run_id": self.run_id,
                    "plugin": self.plugin_id,
                    "retrieved_at": self.service.now(),
                    "source": self.output.get("source", {}),
                },
                "display": copy.deepcopy(
                    self.display_defaults.get(self.output["type"], {})
                ),
                "verification": "unverified",
                "tags": self.output.get("tags", []),
            }
            self.doc["nodes"].append(self.node)
            self.output_node_ids[id(self.output)] = self.nid
            self.members.append(self.nid)
            if (
                id(self.output) not in self.nested_ids
                and self.result.get("group_outputs", True)
                and self.output.get("group")
            ):
                self.output_groups.setdefault(
                    (
                        str(self.output.get("group_id") or self.output["group"])[:200],
                        str(self.output["group"])[:200],
                    ),
                    [],
                ).append(self.nid)
            self.doc["edges"].append(
                {
                    "id": uuid4().hex,
                    "source": self.actor["id"],
                    "target": self.nid,
                    "label": self.output.get("relation", "Ergebnis"),
                    "run_id": self.run_id,
                }
            )
            if self.output.get("source_input"):
                self.node["evidence"]["source_input"] = self.output["source_input"]
                if self.output["type"] == "location":
                    for self.choice in self.result.get("candidates", []):
                        if self.choice["input_id"] == self.output["source_input"]:
                            self.choice["source_input"] = self.choice["input_id"]
                            self.choice["input_id"] = self.nid

    def apply_updates(self):
        for self.update in self.result.get("updates", []):
            self.target = next(
                (n for n in self.inputs if n["id"] == self.update["id"]), None
            )
            if self.target:
                self.target["data"] = {
                    **copy.deepcopy(NODE_DEFAULTS.get(self.target["type"], {})),
                    **self.target["data"],
                    **self.update["data"],
                }
                self.target["evidence"] = {
                    **self.target.get("evidence", {}),
                    **self.update.get("evidence", {}),
                    "last_update": {
                        "run_id": self.run_id,
                        "plugin": self.plugin_id,
                        "at": self.service.now(),
                    },
                }

    def create_groups(self):
        self.nested_members = append_groups(
            self.doc, self.nested, self.output_node_ids, self.run_id
        )
        if self.output_groups:
            for (self._, self.label), self.group_members in self.output_groups.items():
                self.doc["groups"].append(
                    {
                        "id": uuid4().hex,
                        "label": self.label,
                        "members": self.group_members,
                        "collapsed": True,
                        "run_id": self.run_id,
                    }
                )
            self.remaining = [
                nid
                for nid in self.members
                if nid not in self.nested_members
                and (not any((nid in ids for ids in self.output_groups.values())))
                and (
                    next((n for n in self.doc["nodes"] if n["id"] == nid))["type"]
                    != "profile"
                )
            ]
            if len(self.remaining) > 1:
                self.doc["groups"].append(
                    {
                        "id": uuid4().hex,
                        "label": "Suchprotokoll",
                        "members": self.remaining,
                        "collapsed": False,
                        "run_id": self.run_id,
                    }
                )
        elif (
            not self.nested_members
            and len(self.members) > 1
            and self.result.get("group_outputs", True)
        ):
            self.doc["groups"].append(
                {
                    "id": uuid4().hex,
                    "label": self.action_name + " · " + self.started[:19],
                    "members": self.members,
                    "collapsed": False,
                    "run_id": self.run_id,
                }
            )
        return (self.run_id, self.members)
