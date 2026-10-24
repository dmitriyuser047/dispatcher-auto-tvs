export type PersonnelKind='driver'|'operator';
interface PersonnelRow {personnelRoles?:unknown}

/** Directory role facts shared by historical planning and workflow validation. */
export function createPersonnelKinds(){
 const kinds:readonly PersonnelKind[]=Object.freeze(['driver','operator']);
 const object=(value:unknown):value is PersonnelRow=>value!==null&&typeof value==='object'&&!Array.isArray(value);
 function rolesOf(value:unknown):PersonnelKind[]{
  if(!object(value))return [];
  // Legacy entries are drivers; interpreting them does not rewrite the source.
  if(!Object.prototype.hasOwnProperty.call(value,'personnelRoles'))return ['driver'];
  if(!Array.isArray(value.personnelRoles))return [];
  const roles=value.personnelRoles;return kinds.filter(kind=>roles.includes(kind));
 }
 function kindForAsset(value:unknown):PersonnelKind|null {
  if(typeof value!=='string')return null;
  if(/^v:.+$/.test(value))return 'driver';if(/^g:.+$/.test(value))return 'operator';return null;
 }
 function matchesRole(value:unknown,kind:unknown):boolean{return kinds.includes(kind as PersonnelKind)&&rolesOf(value).includes(kind as PersonnelKind);}
 return Object.freeze({apiVersion:1 as const,rolesOf,kindForAsset,matchesRole});
}
export type PersonnelKindsAPI=ReturnType<typeof createPersonnelKinds>;
