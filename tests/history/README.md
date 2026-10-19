# Historical frontend specifications

These text files preserve pre-React/pre-domain-store source-extraction tests. They are not runnable tests of the shipped application: they expected flat globals, a hand-built DOM and direct third-party map frames, and depended on a removed frozen controller manifest.

The active suite imports the real production bundle instead. `frontend_contracts.cjs` covers state isolation, composition, identifiers, links, group detach and autosave; `graph_contracts.cjs` covers nested grouping, fixed ports and layouts; `canvas_contracts.cjs` covers actual viewport wiring and dependency ownership; `group_disclosure_contracts.cjs` covers reversible group disclosure; `domain_contracts.cjs` covers map routing, clipboard references, input compatibility, preview sizing, custom labels and exact-mask route preservation. React browser fixtures and real-backend Chromium workflows cover the shared forms, selectors, tags, palettes, graph gestures, settings and queued execution flows.

Archiving is not a claim that every old assertion has a one-to-one replacement. The text remains available for future coverage expansion; historical DOM-shape expectations must not be counted as current product checks.

Pre-React iteration-named browser scripts are archived as `.cjs.txt` specifications. The active React fixture (`react_browser.cjs`) and real-backend workflow (`browser_workspace.py`) are the runnable browser contracts.
