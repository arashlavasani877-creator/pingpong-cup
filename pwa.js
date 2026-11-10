/* Native install prompt only. Browser approval cannot be bypassed. */
(() => {
 const buttons=[document.getElementById('installApp'),document.getElementById('installAppMenu')].filter(Boolean);
 const help=document.getElementById('installHelp');
 const helpText=document.getElementById('installHelpText');
 const close=document.getElementById('closeInstallHelp');
 let promptEvent=null;
 const installed=()=>window.matchMedia('(display-mode: standalone)').matches || navigator.standalone===true;
 function refresh(){buttons.forEach(b=>b.classList.toggle('hidden',installed()));}
 window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();promptEvent=event;refresh();});
 window.addEventListener('appinstalled',()=>{promptEvent=null;refresh();help.classList.add('hidden');});
 buttons.forEach(b=>b.addEventListener('click',async()=>{
  if(installed())return;
  if(promptEvent){
   const event=promptEvent;promptEvent=null;
   try{await event.prompt();await event.userChoice;}catch(err){console.warn('Install not accepted:',err)}
  }else{
   helpText.textContent='نصب مستقیم هنوز توسط این مرورگر در دسترس قرار نگرفته است. لطفاً پس از آماده‌شدن شرایط نصب دوباره تلاش کنید.';
   help.classList.remove('hidden');
  }
 }));
 close.addEventListener('click',()=>help.classList.add('hidden'));
 refresh();
 if('serviceWorker' in navigator&&location.protocol==='https:'){
  window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js',{scope:'./'}).catch(error=>console.warn('Service worker:',error)));
 }
})();
