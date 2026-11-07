import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.2.0/firebase-app.js';
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js';
import { getFirestore, doc, onSnapshot, runTransaction, serverTimestamp, getDocFromServer } from 'https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';
'use strict';

const $=id=>document.getElementById(id);
const fa=n=>Number(n).toLocaleString('fa-IR');
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let state=null, user=null, db=null, auth=null, unsubscribe=null;
let roomId=(new URLSearchParams(location.search)).get('room');
if(roomId && !/^[a-zA-Z0-9]{1,128}$/.test(roomId))roomId=null;
let revision=0,receivedRemote=false,serverOnline=false,saving=false;
const canManage=()=>Boolean(user&&roomId===user.uid);
function notify(message){$('toast').textContent=message;$('toast').classList.remove('hidden');setTimeout(()=>$('toast').classList.add('hidden'),4000)}
function setStatus(message){$('status').textContent=message}
function names(){return $('names').value.split(/\n/).map(n=>n.trim()).filter(Boolean)}
$('names').oninput=()=>$('count').textContent=fa(names().length)+' بازیکن';
function managementButtons(){
 $('managerLogin').classList.toggle('hidden',!!user);
 $('managerTools').classList.toggle('hidden',!canManage());
 const manager=canManage() && receivedRemote && serverOnline;
 $('start').disabled=!manager||saving;
 for(const id of ['undo','reset','export']) $(id).disabled=!manager||saving;
 $('share').disabled=!canManage();
}
function display(){render();managementButtons()}
function shareUrl(){const u=new URL(location.href);u.searchParams.set('room',roomId);u.hash='';return u.href}
async function saveOnline(next){
 if(!canManage()||!receivedRemote||!serverOnline||saving){notify('برای ثبت نتیجه، اتصال فعال و ورود مدیر لازم است.');return false}
 if(next!==null)next=validate(next);
 const expected=revision,reference=doc(db,'tournaments',roomId);
 saving=true;display();setStatus('در حال ثبت نتیجه روی سرور...');
 try{
   await runTransaction(db,async tx=>{
     const snap=await tx.get(reference);
     const last=snap.exists()?snap.data().revision:0;
     if(last!==expected)throw new Error('OUTDATED');
     const data={state:next,revision:last+1,updatedAt:serverTimestamp()};
     if(snap.exists())tx.update(reference,data);
     else tx.set(reference,{...data,createdAt:serverTimestamp()});
   },{maxAttempts:3});
   notify('نتیجه با موفقیت ثبت شد.');
   return true;
 }catch(err){
   console.error('Firestore write:',err);
   if(err.message==='OUTDATED')notify('نتیجه دیگری ثبت شده؛ جدول را به‌روزرسانی کن و دوباره تلاش کن.');
   else notify('ثبت نتیجه انجام نشد. اتصال اینترنت و قوانین Firestore را بررسی کن.');
   try{const fresh=await getDocFromServer(reference);applyDocument(fresh,true)}catch(_e){}
   return false;
 }finally{saving=false;display()}
}
function applyDocument(snap,fromServer){
 receivedRemote=true;
 serverOnline=fromServer;
 const raw=snap.exists()?snap.data():null;
 revision=raw&&Number.isInteger(raw.revision)?raw.revision:0;
 try{state=raw&&raw.state!==null?validate(raw.state):null}
 catch(err){state=null;setStatus('ساختار ذخیره‌شده نامعتبر است؛ تا بررسی مدیر، تغییری ثبت نکنید.');serverOnline=false}
 display();
}
function listenToRoom(){
 if(unsubscribe){unsubscribe();unsubscribe=null}
 receivedRemote=false;serverOnline=false;state=null;revision=0;
 display();
 if(!roomId){setStatus('مدیر مسابقه وارد شود تا لینک اختصاصی مسابقه ساخته شود.');return}
 setStatus('در حال اتصال به مسابقه...');
 unsubscribe=onSnapshot(doc(db,'tournaments',roomId),{includeMetadataChanges:true},snap=>{
   applyDocument(snap,!snap.metadata.fromCache);
   if(serverOnline){setStatus(canManage()?'اتصال زنده برقرار است · پنل مدیر':'اتصال زنده برقرار است · حالت تماشا')}
   else{setStatus('نمایش اطلاعات حافظه مرورگر؛ اتصال سرور تأیید نشده است. ثبت نتیجه غیرفعال است.')}
 },err=>{console.error('Firestore listener:',err);serverOnline=false;receivedRemote=false;setStatus('اتصال به مسابقه برقرار نشد؛ آدرس یا قوانین Firestore را بررسی کنید.');display()});
}

function shuffle(a){for(let i=a.length-1;i>0;i--){let j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a}
function makeSlots(a){let size=2**Math.ceil(Math.log2(a.length)),byes=size-a.length,out=[],i=0;for(let m=0;m<size/2;m++){out.push(a[i++]);out.push(m<byes?null:a[i++])}let pairs=[];for(let k=0;k<out.length;k+=2)pairs.push(out.slice(k,k+2));return shuffle(pairs).flat()}
function bracket(s){
 const graph=[],k=Math.log2(s.slots.length),W=[];let serial=0;
 const ref=(key,out='winner')=>({key,out});
 const add=(key,group,round,a,b,conditional=false)=>{graph.push({key,group,round,aRef:a,bRef:b,conditional,number:++serial});return key};
 for(let r=0;r<k;r++){W[r]=[];for(let i=0;i<s.slots.length/2**(r+1);i++)W[r].push(add('W'+r+'-'+i,'W',r,r?ref(W[r-1][i*2]):{id:s.slots[i*2]},r?ref(W[r-1][i*2+1]):{id:s.slots[i*2+1]}));}
 let lower;
 if(k===1)lower=ref(W[0][0],'loser');
 else{
   let prev=[],lr=0;
   for(let i=0;i<W[0].length/2;i++)prev.push(add('L'+lr+'-'+i,'L',lr,ref(W[0][2*i],'loser'),ref(W[0][2*i+1],'loser')));
   for(let r=1;r<k;r++){
     lr++;let merged=[];
     for(let i=0;i<prev.length;i++)merged.push(add('L'+lr+'-'+i,'L',lr,ref(prev[i]),ref(W[r][W[r].length-1-i],'loser')));
     prev=merged;
     if(r<k-1){lr++;let paired=[];for(let i=0;i<prev.length/2;i++)paired.push(add('L'+lr+'-'+i,'L',lr,ref(prev[i*2]),ref(prev[i*2+1])));prev=paired;}
   }
   lower=ref(prev[0]);
 }
 const upper=ref(W[k-1][0]);add('F1','F',0,upper,lower);add('F2','F',1,upper,lower,true);
 const byKey={};
 function resolve(ref){if('id'in ref)return {known:true,id:ref.id};let parent=byKey[ref.key];return {known:parent.done,id:parent.done?parent[ref.out]:null};}
 for(let m of graph){m.a=resolve(m.aRef);m.b=resolve(m.bRef);m.active=!m.conditional||(byKey.F1.done&&byKey.F1.winner===byKey.F1.b.id);m.ready=m.active&&m.a.known&&m.b.known;m.bye=m.ready&&(m.a.id===null||m.b.id===null);let win=m.bye?(m.a.id??m.b.id):s.results[m.key];m.done=m.ready&&(m.bye||(win!==undefined&&(win===m.a.id||win===m.b.id)));m.winner=m.done?win:null;m.loser=m.done&&!m.bye?(win===m.a.id?m.b.id:m.a.id):null;byKey[m.key]=m;}
 return graph;
}
function summary(s){let all=bracket(s),losses=s.players.map(()=>0);for(let m of all)if(m.done&&!m.bye)losses[m.loser]++;let f1=all.find(m=>m.key==='F1'),f2=all.find(m=>m.key==='F2');let champion=f2.done?f2.winner:f1.done&&f1.winner===f1.a.id?f1.winner:null;return {all,losses,champion};}
function render(){let active=!!state;$('setup').classList.toggle('hidden',active||!canManage()||!receivedRemote);$('tournament').classList.toggle('hidden',!active);$('waiting').classList.toggle('hidden',active||(canManage()&&receivedRemote));$('managerToolbar').classList.toggle('hidden',!canManage());if(!active)return;
 let {all,losses,champion}=summary(state),done=all.filter(m=>m.done&&!m.bye).length;
 let next=all.filter(m=>m.ready&&!m.done).sort((a,b)=>{const priority=m=>m.group==='W'?2*m.round:m.group==='L'?m.round+1:100+m.round;return priority(a)-priority(b)||a.number-b.number})[0];
 $('cupTitle').textContent=state.title;
 $('stats').innerHTML='<div><strong>'+fa(state.players.length)+'</strong> بازیکن</div><div><strong>'+fa(done)+'</strong> بازی انجام‌شده</div><div><strong>'+fa(losses.filter(x=>x<2).length)+'</strong> بازیکن باقی‌مانده</div>';
 $('undo').disabled=!state.history.length||!canManage()||saving||!serverOnline;
 $('champ').innerHTML=champion!==null?'<div class="champ">🏆 قهرمان مسابقه<strong>'+esc(state.players[champion])+'</strong>تبریک! مسیر قهرمانی کامل شد.</div>':'';
 $('next').textContent=champion!==null?'مسابقه به پایان رسید.':next?'بازی پیشنهادی بعدی · شماره '+fa(next.number)+': '+state.players[next.a.id]+' × '+state.players[next.b.id]:'در انتظار نتایج';
 $('standings').innerHTML='<h2>وضعیت بازیکن‌ها</h2><div style="display:flex;flex-wrap:wrap;gap:10px">'+state.players.map((p,i)=>'<span class="badge" style="color:'+(losses[i]===2?'#a8bcc6':'#d7ff63')+'">'+esc(p)+' · '+(champion===i?'🏆 قهرمان':losses[i]===2?'حذف‌شده · ۲ باخت':losses[i]===1?'۱ باخت':'بدون باخت')+'</span>').join('')+'</div>';
 const describe=(p,ref)=>p.known?(p.id===null?'استراحت':esc(state.players[p.id])):(ref.out==='loser'?'بازنده':'برنده')+' بازی '+fa(all.find(x=>x.key===ref.key).number);
 $('board').innerHTML=['W','L','F'].map(group=>{let matches=all.filter(m=>m.group===group);if(!matches.length)return '';return '<h2 style="margin-top:28px">'+({W:'جدول برنده‌ها · بدون باخت',L:'جدول بازنده‌ها · یک فرصت دیگر',F:'فینال قهرمانی'})[group]+'</h2>'+(group==='F'?'<p class="muted">اگر نماینده جدول بازنده‌ها فینال اول را ببرد، هر دو یک باخت دارند و فینال دوم قهرمان را مشخص می‌کند.</p>':'')+'<div class="board">'+[...new Set(matches.map(m=>m.round))].map(r=>'<div class="round"><h3>'+(group==='F'?(r===0?'فینال اول':'فینال دوم · در صورت نیاز'):'مرحله '+fa(r+1))+'</h3><div class="games">'+matches.filter(m=>m.round===r).map(m=>'<div class="match"><small>بازی '+fa(m.number)+' · '+(!m.active?(champion!==null?'نیازی به برگزاری نیست':'مشروط به نتیجه فینال اول'):m.bye?'عبور خودکار با استراحت':m.done?'نتیجه ثبت شد':m.ready?'آماده بازی':'در انتظار نتایج')+'</small>'+[m.a,m.b].map((p,i)=>'<button class="player '+(m.done&&p.id!==null&&m.winner===p.id?'win':'')+'" '+(!m.ready||m.done||!canManage()||saving||!serverOnline?'disabled':'')+' data-key="'+m.key+'" data-id="'+p.id+'">'+describe(p,i===0?m.aRef:m.bRef)+(m.done&&p.id!==null&&m.winner===p.id?' ✓':'')+'</button>').join('')+'</div>').join('')+'</div></div>').join('')+'</div>'}).join('');
}

function validate(s){if(!s||s.version!==2||typeof s.title!=='string'||s.title.length>80||!Array.isArray(s.players)||s.players.length<2||s.players.length>64||s.players.some(p=>typeof p!=='string'||!p.trim()||p.length>60)||new Set(s.players).size!==s.players.length)throw Error();let size=2**Math.ceil(Math.log2(s.players.length));if(!Array.isArray(s.slots)||s.slots.length!==size)throw Error();let ids=s.slots.filter(x=>x!==null);if(ids.length!==s.players.length||new Set(ids).size!==ids.length||ids.some(x=>!Number.isInteger(x)||x<0||x>=s.players.length))throw Error();if(!Array.isArray(s.history)||!s.results||typeof s.results!=='object'||s.history.length>2*s.players.length-1)throw Error();let clean={version:2,title:s.title,players:s.players,slots:s.slots,results:{},history:[]};for(let key of s.history){let m=bracket(clean).find(m=>m.key===key),id=s.results[key];if(!m||!m.ready||m.done||!Number.isInteger(id)||![m.a.id,m.b.id].includes(id))throw Error();clean.results[key]=id;clean.history.push(key)}if(Object.keys(s.results).length!==s.history.length)throw Error();return clean}


$('start').onclick=async()=>{
 let ns=names();$('error').textContent='';
 if(ns.length<2||ns.length>64){$('error').textContent='بین ۲ تا ۶۴ بازیکن وارد کنید.';return}
 if(ns.some(x=>x.length>60)){$('error').textContent='نام هر بازیکن حداکثر ۶۰ نویسه باشد.';return}
 if(new Set(ns).size!==ns.length){$('error').textContent='نام تکراری دارید؛ نام خانوادگی یا شماره اضافه کنید.';return}
 const next={version:2,title:$('title').value.trim()||'جام پینگ‌پنگ',players:ns,slots:makeSlots(shuffle(ns.map((_,i)=>i))),results:{},history:[]};
 if(await saveOnline(next))window.scrollTo(0,0);
};
$('board').onclick=async e=>{
 let b=e.target.closest('[data-key]');if(!b||b.disabled||!state||!canManage())return;
 let m=bracket(state).find(m=>m.key===b.dataset.key),id=Number(b.dataset.id);
 if(!m||!m.ready||m.done||![m.a.id,m.b.id].includes(id))return;
 if(!confirm('برنده این بازی «'+state.players[id]+'» است؟'))return;
 let next=JSON.parse(JSON.stringify(state));next.results[m.key]=id;next.history.push(m.key);
 await saveOnline(next);
};
$('undo').onclick=async()=>{
 if(!state||!state.history.length)return;
 if(!confirm('آخرین نتیجه ثبت‌شده حذف شود؟'))return;
 let next=JSON.parse(JSON.stringify(state));delete next.results[next.history.pop()];
 await saveOnline(next);
};
$('reset').onclick=async()=>{
 if(!state||!confirm('مسابقه فعلی از دید تمام بازیکنان پاک شود و مسابقه جدید شروع کنید؟ ابتدا نسخه پشتیبان بگیرید.'))return;
 await saveOnline(null);
};
$('print').onclick=()=>window.print();
$('export').onclick=()=>{
 if(!state)return;
 let blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');
 a.href=url;a.download='PingPong_Double_Backup.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),3000);notify('نسخه پشتیبان دانلود شد.');
};
$('import').onchange=async e=>{
 let f=e.target.files[0];if(!f)return;
 try{
   if(!canManage()||!receivedRemote||!serverOnline)throw Error();
   if(f.size>100000)throw Error();
   const loaded=validate(JSON.parse(await f.text()));
   if(!confirm('این نسخه پشتیبان به‌جای مسابقه فعلی برای تمام تماشاگران ثبت شود؟'))return;
   if(await saveOnline(loaded))notify('مسابقه بازیابی و آنلاین شد.');
 }catch(err){notify('فایل معتبر نیست یا اجازه مدیریت نداری. نسخه دوحذفی را انتخاب کن.')}finally{e.target.value=''}
};
$('share').onclick=async()=>{
 if(!canManage())return;
 const url=shareUrl();
 try{await navigator.clipboard.writeText(url);notify('لینک تماشاگران کپی شد.')}catch(_e){window.prompt('لینک تماشاگران را کپی کن:',url)}
};
$('login').onclick=async()=>{
 const email=$('email').value.trim(),pass=$('password').value;
 if(!email||!pass){notify('ایمیل و رمز مدیر را وارد کن.');return}
 $('login').disabled=true;setStatus('در حال ورود مدیر...');
 try{await signInWithEmailAndPassword(auth,email,pass);$('password').value='';notify('ورود مدیر موفق بود.')}
 catch(err){console.error('Auth error',err.code);setStatus('ورود مدیر ناموفق بود. ایمیل/رمز یا فعال‌بودن Email/Password را بررسی کن.');notify('ورود ناموفق بود.')}
 finally{$('login').disabled=false}
};
$('logout').onclick=async()=>{if(confirm('از پنل مدیریت مسابقه خارج شوی؟'))await signOut(auth)};
$('password').addEventListener('keydown',e=>{if(e.key==='Enter')$('login').click()});
const configured=['apiKey','authDomain','projectId','appId'].every(k=>firebaseConfig[k]&& !String(firebaseConfig[k]).includes('REPLACE_ME'));
if(!configured){setStatus('تنظیمات Firebase هنوز وارد نشده است. فایل firebase-config.js را تکمیل کن.');$('managerLogin').classList.add('hidden');$('waiting').classList.remove('hidden');}
else{
 try{
  const app=initializeApp(firebaseConfig,'pingpong-cup');auth=getAuth(app);db=getFirestore(app);
  onAuthStateChanged(auth,newUser=>{
    const priorRoom=roomId;user=newUser;
    // Signed-in organizer always goes to own separate room.
    if(user && roomId!==user.uid){roomId=user.uid;history.replaceState(null,'',shareUrl())}
    if(!user && !roomId){state=null;receivedRemote=false;serverOnline=false}
    if(priorRoom!==roomId||!unsubscribe)listenToRoom();else display();
  },err=>{setStatus('اشکال در بررسی ورود مدیر.');console.error(err)});
 }catch(err){setStatus('خطا در راه‌اندازی Firebase. تنظیمات پروژه را بررسی کن.');console.error(err)}
}
