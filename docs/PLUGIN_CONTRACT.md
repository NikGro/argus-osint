# Plugin contract

Data plugins declare `nodes` with a unique `type`, `name`, `defaults`, category, display defaults and optional map-source lists. Built-ins live in `data_plugins/`; the same declarative format is supported in a community repository. Community types must use their own names, not redefine built-in types.

Actor plugins declare `actions` with accepted input types, default params and optional settings metadata. `run(action, inputs, params, context)` returns `outputs` and optionally warnings, structured input requests and candidates. Output nodes carry type, label, data and source/provenance; `group_path` is a sequence of `{id, label}` descriptors for native nested result groups. Each custom value should express one fact, while a group identifies the provider/context. Initial discovery returns profiles, not extracted biographies or generic provider homepages.

Profiles contain a canonical provider ID and at least one usable URL/identifier. Use `provider_registry` and shared profile helpers; do not invent per-plugin provider aliases. Platform-specific actions declare `providers`; generic profile research declares `generic_profile`. The UI suggests compatibility and the backend enforces it.

UI metadata supports `parameter_sections`, `settings_only`, `auth_fields`, `connection_action`, input prompts and translations keyed by language. New features should extend this contract rather than add provider-specific conditionals to generic UI. Keep credentials in settings-only fields; secrets/transient auth codes do not belong in graph params. Verification remains a user decision, not a claim derived from a successful HTTP response.

Community repositories use `argus-repository.json`, a pinned upstream commit and SHA-256 for Python source. Installation is explicit. See `examples/community-plugin/` and `examples/data-plugin/`. Community subprocesses are resource-limited trusted code, not untrusted-code sandboxes. Locale packs and descriptors are validated before installation.

The native browser application feature factories under `static/app/` are internal UI modules, not installable community plugins. Their callback composition must not become a second public plugin standard.
