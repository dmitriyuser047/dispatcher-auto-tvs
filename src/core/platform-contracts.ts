/** Runtime contracts shared by browser commands and the trusted storage boundary. */
export type Identifier = string | number;
export type JsonPrimitive = null | boolean | number | string;
export type JsonValue = JsonPrimitive | JsonValue[] | { [field: string]: JsonValue };
export type JsonRow = { [field: string]: JsonValue };
export type SectionRows = Record<string, JsonRow[]>;
export type Revisions = Record<string, number>;
export interface OperationDescriptor { id: string; digest?: string }
export interface SectionWrite { base: Revisions; sections: SectionRows; operation?: OperationDescriptor; databaseToken?: string }
export interface AssetTarget { section: 'vehicles' | 'generators'; id: Identifier }
export interface IssueFuelInput { tankId: Identifier; target: AssetTarget; date: string; qty: number; reason: string; legacyOverlapConfirmed?: boolean }
export interface AcceptShiftChanges {
  acceptedBy: string; title?: string; date?: string; target?: AssetTarget; driverId?: Identifier; jobId?: Identifier | null;
  odoStart?: number | null; odoEnd?: number | null; hours?: number | null; fuelIssued?: number | null; tankMeasured?: number | null;
  defect?: string; result?: string;
}
export interface AssignPersonInput {
  assignmentId?: Identifier; driverId: Identifier; target: AssetTarget; from: string; to?: string; site: string; org?: string;
  status?: string; reason: string; replacesAssignmentId?: Identifier;
}
export type CatalogSection = 'vehicles' | 'generators' | 'tanks' | 'drivers' | 'parts' | 'contragents' | 'fuelCards';
export interface MergeCatalogInput {
  section: CatalogSection; sourceId: Identifier; targetId: Identifier; reason: string;
  mutableRefs: { relationId: string; rowId: Identifier; path: string }[]; reviewFingerprint: string;
}
export type DocumentSection = 'shiftReports' | 'workOrders' | 'dispatchJobs' | 'fuelMovements' | 'partMovements' | 'fuelWriteoffs' | 'payments' | 'repairs' | 'vehicleTo' | 'toRecords' | 'tankIncomes';
export interface DocumentReference {section:DocumentSection;id:Identifier}
export type PeriodScope = 'fuel' | 'stock' | 'finance';
export interface PeriodActionInput {
  action:'close'|'reopen';scope:PeriodScope;month:string;reason:string;reviewFingerprint:string;
}
export interface TankTarget {section:'tanks';id:Identifier}
export type FuelActionInput =
  | {action:'measure';target:TankTarget;date:string;observedQty:number;reason:string;reviewFingerprint:string}
  | {action:'applyDifference';measurementId:Identifier;reason:string;reviewFingerprint:string}
  | {action:'voidMeasurement';measurementId:Identifier;reason:string;reviewFingerprint:string}
  | {action:'reverseLegacyTransfer';outId:Identifier;inId:Identifier;reason:string;reviewFingerprint:string};
export type ProcurementKind='tank'|'part';
export interface ProcurementReceiptReference {section:'tankIncomes'|'fuelMovements'|'partMovements';id:Identifier}
export interface ProcurementOrderPayload {kind:ProcurementKind;itemId:Identifier;supplier:string;quantity:number;deliveryDate:string;status:'draft'|'ordered';note:string}
export type ProcurementActionInput =
  | {action:'saveOrder';orderId?:Identifier;payload:ProcurementOrderPayload;reason:string;reviewFingerprint:string}
  | {action:'activateLegacy';kind:ProcurementKind;orderId:Identifier;receiptRefs:ProcurementReceiptReference[];reason:string;reviewFingerprint:string}
  | {action:'cancelRemaining';kind:ProcurementKind;orderId:Identifier;reason:string;reviewFingerprint:string}
  | {action:'supplierReturn';kind:ProcurementKind;orderId:Identifier;receipt:ProcurementReceiptReference;qty:number;date:string;reason:string;reviewFingerprint:string};
export interface CostTarget {section:'tanks'|'parts'|'vehicles'|'generators';id:Identifier}
export type CostExpenseSection='payments'|'repairs'|'vehicleTo'|'toRecords'|'workOrders'|'costEntries';
export interface CostExpenseReference {section:CostExpenseSection;id:Identifier}
export interface CostPolicyPayload {from:string;method:'fifo'|'weightedAverage';taxBasis:'gross'|'net';opening:{qty:number;amount:number|null;basis:string};basis:string}
export interface CostAllocationPayload {source:CostExpenseReference;method:'manual'|'km'|'hours';from:string;to:string;targets:(AssetTarget&{amount?:number})[];basis:string}
export type CostActionInput =
  | {action:'savePolicy';target:CostTarget;payload:CostPolicyPayload;reason:string;reviewFingerprint:string}
  | {action:'saveAllocation';allocationId?:Identifier;payload:CostAllocationPayload;reason:string;reviewFingerprint:string};
export interface RepairPrimaryReference {section:'repairs'|'vehicleTo'|'toRecords';id:Identifier}
export type RepairDowntime = {mode:'interval';from:string;to?:string}|{mode:'none';basis:string};
export interface RepairOrderPayload {
  title:string;target:AssetTarget;owner?:string;site?:string;org?:string;description?:string;work?:string;
  cost?:number|null;actualCost?:number|null;costIncludesMaterials?:boolean|null;contragentId?:Identifier;invoiceNo?:string;
  primary?:RepairPrimaryReference|null;downtime?:RepairDowntime;completedAt?:string;result?:string;acceptedBy?:string;
  source?:{section:'shiftReports';id:Identifier};warrantyUntil?:string;repeatOf?:Identifier;
}
export type RepairActionInput =
  | {action:'saveOrder';orderId?:Identifier;payload:RepairOrderPayload;reason:string;reviewFingerprint:string}
  | {action:'approve'|'start'|'cancel';orderId:Identifier;reason:string;reviewFingerprint:string};
export type DocumentActionInput =
  | {action:'saveDraft';section:DocumentSection;draftId?:Identifier;payload:JsonRow;correctionOf?:DocumentReference;reason?:string}
  | {action:'postDraft';section:DocumentSection;draftId:Identifier;reviewFingerprint:string}
  | {action:'discardDraft';section:DocumentSection;draftId:Identifier;reason:string}
  | {action:'post';section:DocumentSection;id:Identifier;reviewFingerprint:string;reason?:string;payload?:JsonRow}
  | {action:'void';section:DocumentSection;id:Identifier;reviewFingerprint:string;reason:string}
  | {action:'reverse';section:'fuelMovements'|'partMovements';id:Identifier;reviewFingerprint:string;reason:string}
  | {action:'settle';section:'payments';id:Identifier;amount:number;date:string;reason:string;reviewFingerprint:string};
export type PlatformCommand = { type: 'IssueFuel'; version: 1; input: IssueFuelInput }
  | { type: 'AcceptShift'; version: 1; input: { shiftId: Identifier; changes: AcceptShiftChanges } }
  | { type: 'AssignPerson'; version: 1; input: AssignPersonInput }
  | { type: 'MergeCatalog'; version: 1; input: MergeCatalogInput }
  | { type: 'DocumentAction'; version: 1; input: DocumentActionInput }
  | { type: 'PeriodAction'; version: 1; input: PeriodActionInput }
  | { type: 'FuelAction'; version: 1; input: FuelActionInput }
  | { type: 'ProcurementAction'; version: 1; input: ProcurementActionInput }
  | { type: 'CostAction'; version: 1; input: CostActionInput }
  | { type: 'RepairAction'; version: 1; input: RepairActionInput };
export interface CommandEnvelope { protocolVersion: 1; databaseToken: string; operation: OperationDescriptor; base: Revisions; command: PlatformCommand }
export interface ContractError extends Error { code: string; field: string; status: number }

export function createPlatformContracts() {
  function fail(code: string, field: string, message: string): never {
    const error = new Error(message) as ContractError;
    error.name = 'PlatformContractError'; error.code = code; error.field = field; error.status = 400;
    throw error;
  }
  function object(value: unknown): value is Record<string, unknown> {
    if (value === null || typeof value !== 'object' || Object.prototype.toString.call(value) !== '[object Object]') return false;
    const prototype: unknown = Object.getPrototypeOf(value);
    return prototype === null || typeof prototype === 'object' && Object.getPrototypeOf(prototype) === null;
  }
  function identifier(value: unknown): value is Identifier {
    return typeof value === 'string' && value.trim().length > 0 || typeof value === 'number' && Number.isFinite(value);
  }
  function json(value: unknown, field: string, parents = new Set<object>(), depth = 0): asserts value is JsonValue {
    if (depth > 100) fail('INVALID_JSON', field, 'Слишком глубокая структура данных');
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
    if (typeof value === 'number' && Number.isFinite(value)) return;
    if (typeof value !== 'object' || value === null || !Array.isArray(value) && !object(value))
      fail('INVALID_JSON', field, 'Значение нельзя сохранить как JSON');
    if (parents.has(value)) fail('INVALID_JSON', field, 'Циклическая структура данных');
    parents.add(value);
    for (const key of Object.keys(value)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) fail('INVALID_JSON', field, 'Недопустимое имя поля');
      // JSON must mean the same thing in a digest, in memory and on disk.
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor?.get || descriptor?.set) fail('INVALID_JSON', field, 'В данных недопустимы исполняемые свойства');
      json(descriptor?.value, field ? field + '.' + key : key, parents, depth + 1);
    }
    parents.delete(value);
  }
  function validateOperation(value: unknown): OperationDescriptor {
    if (!object(value) || typeof value.id !== 'string' || !/^[a-zA-Z0-9._:-]{1,200}$/.test(value.id))
      fail('INVALID_OPERATION', 'operation.id', 'Некорректный идентификатор операции');
    if (value.digest !== undefined && (typeof value.digest !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(value.digest)))
      fail('INVALID_OPERATION', 'operation.digest', 'Некорректный отпечаток операции');
    return value.digest === undefined ? { id: value.id } : { id: value.id, digest: value.digest as string };
  }
  function validateSections(value: unknown, registry: readonly string[]): SectionRows {
    if (!object(value)) fail('INVALID_SECTIONS', 'sections', 'Некорректные разделы платформы');
    const names = new Set(registry);
    for (const [name, rows] of Object.entries(value)) {
      if (!names.has(name) || !Array.isArray(rows)) fail('INVALID_SECTIONS', name, 'Некорректный раздел платформы: ' + name);
      for (const [index, row] of rows.entries()) {
        if (!object(row)) fail('INVALID_SECTIONS', name + '.' + index, 'Запись раздела должна быть объектом');
        json(row, name + '.' + index);
      }
    }
    return value as SectionRows;
  }
  function validateRevisions(value: unknown, registry: readonly string[]): Revisions {
    if (!object(value)) fail('INVALID_BASE', 'base', 'Нужны исходные версии разделов');
    const names = new Set(registry);
    for (const [name, revision] of Object.entries(value)) {
      if (!names.has(name) || typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0)
        fail('INVALID_BASE', 'base.' + name, 'Некорректная исходная версия раздела');
    }
    return value as Revisions;
  }
  function parseSectionWrite(value: unknown, registry: readonly string[]): SectionWrite {
    if (!object(value)) fail('INVALID_SECTIONS', '', 'Неверный запрос сохранения');
    const result: SectionWrite = { base: validateRevisions(value.base, registry), sections: validateSections(value.sections, registry) };
    if (value.operation !== undefined) result.operation = validateOperation(value.operation);
    if (value.databaseToken !== undefined) {
      if (typeof value.databaseToken !== 'string' || !value.databaseToken) fail('INVALID_DATABASE_TOKEN', 'databaseToken', 'Неверная идентичность базы');
      result.databaseToken = value.databaseToken;
    }
    return result;
  }
  // Commands have an exact, owned JSON boundary. Never execute getters, toJSON
  // or coercion hooks while interpreting an action or computing its identity.
  function commandJson(value: unknown, field: string, parents = new Set<object>(), depth = 0): JsonValue {
    if (depth > 100) fail('INVALID_COMMAND', field, 'Слишком глубокая структура команды');
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (value === null || typeof value !== 'object') fail('INVALID_COMMAND', field, 'Команда должна содержать только значения JSON');
    const array = Array.isArray(value), prototype: unknown = Object.getPrototypeOf(value);
    if (!array && !(prototype === null || typeof prototype === 'object' && prototype !== null && Object.getPrototypeOf(prototype) === null))
      fail('INVALID_COMMAND', field, 'Недопустимый объект команды');
    if (parents.has(value)) fail('INVALID_COMMAND', field, 'Циклическая структура команды');
    parents.add(value);
    const result: JsonRow = {}, items: JsonValue[] = [];
    for (const key of Reflect.ownKeys(value)) {
      if (array && key === 'length') continue;
      if (typeof key !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(key)) fail('INVALID_COMMAND', field, 'Недопустимое поле команды');
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || descriptor.get || descriptor.set) fail('INVALID_COMMAND', field + '.' + key, 'Исполняемые и скрытые свойства недопустимы');
      if (array && (!/^(?:0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)) fail('INVALID_COMMAND', field, 'Недопустимый массив команды');
      const child = commandJson(descriptor.value, field + '.' + key, parents, depth + 1);
      if (array) items[Number(key)] = child; else result[key] = child;
    }
    parents.delete(value);
    if (array && items.length !== value.length || array && Object.keys(items).length !== value.length) fail('INVALID_COMMAND', field, 'Разреженный массив команды недопустим');
    return array ? items : result;
  }
  function commandObject(value: unknown, field: string): Record<string, unknown> {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_COMMAND', field, 'Нужен объект команды');
    return value as Record<string, unknown>;
  }
  function keys(value: Record<string, unknown>, allowed: readonly string[], field: string): void {
    for (const name of Object.keys(value)) if (!allowed.includes(name)) fail('INVALID_COMMAND', field + '.' + name, 'Неизвестное поле команды: ' + name);
  }
  function commandId(value: unknown, field: string): Identifier {
    if (!identifier(value) || typeof value === 'string' && (value.length > 500 || ['__proto__','constructor','prototype'].includes(value)))
      fail('INVALID_COMMAND', field, 'Некорректный идентификатор');
    return value;
  }
  function commandText(value: unknown, field: string, required: boolean, max = 4000): string {
    if (typeof value !== 'string' || value.length > max || required && !value.trim()) fail('INVALID_COMMAND', field, 'Проверьте текстовое поле команды');
    return value;
  }
  function commandDate(value: unknown, field: string, empty = false): string {
    if (empty && value === '') return '';
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail('INVALID_COMMAND', field, 'Проверьте дату команды');
    const day = new Date(value + 'T12:00:00Z');
    if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0,10) !== value) fail('INVALID_COMMAND', field, 'Проверьте дату команды');
    return value;
  }
  function commandTime(value:unknown,field:string):string {
    if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?$/.test(value)||+value.slice(11,13)>23||+value.slice(14,16)>59||value.length>16&&value[16]===':'&&+value.slice(17,19)>59||!Number.isFinite(Date.parse(value)))fail('INVALID_COMMAND',field,'Укажите корректные дату и время факта');
    commandDate(value.slice(0,10),field);return value;
  }
  function target(value: unknown, field: string): AssetTarget {
    const row = commandObject(value, field); keys(row, ['section','id'], field);
    if (row.section !== 'vehicles' && row.section !== 'generators') fail('INVALID_COMMAND', field + '.section', 'Выберите транспорт или ДЭС');
    return {section:row.section,id:commandId(row.id,field + '.id')};
  }
  function documentSection(value:unknown,field:string):DocumentSection {
    const sections:readonly string[]=['shiftReports','workOrders','dispatchJobs','fuelMovements','partMovements','fuelWriteoffs','payments','repairs','vehicleTo','toRecords','tankIncomes'];
    if(typeof value!=='string'||!sections.includes(value))fail('INVALID_COMMAND',field,'Выберите поддерживаемый вид документа');
    return value as DocumentSection;
  }
  function reviewFingerprint(value:unknown,field:string):string {
    if(typeof value!=='string'||!/^sha256:[a-f0-9]{64}$/.test(value))fail('INVALID_COMMAND',field,'Нужен отпечаток просмотренного документа');return value;
  }
  function procurementKind(value:unknown,field:string):ProcurementKind {if(value!=='tank'&&value!=='part')fail('INVALID_COMMAND',field,'Выберите топливо или складскую номенклатуру');return value;}
  function procurementReceipt(value:unknown,kind:ProcurementKind,field:string):ProcurementReceiptReference {
    const reference=commandObject(value,field);keys(reference,['section','id'],field);
    if(kind==='part'?reference.section!=='partMovements':reference.section!=='tankIncomes'&&reference.section!=='fuelMovements')fail('INVALID_COMMAND',field+'.section','Вид прихода не соответствует заказу');
    return {section:reference.section as ProcurementReceiptReference['section'],id:commandId(reference.id,field+'.id')};
  }
  function costText(value:unknown,field:string):string {const result=commandText(value,field,true,2000);if(result.trim().length<3)fail('INVALID_COMMAND',field,'Укажите основание от 3 до 2000 знаков');return result;}
  function costAmount(value:unknown,field:string):number {if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>1e12)fail('INVALID_COMMAND',field,'Нужно неотрицательное число до 1 000 000 000 000');return value;}
  function validateCommand(value: unknown): PlatformCommand {
    const row = commandObject(commandJson(value,'command'),'command'); keys(row,['type','version','input'],'command');
    if (row.version !== 1) fail('COMMAND_VERSION', 'command.version', 'Версия команды не поддерживается');
    const input = commandObject(row.input,'command.input'), path = 'command.input.';
    if (row.type === 'IssueFuel') {
      keys(input,['tankId','target','date','qty','reason','legacyOverlapConfirmed'],'command.input');
      if (typeof input.qty !== 'number' || !Number.isFinite(input.qty) || input.qty <= 0) fail('INVALID_COMMAND',path+'qty','Количество топлива должно быть больше нуля');
      const result: IssueFuelInput = {tankId:commandId(input.tankId,path+'tankId'),target:target(input.target,path+'target'),date:commandDate(input.date,path+'date'),qty:input.qty,reason:commandText(input.reason,path+'reason',true)};
      if (input.legacyOverlapConfirmed !== undefined) {
        if (typeof input.legacyOverlapConfirmed !== 'boolean') fail('INVALID_COMMAND',path+'legacyOverlapConfirmed','Нужно явное подтверждение отдельной выдачи');
        result.legacyOverlapConfirmed = input.legacyOverlapConfirmed;
      }
      return {type:'IssueFuel',version:1,input:result};
    }
    if (row.type === 'AcceptShift') {
      keys(input,['shiftId','changes'],'command.input');
      const changes=commandObject(input.changes,path+'changes');
      keys(changes,['acceptedBy','title','date','target','driverId','jobId','odoStart','odoEnd','hours','fuelIssued','tankMeasured','defect','result'],path+'changes');
      const result: AcceptShiftChanges = {acceptedBy:commandText(changes.acceptedBy,path+'changes.acceptedBy',true,200)};
      if (changes.title !== undefined) result.title=commandText(changes.title,path+'changes.title',true,200);
      if (changes.date !== undefined) result.date=commandDate(changes.date,path+'changes.date');
      if (changes.target !== undefined) result.target=target(changes.target,path+'changes.target');
      if (changes.driverId !== undefined) result.driverId=commandId(changes.driverId,path+'changes.driverId');
      if (changes.jobId !== undefined) result.jobId=changes.jobId===null||changes.jobId===''?null:commandId(changes.jobId,path+'changes.jobId');
      for (const field of ['odoStart','odoEnd','hours','fuelIssued','tankMeasured'] as const) if (changes[field] !== undefined) {
        const amount=changes[field];
        if (amount !== null && (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0)) fail('INVALID_COMMAND',path+'changes.'+field,'Нужно неотрицательное число или пустое значение');
        result[field]=amount;
      }
      for (const field of ['defect','result'] as const) if (changes[field] !== undefined) result[field]=commandText(changes[field],path+'changes.'+field,false);
      return {type:'AcceptShift',version:1,input:{shiftId:commandId(input.shiftId,path+'shiftId'),changes:result}};
    }
    if (row.type === 'AssignPerson') {
      keys(input,['assignmentId','driverId','target','from','to','site','org','status','reason','replacesAssignmentId'],'command.input');
      const result: AssignPersonInput = {driverId:commandId(input.driverId,path+'driverId'),target:target(input.target,path+'target'),from:commandDate(input.from,path+'from'),site:commandText(input.site,path+'site',true,200),reason:commandText(input.reason,path+'reason',true)};
      if (input.assignmentId !== undefined) result.assignmentId=commandId(input.assignmentId,path+'assignmentId');
      if (input.replacesAssignmentId !== undefined) result.replacesAssignmentId=commandId(input.replacesAssignmentId,path+'replacesAssignmentId');
      if (input.to !== undefined) result.to=commandDate(input.to,path+'to',true);
      for (const field of ['org','status'] as const) if (input[field] !== undefined) result[field]=commandText(input[field],path+field,false,200);
      if (result.to && result.to < result.from) fail('INVALID_COMMAND',path+'to','Дата окончания раньше начала');
      return {type:'AssignPerson',version:1,input:result};
    }
    if (row.type === 'MergeCatalog') {
      keys(input,['section','sourceId','targetId','reason','mutableRefs','reviewFingerprint'],'command.input');
      const catalogs = ['vehicles','generators','tanks','drivers','parts','contragents','fuelCards'];
      if (typeof input.section !== 'string' || !catalogs.includes(input.section)) fail('INVALID_COMMAND',path+'section','Выберите поддерживаемый справочник');
      if (!Array.isArray(input.mutableRefs) || input.mutableRefs.length > 1000) fail('INVALID_COMMAND',path+'mutableRefs','Проверьте выбранные связи: не более 1000 за одну операцию');
      const mutableRefs: MergeCatalogInput['mutableRefs'] = [], seen = new Set<string>();
      input.mutableRefs.forEach((value,index) => {
        const field=path+'mutableRefs.'+index,ref=commandObject(value,field);keys(ref,['relationId','rowId','path'],field);
        const entry={relationId:commandText(ref.relationId,field+'.relationId',true,200),rowId:commandId(ref.rowId,field+'.rowId'),path:commandText(ref.path,field+'.path',true,500)};
        if(!/^[a-zA-Z][a-zA-Z0-9]*(?:\[\d+\])?(?:\.[a-zA-Z][a-zA-Z0-9]*(?:\[\d+\])?)*$/.test(entry.path))fail('INVALID_COMMAND',field+'.path','Некорректное поле связи');
        const key=JSON.stringify([entry.relationId,typeof entry.rowId,entry.rowId,entry.path]);
        if(seen.has(key))fail('INVALID_COMMAND',field,'Связь выбрана повторно');seen.add(key);mutableRefs.push(entry);
      });
      if(typeof input.reviewFingerprint!=='string'||!/^sha256:[a-f0-9]{64}$/.test(input.reviewFingerprint))fail('INVALID_COMMAND',path+'reviewFingerprint','Проверьте отпечаток просмотренного плана');
      const result:MergeCatalogInput={section:input.section as CatalogSection,sourceId:commandId(input.sourceId,path+'sourceId'),targetId:commandId(input.targetId,path+'targetId'),reason:commandText(input.reason,path+'reason',true),mutableRefs,reviewFingerprint:input.reviewFingerprint};
      if(result.sourceId===result.targetId)fail('INVALID_COMMAND',path+'targetId','Нельзя объединить карточку с самой собой');
      return {type:'MergeCatalog',version:1,input:result};
    }
    if(row.type==='RepairAction'){
      const reason=costText(input.reason,path+'reason'),fingerprint=reviewFingerprint(input.reviewFingerprint,path+'reviewFingerprint');let result:RepairActionInput;
      if(input.action==='saveOrder'){
        keys(input,['action','orderId','payload','reason','reviewFingerprint'],'command.input');
        const p=commandObject(input.payload,path+'payload'),field=path+'payload.';
        keys(p,['title','target','owner','site','org','description','work','cost','actualCost','costIncludesMaterials','contragentId','invoiceNo','primary','downtime','completedAt','result','acceptedBy','source','warrantyUntil','repeatOf'],path+'payload');
        const payload:RepairOrderPayload={title:commandText(p.title,field+'title',true,300),target:target(p.target,field+'target')};
        for(const name of ['owner','site','org','invoiceNo','acceptedBy'] as const)if(p[name]!==undefined)payload[name]=commandText(p[name],field+name,false,300);
        for(const name of ['description','work','result'] as const)if(p[name]!==undefined)payload[name]=commandText(p[name],field+name,false,10000);
        for(const name of ['cost','actualCost'] as const)if(p[name]!==undefined)payload[name]=p[name]===null?null:costAmount(p[name],field+name);
        for(const name of ['contragentId','repeatOf'] as const)if(p[name]!==undefined)payload[name]=commandId(p[name],field+name);
        if(p.costIncludesMaterials!==undefined){if(p.costIncludesMaterials!==null&&typeof p.costIncludesMaterials!=='boolean')fail('INVALID_COMMAND',field+'costIncludesMaterials','Укажите явно, включены ли материалы в стоимость');payload.costIncludesMaterials=p.costIncludesMaterials;}
        if(p.completedAt!==undefined)payload.completedAt=commandTime(p.completedAt,field+'completedAt');
        if(p.warrantyUntil!==undefined)payload.warrantyUntil=commandDate(p.warrantyUntil,field+'warrantyUntil');
        if(p.primary!==undefined){if(p.primary===null)payload.primary=null;else{const primary=commandObject(p.primary,field+'primary');keys(primary,['section','id'],field+'primary');if(!['repairs','vehicleTo','toRecords'].includes(primary.section as string))fail('INVALID_COMMAND',field+'primary.section','Выберите единственный первичный ремонт или ТО');payload.primary={section:primary.section as RepairPrimaryReference['section'],id:commandId(primary.id,field+'primary.id')};}}
        if(p.source!==undefined){const source=commandObject(p.source,field+'source');keys(source,['section','id'],field+'source');if(source.section!=='shiftReports')fail('INVALID_COMMAND',field+'source.section','Укажите исходный дефект смены');payload.source={section:'shiftReports',id:commandId(source.id,field+'source.id')};}
        if(p.downtime!==undefined){const downtime=commandObject(p.downtime,field+'downtime');if(downtime.mode==='interval'){keys(downtime,['mode','from','to'],field+'downtime');const interval:Extract<RepairDowntime,{mode:'interval'}>={mode:'interval',from:commandTime(downtime.from,field+'downtime.from')};if(downtime.to!==undefined){interval.to=commandTime(downtime.to,field+'downtime.to');if(Date.parse(interval.to)<Date.parse(interval.from))fail('INVALID_COMMAND',field+'downtime.to','Конец простоя раньше начала');}payload.downtime=interval;}else if(downtime.mode==='none'){keys(downtime,['mode','basis'],field+'downtime');payload.downtime={mode:'none',basis:costText(downtime.basis,field+'downtime.basis')};}else fail('INVALID_COMMAND',field+'downtime.mode','Укажите фактический простой либо работу без простоя с основанием');}
        result={action:'saveOrder',payload,reason,reviewFingerprint:fingerprint};if(input.orderId!==undefined)result.orderId=commandId(input.orderId,path+'orderId');
      }else{
        keys(input,['action','orderId','reason','reviewFingerprint'],'command.input');if(input.action!=='approve'&&input.action!=='start'&&input.action!=='cancel')fail('INVALID_COMMAND',path+'action','Действие с ремонтным заказом не поддерживается');result={action:input.action,orderId:commandId(input.orderId,path+'orderId'),reason,reviewFingerprint:fingerprint};
      }
      return {type:'RepairAction',version:1,input:result};
    }
    if(row.type==='CostAction'){
      const reason=costText(input.reason,path+'reason'),fingerprint=reviewFingerprint(input.reviewFingerprint,path+'reviewFingerprint');let result:CostActionInput;
      if(input.action==='savePolicy'){
        keys(input,['action','target','payload','reason','reviewFingerprint'],'command.input');
        const reference=commandObject(input.target,path+'target');keys(reference,['section','id'],path+'target');
        if(!['tanks','parts','vehicles','generators'].includes(reference.section as string))fail('INVALID_COMMAND',path+'target.section','Выберите запас или технику');
        const payload=commandObject(input.payload,path+'payload');keys(payload,['from','method','taxBasis','opening','basis'],path+'payload');
        if(payload.method!=='fifo'&&payload.method!=='weightedAverage')fail('INVALID_COMMAND',path+'payload.method','Явно выберите метод оценки');
        if(payload.taxBasis!=='gross'&&payload.taxBasis!=='net')fail('INVALID_COMMAND',path+'payload.taxBasis','Явно выберите налоговую основу стоимости');
        const opening=commandObject(payload.opening,path+'payload.opening');keys(opening,['qty','amount','basis'],path+'payload.opening');
        result={action:'savePolicy',target:{section:reference.section as CostTarget['section'],id:commandId(reference.id,path+'target.id')},payload:{from:commandDate(payload.from,path+'payload.from'),method:payload.method,taxBasis:payload.taxBasis,opening:{qty:costAmount(opening.qty,path+'payload.opening.qty'),amount:opening.amount===null?null:costAmount(opening.amount,path+'payload.opening.amount'),basis:costText(opening.basis,path+'payload.opening.basis')},basis:costText(payload.basis,path+'payload.basis')},reason,reviewFingerprint:fingerprint};
      }else if(input.action==='saveAllocation'){
        keys(input,['action','allocationId','payload','reason','reviewFingerprint'],'command.input');
        const payload=commandObject(input.payload,path+'payload');keys(payload,['source','method','from','to','targets','basis'],path+'payload');
        const source=commandObject(payload.source,path+'payload.source');keys(source,['section','id'],path+'payload.source');
        if(!['payments','repairs','vehicleTo','toRecords','workOrders','costEntries'].includes(source.section as string))fail('INVALID_COMMAND',path+'payload.source.section','Выберите фактический источник расхода');
        if(payload.method!=='manual'&&payload.method!=='km'&&payload.method!=='hours')fail('INVALID_COMMAND',path+'payload.method','Выберите способ распределения');
        if(!Array.isArray(payload.targets)||!payload.targets.length||payload.targets.length>1000)fail('INVALID_COMMAND',path+'payload.targets','Выберите от 1 до 1000 получателей затрат');
        const seen=new Set<string>(),method=payload.method,targets:CostAllocationPayload['targets']=payload.targets.map((value,index)=>{
          const field=path+'payload.targets.'+index,row=commandObject(value,field);keys(row,method==='manual'?['section','id','amount']:['section','id'],field);
          const reference=target({section:row.section,id:row.id},field),key=JSON.stringify([reference.section,reference.id]);if(seen.has(key))fail('INVALID_COMMAND',field,'Получатель выбран повторно');seen.add(key);
          return method==='manual'?{...reference,amount:costAmount(row.amount,field+'.amount')}:reference;
        });
        const from=commandDate(payload.from,path+'payload.from'),to=commandDate(payload.to,path+'payload.to');if(to<from)fail('INVALID_COMMAND',path+'payload.to','Дата окончания раньше начала');
        result={action:'saveAllocation',payload:{source:{section:source.section as CostExpenseSection,id:commandId(source.id,path+'payload.source.id')},method,from,to,targets,basis:costText(payload.basis,path+'payload.basis')},reason,reviewFingerprint:fingerprint};
        if(input.allocationId!==undefined)result.allocationId=commandId(input.allocationId,path+'allocationId');
      }else fail('INVALID_COMMAND',path+'action','Действие с себестоимостью не поддерживается');
      return {type:'CostAction',version:1,input:result};
    }
    if(row.type==='ProcurementAction'){
      const reason=commandText(input.reason,path+'reason',true,2000);if(reason.trim().length<3)fail('INVALID_COMMAND',path+'reason','Укажите основание от 3 до 2000 знаков');
      const fingerprint=reviewFingerprint(input.reviewFingerprint,path+'reviewFingerprint');let result:ProcurementActionInput;
      if(input.action==='saveOrder'){
        keys(input,['action','orderId','payload','reason','reviewFingerprint'],'command.input');const payload=commandObject(input.payload,path+'payload');keys(payload,['kind','itemId','supplier','quantity','deliveryDate','status','note'],path+'payload');
        const kind=procurementKind(payload.kind,path+'payload.kind');
        if(typeof payload.quantity!=='number'||!Number.isFinite(payload.quantity)||payload.quantity<=0||payload.quantity>1000000000000)fail('INVALID_COMMAND',path+'payload.quantity','Укажите положительное количество заказа');
        if(payload.status!=='draft'&&payload.status!=='ordered')fail('INVALID_COMMAND',path+'payload.status','Исполнение заказа вычисляется по проведённым приходам');
        result={action:'saveOrder',payload:{kind,itemId:commandId(payload.itemId,path+'payload.itemId'),supplier:commandText(payload.supplier,path+'payload.supplier',false,300),quantity:payload.quantity,deliveryDate:commandDate(payload.deliveryDate,path+'payload.deliveryDate'),status:payload.status,note:commandText(payload.note,path+'payload.note',false,4000)},reason,reviewFingerprint:fingerprint};
        if(input.orderId!==undefined)result.orderId=commandId(input.orderId,path+'orderId');
      }else{
        const kind=procurementKind(input.kind,path+'kind'),orderId=commandId(input.orderId,path+'orderId');
        if(input.action==='activateLegacy'){
          keys(input,['action','kind','orderId','receiptRefs','reason','reviewFingerprint'],'command.input');
          if(!Array.isArray(input.receiptRefs)||input.receiptRefs.length>1000)fail('INVALID_COMMAND',path+'receiptRefs','Выберите не более 1000 конкретных приходов');
          const seen=new Set<string>(),receiptRefs=input.receiptRefs.map((value,index)=>{const reference=procurementReceipt(value,kind,path+'receiptRefs.'+index),key=JSON.stringify([reference.section,reference.id]);if(seen.has(key))fail('INVALID_COMMAND',path+'receiptRefs.'+index,'Приход выбран повторно');seen.add(key);return reference;});
          result={action:'activateLegacy',kind,orderId,receiptRefs,reason,reviewFingerprint:fingerprint};
        }else if(input.action==='cancelRemaining'){
          keys(input,['action','kind','orderId','reason','reviewFingerprint'],'command.input');result={action:'cancelRemaining',kind,orderId,reason,reviewFingerprint:fingerprint};
        }else if(input.action==='supplierReturn'){
          keys(input,['action','kind','orderId','receipt','qty','date','reason','reviewFingerprint'],'command.input');
          if(typeof input.qty!=='number'||!Number.isFinite(input.qty)||input.qty<=0||input.qty>1000000000000)fail('INVALID_COMMAND',path+'qty','Укажите положительное количество возврата');
          result={action:'supplierReturn',kind,orderId,receipt:procurementReceipt(input.receipt,kind,path+'receipt'),qty:input.qty,date:commandDate(input.date,path+'date'),reason,reviewFingerprint:fingerprint};
        }else return fail('INVALID_COMMAND',path+'action','Неизвестное действие с закупкой');
      }
      return {type:'ProcurementAction',version:1,input:result};
    }
    if(row.type==='FuelAction'){
      const reason=commandText(input.reason,path+'reason',true,2000);
      if(reason.trim().length<3)fail('INVALID_COMMAND',path+'reason','Укажите основание от 3 до 2000 знаков');
      const fingerprint=reviewFingerprint(input.reviewFingerprint,path+'reviewFingerprint');let result:FuelActionInput;
      if(input.action==='measure'){
        keys(input,['action','target','date','observedQty','reason','reviewFingerprint'],'command.input');
        const reference=commandObject(input.target,path+'target');keys(reference,['section','id'],path+'target');
        if(reference.section!=='tanks')fail('INVALID_COMMAND',path+'target.section','Выберите ёмкость для замера');
        if(typeof input.observedQty!=='number'||!Number.isFinite(input.observedQty)||input.observedQty<0||input.observedQty>1000000000000)fail('INVALID_COMMAND',path+'observedQty','Укажите неотрицательный измеренный остаток');
        result={action:'measure',target:{section:'tanks',id:commandId(reference.id,path+'target.id')},date:commandDate(input.date,path+'date'),observedQty:input.observedQty,reason,reviewFingerprint:fingerprint};
      }else if(input.action==='applyDifference'||input.action==='voidMeasurement'){
        keys(input,['action','measurementId','reason','reviewFingerprint'],'command.input');result={action:input.action,measurementId:commandId(input.measurementId,path+'measurementId'),reason,reviewFingerprint:fingerprint};
      }else if(input.action==='reverseLegacyTransfer'){
        keys(input,['action','outId','inId','reason','reviewFingerprint'],'command.input');
        const outId=commandId(input.outId,path+'outId'),inId=commandId(input.inId,path+'inId');
        if(outId===inId)fail('INVALID_COMMAND',path+'inId','Две стороны перемещения должны иметь разные идентификаторы');
        result={action:'reverseLegacyTransfer',outId,inId,reason,reviewFingerprint:fingerprint};
      }else return fail('INVALID_COMMAND',path+'action','Неизвестное действие с топливом');
      return {type:'FuelAction',version:1,input:result};
    }
    if(row.type==='PeriodAction'){
      keys(input,['action','scope','month','reason','reviewFingerprint'],'command.input');
      if(input.action!=='close'&&input.action!=='reopen')fail('INVALID_COMMAND',path+'action','Выберите закрытие или открытие периода');
      if(input.scope!=='fuel'&&input.scope!=='stock'&&input.scope!=='finance')fail('INVALID_COMMAND',path+'scope','Выберите ГСМ, склад запчастей или финансы');
      if(typeof input.month!=='string'||!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(input.month))fail('INVALID_COMMAND',path+'month','Укажите учётный месяц в формате ГГГГ-ММ');
      const reason=commandText(input.reason,path+'reason',true,2000);
      if(reason.trim().length<3)fail('INVALID_COMMAND',path+'reason','Укажите основание от 3 до 2000 знаков');
      const result:PeriodActionInput={action:input.action,scope:input.scope,month:input.month,reason,reviewFingerprint:reviewFingerprint(input.reviewFingerprint,path+'reviewFingerprint')};
      return {type:'PeriodAction',version:1,input:result};
    }
    if(row.type==='DocumentAction'){
      const section=documentSection(input.section,path+'section');let result:DocumentActionInput;
      if(input.action==='saveDraft'){
        keys(input,['action','section','draftId','payload','correctionOf','reason'],'command.input');
        result={action:'saveDraft',section,payload:commandObject(input.payload,path+'payload') as JsonRow};
        if(input.draftId!==undefined)result.draftId=commandId(input.draftId,path+'draftId');
        if(input.reason!==undefined)result.reason=commandText(input.reason,path+'reason',false);
        if(input.correctionOf!==undefined){const reference=commandObject(input.correctionOf,path+'correctionOf');keys(reference,['section','id'],path+'correctionOf');const source=documentSection(reference.section,path+'correctionOf.section');if(source!==section)fail('INVALID_COMMAND',path+'correctionOf.section','Вид исправления должен совпадать с исходным документом');result.correctionOf={section:source,id:commandId(reference.id,path+'correctionOf.id')};}
      }else if(input.action==='postDraft'){
        keys(input,['action','section','draftId','reviewFingerprint'],'command.input');result={action:'postDraft',section,draftId:commandId(input.draftId,path+'draftId'),reviewFingerprint:reviewFingerprint(input.reviewFingerprint,path+'reviewFingerprint')};
      }else if(input.action==='discardDraft'){
        keys(input,['action','section','draftId','reason'],'command.input');result={action:'discardDraft',section,draftId:commandId(input.draftId,path+'draftId'),reason:commandText(input.reason,path+'reason',true)};
      }else if(input.action==='post'){
        keys(input,['action','section','id','reviewFingerprint','reason','payload'],'command.input');result={action:'post',section,id:commandId(input.id,path+'id'),reviewFingerprint:reviewFingerprint(input.reviewFingerprint,path+'reviewFingerprint')};if(input.reason!==undefined)result.reason=commandText(input.reason,path+'reason',false);if(input.payload!==undefined)result.payload=commandObject(input.payload,path+'payload') as JsonRow;
      }else if(input.action==='void'||input.action==='reverse'){
        keys(input,['action','section','id','reviewFingerprint','reason'],'command.input');const id=commandId(input.id,path+'id'),reason=commandText(input.reason,path+'reason',true),fingerprint=reviewFingerprint(input.reviewFingerprint,path+'reviewFingerprint');
        if(input.action==='reverse'){if(section!=='fuelMovements'&&section!=='partMovements')fail('INVALID_COMMAND',path+'section','Сторно доступно для движений топлива и склада');result={action:'reverse',section,id,reason,reviewFingerprint:fingerprint};}
        else result={action:'void',section,id,reason,reviewFingerprint:fingerprint};
      }else if(input.action==='settle'){
        keys(input,['action','section','id','amount','date','reviewFingerprint','reason'],'command.input');if(section!=='payments')fail('INVALID_COMMAND',path+'section','Оплата относится к платёжному документу');
        if(typeof input.amount!=='number'||!Number.isFinite(input.amount)||input.amount<=0)fail('INVALID_COMMAND',path+'amount','Укажите положительную сумму фактической оплаты');
        result={action:'settle',section,id:commandId(input.id,path+'id'),amount:input.amount,date:commandDate(input.date,path+'date'),reason:commandText(input.reason,path+'reason',true),reviewFingerprint:reviewFingerprint(input.reviewFingerprint,path+'reviewFingerprint')};
      }else return fail('INVALID_COMMAND',path+'action','Неизвестное действие с документом');
      return {type:'DocumentAction',version:1,input:result};
    }
    return fail('UNKNOWN_COMMAND','command.type','Неизвестная команда платформы');
  }
  function parseCommandEnvelope(value: unknown, registry: readonly string[]): CommandEnvelope {
    const row=commandObject(commandJson(value,''),''); keys(row,['protocolVersion','databaseToken','operation','base','command'],'');
    if (row.protocolVersion !== 1) fail('COMMAND_VERSION','protocolVersion','Версия протокола команд не поддерживается');
    const operation=commandObject(row.operation,'operation'); keys(operation,['id','digest'],'operation');
    const token=commandText(row.databaseToken,'databaseToken',true,16384);
    return {protocolVersion:1,databaseToken:token,operation:validateOperation(operation),base:validateRevisions(row.base,registry),command:validateCommand(row.command)};
  }
  return Object.freeze({ apiVersion: 1 as const, identifier, validateOperation, validateSections, validateRevisions, parseSectionWrite, validateCommand, parseCommandEnvelope });
}
