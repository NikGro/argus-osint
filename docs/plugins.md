# Plugin guide

ARGUS distinguishes **data plugins** (node schemas and presentation) from **tool plugins** (actions operating on connected nodes). The word “actor” still appears in internal file/API names; the interface calls them tools.

## Included tools

| Plugin | Inputs | Main output / purpose |
| --- | --- | --- |
| Username research | Username | Deduplicated account/profile leads from enabled sources |
| Email research | Email | Profile leads from enabled sources |
| Phone research | Phone or value | Phone facts and supported account/profile leads |
| Generic Deep Research | One profile | Provider-scoped facts and available media, grouped by context |
| Instagram Deep Research | One Instagram profile | Selected profile, contact, media, relationship and available masked recovery sections |
| Sherlock / Maigret | Username | Direct access to the corresponding research engine |
| Holehe | Email | Direct email-account checks |
| PhoneInfoga | Phone | Number parsing, provider checks and configured scanners |
| Metadata | Uploaded image/file | Available file metadata, including supported location facts |
| Location | Location data | Normalized address/coordinates and geocoding results |
| Merge | Two to 100 data nodes of the same type | One merged node; conflicting fields prompt for a choice |
| JSON Transform | Connected data nodes | Browser-worker transformation using the supplied JavaScript |
| DeepFace | Exactly two images | Match/no match, numeric comparison values and optional overlay image nodes |

The installed descriptor is authoritative for accepted types, limits and available fields. Missing tools/dependencies and unsupported host isolation are reported rather than silently substituted.

## Configuration versus defaults

The **Plugin settings** section holds installation-wide sources, source order, credentials and other settings-only values. Source switches and order are not editable in Research node details; old node-local copies do not override the installation-wide configuration.

The **Defaults for new tools** section sets starting values for timeout, limits, optional output sections and similar parameters. Individual tool details can override those values. Search profiles are available both as defaults and for a specific research node.

Disabled plugins are not offered as executable actions. Only providers currently enabled in plugin settings have a search-profile editor in the node detail panel. Hiding a provider preserves its existing node-specific profiles so they are available if that provider is enabled again.

## Discovery sources and search profiles

Username and email discovery keep their supported providers; Consensus is their default enabled source. Phone research additionally offers PhoneInfoga and Ignorant where supported. Source switches and ordering are independent of the profile filters.

Each provider with a profile catalogue offers a searchable selector. Add profiles such as top lists, categories or provider-defined groups; reorder or remove them. A **custom websites** entry adds a multiline list for that provider. Filters apply only to the selected provider. Ordered profile passes are combined and duplicates are merged. An empty list means unrestricted searching within that provider's normal capabilities; it does not bypass provider limits or create unsupported categories.

Profile catalogues are generated during the image build from the installed engine versions. A label available for one engine need not exist for another. Provider source and provenance remain attached to results. Discovery intentionally retains profile leads rather than automatically turning every discovered account into a full dossier.

## Instagram

Configure credentials/session in the plugin settings, not in graph data. The sign-in action reports progress; supported confirmation challenges open an input dialog. Temporary confirmation codes are not persisted as graph parameters.

Choose research sections and limits in defaults or on an individual tool. Toutatis supplements accessible profile/contact information and masked fields through its bounded lookup adapter. The existing session is supplied where available. Only returned fields are emitted; absent, rate-limited or rejected responses produce a partial-result warning/error node. The adapter does not request delivery of recovery messages. See [instagram.md](instagram.md).

## DeepFace

One selected image makes the tool available for creation. Two selected images are both connected when the tool is dropped onto either selected image. Execution still requires exactly two image inputs.

Model, detector, metric, normalization, alignment, detection enforcement, crop expansion, optional threshold, anti-spoofing, timeout, overlays and large-image working copies are configurable in details. Before inference, an oversized image with resizing disabled produces an input dialog asking whether to enable a working copy of at most 40 MP. Cancelling stops that request. Originals are retained.

Outputs include scores and, if enabled and successfully generated, separately stored JPEG previews with boxes, available landmarks and labels. Detector capabilities vary; missing landmarks are not invented. Uploaded and successfully cached remote images can be used. See [deepface.md](deepface.md).

## Credentials and external requests

Credentials and sessions are encrypted with an installation-local key in the data volume. Preserve that key in backups. Masked settings responses are not the underlying secret. Known credentials are removed from persisted diagnostics. Provider configuration may require an API key or an authenticated account; unavailable upstream data is not manufactured.

External tools contact providers when explicitly run. Image previews are downloaded/cached by the server rather than fetched from a research target by the browser. Deliberately opening an external quick-action link opens that provider in the user's browser; the server VPN does not control a separate browser's internet connection.

## Installing/developing community plugins

Add an approved community repository under the plugin library, inspect its metadata and install explicitly. Python modules are pinned to a repository commit and SHA-256. Treat community code as trusted code you chose to install; the worker boundary is an additional control, not a claim that arbitrary hostile code is safe.

A data plugin may declare node types, default fields, display defaults, categories, icons and translations. A tool plugin declares accepted input types, actions, parameter metadata and a `run` function. For the exact contract, structured result shapes, prompts and provenance rules, see [PLUGIN_CONTRACT.md](PLUGIN_CONTRACT.md) and the examples. Keep a plugin's returned facts small and atomic; use nested groups to express provider/context relationships.
