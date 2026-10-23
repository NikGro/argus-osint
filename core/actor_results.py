"""Materialize already-collected actor results into a graph snapshot. No I/O."""

import copy
from uuid import uuid4

from core.errors import DomainError
from core.graph import NODE_DEFAULTS, TYPES, group_node_ids
from core.result_groups import (
    append_groups,
    create_tree,
    measure,
    nested_outputs,
    place,
)

MAX_OUTPUTS = 5000


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

    def _size(self, output):
        width, height = self.service.bounds(
            {"type": output["type"], "data": output["data"]}
        )[2:4]
        return width, height

    def _actor_size(self):
        return self.service.bounds(self.actor)[2:4]

    def _valid_output(self, output):
        return (
            isinstance(output, dict)
            and output.get("type") in self.output_types
            and isinstance(output.get("data"), dict)
        )

    # -- sort outputs into placement units and collect occupied areas ------

    def prepare_units(self):
        outputs = self.result.get("outputs")
        if not isinstance(outputs, list) or len(outputs) > MAX_OUTPUTS:
            raise DomainError("validation.e0b36ee5da")
        self.nested = nested_outputs(outputs)
        self.nested_ids = {id(o) for o in self.nested}
        for output in outputs:
            # Flat outputs from a named service are grouped by that service.
            if (
                id(output) not in self.nested_ids
                and output.get("type") != "profile"
                and not output.get("group")
                and output.get("source", {}).get("service")
            ):
                output["group"] = str(output["source"]["service"])
            if output.get("group"):
                self.result["group_outputs"] = True

        self.run_id, self.members = uuid4().hex, []
        self.output_types = (TYPES | set(self.schemas)) - {"actor"}
        self.output_groups = {}
        # A unit is placed as one block: a named group or a single node.
        self.output_units = {}
        for output in outputs:
            if not self._valid_output(output):
                raise DomainError("validation.6e3580e33a")
            if id(output) in self.nested_ids:
                continue
            if self.result.get("group_outputs", True) and output.get("group"):
                key = ("group", str(output.get("group_id") or output["group"]))
            else:
                key = ("node", len(self.output_units))
            self.output_units.setdefault(key, []).append(output)

        self.occupied = self._occupied_areas()

    def _occupied_areas(self):
        hidden_ids = {
            node_id
            for group in self.doc["groups"]
            if group.get("collapsed")
            for node_id in group_node_ids(self.doc, group)
        }
        occupied = [
            self.service.bounds(n)
            for n in self.doc["nodes"]
            if n["type"] != "marker" and n["id"] not in hidden_ids
        ]
        for group in self.doc["groups"]:
            if group.get("parent_id"):
                continue
            members = group_node_ids(self.doc, group)
            nodes = [n for n in self.doc["nodes"] if n["id"] in members]
            if not nodes:
                continue
            x = min(n.get("x", 0) for n in nodes) - 20
            y = min(n.get("y", 0) for n in nodes) - 42
            if group.get("collapsed"):
                width, height = 220, 76
            else:
                width = (
                    max(n.get("x", 0) + self.service.bounds(n)[2] for n in nodes)
                    - x
                    + 20
                )
                height = (
                    max(n.get("y", 0) + self.service.bounds(n)[3] for n in nodes)
                    - y
                    + 20
                )
            occupied.append((x, y, width, height))
        return occupied

    # -- choose free positions to the right of the tool --------------------

    def _free_y(self, x, y, width, height):
        """Move down until the rectangle no longer overlaps occupied areas."""
        for _ in range(1100):
            hits = [
                r
                for r in self.occupied
                if x < r[0] + r[2] + 25
                and x + width > r[0] - 25
                and y < r[1] + r[3] + 25
                and y + height > r[1] - 25
            ]
            if not hits:
                break
            y = max(r[1] + r[3] + 35 for r in hits)
        return y

    def plan_positions(self):
        self.placement = {}
        actor_x, actor_y = self.actor.get("x", 0), self.actor.get("y", 0)
        actor_width, actor_height = self._actor_size()
        next_y = actor_y
        for unit in self.output_units.values():
            # Longer edge labels need more horizontal room.
            gap = max(
                200,
                min(
                    520,
                    max(
                        len(str(o.get("relation", "Ergebnis"))) * 7 + 115 for o in unit
                    ),
                ),
            )
            x = actor_x + actor_width + gap
            y = next_y
            grouped = self.result.get("group_outputs", True) and bool(
                unit[0].get("group")
            )
            width = max(250, max(self._size(o)[0] for o in unit) + 40)
            if grouped:
                height = 62 + sum(self._size(o)[1] + 29 for o in unit)
            else:
                height = max(self._size(o)[1] for o in unit)
            if not self.placement and not grouped:
                # The first single node is vertically centered on the tool.
                y = actor_y + (actor_height - height) / 2
            y = self._free_y(x, y, width, height)
            self.occupied.append((x, y, width, height))
            next_y = y + height + 40

            offset = 42 if grouped else 0
            for output in unit:
                self.placement[id(output)] = (x + 20 if grouped else x, y + offset)
                if grouped:
                    offset += self._size(output)[1] + 29

        for tree in create_tree(self.nested).values():
            measure(tree, self.service.bounds)
            tree["_bounds"] = self.service.bounds
            x = actor_x + actor_width + 220
            if self.placement:
                y = next_y
            else:
                y = actor_y + (actor_height - 76) / 2
            y = self._free_y(x, y, 220, 76)
            self.occupied.append((x, y, 220, 76))
            place(tree, x, y, self.placement)
            next_y = y + 116

    # -- create nodes, edges and updates -----------------------------------

    def create_nodes(self):
        self.output_node_ids = {}
        for output in self.result["outputs"]:
            if not self._valid_output(output):
                raise DomainError("validation.6e3580e33a")
            if output["type"] == "profile":
                data = output["data"]
                if not str(data.get("provider", "")).strip() or not (
                    str(data.get("url", "")).strip()
                    or str(data.get("identifier", "")).strip()
                ):
                    raise DomainError("validation.0dbed61b46")
            node_id = uuid4().hex
            x, y = self.placement[id(output)]
            node = {
                "id": node_id,
                "type": output["type"],
                "label": str(output.get("label", output["type"]))[:1000],
                "data": output["data"],
                "x": x,
                "y": y,
                "evidence": {
                    "run_id": self.run_id,
                    "plugin": self.plugin_id,
                    "retrieved_at": self.service.now(),
                    "source": output.get("source", {}),
                },
                "display": copy.deepcopy(self.display_defaults.get(output["type"], {})),
                "verification": "unverified",
                "tags": output.get("tags", []),
            }
            self.doc["nodes"].append(node)
            self.output_node_ids[id(output)] = node_id
            self.members.append(node_id)
            if (
                id(output) not in self.nested_ids
                and self.result.get("group_outputs", True)
                and output.get("group")
            ):
                group_key = (
                    str(output.get("group_id") or output["group"])[:200],
                    str(output["group"])[:200],
                )
                self.output_groups.setdefault(group_key, []).append(node_id)
            self.doc["edges"].append(
                {
                    "id": uuid4().hex,
                    "source": self.actor["id"],
                    "target": node_id,
                    "label": output.get("relation", "Ergebnis"),
                    "run_id": self.run_id,
                }
            )
            if output.get("source_input"):
                node["evidence"]["source_input"] = output["source_input"]
                if output["type"] == "location":
                    self._retarget_location_choices(output["source_input"], node_id)

    def _retarget_location_choices(self, source_input, node_id):
        # Address candidates now apply to the new location node.
        for choice in self.result.get("candidates", []):
            if choice["input_id"] == source_input:
                choice["source_input"] = choice["input_id"]
                choice["input_id"] = node_id

    def apply_updates(self):
        inputs = {n["id"]: n for n in self.inputs}
        for update in self.result.get("updates", []):
            target = inputs.get(update["id"])
            if not target:
                continue
            target["data"] = {
                **copy.deepcopy(NODE_DEFAULTS.get(target["type"], {})),
                **target["data"],
                **update["data"],
            }
            target["evidence"] = {
                **target.get("evidence", {}),
                **update.get("evidence", {}),
                "last_update": {
                    "run_id": self.run_id,
                    "plugin": self.plugin_id,
                    "at": self.service.now(),
                },
            }

    # -- group the new nodes -----------------------------------------------

    def _add_group(self, label, members, collapsed):
        self.doc["groups"].append(
            {
                "id": uuid4().hex,
                "label": label,
                "members": members,
                "collapsed": collapsed,
                "run_id": self.run_id,
            }
        )

    def create_groups(self):
        nested_members = append_groups(
            self.doc, self.nested, self.output_node_ids, self.run_id
        )
        if self.output_groups:
            for (_, label), members in self.output_groups.items():
                self._add_group(label, members, collapsed=True)
            grouped = {nid for ids in self.output_groups.values() for nid in ids}
            types = {n["id"]: n["type"] for n in self.doc["nodes"]}
            remaining = [
                nid
                for nid in self.members
                if nid not in nested_members
                and nid not in grouped
                and types[nid] != "profile"
            ]
            if len(remaining) > 1:
                self._add_group("Suchprotokoll", remaining, collapsed=False)
        elif (
            not nested_members
            and len(self.members) > 1
            and self.result.get("group_outputs", True)
        ):
            self._add_group(
                self.action_name + " · " + self.started[:19],
                self.members,
                collapsed=False,
            )
        return self.run_id, self.members
