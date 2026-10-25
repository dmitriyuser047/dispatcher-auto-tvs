'use strict';
// Real source-byte boundary, no databases, profile files or import interpretation.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {bytesOf}=require('../electron/import-source.cjs').inventorySupport;
const LIMIT=25*1024*1024;
const read=base64=>bytesOf({name:'source.json',base64});
const rejects=(encoded,code='IMPORT_FILE')=>assert.throws(()=>read(encoded),error=>error.code===code&&!(error instanceof RangeError));

test('a real four-megabyte source roundtrips every original byte without overflowing the regexp stack',()=>{
 const original=Buffer.alloc(4_059_111);for(let index=0;index<original.length;index++)original[index]=(index*131+17)&255;
 const encoded=original.toString('base64'),result=bytesOf({name:'source-folder/prepared-import.json',base64:encoded});
 assert.equal(result.name,'prepared-import.json');assert.equal(result.bytes.length,original.length);assert.deepEqual(result.bytes,original);
});

test('large malformed sources reject illegal alphabet, embedded padding and truncated groups before permissive Buffer decoding',()=>{
 const body='A'.repeat(5_412_148);
 for(const encoded of [body.slice(0,-1)+'*',body.slice(0,-1)+'_',body.slice(0,-1)+'-',body.slice(0,-1)+'\n',body.slice(0,-1)+'\u00a0',body.slice(0,-1)+'é',body.slice(0,-4)+'A===',body.slice(0,-4)+'AA=A',body.slice(0,-8)+'AA==AAAA',body.slice(0,-1),body.slice(0,-2),body.slice(0,-3)])rejects(encoded);
});

test('the original base64 grammar retains its three legal terminal shapes and rejects malformed padding',()=>{
 for(const [encoded,expected]of [['AAAA',[0,0,0]],['AA==',[0]],['AAA=',[0,0]],['AB==',[0]],['AAB=',[0,0]],['////',[255,255,255]],['++++',[251,239,190]]])assert.deepEqual([...read(encoded).bytes],expected);
 for(const encoded of ['A','AA','AAA','A===','====','AAA==','AAAA=','AAAA==','AA=A','=AAA','AAA\r','AA==\n','AA==AAAA','A A=','AA-_'])rejects(encoded);
 rejects('','IMPORT_LIMIT');
});

test('the exact 25 MiB byte ceiling accepts the boundary and rejects both oversized decoded and encoded inputs',()=>{
 const encoded=Buffer.alloc(LIMIT,0xa5).toString('base64'),result=read(encoded);assert.equal(result.bytes.length,LIMIT);assert.equal(result.bytes[0],0xa5);assert.equal(result.bytes.at(-1),0xa5);
 // LIMIT and LIMIT+1 share their encoded length: checking base64 length alone
 // must never let an oversized decoded source cross the existing byte limit.
 const decodedOverflow=Buffer.alloc(LIMIT+1,0x5a).toString('base64');assert.equal(decodedOverflow.length,encoded.length);rejects(decodedOverflow,'IMPORT_LIMIT');
 rejects('A'.repeat(encoded.length+4),'IMPORT_FILE');
});
