/* Public policy compatibility facade. Workflow rules and source checks live below this boundary. */
(function(root,factory){'use strict';if(typeof module==='object'&&module.exports)module.exports=factory(require('./workflow-validation.js'),()=>require('./platform-integrity.js'));else root.PlatformPolicies=factory(root.WorkflowValidation,()=>root.PlatformIntegrity);})(typeof globalThis==='object'?globalThis:this,function(validation,getIntegrity){
  'use strict';
  function validateImportChanges(previous,next,context){const integrity=getIntegrity();if(integrity?.apiVersion!==1)throw Object.assign(Error('Не загружена проверка связей импорта'),{code:'MODULE_UNAVAILABLE'});return integrity.validateChanges(previous,next,context);}
  return Object.freeze({apiVersion:1,validateImportChanges,inspect:validation.inspect,inspectStock:validation.inspectStock,inspectFuel:validation.inspectFuel,periodRowIdentity:validation.periodRowIdentity,scopePeriods:validation.scopePeriods,validatePeriodChanges:validation.validatePeriodChanges,validateStockChanges:validation.validateStockChanges,validateFuelChanges:validation.validateFuelChanges,validateChanges:validation.validateChanges});
});
