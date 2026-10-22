'use strict';
// Current-client fixtures opt in explicitly. Dedicated old/raw-client tests
// intentionally omit this helper and keep testing the compatibility refusal.
function writerHeaders(){return {'x-tvs-writer-schema':String(require('../../electron/storage-format.cjs').SCHEMA_VERSION)};}
module.exports={writerHeaders};
