/* Optional installation flow; does not change authentication or results. */
(() => {
 const button=document.getElementById('installApp');
 const help=document.getElementById('installHelp');
 const helpText=document.getElementById('installHelpText');
 const close=document.getElementById('closeInstallHelp');
 if(!button||!help||!helpText||!close)return;
 let deferredPrompt=null;
 const standalone=()=>window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
 const hideIfInstalled=()=>{if(standalone())button.classList.add('hidden');};
 hideIfInstalled();
 window.addEventListener('beforeinstallprompt',event=>{
   event.preventDefault();
   deferredPrompt=event;
   hideIfInstalled();
 });
 window.addEventListener('appinstalled',()=>{deferredPrompt=null;button.classList.add('hidden');help.classList.add('hidden');});
 close.addEventListener('click',()=>help.classList.add('hidden'));
 button.addEventListener('click',async()=>{
   if(standalone()){button.classList.add('hidden');return}
   if(deferredPrompt){
      const promptEvent=deferredPrompt;deferredPrompt=null;
      promptEvent.prompt();
      try{await promptEvent.userChoice;}catch(err){console.debug('Install prompt outcome:',err)}
      return;
   }
   const isIOS=/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
   const isAndroid=/Android/i.test(navigator.userAgent);
   helpText.textContent=isIOS
      ? 'آیفون و آیپد: سایت را با Safari باز کنید، روی Share (اشتراک‌گذاری) بزنید و Add to Home Screen (افزودن به صفحه اصلی) را انتخاب کنید.'
      : isAndroid
        ? 'اندروید: در Chrome روی منوی سه‌نقطه بزنید و Install app یا Add to Home screen را انتخاب کنید.'
        : 'کامپیوتر: در Chrome یا Edge از منوی مرورگر گزینه Install app / Install this site as an app را انتخاب کنید. اگر گزینه نمایش داده نشد، مرورگر را به‌روز کنید.';
   help.classList.remove('hidden');
 });
 if('serviceWorker' in navigator && location.protocol==='https:'){
   window.addEventListener('load',()=>{
     navigator.serviceWorker.register('./sw.js',{scope:'./'})
       .catch(error=>console.warn('PWA service worker registration failed',error));
   });
 }
})();
