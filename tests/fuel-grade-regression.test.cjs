const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const context=vm.createContext({console,window:{},document:{addEventListener(){},documentElement:{removeAttribute(){}},getElementById(){}},localStorage:{getItem(){}}});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../assets/js/01-core.js'),'utf8'),context,{filename:'assets/js/01-core.js'});
const parse=text=>context.parseFuelGrade(text);

test('receipt quantity cannot become an extra octane digit',()=>{
 for(const text of ['Аи-92 30л','Аи-92 28л','Аи-92 30��','Аи-92\u00a030л','АИ-95 40 литров','АИ-100 35л','Бензин 92 30 л','G-Drive95 30л']){
  assert.equal(parse(text),/95/.test(text)?'АИ-95':/100/.test(text)?'АИ-100':'АИ-92',text);
 }
});
test('Latin labels, underscores, spaces and Unicode hyphens keep recognizing existing grades',()=>{
 const cases=[['AI 95','АИ-95'],['AI_95','АИ-95'],['AИ-95','АИ-95'],['АI 95','АИ-95'],['АИ_95','АИ-95'],['А И 95','АИ-95'],['АИ - 95','АИ-95'],['АИ\u00a0—\u00a095','АИ-95'],['АИ‑95','АИ-95'],['АИ−100','АИ-100'],['АИ－98','АИ-98'],['G-Drive95','АИ-95'],['Ultimate 98','АИ-98'],['Бензин 100 Евро','АИ-100']];
 for(const [text,expected]of cases)assert.equal(parse(text),expected,text);
});
test('diesel and gas aliases retain previous behavior',()=>{
 const cases=[['ДТ-Л-К5','ДТ'],['ДТ—Л—К5','ДТ'],['Дизельное топливо','ДТ'],['DT','ДТ'],['Д Т','ДТ'],['Газ','Газ'],['ГБО','Газ'],['Пропан-бутан','Газ'],['Метан','Газ'],['СУГ','Газ']];
 for(const [text,expected]of cases)assert.equal(parse(text),expected,text);
});
test('legacy two and three digit grade tokens are preserved without silently reclassifying stored stock',()=>{
 for(const text of ['АИ-923','АИ-922','АИ-80','АИ-91','AI 123'])assert.equal(parse(text),'АИ-'+text.match(/\d+/)[0],text);
 const vehicle={id:'v',fuel:'gasoline',fuelGrade:'АИ-923'},record={vehicleId:'v',fuelGrade:'АИ-922'};
 assert.equal(context.vehicleFuelGrade(vehicle),'АИ-923');assert.equal(context.recordFuelGrade(record,vehicle),'АИ-922');
});
test('long numeric strings do not parse as truncated fuel grades',()=>{
 for(const text of ['АИ-9230','АИ-9530','АИ-1000','АИ-1234','AI 10030','Бензин 950','G-Drive950','192','1000'])assert.equal(parse(text),'',text);
 for(const text of [null,undefined,'','не указано','масло 5W-30'])assert.equal(parse(text),'',String(text));
});
