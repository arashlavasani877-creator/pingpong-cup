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
let deletingRoomId=null;
let adminTab='dashboard',adminFilter='all',adminRoomsLoaded=false,newTournamentMode=false;
// A list is not empty until Firestore's first snapshot arrives.
let publicRoomsLoaded=false, publicRoomsError=false;
const ROOM_CACHE_KEY='pingpong-public-room-preview-v7';
try {
 const preview=JSON.parse(localStorage.getItem(ROOM_CACHE_KEY)||'null');
 if(preview && Number.isFinite(preview.savedAt) && Date.now()-preview.savedAt<12*3600*1000 && Array.isArray(preview.rooms)) {
  publicRooms=preview.rooms.filter(r=>r && /^[a-zA-Z0-9]{1,128}$/.test(r.id) && typeof r.title==='string').slice(0,150);
 }
} catch(_error) { /* Private mode or unavailable storage: load directly from Firestore. */ }

const canManage=()=>Boolean(user&&isManager);
const isOwner=()=>Boolean(user&&ownerReady&&user.uid===ownerUid);
function notify(message){$('toast').textContent=message;$('toast').classList.remove('hidden');setTimeout(()=>$('toast').classList.add('hidden'),4000)}
function setStatus(message){$('status').textContent=message}
function names(){return $('names').value.split(/\n/).map(n=>n.trim()).filter(Boolean)}
$('names').oninput=()=>$('count').textContent=fa(names().length)+' بازیکن';
function roomUrl(id){const u=new URL(location.href);if(id)u.searchParams.set('room',id);else u.searchParams.delete('room');u.hash='';return u.href}
function shareUrl(){return roomUrl(roomId)}
function clearListener(k){if(k==='room'&&unsubRoom){unsubRoom();unsubRoom=null}if(k==='role'&&unsubRole){unsubRole();unsubRole=null}}
function stopAdminListeners(){for(const key of ['unsubRooms','unsubManagers','unsubRequests']){if(evalUnsub(key))evalUnsub(key)()}unsubRooms=unsubManagers=unsubRequests=null;rooms=[];managers=[];requests=[];adminRoomsLoaded=false}
function evalUnsub(k){return k==='unsubRooms'?unsubRooms:k==='unsubManagers'?unsubManagers:unsubRequests}
function managementButtons(){
 $('managerLogin').classList.toggle('hidden',!!user||!loginExpanded);
 $('showLogin').classList.toggle('hidden',!!user);
 $('managerTools').classList.toggle('hidden',!user);
 $('requestPanel').classList.toggle('hidden',!user||isManager);
 $('adminPanel').classList.toggle('hidden',!canManage()||!!roomId||newTournamentMode);
 $('accountInfo').classList.toggle('hidden',!user);
 $('accountInfo').textContent=user ? `حساب: ${user.email||'بدون ایمیل'} · شناسه UID: ${user.uid}` : '';
 const writable=canManage()&&(!roomId||(receivedRemote&&serverOnline))&&!saving;
 $('start').disabled=!writable;
 for(const id of ['undo','export'])$(id).disabled=!canManage()||saving||!state;
 $('share').disabled=!canManage()||!roomId;
 $('startNew').disabled=!canManage()||saving;
 $('adminQuickCreate').disabled=!canManage()||saving;
 $('requestAccess').disabled=!user||isManager;
 $('copyUid').disabled=!user;
}
function display(){render();managementButtons();renderManagement();renderPublicRooms()}
function renderPublicRooms(){
 const target=$('publicRooms');
 if(!target)return;
 if(!publicRoomsLoaded && !publicRooms.length){
  target.innerHTML=publicRoomsError?
   '<p class="muted" role="alert">دریافت مسابقات ممکن نشد. اتصال اینترنت را بررسی کنید و دوباره وارد صفحه شوید.</p>':
   '<div class="room-loading" role="status" aria-live="polite"><span class="spinner" aria-hidden="true"></span>در حال بارگذاری مسابقات...</div>'+
   '<div class="room-skeleton" aria-hidden="true"></div><div class="room-skeleton" aria-hidden="true"></div>';
  return;
 }
 const syncTag=!publicRoomsLoaded?'<div class="sync-note">نمایش فهرست ذخیره‌شده؛ در حال دریافت تازه‌ترین اطلاعات...</div>':'';
 target.innerHTML=syncTag+(publicRooms.length?
 publicRooms.map(r=>'<div class="room-row spectator-room"><div class="row-details"><strong>'+esc(r.title)+'</strong><small>'+fa(r.count)+' بازیکن · '+(r.champion?'پایان‌یافته':'در حال برگزاری')+'</small>'+(r.champion?'<span class="trophy-tag">🏆 قهرمان: '+esc(r.champion)+'</span>'+(r.runner?'<small>🥈 نایب‌قهرمان: '+esc(r.runner)+'</small>':''):'')+(r.latest?'<small>آخرین نتیجه: '+esc(r.latest)+'</small>':'')+'</div><button data-public-room="'+esc(r.id)+'">مشاهده جدول</button></div>').join(''):
 '<p class="muted">هنوز مسابقه‌ای برای تماشا وجود ندارد.</p>');
}
// createdAt, not updatedAt: editing an old match must never move it above a newer cup.
function dateMillis(ts){
 if(ts && typeof ts.toMillis==='function')return ts.toMillis();
 if(ts && Number.isFinite(ts.seconds))return ts.seconds*1000+(ts.nanoseconds||0)/1e6;
 if(typeof ts==='number' && Number.isFinite(ts))return ts;
 return 0;
}
function byNewestCreated(a,b){
 return b.createdMillis-a.createdMillis || b.updatedMillis-a.updatedMillis || a.id.localeCompare(b.id);
}

function tournamentHighlights(s){
 const {all,champion}=summary(s), byKey=new Map(all.map(m=>[m.key,m]));
 const finale=byKey.get('F2')?.done?byKey.get('F2'):byKey.get('F1')?.done&&champion!==null?byKey.get('F1'):null;
 const runner=finale?(finale.a.id===champion?finale.b.id:finale.a.id):null;
 const recent=s.history.slice(-5).reverse().map(key=>byKey.get(key)).filter(m=>m&&m.done&&!m.bye);
 const next=all.filter(m=>m.ready&&!m.done).sort((a,b)=>{
  const priority=m=>m.group==='W'?2*m.round:m.group==='L'?m.round+1:100+m.round;
  return priority(a)-priority(b)||a.number-b.number;
 })[0];
 return {all,champion,runner,recent,next};
}
function publicRoomFromDoc(d){
 const s=d.data()?.state;
 const row={id:d.id,title:s?.title||'مسابقه جدید',count:s?.players?.length||0,createdMillis:dateMillis(d.data()?.createdAt),updatedMillis:dateMillis(d.data()?.updatedAt),champion:null,runner:null,latest:null,nextLabel:null};
 if(!s)return row;
 try{
  const x=tournamentHighlights(s);
  if(x.champion!==null)row.champion=s.players[x.champion];
  if(x.runner!==null)row.runner=s.players[x.runner];
  if(x.recent.length)row.latest=s.players[x.recent[0].winner]+' مقابل '+s.players[x.recent[0].loser];
  if(x.next && x.next.a?.id!==null && x.next.b?.id!==null)row.nextLabel=s.players[x.next.a.id]+' × '+s.players[x.next.b.id];
 }catch(error){console.warn('Tournament summary failed:',d.id,error)}
 return row;
}
function listenPublicRooms(){
 if(unsubPublicRooms){unsubPublicRooms();unsubPublicRooms=null}
 unsubPublicRooms=onSnapshot(collection(db,'tournaments'),snapshot=>{
   publicRooms=snapshot.docs.map(publicRoomFromDoc).sort(byNewestCreated);
   publicRoomsLoaded=true; publicRoomsError=false;
   $('roomSyncWarning').textContent='';
   try{localStorage.setItem(ROOM_CACHE_KEY,JSON.stringify({savedAt:Date.now(),rooms:publicRooms.slice(0,150)}))}catch(_e){}
   renderPublicRooms();
 },err=>{
   console.error('public tournaments:',err);publicRoomsError=true;
   if(!publicRooms.length)renderPublicRooms();
   else $('roomSyncWarning').textContent='ارتباط زنده برقرار نیست؛ فهرست ذخیره‌شده ممکن است قدیمی باشد.';
 });
}
$('publicRooms').onclick=e=>{
 const button=e.target.closest('[data-public-room]');
 if(button)changeRoom(button.dataset.publicRoom);
};
$('showLogin').onclick=()=>{loginExpanded=!loginExpanded;managementButtons()};
function switchAdminTab(tab,focus=false){
 if(!canManage()||!['dashboard','tournaments','managers','settings'].includes(tab))return;
 adminTab=tab;
 for(const name of ['dashboard','tournaments','managers','settings']){
  const button=$('adminTab'+name[0].toUpperCase()+name.slice(1));
  const panel=$('adminView'+name[0].toUpperCase()+name.slice(1));
  const selected=name===adminTab;
  button.classList.toggle('active',selected);
  button.setAttribute('aria-selected',String(selected));
  button.tabIndex=selected?0:-1;
  panel.classList.toggle('hidden',!selected);
 }
 if(focus){$('adminPanel').scrollIntoView({behavior:'smooth',block:'start'});}
}
function openNewTournament(){
 if(!canManage()||saving)return;
 if(roomId)changeRoom(null);
 newTournamentMode=true;
 display();
 $('setup').scrollIntoView({behavior:'smooth',block:'start'});
}
function renderAdminDashboard(){
 if(!canManage())return;
 const total=adminRoomsLoaded?rooms.length:null;
 const complete=adminRoomsLoaded?rooms.filter(r=>r.champion!==null).length:null;
 $('dashAll').textContent=total===null?'…':fa(total);
 $('dashActive').textContent=total===null?'…':fa(total-complete);
 $('dashFinished').textContent=total===null?'…':fa(complete);
 $('dashRequests').textContent=fa(requests.length);
 const badge=$('pendingRequestsBubble');
 badge.classList.toggle('hidden',!requests.length);
 badge.textContent=requests.length?fa(requests.length):'';
 const sortedByUpdate=[...rooms].sort((a,b)=>b.updatedMillis-a.updatedMillis);
 const next=sortedByUpdate.find(r=>r.nextLabel);
 const latest=sortedByUpdate.find(r=>r.latest);
 $('dashNextMatch').innerHTML=next?'<span class="admin-kicker">'+esc(next.title)+'</span><strong>'+esc(next.nextLabel)+'</strong><button data-dashboard-room="'+esc(next.id)+'" type="button">باز کردن جدول</button>':
   '<p class="muted">'+(adminRoomsLoaded?'در حال حاضر بازی آماده‌ای وجود ندارد.':'در حال دریافت مسابقات...')+'</p>';
 $('dashLastResult').innerHTML=latest?'<span class="admin-kicker">'+esc(latest.title)+'</span><strong>'+esc(latest.latest)+'</strong><button data-dashboard-room="'+esc(latest.id)+'" type="button">مشاهده نتیجه</button>':
   '<p class="muted">'+(adminRoomsLoaded?'هنوز نتیجه‌ای در فهرست مسابقات ثبت نشده است.':'در حال دریافت نتایج...')+'</p>';
 $('settingsEmail').textContent=user?.email||'حساب مدیر';
}
function renderManagement(){
 if(!canManage())return;
 const search=$('adminSearch').value.trim().toLowerCase();
 const filtered=rooms.filter(r=>(adminFilter==='all'||(adminFilter==='finished'?r.champion!==null:r.champion===null))&&r.title.toLowerCase().includes(search));
 $('adminRoomCount').textContent=adminRoomsLoaded?fa(filtered.length)+' مسابقه': 'در حال بارگذاری مسابقات...';
 $('roomList').innerHTML=!adminRoomsLoaded?'<div class="room-loading"><span class="spinner" aria-hidden="true"></span>در حال بارگذاری مسابقات...</div>':
 filtered.length ? filtered.map(r=>'<div class="room-row"><div class="row-details"><strong>'+esc(r.title)+'</strong><small>'+fa(r.count)+' بازیکن</small><span class="admin-status-tag '+(r.champion!==null?'finished':'')+'">'+(r.champion!==null?'🏆 پایان‌یافته · '+esc(r.champion):'🏓 در حال برگزاری')+'</span></div><div class="room-actions"><button type="button" data-room="'+esc(r.id)+'">مدیریت</button><button type="button" class="action-danger" data-delete-room="'+esc(r.id)+'" '+(deletingRoomId===r.id?'disabled':'')+'>حذف</button></div></div>').join(''):
 '<p class="muted">'+(rooms.length?'مسابقه‌ای با این فیلتر پیدا نشد.':'هنوز مسابقه‌ای ایجاد نشده است.')+'</p>';
 $('requestsList').innerHTML=requests.length ? requests.map(x=>'<div class="request-row"><div class="row-details"><strong>'+esc(x.email)+'</strong><small>شناسه '+esc(x.uid)+'</small></div><button class="primary" data-approve="'+esc(x.uid)+'">تأیید</button><button data-deny="'+esc(x.uid)+'">رد</button></div>').join(''):'<p class="muted">درخواست جدیدی وجود ندارد.</p>';
 $('managersList').innerHTML='<div class="manager-row"><div class="row-details"><strong>مدیر ثابت (مالک)</strong><small>'+esc(ownerReady?ownerUid:'UID هنوز تنظیم نشده')+'</small></div><span id="managerBadge">محافظت‌شده</span></div>' +
 managers.filter(m=>m.uid!==ownerUid).map(m=>'<div class="manager-row"><div class="row-details"><strong>'+esc(m.email||m.uid)+'</strong><small>'+esc(m.uid)+'</small></div><button class="action-danger" data-revoke="'+esc(m.uid)+'">لغو مدیریت</button></div>').join('');
 renderAdminDashboard();
}
$('adminPanel').addEventListener('click',event=>{
 const tab=event.target.closest('[data-admin-tab]');
 if(tab){switchAdminTab(tab.dataset.adminTab);return}
 const filter=event.target.closest('[data-admin-filter]');
 if(filter){
  adminFilter=filter.dataset.adminFilter;
  document.querySelectorAll('[data-admin-filter]').forEach(b=>{const on=b.dataset.adminFilter===adminFilter;b.classList.toggle('active',on);b.setAttribute('aria-pressed',String(on))});
  renderManagement();return;
 }
 const room=event.target.closest('[data-dashboard-room]');
 if(room)changeRoom(room.dataset.dashboardRoom);
});
$('adminSearch').addEventListener('input',renderManagement);
$('adminQuickCreate').onclick=openNewTournament;
$('dashSeeTournaments').onclick=()=>switchAdminTab('tournaments',true);
$('dashSeeManagers').onclick=()=>switchAdminTab('managers',true);
$('settingsGoToRooms').onclick=()=>switchAdminTab('tournaments',true);
$('settingsImport').onclick=()=>{if(canManage()&&!saving){newTournamentMode=false;$('import').click()}};
$('settingsInstall').onclick=()=>$('installAppMenu').click();
$('settingsLogout').onclick=()=>$('logout').click();
$('cancelNew').onclick=()=>{newTournamentMode=false;switchAdminTab('tournaments');display();$('adminPanel').scrollIntoView({behavior:'smooth',block:'start'})};
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
// Browser history: detail -> list -> ask before exiting an installed PWA.
const routeState=(view,extra={})=>({pingpongRouteV7:true,view,...extra});
let exitWasApproved=false;
function changeRoom(id,fromHistory=false){
 roomId=id||null;newTournamentMode=false;
 if(!fromHistory){
  if(roomId)history.pushState(routeState('detail',{roomId}), '',roomUrl(roomId));
  else history.replaceState(routeState('home'),'',roomUrl(null));
 }
 if(db)listenToRoom();else {state=null;display()}
 window.scrollTo(0,0);
}
function setupNavigation(){
 // A direct spectator ?room= link also gets a synthetic home route underneath it.
 const existing=history.state;
 if(!existing?.pingpongRouteV7){
  const initialRoom=roomId;
  history.replaceState(routeState('exit'),'',roomUrl(null));
  history.pushState(routeState('home'),'',roomUrl(null));
  if(initialRoom)history.pushState(routeState('detail',{roomId:initialRoom}),'',roomUrl(initialRoom));
 }
 window.addEventListener('popstate',event=>{
  const stateFromHistory=event.state;
  if(stateFromHistory?.pingpongRouteV7 && stateFromHistory.view==='detail'){
   changeRoom(stateFromHistory.roomId,true);return;
  }
  if(stateFromHistory?.pingpongRouteV7 && stateFromHistory.view==='home'){
   changeRoom(null,true);return;
  }
  if(stateFromHistory?.pingpongRouteV7 && stateFromHistory.view==='exit'){
   if(exitWasApproved){history.back();return}
   // Re-arm the exit guard before opening the confirmation dialog.
   history.pushState(routeState('home'),'',roomUrl(null));
   if(roomId)changeRoom(null,true);
   $('exitModal').classList.remove('hidden');
   $('stayInApp').focus();
  }
 });
 $('returnToList').onclick=()=>{
  if(history.state?.view==='detail')history.back();
  else changeRoom(null);
 };
 $('returnFromMissing').onclick=()=>{
  if(history.state?.view==='detail')history.back();
  else changeRoom(null);
 };
 $('stayInApp').onclick=()=>{$('exitModal').classList.add('hidden')};
 $('exitApp').onclick=()=>{
  exitWasApproved=true;
  $('exitModal').classList.add('hidden');
  history.back();
 };
 window.addEventListener('keydown',event=>{
  if(event.key==='Escape' && !$('exitModal').classList.contains('hidden')){
   event.preventDefault();$('stayInApp').click();
  }
 });
}

function listenToAdmin(){
 stopAdminListeners();if(!canManage())return;
 unsubRooms=onSnapshot(collection(db,'tournaments'),s=>{rooms=s.docs.map(publicRoomFromDoc).sort(byNewestCreated);adminRoomsLoaded=true;renderManagement()},e=>{console.error(e);notify('فهرست مسابقات قابل خواندن نیست؛ قوانین Firestore را بررسی کن.')});
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

// Player IDs never change during renaming; previous results and the draw remain intact.
function renamePlayers(s,proposedNames){
 if(proposedNames.length!==s.players.length)throw Error('COUNT');
 const names=proposedNames.map(n=>n.trim());
 if(names.some(n=>!n||n.length>60)||new Set(names).size!==names.length)throw Error('NAMES');
 return validate({...s,players:names});
}
// Rebuild result history in its original order, keeping only still-valid independent games.
// A changed winner invalidates downstream results when either player's identity differs.
function revisedWinnerState(s,key,newWinner){
 const oldMatches=new Map(bracket(s).map(m=>[m.key,m]));
 const selected=oldMatches.get(key);
 if(!selected||!selected.done||selected.bye||selected.winner===newWinner||![selected.a.id,selected.b.id].includes(newWinner))throw Error('SELECTION');
 const clean={...s,results:{},history:[]};
 for(const oldKey of s.history){
  const old=oldMatches.get(oldKey);
  const candidate=bracket(clean).find(m=>m.key===oldKey);
  if(!old||!candidate||!candidate.ready||candidate.done||candidate.bye)continue;
  if(oldKey!==key){
   const before=[old.a.id,old.b.id].sort((a,b)=>a-b).join(',');
   const after=[candidate.a.id,candidate.b.id].sort((a,b)=>a-b).join(',');
   if(before!==after)continue;
  }
  const chosen=oldKey===key?newWinner:s.results[oldKey];
  if(![candidate.a.id,candidate.b.id].includes(chosen))continue;
  clean.results[oldKey]=chosen;
  clean.history.push(oldKey);
 }
 return validate(clean);
}
async function editPlayerNames(){
 if(!canManage()||!state||saving||!serverOnline)return;
 $('editNamesArea').value=state.players.join('\n');
 $('editNamesError').textContent='';
 $('editNamesModal').classList.remove('hidden');
 $('editNamesArea').focus();
}
$('editNames').onclick=editPlayerNames;
$('closeEditNames').onclick=()=>$('editNamesModal').classList.add('hidden');
$('saveEditNames').onclick=async()=>{
 if(!state||!canManage())return;
 const proposed=$('editNamesArea').value.split(/\r?\n/);
 try{
  const next=renamePlayers(state,proposed);
  if(!confirm('نام‌ها بدون تغییر قرعه‌کشی یا نتایج اصلاح شوند؟'))return;
  if(await saveOnline(next)){$('editNamesModal').classList.add('hidden');notify('نام بازیکنان اصلاح شد.');}
 }catch(error){
  $('editNamesError').textContent=error.message==='COUNT'?'تعداد خطوط باید دقیقاً برابر تعداد بازیکنان باشد.':'نام خالی، تکراری یا طولانی (بیش از ۶۰ نویسه) مجاز نیست.';
 }
};
async function correctWinner(key){
 if(!state||!canManage()||saving||!serverOnline)return;
 const m=bracket(state).find(x=>x.key===key);
 if(!m||!m.done||m.bye)return;
 const alternative=m.a.id===m.winner?m.b.id:m.a.id;
 const corrected=revisedWinnerState(state,key,alternative);
 const removed=state.history.length-corrected.history.length;
 const warning=removed>0?'\nتوجه: '+fa(removed)+' نتیجه وابسته که پس از این تغییر دیگر معتبر نیست حذف خواهد شد.':'\nنتایج مستقل حفظ می‌شوند.';
 if(!confirm('اصلاح برنده بازی '+fa(m.number)+'\nبرنده فعلی: '+state.players[m.winner]+'\nبرنده صحیح: '+state.players[alternative]+warning+'\n\nتأیید می‌کنی؟'))return;
 if(await saveOnline(corrected))notify('نتیجه اصلاح شد و مسیر جدول دوباره محاسبه شد.');
}

function render(){
 let active=!!state;
 $('setup').classList.toggle('hidden',!newTournamentMode||active||!canManage()||!!roomId);
 $('tournament').classList.toggle('hidden',!active);
 $('waiting').classList.toggle('hidden',!!roomId||active||canManage());
 $('roomLoading').classList.toggle('hidden',!roomId||active);
 if(roomId&&!active){
  $('roomLoadingText').textContent=receivedRemote?
   'این مسابقه موجود نیست یا دیگر در دسترس قرار ندارد.':'در حال دریافت جدول مسابقه...';
 }
 $('managerToolbar').classList.toggle('hidden',!canManage());
 if(!active)return;
 let {all,losses,champion}=summary(state),done=all.filter(m=>m.done&&!m.bye).length;
 const highlights=tournamentHighlights(state),{runner,recent,next}=highlights;
 $('cupTitle').textContent=state.title;
 $('stats').innerHTML='<div><strong>'+fa(state.players.length)+'</strong> بازیکن</div><div><strong>'+fa(done)+'</strong> بازی انجام‌شده</div><div><strong>'+fa(losses.filter(x=>x<2).length)+'</strong> بازیکن باقی‌مانده</div>';
 $('undo').disabled=!state.history.length||!canManage()||saving||!serverOnline;
 $('champ').innerHTML=champion!==null?'<div class="champ"><div class="champ-icon">🏆</div><div>قهرمان جام</div><strong>'+esc(state.players[champion])+'</strong>'+(runner!==null?'<div class="runner-up">🥈 نایب‌قهرمان: '+esc(state.players[runner])+'</div>':'')+'<div class="champ-sub">پایان مسابقات · تبریک به همه بازیکنان</div></div>':'';
 $('next').innerHTML=champion!==null?'<span class="section-eyebrow">مسابقات پایان یافت</span><strong>🏆 '+esc(state.players[champion])+'، قهرمان جام!</strong>':next?'<span class="section-eyebrow">🏓 بازی بعدی · شماره '+fa(next.number)+'</span><strong>'+esc(state.players[next.a.id])+' <span class="versus">VS</span> '+esc(state.players[next.b.id])+'</strong>':'<span class="section-eyebrow">بازی بعدی</span><strong>در انتظار مشخص‌شدن بازیکنان</strong>';
 $('recentResults').innerHTML='<div class="section-title"><h2>آخرین نتایج</h2><span>به‌روزرسانی زنده</span></div>'+(recent.length?recent.slice(0,4).map(m=>'<div class="recent-row"><span class="recent-medal">✓</span><div><strong>'+esc(state.players[m.winner])+'</strong><small>پیروز بازی '+fa(m.number)+'</small></div><span class="recent-opponent">مقابل '+esc(state.players[m.loser])+'</span></div>').join(''):'<p class="muted">هنوز نتیجه‌ای ثبت نشده است.</p>');
 $('standings').innerHTML='<h2>وضعیت بازیکن‌ها</h2><div style="display:flex;flex-wrap:wrap;gap:10px">'+state.players.map((p,i)=>'<span class="badge" style="color:'+(losses[i]===2?'#a8bcc6':'#d7ff63')+'">'+esc(p)+' · '+(champion===i?'🏆 قهرمان':losses[i]===2?'حذف‌شده · ۲ باخت':losses[i]===1?'۱ باخت':'بدون باخت')+'</span>').join('')+'</div>';
 const describe=(p,ref)=>p.known?(p.id===null?'استراحت':esc(state.players[p.id])):(ref.out==='loser'?'بازنده':'برنده')+' بازی '+fa(all.find(x=>x.key===ref.key).number);
 $('board').innerHTML=['W','L','F'].map(group=>{let matches=all.filter(m=>m.group===group);if(!matches.length)return '';return '<h2 style="margin-top:28px">'+({W:'جدول برنده‌ها · بدون باخت',L:'جدول بازنده‌ها · یک فرصت دیگر',F:'فینال قهرمانی'})[group]+'</h2>'+(group==='F'?'<p class="muted">اگر نماینده جدول بازنده‌ها فینال اول را ببرد، هر دو یک باخت دارند و فینال دوم قهرمان را مشخص می‌کند.</p>':'')+'<div class="board">'+[...new Set(matches.map(m=>m.round))].map(r=>'<div class="round"><h3>'+(group==='F'?(r===0?'فینال اول':'فینال دوم · در صورت نیاز'):'مرحله '+fa(r+1))+'</h3><div class="games">'+matches.filter(m=>m.round===r).map(m=>'<div class="match"><small>بازی '+fa(m.number)+' · '+(!m.active?(champion!==null?'نیازی به برگزاری نیست':'مشروط به نتیجه فینال اول'):m.bye?'عبور خودکار با استراحت':m.done?'نتیجه ثبت شد':m.ready?'آماده بازی':'در انتظار نتایج')+'</small>'+[m.a,m.b].map((p,i)=>'<button class="player '+(m.done&&p.id!==null&&m.winner===p.id?'win':'')+'" '+(!m.ready||m.done||!canManage()||saving||!serverOnline?'disabled':'')+' data-key="'+m.key+'" data-id="'+p.id+'">'+describe(p,i===0?m.aRef:m.bRef)+(m.done&&p.id!==null&&m.winner===p.id?' ✓':'')+'</button>').join('')+(m.done&&!m.bye&&canManage()?'<button class="correct-winner" data-correct-key="'+m.key+'" '+(saving||!serverOnline?'disabled':'')+'>✎ اصلاح برنده</button>':'')+'</div>').join('')+'</div></div>').join('')+'</div>'}).join('');
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
 const fix=e.target.closest('[data-correct-key]');
 if(fix){await correctWinner(fix.dataset.correctKey);return;}
 const b=e.target.closest('[data-key]');if(!b||b.disabled||!state||!canManage())return;
 const m=bracket(state).find(m=>m.key===b.dataset.key),id=Number(b.dataset.id);
 if(!m||!m.ready||m.done||![m.a.id,m.b.id].includes(id))return;
 if(!confirm('برنده این بازی «'+state.players[id]+'» است؟'))return;
 const next=JSON.parse(JSON.stringify(state));next.results[m.key]=id;next.history.push(m.key);
 await saveOnline(next);
};
$('undo').onclick=async()=>{if(!state||!state.history.length)return;if(!confirm('آخرین نتیجه ثبت‌شده حذف شود؟'))return;const next=JSON.parse(JSON.stringify(state));delete next.results[next.history.pop()];await saveOnline(next)};
$('reset').onclick=()=>{if(!canManage())return;openNewTournament();notify('مسابقه قبلی حفظ شد؛ مسابقه جدید بساز.');};
$('startNew').onclick=openNewTournament;
$('print').onclick=()=>window.print();
$('export').onclick=()=>{if(!state)return;const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='PingPong_Double_Backup.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),3000);notify('نسخه پشتیبان دانلود شد.')};
$('import').onchange=async e=>{const f=e.target.files[0];if(!f)return;try{if(!canManage())throw Error();if(f.size>100000)throw Error();const loaded=validate(JSON.parse(await f.text()));if(!confirm(roomId?'این نسخه پشتیبان جایگزین جدول همین مسابقه شود؟':'از این فایل پشتیبان یک مسابقه جدید ساخته شود؟'))return;if(roomId){if(await saveOnline(loaded))notify('مسابقه بازیابی شد.')}else await createTournament(loaded);}catch(err){notify('فایل معتبر نیست یا مجوز مدیریت نداری.')}finally{e.target.value=''}};
$('share').onclick=async()=>{if(!canManage()||!roomId)return;const url=shareUrl();try{await navigator.clipboard.writeText(url);notify('لینک تماشاگران کپی شد.')}catch(_e){window.prompt('لینک تماشاگران:',url)}};
// Only a signed-in manager can delete an individual tournament; Firestore rules also enforce this.
// Never delete from the spectator view or delete a manager account here.
async function deleteTournament(roomToDelete){
 if(!canManage()||deletingRoomId)return;
 const record=rooms.find(r=>r.id===roomToDelete);
 if(!record){notify('مسابقه در فهرست وجود ندارد.');return}
 const reference=doc(db,'tournaments',roomToDelete);
 let lastRevision;
 try{
   const fresh=await getDocFromServer(reference);
   if(!fresh.exists()){notify('این مسابقه قبلاً حذف شده است.');return}
   lastRevision=fresh.data().revision;
 }catch(err){console.error('read before deletion:',err);notify('برای حذف باید اتصال فعال به سرور برقرار باشد.');return}
 const title=record.title;
 if(!confirm('آیا می‌خواهید مسابقه «'+title+'» حذف شود؟\nنتایج و جدول همین مسابقه برای همیشه پاک می‌شوند.'))return;
 const typed=prompt('برای تأیید نهایی، نام مسابقه را دقیقاً بنویسید:\n'+title+'\n\nاین کار قابل بازگشت نیست.');
 if(typed===null)return;
 if(typed.trim()!==title.trim()){notify('نام مسابقه مطابقت نداشت؛ حذف لغو شد.');return}
 deletingRoomId=roomToDelete;renderManagement();
 try{
   await runTransaction(db,async transaction=>{
     const fresh=await transaction.get(reference);
     if(!fresh.exists())throw new Error('ALREADY_DELETED');
     if(fresh.data().revision!==lastRevision)throw new Error('CHANGED');
     transaction.delete(reference);
   },{maxAttempts:3});
   if(roomId===roomToDelete)changeRoom(null);
   notify('مسابقه «'+title+'» حذف شد.');
 }catch(err){
   console.error('delete tournament:',err);
   notify(err.message==='CHANGED'?'نتایج مسابقه اخیراً تغییر کرده؛ برای جلوگیری از حذف اشتباه دوباره اقدام کن.':
          err.message==='ALREADY_DELETED'?'مسابقه قبلاً حذف شده است.':'حذف انجام نشد؛ قانون Firestore یا دسترسی مدیریت را بررسی کن.');
 }finally{deletingRoomId=null;renderManagement()}
}
$('roomList').onclick=e=>{
 if(!canManage())return;
 const deleteButton=e.target.closest('[data-delete-room]');
 if(deleteButton){deleteTournament(deleteButton.dataset.deleteRoom);return}
 const openButton=e.target.closest('[data-room]');
 if(openButton)changeRoom(openButton.dataset.room);
};
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
setupNavigation();
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
