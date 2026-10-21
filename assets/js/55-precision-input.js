// UI decimal boundary. Stored legacy facts are preserved while their field is untouched.
function precisionParse(value,options={}) {
  return DecimalCore.parseInput(value,{scale:options.scale??3,blank:options.blank??'null',nonNegative:options.nonNegative??true,max:options.max??1e12});
}
function precisionRemember(container) {
  if(!container)return;
  container.querySelectorAll('input,textarea').forEach(input=>{input._precisionInitial=input.value;});
}
function precisionInput(id,options={}) {
  const input=typeof id==='string'?document.getElementById(id):id;
  if(!input)throw Error('Числовое поле не найдено');
  if(Object.hasOwn(options,'previous')&&(options.previous!==undefined||input._precisionInitial==='')&&input._precisionInitial!==undefined&&input.value===input._precisionInitial&&!input.validity?.badInput)return options.previous;
  try {
    if(input.validity?.badInput)throw Error('Незавершённый ввод числа');
    return precisionParse(input.value,options);
  } catch(cause) {
    const error=Error(cause.code==='PRECISION'?'Допустимо знаков после запятой: '+(options.scale??3):cause.code==='RANGE'?'Число вне допустимого диапазона':cause.code==='BLANK'?'Заполните числовое поле':'Введите полное неотрицательное число');
    error.code=cause.code||'INVALID_DECIMAL';error.fieldId=input.id;throw error;
  }
}
function precisionRead(map,previous) {
  try{return Object.fromEntries(Object.entries(map).map(([key,[id,scale=3,blank='null']])=>[key,precisionInput(id,{scale,blank,...(previous?{previous:previous[key]}:{})})]));}
  catch(error){showFieldError(error.message,error.fieldId);return null;}
}
function precisionRound(value,scale=2) {
  return DecimalCore.toNumberExact(DecimalCore.quantize(value,{scale,rounding:'half-away-from-zero'}));
}
function precisionFormat(value,options={}) {
  if(value==null||value==='')return options.blank??'—';
  try{
    const text=options.scale==null?DecimalCore.parse(value):DecimalCore.quantize(value,{scale:options.scale,rounding:'half-away-from-zero'});
    const fraction=(text.split('.')[1]||'').length,scale=Math.max(fraction,options.minimumScale||0);
    return DecimalCore.format(text,{scale,decimalSeparator:',',groupSeparator:' '});
  }catch{return 'Ошибка числа';}
}
