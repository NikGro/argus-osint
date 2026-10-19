'use strict';
// Compatibility entry for the fixed Docker runner. Semantic tests import production ESM.
require('./frontend_contracts.cjs');

require('./alpha1_contracts.cjs');
require('./canvas_contracts.cjs');
require('./beta_contracts.cjs');

require('./domain_contracts.cjs');
