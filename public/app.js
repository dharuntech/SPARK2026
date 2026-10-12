(function(){'use strict';
const $=id=>document.getElementById(id);
/* ── Spark'26 data layer ────────────────────────────────────────────────
   PostgreSQL (through the REST API) is the single source of truth for events,
   students, registrations, QR passes and attendance. There is no hardcoded
   event array and no fake "success" fallback when the API fails.
   localStorage keeps only two non-authoritative conveniences:
     • opaque pass tokens created on this device (so a student can reopen a pass)
     • the last academic details typed, to pre-fill the form
   No images and no QR secret beyond the capability token are stored there. */
const store={get:(k,d)=>{try{return JSON.parse(localStorage.getItem(k))??d}catch(e){return d}},set:(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}},del:k=>{try{localStorage.removeItem(k)}catch(e){}}};
const LS_TOKENS='sp26_pass_tokens',LS_STUDENT='sp26_student';
let events=[],regs=[],attendance={},passes=[],passIndex=0,server={heroImage:null,stats:null,admin:null,attendanceSummary:null};
let selectedId='',currentSection=0,adminAuthed=false,activeFilter='ALL',csrfToken=null,loadState='loading';
function apiError(data,status){const e=new Error((data&&data.error&&data.error.message)||(data&&data.message)||('Request failed ('+status+')'));e.code=data&&data.error&&data.error.code;e.details=(data&&data.error&&data.error.details)||null;e.status=status;return e}
async function api(url,opts){const o=opts||{},method=(o.method||'GET').toUpperCase(),headers={};
if(csrfToken&&method!=='GET'&&method!=='HEAD')headers['x-csrf-token']=csrfToken;
let body=null;
if(o.form)body=o.form;else if(o.body!==undefined){headers['Content-Type']='application/json';body=JSON.stringify(o.body)}
let res;try{res=await fetch(url,{method,headers,body,credentials:'include'})}catch(err){const e=new Error('Cannot reach the Spark’26 server — please make sure the backend is running.');e.offline=true;throw e}
if(o.download){if(!res.ok){let d={};try{d=await res.json()}catch(err){}throw apiError(d,res.status)}return res}
let data={};try{data=await res.json()}catch(err){data={}}
if(!res.ok||data.ok===false){const e=apiError(data,res.status);e.data=data;throw e}
return data}
function rememberPass(p){if(!p||!p.qr||!p.qr.token)return;const list=store.get(LS_TOKENS,[]).filter(t=>t!==p.qr.token);list.unshift(p.qr.token);store.set(LS_TOKENS,list.slice(0,20))}
function trackPass(p){passes=[p,...passes.filter(x=>x.registrationId!==p.registrationId)];passIndex=0;rememberPass(p)}
function prefillStudent(){const s=store.get(LS_STUDENT,null);if(!s)return;if(!$('rName').value)$('rName').value=s.name||'';if(!$('rRegno').value)$('rRegno').value=s.registerNumber||'';if(!$('rDept').value)$('rDept').value=s.department||'';if(!$('rYear').value&&s.academicYear)$('rYear').value=s.academicYear;if(!$('rSection').value)$('rSection').value=s.section||'';if(!$('rEmail').value)$('rEmail').value=s.email||''}
function downloadBlob(blob,filename){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),4000)}
async function downloadFile(url,fallbackName){const res=await api(url,{download:true});const cd=res.headers.get('Content-Disposition')||'';const m=/filename="?([^";]+)"?/.exec(cd);const blob=await res.blob();const name=m?m[1]:fallbackName;downloadBlob(blob,name);return name}
const sections=[0,1,2,3,4].map(i=>$('s'+i));
function esc(v){return String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}function save(){/* PostgreSQL is authoritative — nothing is mirrored in this browser */}function toast(title,msg){const t=$('toast');t.innerHTML='<strong>'+esc(title)+'</strong>'+esc(msg);t.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>t.classList.remove('show'),3600)}
function go(i){
i=Math.max(0,Math.min(4,i));
const out=sections[currentSection],inn=sections[i];
if(i===currentSection&&inn.classList.contains('show'))return;
const dir=i>currentSection?1:-1,reduce=matchMedia('(prefers-reduced-motion:reduce)').matches;
currentSection=i;document.body.dataset.page=i;window.__sparkFx&&window.__sparkFx(i,dir);
sections.forEach(s=>{s.getAnimations().forEach(x=>x.cancel());s.classList.remove('leaving');if(s!==inn&&s!==out)s.classList.remove('show')});
window.scrollTo(0,0);
inn.classList.add('show');
document.querySelectorAll('[data-section]').forEach(x=>x.classList.toggle('active',+(x.dataset.section)===i));
if(i===1){renderEvents();const g=$('eventGrid');g.classList.add('reveal');clearTimeout(go.t);go.t=setTimeout(()=>g.classList.remove('reveal'),1500)}
if(i===2)updateSelected();
if(i===3)updatePass();
if(out===inn)return;
if(reduce){out.classList.remove('show');return}
out.classList.add('leaving');
const P='perspective(1400px) ',idt=P+'translate3d(0,0,0) rotateY(0deg) scale(1)',
start=P+'translate3d('+(dir*13)+'vw,0,-190px) rotateY('+(-dir*17)+'deg) scale(.93)',
exit=P+'translate3d('+(-dir*13)+'vw,0,-190px) rotateY('+(dir*17)+'deg) scale(.93)';
inn.animate([{opacity:0,transform:start},{opacity:1,transform:idt}],{duration:760,easing:'cubic-bezier(.16,.9,.24,1)',fill:'backwards'});
const o=out.animate([{opacity:1,transform:idt},{opacity:0,transform:exit}],{duration:440,easing:'cubic-bezier(.5,0,.75,.4)',fill:'forwards'});
o.onfinish=()=>{out.classList.remove('show','leaving');o.cancel()}
}
document.querySelectorAll('[data-section]').forEach(x=>x.addEventListener('click',()=>go(+x.dataset.section)));$('brand')?.addEventListener('click',()=>go(0));document.querySelector('.brand').addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' ')go(0)});$('heroEvents')?.addEventListener('click',()=>go(1));$('navReg').onclick=()=>go(1);window.sparkGo=go;
(function(){
let sx=0,sy=0,st=0,tracking=false;
const blocked=t=>!t||!t.closest||t.closest('input,select,textarea,.table-wrap,.overlay.show,.admin.show,.modal');
document.addEventListener('pointerdown',e=>{if(e.pointerType==='mouse'&&e.button!==0){tracking=false;return}tracking=!blocked(e.target)&&!(e.pointerType==='mouse'&&e.target.closest&&e.target.closest('#arena3d'));if(!tracking)return;sx=e.clientX;sy=e.clientY;st=performance.now()});
document.addEventListener('pointercancel',()=>{tracking=false});
document.addEventListener('pointerup',e=>{if(!tracking)return;tracking=false;const dx=e.clientX-sx,dy=e.clientY-sy;if(performance.now()-st>900||Math.abs(dx)<55||Math.abs(dx)<Math.abs(dy)*1.5)return;if(String(getSelection()||'').length)return;go(currentSection+(dx<0?1:-1))});
document.addEventListener('keydown',e=>{if(e.target.closest&&e.target.closest('input,select,textarea'))return;if(document.querySelector('.overlay.show,.admin.show'))return;if(e.key==='ArrowRight')go(currentSection+1);else if(e.key==='ArrowLeft')go(currentSection-1)});
/* subtle 3D tilt on event cards (mouse only) */
const grid=$('eventGrid');let cur=null;const reset=c=>{if(!c)return;c.style.setProperty('--rx','0deg');c.style.setProperty('--ry','0deg');c.classList.remove('tilting')};
grid.addEventListener('pointermove',e=>{if(e.pointerType!=='mouse'||matchMedia('(prefers-reduced-motion:reduce)').matches)return;const c=e.target.closest('.card');if(c!==cur){reset(cur);cur=c}if(!c)return;const r=c.getBoundingClientRect(),px=(e.clientX-r.left)/r.width,py=(e.clientY-r.top)/r.height;c.style.setProperty('--ry',((px-.5)*9).toFixed(2)+'deg');c.style.setProperty('--rx',((.5-py)*7).toFixed(2)+'deg');c.style.setProperty('--mx',(px*100)+'%');c.style.setProperty('--my',(py*100)+'%');c.classList.add('tilting')});
grid.addEventListener('pointerleave',()=>{reset(cur);cur=null});
document.querySelectorAll('.pager button').forEach(b=>b.addEventListener('click',()=>go(+b.dataset.section)));
})();
function eventById(id){return events.find(e=>e.id===id||e.code===id)||null}
function cardMedia(e){return e.imageUrl?'<div class="card-media"><img loading="lazy" alt="'+esc(e.name)+' poster" src="'+esc(e.imageUrl)+'"></div>':'<div class="card-media fallback"><span>'+esc(e.code)+'</span><b>'+esc(e.categoryLabel)+'</b></div>'}
function seatLabel(e){return e.maxCapacity!=null?(e.registeredCount+' / '+e.maxCapacity+' registered'):(e.registeredCount+(e.registeredCount===1?' student registered':' students registered'))}
function renderEvents(){const q=$('eventSearch')?$('eventSearch').value.trim().toLowerCase():'',grid=$('eventGrid');
const list=events.filter(e=>(activeFilter==='ALL'||e.category===activeFilter)&&(!q||[e.name,e.description,e.venue,e.categoryLabel,e.code].join(' ').toLowerCase().includes(q)));
grid.innerHTML=list.length?list.map(e=>{const open=e.registrationOpen;const statusText=open?'OPEN':(e.closedReason==='FULL'?'FULL':e.closedReason==='ON_SPOT_ONLY'?'ON-SPOT':e.closedReason==='CANCELLED'?'CANCELLED':e.closedReason==='COMPLETED'?'COMPLETED':'CLOSED');
return '<article class="card" data-event="'+esc(e.id)+'">'+cardMedia(e)+'<div class="meta"><span>'+esc(e.code)+'</span><span class="tag">'+esc(e.categoryLabel)+'</span></div><h3>'+esc(e.name)+'</h3><p>'+esc(e.description)+'</p><div class="kv"><div>VENUE<b>'+esc(e.venue)+'</b></div><div>TIME<b>'+esc(e.dateLabel)+' · '+esc(e.timeLabel)+'</b></div><div>MODE<b>'+esc(e.modeLabel)+'</b></div><div>STATUS<b class="'+(open?'st-open':'st-closed')+'">'+statusText+'</b></div></div><div class="card-seats">'+esc(seatLabel(e))+'</div><div class="actions"><button class="mini primary" data-reg="'+esc(e.id)+'"'+(open?'':' disabled title="'+esc(e.closedMessage||'Registration closed')+'"')+'>'+(open?'Register':'Registration closed')+'</button><button class="mini" data-info="'+esc(e.id)+'">Details</button></div></article>'}).join(''):'<div class="empty">'+(loadState==='loading'?'Loading events from the server…':loadState==='error'?'Events could not be loaded from the server. Please refresh the page to try again.':'No published events match your search.')+'</div>';
if($('countEvents'))$('countEvents').textContent=String(events.length).padStart(2,'0');
if($('countTechnical'))$('countTechnical').textContent=String(events.filter(e=>e.category==='TECHNICAL').length).padStart(2,'0');
if($('countRegs'))$('countRegs').textContent=String(events.reduce((a,e)=>a+(e.registeredCount||0),0)).padStart(2,'0')}
async function loadEvents(){loadState='loading';renderEvents();try{const d=await api('/api/events');events=d.events||[];loadState='ready'}catch(err){loadState='error';events=[];toast('Events unavailable',err.message)}renderEvents();if(selectedId&&!eventById(selectedId))selectedId='';if(!selectedId&&events.length)selectedId=events[0].id;updateSelected()}
document.querySelectorAll('.filter[data-filter]').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('.filter[data-filter]').forEach(x=>x.classList.remove('active'));b.classList.add('active');activeFilter=b.dataset.filter;renderEvents()}));
if($('eventSearch'))$('eventSearch').addEventListener('input',renderEvents);
$('eventGrid').addEventListener('click',e=>{const r=e.target.closest('[data-reg]'),d=e.target.closest('[data-info]');
if(r){if(r.disabled)return;const ev=eventById(r.dataset.reg);if(!ev)return;if(!ev.registrationOpen){showInfo(ev.name,'Registration closed','<div class="notice">'+esc(ev.closedMessage||'Registration is closed for this event.')+'</div>');return}selectEvent(ev);go(2)}
if(d){const ev=eventById(d.dataset.info);if(!ev)return;
const img=ev.imageUrl?'<img class="detail-img" src="'+esc(ev.imageUrl)+'" alt="'+esc(ev.name)+' poster">':'';
const body='<div class="success">'+img+'<b>'+esc(ev.venue)+'</b><br>'+esc(ev.dateLabel)+' · '+esc(ev.timeLabel)+'<br><br>'+esc(ev.description)+'<br><br>Registration mode: '+esc(ev.modeLabel)+'<br>'+esc(seatLabel(ev))+(ev.registrationDeadlineLabel?'<br>Online registration closes: '+esc(ev.registrationDeadlineLabel):'')+(ev.brochureUrl?'<br><a class="mini" style="margin-top:8px;display:inline-flex" href="'+esc(ev.brochureUrl)+'" target="_blank" rel="noopener">View brochure</a>':'')+'</div>'+(ev.registrationOpen?'<div class="actions"><button class="cta" id="detailRegister">Register for this event</button></div>':'<div class="notice">'+esc(ev.closedMessage||'Registration is closed for this event.')+'</div>');
showInfo(ev.name,ev.categoryLabel+' · '+ev.code,body);
const dr=$('detailRegister');if(dr)dr.onclick=()=>{closeInfo();selectEvent(ev);go(2)}}});
function selectEvent(ev){if(!ev)return;selectedId=ev.id;updateSelected()}
function updateSelected(){const e=eventById(selectedId)||events[0]||null;
if(!e){$('selectedTitle').textContent='Choose an event';$('selectedMeta').textContent='No published events are available right now.';return}
selectedId=e.id;$('selectedTitle').textContent=e.name;
$('selectedMeta').textContent=e.categoryLabel+' · '+e.venue+' · '+e.dateLabel+' · '+e.timeLabel+' · '+e.modeLabel;
$('regSubmit').disabled=!e.registrationOpen;
$('regSubmit').textContent=e.registrationOpen?'Generate my pass':'Registration closed';
$('regError').textContent=e.registrationOpen?'':(e.closedMessage||'');
prefillStudent()}
$('regForm').addEventListener('submit',async e=>{
e.preventDefault();
const form=e.currentTarget,err=$('regError'),btn=$('regSubmit'),label=btn.textContent;
err.textContent='';
if(!form.checkValidity()){err.textContent='Please complete every field with valid details.';form.reportValidity();return}
const ev=eventById(selectedId);
if(!ev){err.textContent='Please choose an event from the Events page.';go(1);return}
if(!ev.registrationOpen){err.textContent=ev.closedMessage||'Registration is closed for this event.';return}
const payload={eventId:ev.id,name:$('rName').value.trim(),registerNumber:$('rRegno').value.trim(),department:$('rDept').value.trim(),academicYear:$('rYear').value,section:$('rSection').value.trim(),email:$('rEmail').value.trim()};
btn.disabled=true;btn.textContent='Creating your pass…';
try{
  const data=await api('/api/registrations',{method:'POST',body:payload});
  trackPass(data.pass);
  store.set(LS_STUDENT,{name:payload.name,registerNumber:payload.registerNumber,department:payload.department,academicYear:payload.academicYear,section:payload.section,email:payload.email});
  form.reset();prefillStudent();
  await loadEvents();
  go(3);renderPass();
  updateSelected();
  showInfo('Registration confirmed','Your Spark’26 pass is ready','<div class="success">Registration ID <b>'+esc(data.pass.registrationId)+'</b> created for <b>'+esc(data.pass.event.name)+'</b>.<br>Show the QR pass at the venue for check-in.</div>');
  toast('Registration confirmed',data.pass.event.name+' · '+data.pass.registrationId);
}catch(ex){
  err.textContent=ex.message||'Registration failed.';
  if(ex.code==='DUPLICATE_REGISTRATION'&&ex.details&&ex.details.registrationId){err.textContent+=' Existing pass: '+ex.details.registrationId+'.';}
}finally{btn.disabled=false;btn.textContent=(ev&&ev.registrationOpen)?'Generate my pass':'Registration closed'}});
async function loadPasses(){const tokens=store.get(LS_TOKENS,[]);if(!tokens.length){passes=[];return passes}
const out=[];
for(const t of tokens){try{const d=await api('/api/passes/token/'+encodeURIComponent(t));out.push(d.pass)}catch(err){if(err.status===404)continue;throw err}}
passes=out;store.set(LS_TOKENS,out.map(p=>p.qr.token));if(passIndex>=passes.length)passIndex=0;return passes}
async function updatePass(){try{if(!passes.length)await loadPasses()}catch(err){toast('Pass unavailable',err.message)}renderPass()}
function renderPassChips(){const box=$('passSwitcher');if(!box)return;box.innerHTML=passes.length>1?passes.map((p,i)=>'<button class="mini'+(i===passIndex?' primary':'')+'" data-pass="'+i+'">'+esc(p.event.name)+'</button>').join(''):'';box.classList.toggle('hidden',passes.length<2)}
function renderPass(){const ids=['passEvent','passId','passName','passReg','passCategory','passVenue','passTime','passAttendance'],qr=$('qr'),p=passes[passIndex]||null;
renderPassChips();
if(!p){ids.forEach(id=>$(id).textContent=id==='passEvent'?'No registration yet':'—');$('passStatus').textContent='NO PASS';$('passHint').innerHTML='Register for an event to receive a genuine, scannable QR pass — or restore an existing pass with your register number and email below.';qr.classList.remove('has-image');qr.innerHTML='';$('downloadQr').disabled=true;return}
$('passEvent').textContent=p.event.name;$('passId').textContent=p.registrationId;$('passName').textContent=p.student.name;$('passReg').textContent=p.student.registerNumber;
$('passCategory').textContent=p.event.categoryLabel;$('passVenue').textContent=p.event.venue;$('passTime').textContent=p.event.dateLabel+' · '+p.event.timeLabel;
$('passAttendance').textContent=p.attendanceVerified?('PRESENT · '+p.checkedInAtLabel):p.attendanceStatus;
$('passStatus').textContent=p.attendanceVerified?'ATTENDANCE VERIFIED':'QR READY';
$('passHint').innerHTML='Registered '+esc(p.createdAtLabel)+' IST · '+esc(p.sourceLabel)+'<br>'+esc(p.student.department)+' · Year '+esc(p.student.academicYear)+' · Section '+esc(p.student.section)+(p.attendanceVerified?'<br>Checked in: '+esc(p.checkedInAtLabel):'');
qr.classList.add('has-image');
qr.innerHTML='<img alt="QR pass '+esc(p.registrationId)+'" src="'+p.qr.svgDataUrl+'">';
$('downloadQr').disabled=false}
$('refreshPass').onclick=async()=>{passes=[];await updatePass();toast('Pass refreshed','Attendance status was re-checked with the server.')};
$('downloadQr').onclick=()=>{const p=passes[passIndex];if(!p)return;const a=document.createElement('a');a.href=p.qr.pngDataUrl;a.download='Spark26_Pass_'+p.registrationId+'.png';document.body.appendChild(a);a.click();a.remove()};
$('passSwitcher').addEventListener('click',e=>{const b=e.target.closest('[data-pass]');if(!b)return;passIndex=+b.dataset.pass;renderPass()});
$('passLookupForm').addEventListener('submit',async e=>{
e.preventDefault();
const msg=$('passLookupMsg'),btn=$('passLookupBtn'),label=btn.textContent;
msg.textContent='';btn.disabled=true;btn.textContent='Searching…';
try{
  const d=await api('/api/passes/lookup',{method:'POST',body:{registerNumber:$('lookupRegno').value.trim(),email:$('lookupEmail').value.trim()}});
  d.passes.forEach(rememberPass);
  const s=d.passes[0].student;
  store.set(LS_STUDENT,{name:s.name,registerNumber:s.registerNumber,department:s.department,academicYear:s.academicYear,section:s.section,email:s.email});
  passes=d.passes;passIndex=0;renderPass();
  toast('Pass restored',d.count+(d.count===1?' registration':' registrations')+' linked to this device.');
}catch(ex){msg.textContent=ex.message}
finally{btn.disabled=false;btn.textContent=label}});
function showInfo(title,lead,body){$('infoTitle').textContent=title;$('infoLead').textContent=lead;$('infoBody').innerHTML=body;$('infoOverlay').classList.add('show');$('infoOverlay').setAttribute('aria-hidden','false')}function closeInfo(){$('infoOverlay').classList.remove('show');$('infoOverlay').setAttribute('aria-hidden','true')}function openLogin(){$('loginError').textContent='';$('loginPassword').value='';$('loginOverlay').classList.add('show');$('loginOverlay').setAttribute('aria-hidden','false');setTimeout(()=>$('loginPassword').focus(),50)}function closeLogin(){$('loginOverlay').classList.remove('show');$('loginOverlay').setAttribute('aria-hidden','true')}$('closeInfo').onclick=closeInfo;$('closeLogin').onclick=closeLogin;$('infoOverlay').addEventListener('click',e=>{if(e.target===e.currentTarget)closeInfo()});$('loginOverlay').addEventListener('click',e=>{if(e.target===e.currentTarget)closeLogin()});$('navAdmin').onclick=async()=>{if(await restoreSession())await openAdmin();else openLogin()};$('forgotBtn').onclick=()=>showInfo('Password reset','Protected admin access','<div class="notice">Admin passwords are reset by the symposium coordinator with <b>npm run admin:create -- --email … --rotate</b> (see README). There is no public password-reset endpoint by design.</div>');
/* ═══════════════════════ ADMIN WORKSPACE (PostgreSQL backed) ═══════════════════════ */
let adminEvents=[],adminRegRows=[],adminSelectedEvent='',adminBusy=false;
let html5Scanner=null,lastScan={code:'',at:0},scanEventId='';
function adminAuthHeaders(){return csrfToken?{'x-csrf-token':csrfToken}:{}}
async function restoreSession(){try{const d=await api('/api/admin/auth/session');csrfToken=d.csrfToken;adminAuthed=true;server.admin=d.admin;return true}catch(err){adminAuthed=false;csrfToken=null;return false}}
$('loginForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const err=$('loginError'),btn=$('loginSubmit'),label=btn?btn.textContent:'Open admin';
  err.textContent='';if(btn){btn.disabled=true;btn.textContent='Signing in…'}
  try{
    const d=await api('/api/admin/auth/login',{method:'POST',body:{email:$('loginEmail').value.trim(),password:$('loginPassword').value}});
    csrfToken=d.csrfToken;adminAuthed=true;server.admin=d.admin;$('loginPassword').value='';closeLogin();await openAdmin();
    toast('Signed in','Welcome back, '+d.admin.name+'.');
  }catch(ex){err.textContent=ex.message}
  finally{if(btn){btn.disabled=false;btn.textContent=label}}
});
async function openAdmin(){
  if(!adminAuthed&&!(await restoreSession())){openLogin();return}
  $('adminPortal').classList.add('show');$('adminPortal').setAttribute('aria-hidden','false');
  await refreshAdmin();
}
function closeAdmin(){$('adminPortal').classList.remove('show');$('adminPortal').setAttribute('aria-hidden','true');go(currentSection)}
$('adminHome').onclick=()=>closeAdmin();
$('adminLogout').onclick=async()=>{
  try{await api('/api/admin/auth/logout',{method:'POST'})}catch(ex){}
  adminAuthed=false;csrfToken=null;adminEvents=[];adminRegRows=[];closeAdmin();
  $('loginPassword').value='';toast('Signed out','Your admin session has ended.');
};
async function refreshAdmin(){
  if(adminBusy)return;adminBusy=true;
  try{
    const [ev,rs,sum]=await Promise.all([api('/api/admin/events'),api('/api/admin/registrations?pageSize=200'),api('/api/admin/attendance/summary')]);
    adminEvents=ev.events;server.stats=ev.stats;server.attendanceSummary=sum.summary;
    adminRegRows=rs.registrations;
    renderAdmin();await loadParticipants();
  }catch(ex){
    if(ex.status===401){adminAuthed=false;csrfToken=null;closeAdmin();openLogin();toast('Session expired','Please sign in again.');}
    else toast('Admin data unavailable',ex.message);
  }finally{adminBusy=false}
}
async function refreshCounts(){
  try{
    const ev=await api('/api/admin/events');
    adminEvents=ev.events;server.stats=ev.stats;renderAdminStats();renderEventSelectors();
    const keep=adminSelectedEvent;renderAdminEventsTable();adminSelectedEvent=keep;
    if(keep)$('adminEventSelect').value=keep;
  }catch(ex){if(ex.status===401){adminAuthed=false;openLogin()}}
}
async function refreshPassesFromServer(){try{await loadPasses();renderPass()}catch(ex){}}
function renderAdminStats(){const s=server.stats||{};$('aPublished').textContent=s.published??0;$('aRegs').textContent=s.registrations??0;$('aAttendance').textContent=s.attendance??0;$('aDrafts').textContent=s.drafts??0;if($('countRegs'))$('countRegs').textContent=String(events.reduce((a,e)=>a+(e.registeredCount||0),0)).padStart(2,'0')}
function renderAdminEventsTable(){
  const q=$('adminSearch').value.trim().toLowerCase(),status=$('statusFilter').value,cat=$('categoryFilter').value;
  const list=adminEvents.filter(e=>(status==='ALL'||e.status===status)&&(cat==='ALL'||e.categoryLabel===cat)&&(!q||[e.code,e.name,e.venue,e.categoryLabel].join(' ').toLowerCase().includes(q)));
  $('adminEventsTable').innerHTML=list.length?list.map(e=>'<tr><td><strong>'+esc(e.name)+'</strong><br><span class="muted">'+esc(e.code)+' · '+esc(e.categoryLabel)+' · '+esc(e.venue)+'<br>'+esc(e.dateLabel)+' · '+esc(e.timeLabel)+'</span></td><td><span class="status">'+esc(e.statusLabel)+'</span><br><span class="muted">'+esc(e.modeLabel)+'</span></td><td>'+e.registeredCount+'<br><span class="muted">'+e.presentCount+' present</span></td><td><div class="table-actions"><button class="mini" data-edit="'+esc(e.id)+'">Edit</button>'+(e.status==='PUBLISHED'?'<button class="mini" data-draft="'+esc(e.id)+'">Unpublish</button>':'<button class="mini success" data-publish="'+esc(e.id)+'">Publish</button>')+'<button class="mini" data-participants="'+esc(e.id)+'">Participants</button>'+(e.registeredCount?'<button class="mini danger" data-archive="'+esc(e.id)+'">Archive</button>':'<button class="mini danger" data-delete="'+esc(e.id)+'">Delete</button>')+'</div></td></tr>').join(''):'<tr><td colspan="4" class="muted">No events match the selected filters.</td></tr>';
}
function renderEventSelectors(){
  const allOpts=adminEvents.map(e=>'<option value="'+esc(e.id)+'">'+esc(e.code+' · '+e.name)+' ('+e.registeredCount+')</option>').join('');
  const regSel=$('regEventFilter'),keepReg=regSel.value;
  regSel.innerHTML='<option value="ALL">All events</option>'+allOpts;
  if(keepReg)regSel.value=keepReg;
  const sel=$('adminEventSelect'),keepSel=sel.value||adminSelectedEvent;
  sel.innerHTML=allOpts||'<option value="">No events yet</option>';
  if(keepSel)sel.value=keepSel;
  const scan=$('scanEventSelect'),keepScan=scan.value;
  scan.innerHTML=adminEvents.filter(e=>e.status==='PUBLISHED'||e.status==='COMPLETED').map(e=>'<option value="'+esc(e.id)+'">'+esc(e.code+' · '+e.name)+'</option>').join('')||'<option value="">Publish an event first</option>';
  if(keepScan)scan.value=keepScan;
  const onspot=$('onspotEventSelect'),keepOn=onspot.value;
  onspot.innerHTML=adminEvents.filter(e=>e.registrationMode!=='WEBSITE').map(e=>'<option value="'+esc(e.id)+'">'+esc(e.code+' · '+e.name)+' · '+esc(e.modeLabel)+'</option>').join('')||'<option value="">No on-spot events</option>';
  if(keepOn)onspot.value=keepOn;
}
function renderAdmin(){renderAdminStats();renderAdminEventsTable();renderEventSelectors();renderRegsTable()}
/* ── event-wise participant list ── */
async function loadParticipants(){
  const box=$('participantsBody'),id=$('adminEventSelect').value||adminSelectedEvent;
  if(!id){box.innerHTML='<tr><td colspan="12" class="muted">Create and publish an event first.</td></tr>';$('participantCount').textContent='0 registered';return}
  adminSelectedEvent=id;
  box.innerHTML='<tr><td colspan="12" class="muted">Loading participants…</td></tr>';
  try{
    const q=encodeURIComponent($('participantSearch').value.trim());
    const att=$('participantAttFilter').value;
    const d=await api('/api/admin/events/'+encodeURIComponent(id)+'/participants?search='+q+'&attendance='+att+'&pageSize=200');
    $('participantTitle').textContent=d.event.name+' · '+d.event.code;
    $('participantMeta').textContent=d.event.dateLabel+' · '+d.event.timeLabel+' · '+d.event.venue+' · '+d.event.modeLabel;
    $('participantCount').textContent=d.pagination.total+' registered · '+d.event.presentCount+' present';
    const rows=d.registrations;
    box.innerHTML=rows.length?rows.map((r,i)=>'<tr><td>'+(i+1)+'</td><td><strong>'+esc(r.registrationId)+'</strong><br><span class="muted">'+esc(r.sourceLabel)+'</span></td><td>'+esc(r.name)+'</td><td>'+esc(r.registerNumber)+'</td><td>'+esc(r.department)+'</td><td>'+esc(r.academicYear)+'</td><td>'+esc(r.section)+'</td><td>'+esc(r.email)+'</td><td>'+esc(r.createdAtLabel)+'</td><td><span class="status'+(r.attendanceStatus==='PRESENT'?' ok':'')+'">'+esc(r.attendanceStatus)+'</span>'+(r.checkedInAtLabel?'<br><span class="muted">'+esc(r.checkedInAtLabel)+'</span>':'')+'</td><td><button class="mini '+(r.attendanceStatus==='PRESENT'?'':'success')+'" data-toggle-att="'+esc(r.dbId)+'" data-next="'+(r.attendanceStatus==='PRESENT'?'PENDING':'PRESENT')+'">'+(r.attendanceStatus==='PRESENT'?'Mark pending':'Mark present')+'</button></td></tr>').join(''):'<tr><td colspan="12" class="muted">No students registered for this event yet.</td></tr>';
  }catch(ex){box.innerHTML='<tr><td colspan="12" class="muted">'+esc(ex.message)+'</td></tr>'}
}
/* ── global registration list ── */
function renderRegsTable(){
  const q=$('regSearch').value.trim().toLowerCase(),filter=$('regEventFilter').value;
  const list=adminRegRows.filter(r=>(filter==='ALL'||r.eventId===filter)&&(!q||[r.registrationId,r.name,r.email,r.registerNumber,r.eventName].join(' ').toLowerCase().includes(q)));
  $('regsTable').innerHTML=list.length?list.map(r=>'<tr><td><strong>'+esc(r.name)+'</strong><br><span class="muted">'+esc(r.email)+'</span></td><td>'+esc(r.eventName)+'<br><span class="muted">'+esc(r.registrationId)+'</span></td><td>'+esc(r.department)+' · Year '+esc(r.academicYear)+' · '+esc(r.section)+'<br>'+esc(r.registerNumber)+'</td><td><span class="status'+(r.attendanceStatus==='PRESENT'?' ok':'')+'">'+esc(r.attendanceStatus)+'</span><br><span class="muted">'+esc(r.sourceLabel)+'</span></td><td><button class="mini '+(r.attendanceStatus==='PRESENT'?'':'success')+'" data-att-row="'+esc(r.dbId)+'" data-next="'+(r.attendanceStatus==='PRESENT'?'PENDING':'PRESENT')+'">'+(r.attendanceStatus==='PRESENT'?'Verified':'Verify')+'</button></td></tr>').join(''):'<tr><td colspan="5" class="muted">No registrations match the selected filters.</td></tr>';
}
$('regsTable').addEventListener('click',async e=>{
  const b=e.target.closest('[data-att-row]');if(!b)return;
  b.disabled=true;
  try{const d=await api('/api/admin/registrations/'+encodeURIComponent(b.dataset.attRow)+'/attendance',{method:'PATCH',body:{attendanceStatus:b.dataset.next}});
    toast('Attendance updated',d.registration.name+' → '+d.registration.attendanceStatus);
    await refreshAdmin();await refreshPassesFromServer();}
  catch(ex){toast('Update failed',ex.message)}finally{b.disabled=false}
});
$('participantsBody').addEventListener('click',async e=>{
  const b=e.target.closest('[data-toggle-att]');if(!b)return;
  b.disabled=true;
  try{const d=await api('/api/admin/registrations/'+encodeURIComponent(b.dataset.toggleAtt)+'/attendance',{method:'PATCH',body:{attendanceStatus:b.dataset.next}});
    toast('Attendance updated',d.registration.name+' → '+d.registration.attendanceStatus);
    await refreshCounts();await loadParticipants();await refreshPassesFromServer();}
  catch(ex){toast('Update failed',ex.message)}finally{b.disabled=false}
});
/* ── Excel exports (real .xlsx generated from PostgreSQL) ── */
$('downloadEventXlsx').onclick=async()=>{
  const id=$('adminEventSelect').value||adminSelectedEvent;
  if(!id)return toast('Choose an event','Select an event before downloading its workbook.');
  try{const name=await downloadFile('/api/admin/events/'+encodeURIComponent(id)+'/registrations.xlsx','Spark26_Event_Registrations.xlsx');toast('Excel ready',name+' downloaded.')}
  catch(ex){toast('Export failed',ex.message)}
};
$('downloadMasterXlsx').onclick=async()=>{
  try{const name=await downloadFile('/api/admin/export/master.xlsx','Spark26_Master_Registrations.xlsx');toast('Master workbook ready',name+' downloaded.')}
  catch(ex){toast('Export failed',ex.message)}
};
$('exportRegs').onclick=async()=>{
  try{const name=await downloadFile('/api/admin/export/master.xlsx','Spark26_Master_Registrations.xlsx');toast('Workbook ready',name+' saved to your downloads.')}
  catch(ex){toast('Export failed',ex.message)}
};
/* ── event create / edit form ── */
const EVENT_FIELD_MAP={eName:'name',eCategory:'category',eVenue:'venue',eDate:'eventDate',eStart:'startTime',eEnd:'endTime',eMode:'registrationMode',eDesc:'description',eDeadline:'registrationDeadline',eCapacity:'maxCapacity',eStatus:'status'};
function resetEventForm(){$('eventForm').reset();$('editEventId').value='';$('eventFormTitle').textContent='Create an event';$('eventSubmit').textContent='Save event';$('cancelEdit').classList.add('hidden');$('brochurePreview').classList.add('hidden');$('imagePreview').classList.add('hidden');$('eventFormError').textContent='';$('eStatus').value='DRAFT'}
function fillEventForm(ev){
  $('editEventId').value=ev.id;$('eName').value=ev.name;$('eCategory').value=ev.category;$('eVenue').value=ev.venue;
  $('eDate').value=ev.dateInput;$('eStart').value=ev.startInput;$('eEnd').value=ev.endInput;$('eMode').value=ev.registrationMode;
  $('eDesc').value=ev.description;$('eDeadline').value=ev.registrationDeadlineInput||'';$('eCapacity').value=ev.maxCapacity??'';$('eStatus').value=ev.status;
  $('eventFormTitle').textContent='Edit '+ev.name;$('eventSubmit').textContent='Update event';$('cancelEdit').classList.remove('hidden');
  if(ev.imageUrl){$('imagePreview').src=ev.imageUrl;$('imagePreview').classList.remove('hidden')}else $('imagePreview').classList.add('hidden');
  if(ev.brochureUrl){$('brochurePreview').src=ev.brochureUrl;$('brochurePreview').classList.remove('hidden')}else $('brochurePreview').classList.add('hidden');
}
$('newEventBtn').onclick=()=>{$('adminPortal').scrollTo({top:0,behavior:'smooth'});resetEventForm();$('eName').focus()};
$('cancelEdit').onclick=resetEventForm;
$('eImage').addEventListener('change',e=>{const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=()=>{$('imagePreview').src=r.result;$('imagePreview').classList.remove('hidden')};r.readAsDataURL(f)});
$('eBrochure').addEventListener('change',e=>{const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=()=>{$('brochurePreview').src=r.result;$('brochurePreview').classList.remove('hidden')};r.readAsDataURL(f)});
$('eventForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const form=e.currentTarget,err=$('eventFormError'),btn=$('eventSubmit'),id=$('editEventId').value,label=btn.textContent;
  err.textContent='';
  if(!form.checkValidity()){err.textContent='Complete the event details before saving.';form.reportValidity();return}
  if(!adminAuthed&&!(await restoreSession())){openLogin();return}
  const fd=new FormData();
  Object.keys(EVENT_FIELD_MAP).forEach(k=>{const el=$(k);if(el)fd.append(EVENT_FIELD_MAP[k],el.value)});
  const image=$('eImage').files[0];if(image)fd.append('image',image);
  const brochure=$('eBrochure').files[0];if(brochure)fd.append('brochure',brochure);
  btn.disabled=true;btn.textContent='Saving…';
  try{
    const d=await api(id?('/api/admin/events/'+encodeURIComponent(id)):'/api/admin/events',{method:id?'PATCH':'POST',form:fd});
    toast(id?'Event updated':'Event saved',d.event.name+' · '+d.event.statusLabel);
    resetEventForm();await refreshAdmin();await loadEvents();
  }catch(ex){
    err.textContent=ex.message+(ex.details?(' '+Object.values(ex.details).join(' · ')):'');
  }finally{btn.disabled=false;btn.textContent=label}
});
$('adminEventsTable').addEventListener('click',async e=>{
  const b=e.target.closest('button');if(!b)return;
  const id=b.dataset.edit||b.dataset.publish||b.dataset.draft||b.dataset.delete||b.dataset.participants||b.dataset.archive;
  const ev=adminEvents.find(x=>x.id===id);if(!ev)return;
  if(b.dataset.edit){fillEventForm(ev);$('adminPortal').scrollTo({top:0,behavior:'smooth'});const f=$('eName');f&&f.focus();return}
  if(b.dataset.participants){$('adminEventSelect').value=ev.id;adminSelectedEvent=ev.id;await loadParticipants();$('participantsPanel').scrollIntoView({behavior:'smooth',block:'start'});return}
  if(b.dataset.publish||b.dataset.draft){
    b.disabled=true;
    try{const d=await api('/api/admin/events/'+encodeURIComponent(id)+'/status',{method:'POST',body:{status:b.dataset.publish?'PUBLISHED':'DRAFT'}});
      toast('Event '+(b.dataset.publish?'published':'unpublished'),d.event.name+' is now '+d.event.statusLabel.toLowerCase()+'.');
      await refreshAdmin();await loadEvents();}
    catch(ex){toast('Action failed',ex.message)}finally{b.disabled=false}
    return;
  }
  if(b.dataset.archive){
    if(!confirm('Archive '+ev.name+'? Students will no longer see it, but every registration and attendance record is preserved.'))return;
    b.disabled=true;
    try{await api('/api/admin/events/'+encodeURIComponent(id)+'/archive',{method:'POST'});toast('Event archived',ev.name+' was archived with its history intact.');await refreshAdmin();await loadEvents()}
    catch(ex){toast('Archive failed',ex.message)}finally{b.disabled=false}
    return;
  }
  if(b.dataset.delete){
    if(confirm('Delete '+ev.name+'? This cannot be undone.')){
      b.disabled=true;
      try{await api('/api/admin/events/'+encodeURIComponent(id),{method:'DELETE'});toast('Event deleted',ev.name+' was removed.');await refreshAdmin();await loadEvents()}
      catch(ex){toast('Delete failed',ex.message)}finally{b.disabled=false}
    }
  }
});
['adminSearch','statusFilter','categoryFilter','regSearch','regEventFilter'].forEach(id=>$(id).addEventListener('input',()=>{renderAdminEventsTable();renderRegsTable()}));
$('adminEventSelect').addEventListener('change',()=>{adminSelectedEvent=$('adminEventSelect').value;loadParticipants()});
$('participantSearch').addEventListener('input',()=>{clearTimeout(loadParticipants.t);loadParticipants.t=setTimeout(loadParticipants,250)});
$('participantAttFilter').addEventListener('change',loadParticipants);
/* ── on-spot registration ── */
$('onspotForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const f=e.currentTarget,msg=$('onspotMsg'),btn=$('onspotSubmit'),label=btn.textContent;
  msg.textContent='';btn.disabled=true;btn.textContent='Registering…';
  try{
    const d=await api('/api/admin/registrations',{method:'POST',body:{eventId:$('onspotEventSelect').value,name:$('spotName').value.trim(),registerNumber:$('spotRegno').value.trim(),department:$('spotDept').value.trim(),academicYear:$('spotYear').value,section:$('spotSection').value.trim(),email:$('spotEmail').value.trim()}});
    msg.textContent='Pass created · '+d.pass.registrationId;
    toast('On-spot registration',d.pass.student.name+' → '+d.pass.event.name);
    showInfo('On-spot pass created',d.pass.registrationId+' · '+d.pass.sourceLabel,'<div class="success">'+esc(d.pass.student.name)+' ('+esc(d.pass.student.registerNumber)+') registered for '+esc(d.pass.event.name)+'.<br>Scan this QR at the desk or let the student keep it.</div><div class="qr-inline"><img alt="QR pass" src="'+d.pass.qr.svgDataUrl+'"></div>');
    f.reset();
    await refreshAdmin();await loadEvents();
  }catch(ex){msg.textContent=ex.message}
  finally{btn.disabled=false;btn.textContent=label}
});
/* ── QR scanner (camera) + manual verification ── */
function setScanStatus(kind,title,body){const box=$('scanResult');box.dataset.kind=kind;box.innerHTML='<strong>'+esc(title)+'</strong>'+body}
async function startScanner(){
  scanEventId=$('scanEventSelect').value;
  if(!scanEventId)return toast('Choose an event','Select the event you are checking students in for.');
  if(!window.Html5Qrcode){setScanStatus('warn','Scanner library unavailable','<span>The camera scanner could not be loaded. Use the manual registration-ID lookup below.</span>');return}
  if(html5Scanner)return;
  setScanStatus('info','Camera starting…','<span>Allow camera access when your browser asks.</span>');
  try{
    html5Scanner=new window.Html5Qrcode('scanView');
    // A generous scan region (82% of the shorter side) so students can hold the pass
    // anywhere in the box; the native BarcodeDetector is used when the browser has it.
    await html5Scanner.start(
      {facingMode:'environment'},
      {
        fps:10,
        qrbox:(w,h)=>{const s=Math.floor(Math.min(w,h)*0.82);return {width:s,height:s}},
        experimentalFeatures:{useBarCodeDetectorIfSupported:true},
      },
      text=>onScan(text),
      ()=>{},
    );
    $('scanStart').disabled=true;$('scanStop').disabled=false;
    setScanStatus('info','Scanning…','<span>Point the camera at the student’s QR pass.</span>');
  }catch(err){
    html5Scanner=null;$('scanStart').disabled=false;
    const m=(err&&(err.message||err.name))||'';
    setScanStatus('bad','Camera unavailable','<span>'+esc(String(m||'The camera could not be started.'))+'<br>You can still verify attendance manually with the registration ID below.</span>');
  }
}
async function stopScanner(){
  if(!html5Scanner){$('scanStart').disabled=false;$('scanStop').disabled=true;return}
  try{await html5Scanner.stop();await html5Scanner.clear()}catch(e){}
  html5Scanner=null;$('scanStart').disabled=false;$('scanStop').disabled=true;
  setScanStatus('idle','Scanner stopped','<span>Start the camera again to continue checking students in.</span>');
}
async function onScan(text){
  const now=Date.now();
  if(lastScan.code===text&&now-lastScan.at<5000)return;      /* debounce the same code */
  lastScan={code:text,at:now};
  await verifyCode(text,null);
}
async function verifyCode(code,registrationId){
  const evId=$('scanEventSelect').value;
  if(!evId)return toast('Choose an event','Select the event before verifying attendance.');
  const body={eventId:evId};
  if(code)body.code=code;else body.registrationId=registrationId;
  try{
    const d=await api('/api/admin/attendance/verify',{method:'POST',body});
    if(d.result==='CHECKED_IN'){
      setScanStatus('good','Present · '+d.student.name,'<span>'+esc(d.student.registrationId)+' · '+esc(d.student.registerNumber)+'<br>'+esc(d.student.department)+' · Year '+esc(d.student.academicYear)+' · Section '+esc(d.student.section)+'<br>Checked in '+esc(d.checkedInAtLabel)+'</span>');
      toast('Attendance verified',d.student.name+' is marked present.');
    }else if(d.result==='ALREADY_CHECKED_IN'){
      setScanStatus('warn','Already checked in','<span>'+esc(d.student.name)+' was marked present at '+esc(d.checkedInAtLabel)+'. No second check-in was recorded.</span>');
    }else if(d.result==='WRONG_EVENT'){
      setScanStatus('bad','Wrong event','<span>'+esc(d.message)+'</span>');
    }else{
      setScanStatus('bad','Not verified','<span>'+esc(d.message||'This pass could not be verified.')+'</span>');
    }
    await refreshCounts();await loadParticipants();await refreshPassesFromServer();
  }catch(ex){
    const r=ex.data&&ex.data.result;
    if(r==='WRONG_EVENT')setScanStatus('bad','Wrong event','<span>'+esc(ex.message)+'</span>');
    else if(r==='ALREADY_CHECKED_IN')setScanStatus('warn','Already checked in','<span>'+esc(ex.data.message||'')+'</span>');
    else if(r==='INVALID_CODE'||r==='UNKNOWN_REGISTRATION'||r==='CANCELLED_REGISTRATION')setScanStatus('bad','Not verified','<span>'+esc(ex.message)+'</span>');
    else setScanStatus('bad',ex.code==='RATE_LIMITED'?'Slow down':'Verification failed','<span>'+esc(ex.message)+'</span>');
  }
}
$('scanStart').onclick=startScanner;
$('scanStop').onclick=stopScanner;
$('scanManualForm').addEventListener('submit',e=>{
  e.preventDefault();
  const id=$('scanManualId').value.trim().toUpperCase();
  if(!id)return;
  verifyCode(null,id);
  $('scanManualId').value='';
});
$('scanEventSelect').addEventListener('change',()=>{scanEventId=$('scanEventSelect').value;lastScan={code:'',at:0}});
/* ── home page photo (persistent upload, not base64 in the browser) ── */
$('heroFile').addEventListener('change',async e=>{
  const f=e.target.files[0];if(!f)return;
  if(f.size>4.5*1024*1024){$('heroMsg').textContent='Please select an image smaller than 4.5 MB.';return}
  if(!adminAuthed&&!(await restoreSession())){openLogin();return}
  $('heroMsg').textContent='Uploading photo…';
  const fd=new FormData();fd.append('image',f);
  try{
    const d=await api('/api/admin/settings/home-hero',{method:'POST',form:fd});
    server.heroImage=d.homeHeroImageUrl;
    if(window.__sparkHero)window.__sparkHero(d.homeHeroImageUrl);
    $('heroMsg').textContent='Home page photo updated for every visitor.';
    toast('Home photo updated','The new hero image is live for all students.');
  }catch(ex){$('heroMsg').textContent=ex.message}
});
$('heroReset').addEventListener('click',async()=>{
  if(!adminAuthed&&!(await restoreSession())){openLogin();return}
  $('heroMsg').textContent='Removing photo…';
  try{
    await api('/api/admin/settings/home-hero',{method:'DELETE'});
    server.heroImage=null;
    if(window.__sparkHero)window.__sparkHero('');
    $('heroFile').value='';
    $('heroMsg').textContent='Home page photo removed — the built-in hero styling is back.';
    toast('Photo removed','Hero background reset to default.');
  }catch(ex){$('heroMsg').textContent=ex.message}
});
/* ═════════════════════════════ BOOT ═════════════════════════════ */
(async function boot(){
  try{const d=await api('/api/settings');server.heroImage=d.settings.homeHeroImageUrl||null;if(window.__sparkHero)window.__sparkHero(server.heroImage)}catch(ex){}
  await loadEvents();
  prefillStudent();
  renderEvents();updateSelected();
  try{await updatePass()}catch(ex){}
  renderAdminStats();
  await restoreSession();   /* keeps an existing admin session alive across refreshes */
})();
})();
