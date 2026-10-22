'use strict';
// Independent acceptance tests exercise the actual shipped UMD API and Electron inspector.
const path=require('node:path'),{ROOT}=require('./database-identity23-fixtures.cjs');
module.exports={planner:()=>require(path.join(ROOT,'assets/core/database-lifecycle.js')),inspector:()=>require(path.join(ROOT,'electron/database-lifecycle.cjs'))};
