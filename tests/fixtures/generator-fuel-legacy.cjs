'use strict';
// Frozen pre-extraction FuelMovementPolicy generator implementation, 2026-10-24.
// This independent oracle deliberately retains its legacy parsing and unknown rules.
module.exports=function legacyGeneratorOracle(decimalApi,periodApi){
  const own=(row,key)=>Object.prototype.hasOwnProperty.call(row,key);
  const present=value=>value!==undefined&&value!==null&&String(value).trim()!=='';
  const number=value=>typeof value==='number'&&Number.isFinite(value)?value:typeof value==='string'&&/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())&&Number.isFinite(Number(value))?Number(value):NaN;
  const quantity=value=>Number.isFinite(number(value))?number(value):0;
  const getPeriods=()=>periodApi;
  function decimal(){const api=decimalApi;if(api?.apiVersion!==1)throw Object.assign(Error('Не загружена десятичная арифметика'),{code:'MODULE_UNAVAILABLE'});return api;}
  function generatorParameters(generator,row){
    if(!generator||!own(generator,'fuelNorms'))return generator;
    const api=getPeriods();if(api?.apiVersion!==1)throw Object.assign(Error('Не загружены датированные нормы'),{code:'MODULE_UNAVAILABLE'});
    const selected=api.resolve('generators',generator,row.date,'fuelNorms');return selected.status==='known'?selected.parameters:null;
  }
  function generatorRate(generator,row){
    const d=decimal(),power=number(generator?.power),n100=number(generator?.norm100),load=number(row.load),n50=number(generator?.norm50),idle=number(generator?.normIdle);
    if(!(power>0)||!Number.isFinite(n100)||!Number.isFinite(load))return null;
    const share=d.div(load,power,{scale:12,rounding:'half-away-from-zero'}),twice=d.mul(share,2);
    const rate=Number.isFinite(n50)?d.compare(share,'0.5')<=0&&Number.isFinite(idle)
      ?d.add(idle,d.mul(d.sub(n50,idle),twice))
      :d.add(n50,d.mul(d.sub(n100,n50),d.sub(twice,1)))
      :d.mul(n100,share);
    return d.compare(rate,0)<0?'0':rate;
  }
  function generatorRounded(value){const d=decimal();return d.toNumberExact(d.quantize(value,{scale:3,rounding:'half-away-from-zero'}));}
  function generatorIssueOnly(row){return row?.hours===0&&!present(row.fuelUsed)&&!present(row.fuelActual)&&
    (typeof row.fuelMovementId==='string'&&row.fuelMovementId.trim()!==''||typeof row.fuelMovementId==='number'&&Number.isFinite(row.fuelMovementId));}
  function generatorSpent(generator,row){
    if(!row)return 0;
    if(present(row.fuelActual))return quantity(row.fuelActual);if(present(row.fuelUsed))return quantity(row.fuelUsed);
    if(generatorIssueOnly(row))return 0;
    const parameters=generatorParameters(generator,row);if(parameters===null)return null;
    const hours=quantity(row.hours);if(!generator||!hours)return 0;const rate=generatorRate(parameters,row);
    return rate===null?(own(generator,'fuelNorms')?null:0):generatorRounded(decimal().mul(rate,hours));
  }
  function generatorNormSpent(generator,row){
    if(!generator||!row)return 0;if(present(row.fuelUsed))return quantity(row.fuelUsed);
    if(generatorIssueOnly(row))return 0;
    const parameters=generatorParameters(generator,row);if(parameters===null)return null;
    const hours=quantity(row.hours);if(!hours)return 0;
    const rate=present(row.load)?generatorRate(parameters,row):null;
    if(rate!==null)return generatorRounded(decimal().mul(rate,hours));
    const flat=present(parameters.norm)?number(parameters.norm):number(parameters.norm100);
    return Number.isFinite(flat)?generatorRounded(decimal().mul(flat,hours)):(own(generator,'fuelNorms')?null:0);
  }
  function generatorNormKnown(generator,row){
    if(!generator||!row)return false;if(present(row.fuelUsed)&&Number.isFinite(number(row.fuelUsed)))return true;
    if(generatorIssueOnly(row))return true;
    const parameters=generatorParameters(generator,row);return parameters!==null&&(Number.isFinite(number(parameters.norm))||Number.isFinite(number(parameters.norm100)));
  }
  return Object.freeze({apiVersion:1,generatorParameters,generatorRate,generatorIssueOnly,generatorSpent,generatorNormSpent,generatorNormKnown});
};
