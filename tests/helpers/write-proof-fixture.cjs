'use strict';
const compatibility=require('../../assets/core/platform-compatibility.js');
const plain=value=>JSON.parse(JSON.stringify(value));
function fixture(schemaVersion=3){const description=plain(compatibility.describe());return {module:compatibility,hello:description.hello,server:description.serverProfile,descriptor:require('../../electron/storage-format.cjs').describe(schemaVersion)};}
module.exports={fixture,plain};
