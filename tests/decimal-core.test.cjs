'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const decimal=require('../assets/core/decimal-core.js'),round={scale:3,rounding:'half-away-from-zero'};
const code=value=>error=>error?.name==='DecimalError'&&error.code===value;

test('decimal source facts parse exactly without invoking coercion hooks or implicit rounding',()=>{
  for(const [input,expected]of [[923.537,'923.537'],['000923.53700','923.537'],['-0.000','0'],[1e-7,'0.0000001'],['1.230e+3','1230'],[Number.MIN_VALUE,'0.'+'0'.repeat(323)+'5']])assert.equal(decimal.parse(input),expected);
  for(const input of [null,undefined,true,[],{},NaN,Infinity,'','1,2','12 litres','.5','1.','1e','1e10000000'])assert.throws(()=>decimal.parse(input));
  let called=0;assert.throws(()=>decimal.parse({toString(){called++;return '1';}}),code('INVALID_DECIMAL'));assert.equal(called,0);
  assert.equal(decimal.parse('1.2300',{scale:2}),'1.23');assert.throws(()=>decimal.parse('1.2301',{scale:3}),code('PRECISION'));
  assert.throws(()=>decimal.parse(-1,{nonNegative:true}),code('RANGE'));assert.throws(()=>decimal.parse('-1.1',{max:1}),code('RANGE'));
  assert.throws(()=>decimal.parse(1,{get scale(){throw Error('executed');}}),code('INVALID_DECIMAL'));
});

test('half away from zero is symmetric for signed halves and never emits negative zero',()=>{
  assert.equal(decimal.quantize('1.2345',round),'1.235');assert.equal(decimal.quantize('-1.2345',round),'-1.235');
  assert.equal(decimal.add(decimal.quantize('1.2345',round),decimal.quantize('-1.2345',round)),'0');
  assert.equal(decimal.quantize('-0.0004',round),'0');assert.equal(decimal.quantize('-0.0005',round),'-0.001');
  for(let value=-1000;value<=1000;value++){
    const text=decimal.div(value,10000,{scale:4,rounding:'half-away-from-zero'}),opposite=decimal.sub(0,text);
    assert.equal(decimal.add(decimal.quantize(text,round),decimal.quantize(opposite,round)),'0');
    assert.equal(decimal.quantize(decimal.quantize(text,round),round),decimal.quantize(text,round));
  }
});

test('addition multiplication and explicit division preserve decimal quantities and monetary products',()=>{
  assert.equal(decimal.add('.1'.replace('.','0.'),'0.2'),'0.3');assert.equal(decimal.sub(923.537,.537),'923');
  assert.equal(decimal.sum(Array(1000).fill(.001)),'1');assert.equal(decimal.mul(1.5,.67),'1.005');
  const cents={scale:2,rounding:'half-away-from-zero'};assert.equal(decimal.quantize(decimal.mul(1.5,.67),cents),'1.01');assert.equal(decimal.quantize(decimal.mul(1.005,1),cents),'1.01');
  assert.equal(decimal.div(1,3,{scale:6,rounding:'half-away-from-zero'}),'0.333333');assert.equal(decimal.div(-1,8,cents),'-0.13');
  assert.equal(decimal.compare('1.000',1),0);assert.equal(decimal.compare('-0.001',0),-1);
  assert.throws(()=>decimal.div(1,0,cents),code('DIVISION_BY_ZERO'));assert.throws(()=>decimal.div(1,3,{scale:2}),code('INVALID_DECIMAL'));
  assert.throws(()=>decimal.sum(new Array(1)),code('INVALID_DECIMAL'));
});

test('numeric DTO conversion proves the decimal round trip, including the unsafe scaled boundary',()=>{
  assert.equal(decimal.toNumberExact('923.537'),923.537);assert.equal(decimal.toNumberExact('0.001'),.001);
  assert.throws(()=>decimal.toNumberExact('9007199254740.991'),code('RANGE'));
  assert.throws(()=>decimal.toNumberExact('9007199254740993'),code('RANGE'));
  assert.throws(()=>decimal.toNumberExact(decimal.add(1e308,1e308)),code('RANGE'));
  assert.throws(()=>decimal.toNumberExact('1e-1000'),code('RANGE'));
  assert.equal(typeof JSON.parse(JSON.stringify({amount:decimal.add('0.1','0.2')})).amount,'string');
});

test('localized full-token input separates blanks and zero and rejects partial strings and tiny values',()=>{
  const options={scale:3,blank:'null',nonNegative:true};
  for(const [value,expected]of [['923,537',923.537],['1 923,537',1923.537],['1\u00a0923.537',1923.537],['1\u202f923,537',1923.537],['0',0],[0,0],['',null],['  ',null],[null,null]])assert.equal(decimal.parseInput(value,options),expected);
  assert.equal(decimal.parseInput('',{scale:2,blank:'zero'}),0);assert.throws(()=>decimal.parseInput('',{scale:2,blank:'error'}),code('BLANK'));
  for(const value of ['12 litres','1 23,456','1,234.56','1.234,56','1 234\u00a0567','1e3','0.0001',Number.MIN_VALUE,true])assert.throws(()=>decimal.parseInput(value,options));
  assert.throws(()=>decimal.parseInput('1,001',{scale:2,blank:'error'}),code('PRECISION'));
  assert.equal(decimal.format('923.537',{decimalSeparator:','}),'923,537');assert.equal(decimal.format('1923.5',{scale:3,decimalSeparator:',',groupSeparator:' '}),'1 923,500');
  assert.throws(()=>decimal.format('1.005',{scale:2}),code('PRECISION'));
});

test('browser UMD matches CommonJS with no browser or filesystem globals',()=>{
  const context=vm.createContext({});vm.runInContext(fs.readFileSync(path.join(__dirname,'../assets/core/decimal-core.js'),'utf8'),context);
  assert.ok(Object.isFrozen(context.DecimalCore));assert.deepEqual(Object.keys(context),['DecimalCore']);
  assert.equal(context.DecimalCore.quantize('-1.2345',round),decimal.quantize('-1.2345',round));
  assert.equal(context.DecimalCore.parseInput('923,537',{scale:3,blank:'error'}),923.537);
});
