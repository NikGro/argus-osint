'use strict';
// Compatibility entry for the fixed Docker runner. Semantic tests import production ESM.
require('./frontend_contracts.cjs');

require('./graph_contracts.cjs');
require('./canvas_contracts.cjs');
require('./group_disclosure_contracts.cjs');

require('./domain_contracts.cjs');
