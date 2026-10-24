import type {DecimalCoreAPI} from './decimal-core';
import type {EffectivePeriodsAPI} from './effective-periods';

export interface GeneratorFuelAPI {
  readonly apiVersion:1;
  generatorParameters(generator:unknown,record:unknown):unknown;
  generatorRate(generator:unknown,record:unknown):string|null;
  generatorIssueOnly(record:unknown):boolean;
  generatorSpent(generator:unknown,record:unknown):number|null;
  generatorNormSpent(generator:unknown,record:unknown):number|null;
  generatorNormKnown(generator:unknown,record:unknown):boolean;
}
type Row=Record<string,unknown>;

/** Historical physical and normative DES arithmetic, independent of storage,
 * journals, workflows and seasonal planning. Unknown and legacy fallbacks are
 * intentional published behavior; source validation belongs to its callers. */
export function createGeneratorFuel(decimalApi?:Readonly<DecimalCoreAPI>,periodApi?:Readonly<EffectivePeriodsAPI>):GeneratorFuelAPI {
  const own=(row:unknown,key:string):boolean=>Object.prototype.hasOwnProperty.call(row,key);
  const present=(value:unknown):boolean=>value!==undefined&&value!==null&&String(value).trim()!=='';
  const number=(value:unknown):number=>typeof value==='number'&&Number.isFinite(value)?value:typeof value==='string'&&/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())&&Number.isFinite(Number(value))?Number(value):NaN;
  const quantity=(value:unknown):number=>Number.isFinite(number(value))?number(value):0;
  function decimal():Readonly<DecimalCoreAPI> {const api=decimalApi;if(api?.apiVersion!==1)throw Object.assign(Error('Не загружена десятичная арифметика'),{code:'MODULE_UNAVAILABLE'});return api;}
  function generatorParameters(generatorValue:unknown,rowValue:unknown):unknown {
    const generator=generatorValue as Row|null|undefined,row=rowValue as Row;
    if(!generator||!own(generator,'fuelNorms'))return generator;
    const api=periodApi;if(api?.apiVersion!==1)throw Object.assign(Error('Не загружены датированные нормы'),{code:'MODULE_UNAVAILABLE'});
    const selected=api.resolve('generators',generator,row.date,'fuelNorms');return selected.status==='known'?selected.parameters:null;
  }
  function generatorRate(generatorValue:unknown,rowValue:unknown):string|null {
    const generator=generatorValue as Row|null|undefined,row=rowValue as Row;
    const d=decimal(),power=number(generator?.power),n100=number(generator?.norm100),load=number(row.load),n50=number(generator?.norm50),idle=number(generator?.normIdle);
    if(!(power>0)||!Number.isFinite(n100)||!Number.isFinite(load))return null;
    const share=d.div(load,power,{scale:12,rounding:'half-away-from-zero'}),twice=d.mul(share,2);
    const rate=Number.isFinite(n50)?d.compare(share,'0.5')<=0&&Number.isFinite(idle)
      ?d.add(idle,d.mul(d.sub(n50,idle),twice))
      :d.add(n50,d.mul(d.sub(n100,n50),d.sub(twice,1)))
      :d.mul(n100,share);
    return d.compare(rate,0)<0?'0':rate;
  }
  function generatorRounded(value:unknown):number {const d=decimal();return d.toNumberExact(d.quantize(value,{scale:3,rounding:'half-away-from-zero'}));}
  function generatorIssueOnly(rowValue:unknown):boolean {
    const row=rowValue as Row|null|undefined;
    return row?.hours===0&&!present(row.fuelUsed)&&!present(row.fuelActual)&&
      (typeof row.fuelMovementId==='string'&&row.fuelMovementId.trim()!==''||typeof row.fuelMovementId==='number'&&Number.isFinite(row.fuelMovementId));
  }
  function generatorSpent(generatorValue:unknown,rowValue:unknown):number|null {
    const generator=generatorValue as Row|null|undefined,row=rowValue as Row|null|undefined;
    if(!row)return 0;
    if(present(row.fuelActual))return quantity(row.fuelActual);if(present(row.fuelUsed))return quantity(row.fuelUsed);
    if(generatorIssueOnly(row))return 0;
    const parameters=generatorParameters(generator,row);if(parameters===null)return null;
    const hours=quantity(row.hours);if(!generator||!hours)return 0;const rate=generatorRate(parameters,row);
    return rate===null?(own(generator,'fuelNorms')?null:0):generatorRounded(decimal().mul(rate,hours));
  }
  function generatorNormSpent(generatorValue:unknown,rowValue:unknown):number|null {
    const generator=generatorValue as Row|null|undefined,row=rowValue as Row|null|undefined;
    if(!generator||!row)return 0;if(present(row.fuelUsed))return quantity(row.fuelUsed);
    if(generatorIssueOnly(row))return 0;
    const parameters=generatorParameters(generator,row) as Row|null;if(parameters===null)return null;
    const hours=quantity(row.hours);if(!hours)return 0;
    const rate=present(row.load)?generatorRate(parameters,row):null;
    if(rate!==null)return generatorRounded(decimal().mul(rate,hours));
    const flat=present(parameters.norm)?number(parameters.norm):number(parameters.norm100);
    return Number.isFinite(flat)?generatorRounded(decimal().mul(flat,hours)):(own(generator,'fuelNorms')?null:0);
  }
  function generatorNormKnown(generatorValue:unknown,rowValue:unknown):boolean {
    const generator=generatorValue as Row|null|undefined,row=rowValue as Row|null|undefined;
    if(!generator||!row)return false;if(present(row.fuelUsed)&&Number.isFinite(number(row.fuelUsed)))return true;
    if(generatorIssueOnly(row))return true;
    const parameters=generatorParameters(generator,row) as Row|null;return parameters!==null&&(Number.isFinite(number(parameters.norm))||Number.isFinite(number(parameters.norm100)));
  }
  return Object.freeze({apiVersion:1,generatorParameters,generatorRate,generatorIssueOnly,generatorSpent,generatorNormSpent,generatorNormKnown});
}
