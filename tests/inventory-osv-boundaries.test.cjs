'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),api=require('../assets/core/asset-inventory-excel.js');
const options={format:'osv',defaultOrgName:'Synthetic org',defaultObjectName:'Synthetic object'},decode=rows=>api.decode({name:'Synthetic OSV.xlsx',sheets:[{name:'OSV',rows}]},options);

test('ordinary adjacent opening, turnover and closing headings have independent debit columns',()=>{
 const result=decode([
  ['Счёт','','Сальдо на начало периода','','Обороты за период','','Сальдо на конец периода'],
  ['Наименование','Код','Дебет','Кредит','Дебет','Кредит','Дебет','Кредит'],
  ['01'],['МОЛ Иванов'],['Synthetic item','000007',100,null,20,30,90]
 ]);
 assert.equal(result.canImport,true,JSON.stringify(result.issues));assert.equal(result.data.inventoryItems.length,1);assert.equal(result.data.inventoryItems[0].cost,90);
});

test('account changes in second-column BU layout do not become inventory items or retain the previous MOL',()=>{
 const result=decode([
  ['08.04.1','БУ'],['МОЛ Первый','БУ'],['First item','БУ','','','','',100],['','Кол.','','','','',1],
  ['10.06','БУ'],['Second item','БУ','','','','',200],['','Кол.','','','','',2]
 ]);
 assert.equal(result.canImport,true,JSON.stringify(result.issues));assert.deepEqual(result.data.inventoryItems.map(r=>[r.name,r.qty,r.cost]),[['First item',1,100],['Second item',2,200]]);
 assert.deepEqual(result.data.inventoryMols.map(r=>[r.accountCode,r.name]),[['08.04.1','Первый'],['10.06','МОЛ не указан в файле']]);
});

test('a total quantity following its BU total never supplies the last item missing its own quantity',()=>{
 const result=decode([
  ['МЦ.04','','БУ'],['МОЛ Первый','','БУ'],['Known item','A','БУ','','','','',100],['','','Кол.','','','','',1],
  ['Unknown quantity item','B','БУ','','','','',200],['Итого','','БУ','','','','',300],['','','Кол.','','','','',99]
 ]);
 assert.equal(result.canImport,true,JSON.stringify(result.issues));assert.deepEqual(result.data.inventoryItems.map(r=>[r.name,r.qty]),[['Known item',1],['Unknown quantity item',null]]);
});

test('genuinely ambiguous debit columns within one balance group remain blocked',()=>{
 const result=decode([
  ['Сальдо на конец периода'],['Дебет','Дебет'],['МЦ.04','','БУ'],['МОЛ A','','БУ'],['Item','A','БУ','','','','',3],['','','Кол.','','','','',1]
 ]);
 assert.equal(result.canImport,false);assert.ok(result.issues.some(r=>r.code==='EXCEL_BALANCE_HEADER'));
});

test('1C unit symbols are retained instead of the neighbouring OKEI code or a merged unit heading',()=>{
 const result=decode([
  ['Счёт','','Единица измерения','','Показатели','Сальдо на начало периода','','Обороты за период','','Сальдо на конец периода'],
  ['Наименование','Код','Код','Условное обозначение','','Дебет','Кредит','Дебет','Кредит','Дебет','Кредит'],
  ['10','','','','БУ'],['МОЛ A','','','','БУ'],
  ['Cable','000007',6,'м','БУ',null,null,null,null,10],['','','','','Кол.',null,null,null,null,2]
 ]);
 assert.equal(result.canImport,true,JSON.stringify(result.issues));assert.deepEqual(result.data.inventoryItems.map(r=>[r.code,r.unit,r.qty,r.cost]),[['000007','м',2,10]]);
});

test('source negative balances remain blocked with exact source coordinates and are never turned positive',()=>{
 const rows=[['МЦ.04','','БУ'],['Negative item','000007','БУ','','','','',-41538],['','','Кол.','','','','',-0.129]],before=JSON.stringify(rows),result=decode(rows);
 assert.equal(result.canImport,false);assert.equal(JSON.stringify(rows),before);assert.deepEqual(result.issues.map(r=>[r.code,r.row,r.column]),[['EXCEL_NUMBER',2,8],['EXCEL_NUMBER',3,8]]);assert.ok(result.issues.every(r=>/отрицательный учётный остаток/.test(r.message)));
});
