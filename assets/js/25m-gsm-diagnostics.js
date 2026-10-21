// Compatibility entry point. Calculations run in the portable fuel audit core.
if(typeof TvsFuelAudit==='undefined'||TvsFuelAudit.apiVersion!==1)throw Error('Fuel audit core is unavailable (assets/core/fuel-audit.js)');
const GSM_AUDIT_RULES=TvsFuelAudit.rules;
function gsmAuditModel(input,options){return TvsFuelAudit.buildModel(input,options);}
