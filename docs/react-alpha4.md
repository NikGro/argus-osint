# ARGUS Alpha 4 implementation

All active application views are React components: navigation, projects, toolbar, SVG graph, palette, node/group details, plugin management/settings, dialogs, VPN, system/project logs and report frame. The existing domain commands handle storage/reconciliation, execution, geometry, grouping, layout and clipboard. A checked command registry supplies dependencies and a subscribed domain store; React owns view elements and keyed graph nodes. Gesture transforms and transient selection/connection previews use the existing bounded imperative graph adapter.

The old feature modules remain available for command compatibility and pending test migration; they are not a claim that every historical helper has already been rewritten. The previous manually wired composition root is no longer the active startup path.

CSS uses one maintained stylesheet and shared tokens/components, without !important patches. Dimensions and layout were compared with the incumbent live interface, including 220px palette, 320px details, compact toolbar, centered project title and 28px right status alignment. New media editors use the same controls.

Other implemented review items: cached translation-key ordering, output artifact limits retained during process execution, indexed project file ownership, a separate CPU media environment, queue infrastructure recovery, and queue-thread health information. VERSION is shared by backend/build metadata.

Remaining architectural follow-ups include explicit backend application lifecycle/factory, streaming/global upload budgets, further splitting of large collectors/result-building functions, typed plugin-result contracts and conversion of retired source-extraction tests. This batch does not certify the whole application as regression-free. No full suite or GitHub Release was initiated.

Deployment: production image built successfully after correcting one omitted layout source in the transfer. The image build verified the checked-in frontend manifest and regenerated provider/profile catalogues. A synthetic PNG opened in the React photo editor with its crop rectangle; no tool execution or inference was initiated.
