# ARGUS React component library

Application views import reusable components from `static/react/ui/index.jsx`.
The previous `components.jsx` is a compatibility re-export, not another implementation.
The library uses the established ARGUS tokens in `static/style.css` and has no runtime
dependency on a component framework, CSS override bundle or external font service.

| Module | Public components | Contract |
| --- | --- | --- |
| controls | Icon, Button, Check, SaveState | Shared icons, control dimensions, destructive colors and checkbox alignment. SaveState belongs to settings/plugin views; node details use the header status. |
| select | Select | Searchable portal, keyboard navigation, selection focus and accessible combobox. |
| fields | Field, Fields, Facts, ColorField | Controlled drafts retain the caret; schema controls numeric limits and native date/time inputs. ColorField offers a native picker and optional HEX entry. |
| sortable | SortList, SearchProfiles | One row implementation for providers, search profiles and VPN profiles. Optional expansion, removal, numbering and keyboard arrows; whole-row drag image, midpoint reorder and displacement animation. Reduced motion is respected. |
| modal | Modal | One dialog lifecycle and spaced choice list for confirmations, file-type choices and tool input requests. |
| layout | DetailSection, MediaFrame | One leading section boundary, clipped rounded media, native video controls. |

`SortList` takes immutable `items`, `onChange`, `renderItem`, and optional
`renderDetails`, `remove`, `numbered`, `label`. Items need stable `id` or `key`.
Expansion is independent of enabled state. Research profiles in provider expansions
are explicitly labelled as defaults and remain editable per enabled tool provider.

Canvas geometry derives available media height from node bounds, badges and action
rows. Media components remain keyed while the viewport transform changes. A scoped
ResizeObserver preserves the world-space view centre when either sidebar changes.
Touch gestures are registered and disposed with the canvas; text editors release focus
when another graph element is selected. Escape also exits a note editor.

`tests/react_browser.cjs` renders the shipped bundle with local synthetic API/media
fixtures. `tests/browser_v19_smoke.py` uses the real backend and a temporary database.
No research, external accounts or face comparisons are invoked by these tests.
