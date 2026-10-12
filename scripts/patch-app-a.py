#!/usr/bin/env python3
"""Spark'26 frontend patch (part A, v2): replace the mock data layer with the real API layer.

Uses string boundaries (not line indices) so every splice is deterministic.
"""
P = '/home/user/spark26/public/app.js'
src = open(P, encoding='utf-8').read()


def one(anchor):
    n = src.count(anchor)
    if n != 1:
        raise SystemExit('anchor appears %d times: %s' % (n, anchor[:100]))
    return src.index(anchor)


def splice(start_anchor, end_anchor, block, label):
    """Replace everything from start_anchor up to (not including) end_anchor."""
    global src
    s = one(start_anchor)
    e = src.index(end_anchor, s)
    src = src[:s] + block + '\n' + src[e:]
    print('  ✓ spliced', label)


BLOCK_A = r"""const $=id=>document.getElementById(id);
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
function apiError(data,status){const e=new Error((data&&data.error&&data.error.message)||('Request failed ('+status+')'));e.code=data&&data.error&&data.error.code;e.details=(data&&data.error&&data.error.details)||null;e.status=status;return e}
async function api(url,opts){const o=opts||{},method=(o.method||'GET').toUpperCase(),headers={};
if(csrfToken&&method!=='GET'&&method!=='HEAD')headers['x-csrf-token']=csrfToken;
let body=null;
if(o.form)body=o.form;else if(o.body!==undefined){headers['Content-Type']='application/json';body=JSON.stringify(o.body)}
let res;try{res=await fetch(url,{method,headers,body,credentials:'include'})}catch(err){const e=new Error('Cannot reach the Spark’26 server — please make sure the backend is running.');e.offline=true;throw e}
if(o.download){if(!res.ok){let d={};try{d=await res.json()}catch(err){}throw apiError(d,res.status)}return res}
let data={};try{data=await res.json()}catch(err){data={}}
if(!res.ok||data.ok===false)throw apiError(data,res.status);
return data}
function rememberPass(p){if(!p||!p.qr||!p.qr.token)return;const list=store.get(LS_TOKENS,[]).filter(t=>t!==p.qr.token);list.unshift(p.qr.token);store.set(LS_TOKENS,list.slice(0,20))}
function trackPass(p){passes=[p,...passes.filter(x=>x.registrationId!==p.registrationId)];passIndex=0;rememberPass(p)}
function prefillStudent(){const s=store.get(LS_STUDENT,null);if(!s)return;if(!$('rName').value)$('rName').value=s.name||'';if(!$('rRegno').value)$('rRegno').value=s.registerNumber||'';if(!$('rDept').value)$('rDept').value=s.department||'';if(!$('rYear').value&&s.academicYear)$('rYear').value=s.academicYear;if(!$('rSection').value)$('rSection').value=s.section||'';if(!$('rEmail').value)$('rEmail').value=s.email||''}
function downloadBlob(blob,filename){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),4000)}
async function downloadFile(url,fallbackName){const res=await api(url,{download:true});const cd=res.headers.get('Content-Disposition')||'';const m=/filename="?([^";]+)"?/.exec(cd);const blob=await res.blob();const name=m?m[1]:fallbackName;downloadBlob(blob,name);return name}"""

BLOCK_C = r"""function eventById(id){return events.find(e=>e.id===id||e.code===id)||null}
function cardMedia(e){return e.imageUrl?'<div class="card-media"><img loading="lazy" alt="'+esc(e.name)+' poster" src="'+esc(e.imageUrl)+'"></div>':'<div class="card-media fallback"><span>'+esc(e.code)+'</span><b>'+esc(e.categoryLabel)+'</b></div>'}
function seatLabel(e){return e.maxCapacity!=null?(e.registeredCount+' / '+e.maxCapacity+' registered'):(e.registeredCount+(e.registeredCount===1?' student registered':' students registered'))}
function renderEvents(){const q=$('eventSearch').value.trim().toLowerCase(),grid=$('eventGrid');
const list=events.filter(e=>(activeFilter==='ALL'||e.category===activeFilter)&&(!q||[e.name,e.description,e.venue,e.categoryLabel,e.code].join(' ').toLowerCase().includes(q)));
grid.innerHTML=list.length?list.map(e=>{const open=e.registrationOpen;const statusText=open?'OPEN':(e.closedReason==='FULL'?'FULL':e.closedReason==='ON_SPOT_ONLY'?'ON-SPOT':e.closedReason==='CANCELLED'?'CANCELLED':e.closedReason==='COMPLETED'?'COMPLETED':'CLOSED');
return '<article class="card" data-event="'+esc(e.id)+'">'+cardMedia(e)+'<div class="meta"><span>'+esc(e.code)+'</span><span class="tag">'+esc(e.categoryLabel)+'</span></div><h3>'+esc(e.name)+'</h3><p>'+esc(e.description)+'</p><div class="kv"><div>VENUE<b>'+esc(e.venue)+'</b></div><div>TIME<b>'+esc(e.dateLabel)+' · '+esc(e.timeLabel)+'</b></div><div>MODE<b>'+esc(e.modeLabel)+'</b></div><div>STATUS<b class="'+(open?'st-open':'st-closed')+'">'+statusText+'</b></div></div><div class="card-seats">'+esc(seatLabel(e))+'</div><div class="actions"><button class="mini primary" data-reg="'+esc(e.id)+'"'+(open?'':' disabled title="'+esc(e.closedMessage||'Registration closed')+'"')+'>'+(open?'Register':'Registration closed')+'</button><button class="mini" data-info="'+esc(e.id)+'">Details</button></div></article>'}).join(''):'<div class="empty">'+(loadState==='loading'?'Loading events from the server…':loadState==='error'?'Events could not be loaded from the server. Please refresh the page to try again.':'No published events match your search.')+'</div>';
$('countEvents').textContent=String(events.length).padStart(2,'0');
$('countTechnical').textContent=String(events.filter(e=>e.category==='TECHNICAL').length).padStart(2,'0');
$('countRegs').textContent=String(events.reduce((a,e)=>a+(e.registeredCount||0),0)).padStart(2,'0')}
async function loadEvents(){loadState='loading';renderEvents();try{const d=await api('/api/events');events=d.events||[];loadState='ready'}catch(err){loadState='error';events=[];toast('Events unavailable',err.message)}renderEvents();if(selectedId&&!eventById(selectedId))selectedId='';if(!selectedId&&events.length)selectedId=events[0].id;updateSelected()}"""

BLOCK_D = r"""document.querySelectorAll('.filter[data-filter]').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('.filter[data-filter]').forEach(x=>x.classList.remove('active'));b.classList.add('active');activeFilter=b.dataset.filter;renderEvents()}));
$('eventSearch').addEventListener('input',renderEvents);
$('eventGrid').addEventListener('click',e=>{const r=e.target.closest('[data-reg]'),d=e.target.closest('[data-info]');
if(r){if(r.disabled)return;const ev=eventById(r.dataset.reg);if(!ev)return;if(!ev.registrationOpen){showInfo(ev.name,'Registration closed','<div class="notice">'+esc(ev.closedMessage||'Registration is closed for this event.')+'</div>');return}selectEvent(ev);go(2)}
if(d){const ev=eventById(d.dataset.info);if(!ev)return;
const img=ev.imageUrl?'<img class="detail-img" src="'+esc(ev.imageUrl)+'" alt="'+esc(ev.name)+' poster">':'';
const body='<div class="success">'+img+'<b>'+esc(ev.venue)+'</b><br>'+esc(ev.dateLabel)+' · '+esc(ev.timeLabel)+'<br><br>'+esc(ev.description)+'<br><br>Registration mode: '+esc(ev.modeLabel)+'<br>'+esc(seatLabel(ev))+(ev.registrationDeadlineLabel?'<br>Online registration closes: '+esc(ev.registrationDeadlineLabel):'')+(ev.brochureUrl?'<br><a class="mini" style="margin-top:8px;display:inline-flex" href="'+esc(ev.brochureUrl)+'" target="_blank" rel="noopener">View brochure</a>':'')+'</div>'+(ev.registrationOpen?'<div class="actions"><button class="cta" id="detailRegister">Register for this event</button></div>':'<div class="notice">'+esc(ev.closedMessage||'Registration is closed for this event.')+'</div>');
showInfo(ev.name,ev.categoryLabel+' · '+ev.code,body);
const dr=$('detailRegister');if(dr)dr.onclick=()=>{closeInfo();selectEvent(ev);go(2)}}});"""

BLOCK_E = r"""function selectEvent(ev){if(!ev)return;selectedId=ev.id;updateSelected()}
function updateSelected(){const e=eventById(selectedId)||events[0]||null;
if(!e){$('selectedTitle').textContent='Choose an event';$('selectedMeta').textContent='No published events are available right now.';return}
selectedId=e.id;$('selectedTitle').textContent=e.name;
$('selectedMeta').textContent=e.categoryLabel+' · '+e.venue+' · '+e.dateLabel+' · '+e.timeLabel+' · '+e.modeLabel;
$('regSubmit').disabled=!e.registrationOpen;
$('regSubmit').textContent=e.registrationOpen?'Generate my pass':'Registration closed';
$('regError').textContent=e.registrationOpen?'':(e.closedMessage||'');
prefillStudent()}"""

BLOCK_F = r"""$('regForm').addEventListener('submit',async e=>{
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
  showInfo('Registration confirmed','Your Spark’26 pass is ready','<div class="success">Registration ID <b>'+esc(data.pass.registrationId)+'</b> created for <b>'+esc(data.pass.event.name)+'</b>.<br>Show the QR pass at the venue for check-in.</div>');
  toast('Registration confirmed',data.pass.event.name+' · '+data.pass.registrationId);
}catch(ex){
  err.textContent=ex.message||'Registration failed.';
  if(ex.code==='DUPLICATE_REGISTRATION'&&ex.details&&ex.details.registrationId){err.textContent+=' Existing pass: '+ex.details.registrationId+'.';}
}finally{btn.disabled=false;btn.textContent=label;updateSelected()}});"""

BLOCK_G = r"""async function loadPasses(){const tokens=store.get(LS_TOKENS,[]);if(!tokens.length){passes=[];return passes}
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
finally{btn.disabled=false;btn.textContent=label}});"""

print('patching app.js (part A)')
splice("const $=id=>document.getElementById(id),store=", "const sections=[0,1,2,3,4]", BLOCK_A, 'data layer')
splice("function renderEvents(){const q=", "document.querySelectorAll('.filter[data-filter]')", BLOCK_C, 'renderEvents')
splice("document.querySelectorAll('.filter[data-filter]').forEach(b=>b.addEventListener('click'", "function updateSelected(){", BLOCK_D, 'filters + card clicks')
splice("function updateSelected(){const e=events.find", "$('regForm').addEventListener('submit'", BLOCK_E, 'updateSelected')
splice("$('regForm').addEventListener('submit'", "function hash(s){let h=2166136261;", BLOCK_F, 'registration submit')
splice("function hash(s){let h=2166136261;", "function showInfo(title,lead,body)", BLOCK_G, 'QR pass + retrieval')

old_save = "function save(){store.set('sp26_events',events);store.set('sp26_regs',regs);store.set('sp26_att',attendance)}"
if src.count(old_save) != 1:
    raise SystemExit('save() replacement failed')
src = src.replace(old_save, "function save(){/* PostgreSQL is authoritative — nothing is mirrored in this browser */}")

# "Register now" in the main nav must open the Events portal (section 1)
if src.count("$('navReg').onclick=()=>go(2);") != 1:
    raise SystemExit('navReg replacement failed')
src = src.replace("$('navReg').onclick=()=>go(2);", "$('navReg').onclick=()=>go(1);")

open(P, 'w', encoding='utf-8').write(src)
print('part A applied · lines now:', src.count('\n') + 1)
