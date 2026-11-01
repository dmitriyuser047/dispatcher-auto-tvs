'use strict';
document.querySelector('[data-web-logout]')?.addEventListener('submit',async event=>{
  event.preventDefault();const button=event.target.querySelector('button');button.disabled=true;
  try{const response=await fetch('/web-api/logout',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-CSRF-Token':document.querySelector('meta[name="tvs-csrf"]').content},body:'{}'});if(!response.ok)throw Error();location.assign('/login');}
  catch{button.disabled=false;button.textContent='Повторить выход';}
});
