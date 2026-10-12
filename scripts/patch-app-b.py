#!/usr/bin/env python3
"""Spark'26 frontend patch (part B): API-backed admin workspace, QR scanner, Excel exports, boot."""
P = '/home/user/spark26/public/app.js'
src = open(P, encoding='utf-8').read()


def replace_once(old, new, label):
    global src
    if src.count(old) != 1:
        raise SystemExit('anchor count %d for %s' % (src.count(old), label))
    src = src.replace(old, new)
    print('  ✓ replaced', label)


BLOCK_H = r"""/* ═══════════════════════ ADMIN WORKSPACE (PostgreSQL backed) ═══════════════════════ */
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
function renderAdminStats(){const s=server.stats||{};$('aPublished').textContent=s.published??0;$('aRegs').textContent=s.registrations??0;$('aAttendance').textContent=s.attendance??0;$('aDrafts').textContent=s.drafts??0;$('countRegs').textContent=String(events.reduce((a,e)=>a+(e.registeredCount||0),0)).padStart(2,'0')}
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
  onspot.innerHTML=adminEvents.filter(e=>e.modeLabel!=='Website registration').map(e=>'<option value="'+esc(e.id)+'">'+esc(e.code+' · '+e.name)+' · '+esc(e.modeLabel)+'</option>').join('')||'<option value="">No on-spot events</option>';
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
  $('editEventId').value=ev.id;$('eName').value=ev.name;$('eCategory').value=ev.categoryLabel;$('eVenue').value=ev.venue;
  $('eDate').value=ev.dateInput;$('eStart').value=ev.startInput;$('eEnd').value=ev.endInput;$('eMode').value=ev.modeLabel;
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
    await html5Scanner.start({facingMode:'environment'},{fps:10,qrbox:{width:220,height:220}},text=>onScan(text),()=>{});
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
    setScanStatus('bad',ex.code==='RATE_LIMITED'?'Slow down':'Verification failed','<span>'+esc(ex.message)+'</span>');
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
  try{
    await api('/api/admin/settings/home-hero',{method:'DELETE'});
    server.heroImage=null;
    if(window.__sparkHero)window.__sparkHero('');
    $('heroMsg').textContent='Home page photo removed — the built-in hero styling is back.';
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
"""

# splice out the old admin tail and replace it with the API-backed workspace
s = src.index("$('loginForm').addEventListener('submit'")
e = src.rindex("})();")
src = src[:s] + BLOCK_H + src[e:]

replace_once(
    "$('forgotBtn').onclick=()=>showInfo('Password reset','Protected admin access','<div class=\"notice\">This standalone file cannot send email. In a connected deployment, use the backend reset flow for the administrator account.</div>');",
    "$('forgotBtn').onclick=()=>showInfo('Password reset','Protected admin access','<div class=\"notice\">Admin passwords are reset by the symposium coordinator with <b>npm run admin:create -- --email … --rotate</b> (see README). There is no public password-reset endpoint by design.</div>');",
    'forgot password message',
)
replace_once(
    "$('navAdmin').onclick=openLogin;",
    "$('navAdmin').onclick=async()=>{if(await restoreSession())await openAdmin();else openLogin()};",
    'navAdmin handler',
)

open(P, 'w', encoding='utf-8').write(src)
print('part B applied · lines now:', src.count('\n') + 1)
