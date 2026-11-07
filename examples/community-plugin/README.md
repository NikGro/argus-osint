# Community plugin example

Copy these three files into the root of your own public GitHub repository. In ARGUS: **Plugins → Add plugins → Add community repository**, paste the repository link and install the example.

`template.py` contains `run(action, inputs, params, context)`; `argus-repository.json` describes input types, actions, default parameters and optional input dialogs. After every code change run `sha256sum template.py` and update the checksum in the manifest: installation pins the commit and verifies the SHA-256 hash.

**Inputs:** `url`, `email`, `username`, `phone`, `location`, `image`, `video`, `audio`, `file`, `value`, `datetime`, `note`, or `*` for every data node.

**Outputs:** return `outputs`, each with `type`, `label` and `data`; optionally `source_input`, `source`, `relation` and `group`. Use the matching data type where one exists (for example `username` or `datetime`) and `value` with `data: {"value": "…"}` otherwise. Two or more outputs with the same `group` are grouped; `group_outputs: false` turns automatic groups off. Existing nodes can be extended with `updates: [{id, data, evidence}]`.

**Files:** `context["resolve_file"](file_id)` returns paths only for uploaded files of the file, image, video or audio inputs passed in. Read these originals only and write temporary output to the working directory.

**Manual input:** an `input_prompt` on an action opens a form before the run. Alternatively `run()` can return `{"outputs": [], "input_request": {"title": "…", "fields": [{"key": "parameter", "label": "…", "type": "text", "required": true}]}}`; ARGUS pauses the queue, stores the answer as a tool parameter and runs the same tool again. Validate input before causing external side effects. Cancelling ends the continuation; the tool can be started again later.

**Trust:** community plugins run with the same rights as ARGUS itself, without a sandbox. Install only code you trust.
