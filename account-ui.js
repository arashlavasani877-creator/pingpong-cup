// Lightweight, immediate menu interaction; works before Firebase modules load.
(()=>{
 const button=document.getElementById('accountToggle');
 const panel=document.getElementById('accountDropdown');
 if(!button||!panel)return;
 function change(open){panel.classList.toggle('hidden',!open);button.setAttribute('aria-expanded',String(open));}
 button.addEventListener('click',()=>change(panel.classList.contains('hidden')));
 document.addEventListener('click',event=>{if(!panel.contains(event.target)&&!button.contains(event.target))change(false)});
 document.addEventListener('keydown',event=>{if(event.key==='Escape')change(false)});
})();
