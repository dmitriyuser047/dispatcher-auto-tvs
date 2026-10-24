import type {SectionRows} from './platform-contracts';
import type {ImportPlannerAPI,ImportInput,ImportPlan,ImportPreview,ImportIssue} from './import-planner';
export type {ImportProfile,ImportReference,ImportDecision,ImportInput,ImportIssue,ImportRow,ImportSource,ImportResultRow,ImportPlan,ImportPreview} from './import-planner';

interface Policies {apiVersion:number;validateImportChanges?(previous:unknown,next:unknown,ctx?:unknown):unknown;validateChanges(previous:unknown,next:unknown,ctx?:unknown):unknown}
interface Hash {sha256(value:string):string}
interface ImportError extends Error {code:string;status:number;issues?:ImportIssue[]}

/** Reviewed import workflow adds complete domain validation to owned source facts. */
export function createImportEngine(planner:ImportPlannerAPI,getPolicies?:()=>Policies,getHash?:()=>Hash){
 function fail(code:string,message:string,issues?:ImportIssue[]):never {const error=new Error(message) as ImportError;error.name='ImportError';error.code=code;error.status=400;if(issues)error.issues=issues;throw error;}
 if(planner?.apiVersion!==1)fail('MODULE_UNAVAILABLE','Не загружено общее ядро импорта');
 function frozen<T>(value:T):T {if(value&&typeof value==='object'&&!Object.isFrozen(value)){for(const child of Object.values(value))frozen(child);Object.freeze(value);}return value;}
 function checked(dbValue:unknown,inputValue:unknown,contextValue:unknown):{review:ImportPreview;action:ImportInput}{
  const prepared=planner.prepare(dbValue,inputValue,contextValue),{review,action,context}=prepared,issues=review.issues.slice();
  if(!issues.some(value=>value.severity==='error')){
   const policies=getPolicies?.();if(policies?.apiVersion!==1)fail('MODULE_UNAVAILABLE','Не загружены общие проверки импорта');
   try{(policies.validateImportChanges??policies.validateChanges).call(policies,dbValue,{...(dbValue as SectionRows),...review.sections},{...context,commandIntent:{command:{type:'ImportAction',version:1,input:{...action,reviewFingerprint:'sha256:'+getHash!().sha256('preview')}}}});}
   catch(error){const failure=error as ImportError;if(Array.isArray(failure.issues)&&failure.issues.length)issues.push(...failure.issues.map(value=>({...value,severity:'error' as const})));else issues.push({severity:'error',code:failure.code||'IMPORT_POLICY',message:failure.message});}
  }
  const blockers=issues.filter(value=>value.severity==='error');
  return {review:frozen({...review,issues,blockers,canApply:blockers.length===0}),action};
 }
 function preview(db:unknown,value:unknown,ctx:unknown={}):ImportPreview{return checked(db,value,ctx).review;}
 function plan(db:unknown,value:unknown,ctx:unknown={}):ImportPlan{
  const {review,action}=checked(db,value,ctx);
  if(!action.reviewFingerprint||action.reviewFingerprint!==review.fingerprint)fail('STALE_REVIEW','Данные или решения изменились. Повторите проверку импорта');
  if(!review.canApply)fail('IMPORT_BLOCKED',review.blockers.slice(0,5).map(value=>value.message).join('; '),review.blockers);
  return frozen({sections:review.sections,readSections:review.readSections,writeSections:review.writeSections,entityIds:review.entityIds,rows:review.rows,aggregates:review.aggregates,sourceFingerprint:review.sourceFingerprint});
 }
 const {describe,dependencies,footprint,normalize,validateChanges}=planner;
 return Object.freeze({apiVersion:1 as const,describe,dependencies,footprint,normalize,preview,plan,validateChanges});
}
