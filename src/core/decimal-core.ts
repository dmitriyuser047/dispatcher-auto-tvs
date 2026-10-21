export type DecimalValue = number|string;
export interface DecimalConstraints {scale?:number;max?:DecimalValue;nonNegative?:boolean}
export interface QuantizeOptions {scale:number;rounding:'half-away-from-zero'}
export interface DecimalFormatOptions {scale?:number;decimalSeparator?:'.'|',';groupSeparator?:string}
export interface DecimalInputOptions extends DecimalConstraints {blank:'null'|'zero'|'error';scale:number}
export interface DecimalCoreAPI {
  readonly apiVersion:1;
  parse(value:unknown,options?:DecimalConstraints):string;
  quantize(value:unknown,options:QuantizeOptions):string;
  add(a:unknown,b:unknown):string;sub(a:unknown,b:unknown):string;mul(a:unknown,b:unknown):string;
  div(a:unknown,b:unknown,options:QuantizeOptions):string;
  sum(values:readonly unknown[]):string;compare(a:unknown,b:unknown):-1|0|1;
  toNumberExact(value:unknown):number;
  format(value:unknown,options?:DecimalFormatOptions):string;
  parseInput(value:unknown,options:DecimalInputOptions):number|null;
}
interface Parts {coefficient:bigint;scale:number}
interface DecimalError extends Error {code:string;status:number}

/** Exact base-ten arithmetic. BigInts never cross the public JSON boundary. */
export function createDecimalCore():DecimalCoreAPI {
  const LIMIT=1000, own=(value:object,key:PropertyKey):boolean=>Object.prototype.hasOwnProperty.call(value,key);
  function fail(code:string,message:string):never {const error=new Error(message) as DecimalError;error.name='DecimalError';error.code=code;error.status=400;throw error;}
  function object(value:unknown,allowed:readonly string[]):Record<string,unknown> {
    if(value===null||typeof value!=='object'||Array.isArray(value))fail('INVALID_DECIMAL','Нужны параметры десятичного числа');
    const prototype:unknown=Object.getPrototypeOf(value);
    if(!(prototype===null||typeof prototype==='object'&&prototype!==null&&Object.getPrototypeOf(prototype)===null))fail('INVALID_DECIMAL','Недопустимые параметры числа');
    for(const key of Reflect.ownKeys(value)){
      if(typeof key!=='string'||!allowed.includes(key))fail('INVALID_DECIMAL','Неизвестный параметр числа');
      const descriptor=Object.getOwnPropertyDescriptor(value,key);
      if(!descriptor?.enumerable||descriptor.get||descriptor.set)fail('INVALID_DECIMAL','Исполняемые параметры числа недопустимы');
    }
    return value as Record<string,unknown>;
  }
  function scale(value:unknown):number {if(typeof value!=='number'||!Number.isInteger(value)||value<0||value>LIMIT)fail('RANGE','Недопустимое число десятичных знаков');return value;}
  function power(value:number):bigint {if(value<0||value>LIMIT*2)fail('RANGE','Слишком большая точность числа');return 10n**BigInt(value);}
  function normalize(value:Parts):Parts {
    let {coefficient,scale:places}=value;if(coefficient===0n)return {coefficient:0n,scale:0};
    while(places>0&&coefficient%10n===0n){coefficient/=10n;places--;}
    if(places>LIMIT||coefficient.toString().replace('-','').length>LIMIT)fail('RANGE','Число выходит за пределы десятичного расчёта');
    return {coefficient,scale:places};
  }
  function read(value: unknown):Parts {
    if(typeof value!=='string'&&typeof value!=='number'||typeof value==='number'&&!Number.isFinite(value))fail('INVALID_DECIMAL','Укажите конечное десятичное число');
    const text=typeof value==='number'?String(value):value.trim();
    if(!text||text.length>LIMIT+30)fail('INVALID_DECIMAL','Некорректная длина числа');
    const match=/^([+-]?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(text);
    if(!match)fail('INVALID_DECIMAL','Укажите число целиком, без посторонних символов');
    const integer=match[2]!,fraction=match[3]||'',exponent=Number(match[4]||0);
    if(!Number.isSafeInteger(exponent)||Math.abs(exponent)>LIMIT)fail('RANGE','Слишком большой порядок числа');
    let places=fraction.length-exponent,coefficient=BigInt((match[1]==='-'?'-':'')+integer+fraction);
    if(places<0){coefficient*=power(-places);places=0;}
    return normalize({coefficient,scale:places});
  }
  function write(value:Parts):string {
    const normalized=normalize(value),negative=normalized.coefficient<0n;
    let digits=(negative?-normalized.coefficient:normalized.coefficient).toString();
    if(normalized.scale){digits=digits.padStart(normalized.scale+1,'0');digits=digits.slice(0,-normalized.scale)+'.'+digits.slice(-normalized.scale);}
    return (negative?'-':'')+digits;
  }
  function align(a:Parts,b:Parts):[bigint,bigint,number] {const places=Math.max(a.scale,b.scale);return [a.coefficient*power(places-a.scale),b.coefficient*power(places-b.scale),places];}
  function compare(a:unknown,b:unknown):-1|0|1 {const [left,right]=align(read(a),read(b));return left<right?-1:left>right?1:0;}
  function parse(value:unknown,options:DecimalConstraints={}):string {
    const constraints=object(options,['scale','max','nonNegative']),parts=read(value),result=write(parts);
    if(own(constraints,'scale')&&parts.scale>scale(constraints.scale))fail('PRECISION','Значение содержит лишние десятичные знаки');
    if(own(constraints,'nonNegative')&&typeof constraints.nonNegative!=='boolean')fail('INVALID_DECIMAL','Некорректное ограничение знака');
    if(constraints.nonNegative===true&&parts.coefficient<0n)fail('RANGE','Значение должно быть неотрицательным');
    if(own(constraints,'max')){const maximum=read(constraints.max);if(maximum.coefficient<0n||compare(write({coefficient:parts.coefficient<0n?-parts.coefficient:parts.coefficient,scale:parts.scale}),write(maximum))>0)fail('RANGE','Значение превышает допустимый предел');}
    return result;
  }
  function quantizeOptions(value:unknown):number {const options=object(value,['scale','rounding']);if(options.rounding!=='half-away-from-zero')fail('INVALID_DECIMAL','Неизвестное правило округления');return scale(options.scale);}
  function roundedQuotient(numerator:bigint,denominator:bigint):bigint {
    if(denominator===0n)fail('DIVISION_BY_ZERO','Деление на ноль');
    if(denominator<0n){denominator=-denominator;numerator=-numerator;}
    const result=numerator/denominator,remainder=numerator%denominator;
    return (remainder<0n?-remainder:remainder)*2n>=denominator?result+(numerator<0n?-1n:1n):result;
  }
  function quantize(value:unknown,options:QuantizeOptions):string {
    const target=quantizeOptions(options),parts=read(value);
    return parts.scale<=target?write(parts):write({coefficient:roundedQuotient(parts.coefficient,power(parts.scale-target)),scale:target});
  }
  function add(a:unknown,b:unknown):string {const [left,right,places]=align(read(a),read(b));return write({coefficient:left+right,scale:places});}
  function sub(a:unknown,b:unknown):string {const [left,right,places]=align(read(a),read(b));return write({coefficient:left-right,scale:places});}
  function mul(a:unknown,b:unknown):string {const left=read(a),right=read(b);return write({coefficient:left.coefficient*right.coefficient,scale:left.scale+right.scale});}
  function div(a:unknown,b:unknown,options:QuantizeOptions):string {
    const target=quantizeOptions(options),left=read(a),right=read(b),shift=target+right.scale-left.scale;
    const numerator=left.coefficient*(shift>=0?power(shift):1n),denominator=right.coefficient*(shift<0?power(-shift):1n);
    return write({coefficient:roundedQuotient(numerator,denominator),scale:target});
  }
  function sum(values:readonly unknown[]):string {
    if(!Array.isArray(values)||values.length>1000000)fail('RANGE','Недопустимый список слагаемых');
    let total='0';for(let index=0;index<values.length;index++){const descriptor=Object.getOwnPropertyDescriptor(values,String(index));if(!descriptor||descriptor.get||descriptor.set)fail('INVALID_DECIMAL','Недопустимое слагаемое');total=add(total,descriptor.value);}return total;
  }
  function toNumberExact(value:unknown):number {
    const canonical=parse(value),result=Number(canonical);
    if(!Number.isFinite(result)||write(read(result))!==canonical)fail('RANGE','Число нельзя передать без потери точности');
    return result;
  }
  function format(value:unknown,options:DecimalFormatOptions={}):string {
    const settings=object(options,['scale','decimalSeparator','groupSeparator']),parts=read(value);
    const places=own(settings,'scale')?scale(settings.scale):parts.scale;
    if(places<parts.scale)fail('PRECISION','Сначала явно округлите значение');
    const separator=settings.decimalSeparator??'.',group=settings.groupSeparator??'';
    if(separator!=='.'&&separator!==','||typeof group!=='string'||!['',' ','\u00a0','\u202f'].includes(group))fail('INVALID_DECIMAL','Недопустимый разделитель числа');
    const canonical=write(parts),split=canonical.split('.'),integer=split[0]!,fraction=(split[1]||'').padEnd(places,'0');
    return integer.replace(/\B(?=(\d{3})+(?!\d))/g,group)+(places?separator+fraction:'');
  }
  function parseInput(value:unknown,options:DecimalInputOptions):number|null {
    const settings=object(options,['blank','scale','max','nonNegative']);scale(settings.scale);
    if(!['null','zero','error'].includes(settings.blank as string))fail('INVALID_DECIMAL','Укажите правило пустого поля');
    if(value===null||value===undefined||typeof value==='string'&&!value.trim()){
      if(settings.blank==='null')return null;if(settings.blank==='zero')return 0;fail('BLANK','Заполните числовое поле');
    }
    let input:unknown=value;
    if(typeof value==='string'){
      const text=value.trim(),match=/^([+-]?)([\d \u00a0\u202f]+)(?:([.,])(\d+))?$/.exec(text);
      if(!match)fail('INVALID_DECIMAL','Укажите число целиком');
      const integer=match[2]!;
      if(!/^\d+$/.test(integer)&&!/^\d{1,3}([ \u00a0\u202f])\d{3}(?:\1\d{3})*$/.test(integer))fail('INVALID_DECIMAL','Некорректная группировка цифр');
      input=match[1]+integer.replace(/[ \u00a0\u202f]/g,'')+(match[4]?'.'+match[4]:'');
    }
    const constraints:DecimalConstraints={scale:settings.scale as number};
    if(own(settings,'max'))constraints.max=settings.max as DecimalValue;
    if(own(settings,'nonNegative'))constraints.nonNegative=settings.nonNegative as boolean;
    return toNumberExact(parse(input,constraints));
  }
  return Object.freeze({apiVersion:1 as const,parse,quantize,add,sub,mul,div,sum,compare,toNumberExact,format,parseInput});
}
