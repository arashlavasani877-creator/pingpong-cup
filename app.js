import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.2.0/firebase-app.js';
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js';
import { getFirestore, doc, collection, onSnapshot, runTransaction, serverTimestamp, getDocFromServer, getDoc, setDoc, deleteDoc, writeBatch } from 'https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js';
import { firebaseConfig, ownerUid } from './firebase-config.js';
'use strict';

const $=id=>document.getElementById(id);
const fa=n=>Number(n).toLocaleString('fa-IR');
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const configured=['apiKey','authDomain','projectId','appId'].every(k=>firebaseConfig[k]&&!String(firebaseConfig[k]).includes('REPLACE_ME'));
const ownerReady=/^[a-zA-Z0-9]{12,128}$/.test(ownerUid) && ownerUid!=='OWNER_UID_TO_SET';
let state=null,user=null,db=null,auth=null;
let unsubRoom=null,unsubRole=null,unsubRooms=null,unsubManagers=null,unsubRequests=null,unsubPublicRooms=null;
let isManager=false,roomId=new URLSearchParams(location.search).get('room');
if(roomId && !/^[a-zA-Z0-9]{1,128}$/.test(roomId))roomId=null;
let revision=0,receivedRemote=false,serverOnline=false,saving=false;
let rooms=[],managers=[],requests=[],publicRooms=[],loginExpanded=false;
const canManage=()=>Boolean(user&&isManager);
const isOwner=()=>Boolean(user&&ownerReady&&user.uid===ownerUid);
function notify(message){$('toast').textContent=message;$('toast').classList.remove('hidden');setTimeout(()=>$('toast').classList.add('hidden'),4000)}
function setStatus(message){$('status').textContent=message}
function names(){return $('names').value.split(/\n/).map(n=>n.trim()).filter(Boolean)}
$('names').oninput=()=>$('count').textContent=fa(names().length)+' بازیکن';
function roomUrl(id){const u=new URL(location.href);if(id)u.searchParams.set('room',id);else u.searchParams.delete('room');u.hash='';return u.href}
function shareUrl(){return roomUrl(roomId)}
function clearListener(k){if(k==='room'&&unsubRoom){unsubRoom();unsubRoom=null}if(k==='role'&&unsubRole){unsubRole();unsubRole=null}}
function stopAdminListeners(){for(const key of ['unsubRooms','unsubManagers','unsubRequests']){if(evalUnsub(key))evalUnsub(key)()}unsubRooms=unsubManagers=unsubRequests=null;rooms=[];managers=[];requests=[]}
function evalUnsub(k){return k==='unsubRooms'?unsubRooms:k==='unsubManagers'?unsubManagers:unsubRequests}
function managementButtons(){
 $('managerLogin').classList.toggle('hidden',!!user||!loginExpanded);
 $('showLogin').classList.toggle('hidden',!!user);
 $('managerTools').classList.toggle('hidden',!user);
 $('requestPanel').classList.toggle('hidden',!user||isManager);
 $('adminPanel').classList.toggle('hidden',!canManage());
 $('accountInfo').classList.toggle('hidden',!user);
 $('accountInfo').textContent=user ? `حساب: ${user.email||'بدون ایمیل'} · شناسه UID: ${user.uid}` : '';
 const writable=canManage()&&(!roomId||(receivedRemote&&serverOnline))&&!saving;
 $('start').disabled=!writable;
 for(const id of ['undo','export'])$(id).disabled=!canManage()||saving||!state;
 $('share').disabled=!canManage()||!roomId;
 $('startNew').disabled=!canManage()||saving;
 $('requestAccess').disabled=!user||isManager;
 $('copyUid').disabled=!user;
}
function display(){render();managementButtons();renderManagement();renderPublicRooms()}
function renderPublicRooms(){
 const target=$('publicRooms');
 if(!target)return;
 target.innerHTML=publicRooms.length?
 publicRooms.map(r=>'<div class="room-row"><div class="row-details"><strong>'+esc(r.title)+'</strong><small>'+fa(r.count)+' بازیکن</small></div><button data-public-room="'+esc(r.id)+'">مشاهده جدول</button></div>').join(''):
 '<p class="muted">هنوز مسابقه‌ای برای تماشا وجود ندارد.</p>';
}
function listenPublicRooms(){
 if(unsubPublicRooms){unsubPublicRooms();unsubPublicRooms=null}
 unsubPublicRooms=onSnapshot(collection(db,'tournaments'),snapshot=>{
   publicRooms=snapshot.docs.map(d=>({id:d.id,title:d.data()?.state?.title||'مسابقه جدید',count:d.data()?.state?.players?.length||0}));
   renderPublicRooms();
 },err=>{console.error('public tournaments:',err);$('publicRooms').textContent='فهرست مسابقات قابل دریافت نیست؛ قوانین Firestore یا اتصال را بررسی کنید.';});
}
$('publicRooms').onclick=e=>{
 const button=e.target.closest('[data-public-room]');
 if(button)changeRoom(button.dataset.publicRoom);
};
$('showLogin').onclick=()=>{loginExpanded=!loginExpanded;managementButtons()};
function renderManagement(){
 if(!canManage())return;
 $('roomList').innerHTML=rooms.length ? rooms.map(r=>'<div class="room-row"><div class="row-details"><strong>'+esc(r.title)+'</strong><small>'+fa(r.count)+' بازیکن · '+esc(r.id)+'</small></div><button data-room="'+esc(r.id)+'">باز کردن</button></div>').join(''):'<p class="muted">هنوز مسابقه‌ای ساخته نشده است.</p>';
 $('requestsList').innerHTML=requests.length ? requests.map(x=>'<div class="request-row"><div class="row-details"><strong>'+esc(x.email)+'</strong><small>شناسه '+esc(x.uid)+'</small></div><button class="primary" data-approve="'+esc(x.uid)+'">تأیید</button><button data-deny="'+esc(x.uid)+'">رد</button></div>').join(''):'<p class="muted">درخواست جدیدی وجود ندارد.</p>';
 $('managersList').innerHTML='<div class="manager-row"><div class="row-details"><strong>مدیر ثابت (مالک)</strong><small>'+esc(ownerReady?ownerUid:'UID هنوز تنظیم نشده')+'</small></div><span id="managerBadge">محافظت‌شده</span></div>' +
 managers.filter(m=>m.uid!==ownerUid).map(m=>'<div class="manager-row"><div class="row-details"><strong>'+esc(m.email||m.uid)+'</strong><small>'+esc(m.uid)+'</small></div><button class="action-danger" data-revoke="'+esc(m.uid)+'">لغو مدیریت</button></div>').join('');
}
function listenToRoom(){
 clearListener('room');receivedRemote=false;serverOnline=false;state=null;revision=0;display();
 if(!roomId){setStatus(canManage()?'مدیر وارد شده است · یک مسابقه بساز یا از فهرست باز کن':'حالت تماشاگر · مسابقات را از فهرست انتخاب کن.');return}
 setStatus('در حال اتصال زنده به مسابقه...');
 unsubRoom=onSnapshot(doc(db,'tournaments',roomId),{includeMetadataChanges:true},snap=>{
   receivedRemote=true;serverOnline=!snap.metadata.fromCache;
   const data=snap.exists()?snap.data():null;revision=data&&Number.isInteger(data.revision)?data.revision:0;
   try{state=data&&data.state!==null?validate(data.state):null}
   catch(e){state=null;serverOnline=false;setStatus('اطلاعات این مسابقه معتبر نیست؛ قبل از ثبت تغییر بررسی شود.');}
   display();
   if(serverOnline)setStatus(canManage()?'اتصال زنده · مدیر مسابقه':'اتصال زنده · تماشاگر');
   else setStatus('نمایش اطلاعات موقت؛ اتصال به سرور تأیید نشده است.');
 },err=>{console.error('room subscription:',err);receivedRemote=false;serverOnline=false;display();setStatus('دسترسی به این مسابقه برقرار نشد.');});
}
function changeRoom(id){roomId=id;history.replaceState(null,'',roomUrl(roomId));listenToRoom();if(id)window.scrollTo({top:0,behavior:'smooth'});}
function listenToAdmin(){
 stopAdminListeners();if(!canManage())return;
 unsubRooms=onSnapshot(collection(db,'tournaments'),s=>{rooms=s.docs.map(d=>({id:d.id,title:d.data()?.state?.title||'مسابقه جدید',count:d.data()?.state?.players?.length||0}));renderManagement()},e=>{console.error(e);notify('فهرست مسابقات قابل خواندن نیست؛ قوانین Firestore را بررسی کن.')});
 unsubManagers=onSnapshot(collection(db,'managers'),s=>{managers=s.docs.map(d=>({uid:d.id,email:d.data().email||''}));renderManagement()},e=>{console.error(e);notify('فهرست مدیران قابل خواندن نیست.')});
 unsubRequests=onSnapshot(collection(db,'managerRequests'),s=>{requests=s.docs.map(d=>({uid:d.id,email:d.data().email||''}));renderManagement()},e=>{console.error(e);notify('فهرست درخواست‌های مدیریت قابل خواندن نیست.')});
}
function updateManagerStatus(enabled){const changed=isManager!==enabled;isManager=enabled;if(changed)listenToAdmin();display();
 if(canManage())setStatus('ورود مدیر تأیید شد · امکان مدیریت تمام مسابقات فعال است');
 else if(user)setStatus(ownerReady?'حساب فعال است؛ برای مدیریت درخواست بده.':'UID مالک در فایل تنظیمات و قوانین Firestore هنوز تعیین نشده است.');
}
function watchRole(){clearListener('role');updateManagerStatus(isOwner());if(!user||isOwner())return;
 unsubRole=onSnapshot(doc(db,'managers',user.uid),s=>updateManagerStatus(s.exists()),e=>{console.error(e);updateManagerStatus(false);setStatus('وضعیت دسترسی مدیر قابل تأیید نیست؛ قوانین Firestore را بررسی کن.');});
}
async function saveOnline(next){
 if(!canManage()||!roomId||!receivedRemote||!serverOnline||saving){notify('برای تغییر نتیجه، دسترسی مدیریت و اتصال زنده لازم است.');return false}
 if(next!==null)next=validate(next);
 const expected=revision,reference=doc(db,'tournaments',roomId);
 saving=true;display();setStatus('در حال ثبت اطلاعات...');
 try{
   await runTransaction(db,async tx=>{
     const snap=await tx.get(reference),last=snap.exists()?snap.data().revision:0;
     if(last!==expected)throw Error('OUTDATED');
     const data={state:next,revision:last+1,updatedAt:serverTimestamp()};
     if(snap.exists())tx.update(reference,data);
     else tx.set(reference,{...data,createdAt:serverTimestamp()});
   },{maxAttempts:3});
   notify('تغییرات ثبت و برای همه همگام شد.');return true;
 }catch(e){console.error('write failed:',e);
   notify(e.message==='OUTDATED'?'اطلاعات مسابقه هم‌زمان تغییر کرده؛ مجدداً تلاش کن.':'ثبت نشد؛ اتصال و مجوزهای Firestore را بررسی کن.');
   try{const fresh=await getDocFromServer(reference);receivedRemote=true;serverOnline=true;revision=fresh.exists()?fresh.data().revision:0;state=fresh.exists()?fresh.data().state:null;}catch(_e){}
   return false;
 }finally{saving=false;display()}
}
async function createTournament(next){
 if(!canManage()||saving)return;
 next=validate(next);saving=true;display();setStatus('در حال ساخت مسابقه آنلاین...');
 const ref=doc(collection(db,'tournaments'));
 try{
  await runTransaction(db,async tx=>{const snap=await tx.get(ref);if(snap.exists())throw Error('EXISTS');tx.set(ref,{state:next,revision:1,createdAt:serverTimestamp(),updatedAt:serverTimestamp()})});
  changeRoom(ref.id);notify('مسابقه ساخته شد. لینک تماشاگران آماده است.');
 }catch(e){console.error(e);notify('ساخت مسابقه انجام نشد. قوانین Firestore را بررسی کن.');setStatus('ساخت مسابقه ناموفق بود.');}
 finally{saving=false;display()}
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
function validate(s){if(!s||s.version!==2||typeof s.title!=='string'||s.title.length>80||!Array.isArray(s.players)||s.players.length<2||s.players.length>64||s.players.some(p=>typeof p!=='string'||!p.trim()||p.length>60)||new Set(s.players).size!==s.players.length)throw Error();let size=2**Math.ceil(Math.log2(s.players.length));if(!Array.isArray(s.slots)||s.slots.length!==size)throw Error();let ids=s.slots.filter(x=>x!==null);if(ids.length!==s.players.length||new Set(ids).size!==ids.length||ids.some(x=>!Number.isInteger(x)||x<0||x>=s.players.length))throw Error();if(!Array.isArray(s.history)||!s.results||typeof s.results!=='object'||s.history.length>2*s.players.length-1)throw Error();let clean={version:2,title:s.title,players:s.players,slots:s.slots,results:{},history:[]};for(let key of s.history){let m=bracket(clean).find(m=>m.key===key),id=s.results[key];if(!m||!m.ready||m.done||!Number.isInteger(id)||![m.a.id,m.b.id].includes(id))throw Error();clean.results[key]=id;clean.history.push(key)}if(Object.keys(s.results).length!==s.history.length)throw Error();return clean}

function render(){
 let active=!!state;
 $('setup').classList.toggle('hidden',active||!canManage()||(roomId&&!receivedRemote));
 $('tournament').classList.toggle('hidden',!active);
 $('waiting').classList.toggle('hidden',active||canManage());
 $('managerToolbar').classList.toggle('hidden',!canManage());
 if(!active)return;
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

$('start').onclick=async()=>{
 let ns=names();$('error').textContent='';
 if(ns.length<2||ns.length>64){$('error').textContent='بین ۲ تا ۶۴ بازیکن وارد کنید.';return}
 if(ns.some(x=>x.length>60)){$('error').textContent='نام هر بازیکن حداکثر ۶۰ نویسه باشد.';return}
 if(new Set(ns).size!==ns.length){$('error').textContent='نام تکراری دارید؛ نام خانوادگی یا شماره اضافه کنید.';return}
 const next={version:2,title:$('title').value.trim()||'جام پینگ‌پنگ',players:ns,slots:makeSlots(shuffle(ns.map((_,i)=>i))),results:{},history:[]};
 if(roomId){if(await saveOnline(next))window.scrollTo(0,0)}else await createTournament(next);
};
$('board').onclick=async e=>{
 const b=e.target.closest('[data-key]');if(!b||b.disabled||!state||!canManage())return;
 const m=bracket(state).find(m=>m.key===b.dataset.key),id=Number(b.dataset.id);
 if(!m||!m.ready||m.done||![m.a.id,m.b.id].includes(id))return;
 if(!confirm('برنده این بازی «'+state.players[id]+'» است؟'))return;
 const next=JSON.parse(JSON.stringify(state));next.results[m.key]=id;next.history.push(m.key);
 await saveOnline(next);
};
$('undo').onclick=async()=>{if(!state||!state.history.length)return;if(!confirm('آخرین نتیجه ثبت‌شده حذف شود؟'))return;const next=JSON.parse(JSON.stringify(state));delete next.results[next.history.pop()];await saveOnline(next)};
$('reset').onclick=()=>{if(!canManage())return;changeRoom(null);notify('مسابقه قبلی حفظ شد؛ مسابقه جدید بساز.');};
$('startNew').onclick=()=>{if(!canManage())return;changeRoom(null);$('setup').scrollIntoView({behavior:'smooth'});};
$('print').onclick=()=>window.print();
$('export').onclick=()=>{if(!state)return;const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='PingPong_Double_Backup.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),3000);notify('نسخه پشتیبان دانلود شد.')};
$('import').onchange=async e=>{const f=e.target.files[0];if(!f)return;try{if(!canManage())throw Error();if(f.size>100000)throw Error();const loaded=validate(JSON.parse(await f.text()));if(!confirm('این نسخه پشتیبان جایگزین جدول همین مسابقه شود؟'))return;if(roomId){if(await saveOnline(loaded))notify('مسابقه بازیابی شد.')}else await createTournament(loaded);}catch(err){notify('فایل معتبر نیست یا مجوز مدیریت نداری.')}finally{e.target.value=''}};
$('share').onclick=async()=>{if(!canManage()||!roomId)return;const url=shareUrl();try{await navigator.clipboard.writeText(url);notify('لینک تماشاگران کپی شد.')}catch(_e){window.prompt('لینک تماشاگران:',url)}};
$('roomList').onclick=e=>{const b=e.target.closest('[data-room]');if(b&&canManage())changeRoom(b.dataset.room)};
$('requestsList').onclick=async e=>{
 const approve=e.target.closest('[data-approve]'),deny=e.target.closest('[data-deny]');if(!canManage()||(!approve&&!deny))return;
 const uid=approve?approve.dataset.approve:deny.dataset.deny;if(uid===ownerUid){notify('حساب مالک قابل تغییر نیست.');return}
 const record=requests.find(r=>r.uid===uid);if(!record)return;
 if(!confirm((approve?'مدیریت به این حساب داده شود؟':'این درخواست رد شود؟')+'\n'+record.email))return;
 try{
   if(approve){
    const batch=writeBatch(db);
    batch.set(doc(db,'managers',uid),{email:record.email,grantedBy:user.uid,createdAt:serverTimestamp()});
    batch.delete(doc(db,'managerRequests',uid));await batch.commit();notify('دسترسی مدیر فعال شد.');
   }else{await deleteDoc(doc(db,'managerRequests',uid));notify('درخواست رد شد.')}
 }catch(err){console.error(err);notify('تغییر دسترسی انجام نشد؛ مجوزها را بررسی کن.')}
};
$('managersList').onclick=async e=>{
 const b=e.target.closest('[data-revoke]');if(!b||!canManage())return;const uid=b.dataset.revoke;
 if(uid===ownerUid){notify('هیچ مدیری نمی‌تواند مالک اصلی را حذف کند.');return}
 if(!confirm('دسترسی مدیریت این شخص لغو شود؟'))return;
 try{await deleteDoc(doc(db,'managers',uid));notify('دسترسی مدیریت لغو شد.')}catch(err){console.error(err);notify('لغو دسترسی انجام نشد.')}
};
$('requestAccess').onclick=async()=>{
 if(!user||canManage())return;
 if(!ownerReady){notify('ابتدا UID مالک و قوانین Firestore باید تنظیم شود.');return}
 try{
  const ref=doc(db,'managerRequests',user.uid);
  const existing=await getDoc(ref);
  if(existing.exists()){notify('درخواست مدیریت قبلاً ثبت شده است.');return}
  await setDoc(ref,{email:user.email||'',createdAt:serverTimestamp()});notify('درخواست ثبت شد؛ یکی از مدیران باید تأیید کند.');
 }catch(e){console.error(e);notify('درخواست ثبت نشد؛ قوانین Firestore را بررسی کن.')}
};
$('copyUid').onclick=async()=>{if(!user)return;try{await navigator.clipboard.writeText(user.uid);notify('UID حساب کپی شد.')}catch(e){window.prompt('UID حساب:',user.uid)}};
$('login').onclick=async()=>{
 const email=$('email').value.trim(),pass=$('password').value;
 if(!email||!pass){notify('ایمیل و رمز را وارد کن.');return}
 $('login').disabled=true;setStatus('در حال ورود...');
 try{await signInWithEmailAndPassword(auth,email,pass);$('password').value='';notify('ورود موفق بود.');}
 catch(err){console.error('Auth:',err.code);notify('ورود ناموفق بود. ایمیل/رمز یا فعال بودن Email/Password را بررسی کن.');}
 finally{$('login').disabled=false}
};
$('register').onclick=async()=>{
 const email=$('email').value.trim(),pass=$('password').value;
 if(!email||pass.length<6){notify('برای ساخت حساب، ایمیل و رمز حداقل ۶ کاراکتری وارد کن.');return}
 $('register').disabled=true;
 try{await createUserWithEmailAndPassword(auth,email,pass);$('password').value='';notify('حساب ساخته شد. سپس درخواست مدیریت را ثبت کن.');}
 catch(err){console.error('register:',err.code);notify('ساخت حساب ممکن نشد؛ شاید این ایمیل قبلاً ثبت شده است.');}
 finally{$('register').disabled=false}
};
$('logout').onclick=async()=>{if(confirm('از حساب خارج شوی؟'))await signOut(auth)};
$('password').addEventListener('keydown',e=>{if(e.key==='Enter')$('login').click()});
if(!configured){setStatus('تنظیمات Firebase کامل نیست.');$('managerLogin').classList.add('hidden')}
else try{
 const app=initializeApp(firebaseConfig,'pingpong-cup');auth=getAuth(app);db=getFirestore(app);listenPublicRooms();
 onAuthStateChanged(auth,nextUser=>{
   clearListener('role');stopAdminListeners();user=nextUser;isManager=false;
   if(user){$('signupHint').textContent=ownerReady?'درخواست تو پس از تأیید یکی از مدیران فعال می‌شود.':'برای فعال‌سازی مالک ثابت، UID این حساب را از اینجا کپی کن و در فایل تنظیمات و قوانین قرار بده.';watchRole()}
   else updateManagerStatus(false);
   display();
   if(!unsubRoom)listenToRoom();
 },err=>{console.error(err);setStatus('خطا در بررسی ورود حساب.');});
}catch(e){console.error(e);setStatus('خطا در راه‌اندازی Firebase.');}
