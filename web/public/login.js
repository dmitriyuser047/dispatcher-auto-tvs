'use strict';
document.getElementById('webLoginForm')?.addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button');
  const error = document.getElementById('webLoginError');
  button.disabled = true;
  error.textContent = '';
  try {
    const response = await fetch('/web-api/login', {method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:form.elements.token.value})});
    const result = await response.json();
    if (!response.ok || !result.ok) throw Error(result.error || 'Не удалось войти');
    form.elements.token.value = '';
    const next = new URLSearchParams(location.search).get('next');
    const target = next && next.startsWith('/') && !next.startsWith('//') && !next.includes('\\') ? next : '/objects';
    location.assign(target);
  } catch (failure) {
    error.textContent = failure.message || 'Сервер недоступен';
    button.disabled = false;
  }
});
document.querySelector('[data-demo-login]')?.addEventListener('click',async event=>{
  event.currentTarget.disabled=true;
  try{
    const response=await fetch('/web-api/demo-login',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:'{}'});
    const result=await response.json();
    if(!response.ok||!result.ok)throw Error(result.error||'Тестовая база недоступна');
    location.assign('/objects');
  }catch(error){
    document.getElementById('webLoginError').textContent=error.message;
    event.currentTarget.disabled=false;
  }
});
