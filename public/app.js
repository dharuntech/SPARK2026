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
function prefillStudent(){const s=store.get(LS_STUDENT,null);if(!s)return;if(!$('rName').value)$('rName').value=s.name||'';if(!$('rRegno').value)$('rRegno').value=s.registerNumber||'';if(!$('rDept').value)$('rDept').value=s.department||'';if(!$('rYear').value&&s.academicYear&&['I','II','III','IV'].includes(s.academicYear))$('rYear').value=s.academicYear;if(!$('rSection').value)$('rSection').value=s.section||'';if(!$('rEmail').value)$('rEmail').value=s.email||'';if($('rPhone')&&!$('rPhone').value)$('rPhone').value=s.phone||''}
function downloadBlob(blob,filename){if(typeof window!=='undefined'&&window.__onDownloadBlob)try{window.__onDownloadBlob(blob,filename)}catch(_){}const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),4000)}
async function downloadFile(url,fallbackName){const res=await api(url,{download:true});const cd=res.headers.get('Content-Disposition')||'';const m=/filename="?([^";]+)"?/.exec(cd);const blob=await res.blob();const name=m?m[1]:fallbackName;downloadBlob(blob,name);return name}
const sections=[0,1,2,3,4,5].map(i=>$('s'+i));
const PUBLIC_SECTIONS=[0,1,3,4,5];
function getNextSection(cur){
  if(cur===0)return 1;
  if(cur===1)return 3;
  if(cur===2)return 3;
  if(cur===3)return 4;
  if(cur===4)return 5;
  return 5;
}
function getPrevSection(cur){
  if(cur===5)return 4;
  if(cur===4)return 3;
  if(cur===3)return 1;
  if(cur===2)return 1;
  if(cur===1)return 0;
  return 0;
}
function esc(v){return String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}function save(){/* PostgreSQL is authoritative — nothing is mirrored in this browser */}function toast(title,msg){const t=$('toast');t.innerHTML='<strong>'+esc(title)+'</strong>'+esc(msg);t.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>t.classList.remove('show'),3600)}
function go(i, push = true){
i=Math.max(0,Math.min(5,i));
const out=sections[currentSection],inn=sections[i];
if(i===currentSection&&inn.classList.contains('show'))return;
if(push && window.history && window.history.pushState){
  try{history.pushState({section:i},'','#s'+i)}catch(err){}
}
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
const isMobile=window.innerWidth<=768;
if(isMobile){
  const startX=dir*36,exitX=-dir*36;
  inn.animate([{opacity:0,transform:`translate3d(${startX}px,0,0)`},{opacity:1,transform:'translate3d(0,0,0)'}],{duration:260,easing:'cubic-bezier(.2,.8,.25,1)',fill:'backwards'});
  const o=out.animate([{opacity:1,transform:'translate3d(0,0,0)'},{opacity:0,transform:`translate3d(${exitX}px,0,0)`}],{duration:200,easing:'ease-in',fill:'forwards'});
  o.onfinish=()=>{out.classList.remove('show','leaving');o.cancel()};
}else{
  const P='perspective(1400px) ',idt=P+'translate3d(0,0,0) rotateY(0deg) scale(1)',
  start=P+'translate3d('+(dir*13)+'vw,0,-190px) rotateY('+(-dir*17)+'deg) scale(.93)',
  exit=P+'translate3d('+(-dir*13)+'vw,0,-190px) rotateY('+(dir*17)+'deg) scale(.93)';
  inn.animate([{opacity:0,transform:start},{opacity:1,transform:idt}],{duration:760,easing:'cubic-bezier(.16,.9,.24,1)',fill:'backwards'});
  const o=out.animate([{opacity:1,transform:idt},{opacity:0,transform:exit}],{duration:440,easing:'cubic-bezier(.5,0,.75,.4)',fill:'forwards'});
  o.onfinish=()=>{out.classList.remove('show','leaving');o.cancel()};
}
if(i===0){window.__resumePrism&&window.__resumePrism();window.__wakeOrbs&&window.__wakeOrbs()}
}
document.querySelectorAll('[data-section]').forEach(x=>x.addEventListener('click',()=>go(+x.dataset.section)));
$('brand')?.addEventListener('click',()=>{if(currentSection===0){window.location.reload()}else{go(0)}});
document.querySelector('.brand').addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){if(currentSection===0)window.location.reload();else go(0)}});
$('heroEvents')?.addEventListener('click',()=>go(1));
$('backToEventsBtn')?.addEventListener('click',()=>go(1));
const nr=$('navReg');if(nr)nr.onclick=()=>{if(selectedId&&eventById(selectedId)){updateSelected();go(2)}else{go(1)}};
window.sparkGo=go;window.sparkSelectEvent=selectEvent;window.sparkEvents=()=>events;window.sparkPasses=()=>passes;
(function(){
const blocked = t => {
  if (!t) return false;
  const el = t.nodeType === 1 ? t : (t.parentElement || null);
  if (!el || typeof el.closest !== 'function') return false;
  return Boolean(el.closest('input,select,textarea,.table-wrap,.overlay.show,.admin.show,.modal,#galleryStage,#circularGalleryRoot,.circular-gallery'));
};

// Pull-to-refresh indicator helper
let pullIndicator = null;
function getPullIndicator(){
  if(!pullIndicator){
    pullIndicator = document.createElement('div');
    pullIndicator.className = 'pull-refresh-indicator';
    pullIndicator.innerHTML = '<span class="pull-icon">⟳</span><span class="pull-text">Pull down to refresh</span>';
    document.body.appendChild(pullIndicator);
  }
  return pullIndicator;
}

// 1. TOUCH GESTURES (Horizontal & Vertical section navigation + Mobile pull-down to refresh)
let touchStartX=0,touchStartY=0,touchStartTime=0,touchTracking=false,touchAtTop=false;
window.addEventListener('touchstart',e=>{
  if(e.touches.length!==1){touchTracking=false;return}
  const t=e.touches[0];
  if(blocked(t.target)){touchTracking=false;return}
  touchStartX=t.clientX;touchStartY=t.clientY;touchStartTime=performance.now();touchTracking=true;
  const curEl=sections[currentSection];
  const atTop=(window.scrollY<=4)&&(!curEl||curEl.scrollTop<=4);
  touchAtTop=atTop&&touchStartY<200;
},{passive:true});

window.addEventListener('touchmove',e=>{
  if(!touchTracking||e.touches.length!==1)return;
  const t=e.touches[0];
  const dx=t.clientX-touchStartX,dy=t.clientY-touchStartY;

  // 1A. Pull down to refresh gesture
  if(touchAtTop&&dy>20&&dy>Math.abs(dx)*1.3){
    const ind=getPullIndicator();
    ind.classList.add('visible');
    if(dy>=75){
      ind.classList.add('ready');
      ind.querySelector('.pull-text').textContent='Release to refresh';
    }else{
      ind.classList.remove('ready');
      ind.querySelector('.pull-text').textContent='Pull down to refresh';
    }
    ind.style.transform=`translate(-50%, ${Math.min(dy - 65, 20)}px)`;
    return;
  }

  // 1B. Horizontal swipe between sections: block mobile browser edge exit gesture
  if(Math.abs(dx)>Math.abs(dy)*1.15&&Math.abs(dx)>8){
    if(e.cancelable)e.preventDefault();
  }
},{passive:false});

window.addEventListener('touchend',e=>{
  if(!touchTracking)return;
  touchTracking=false;
  const t=e.changedTouches[0];
  const dx=t?t.clientX-touchStartX:0;
  const dy=t?t.clientY-touchStartY:0;
  const dt=performance.now()-touchStartTime;

  // Execute refresh if pulled down past threshold
  if(touchAtTop&&dy>=75){
    touchAtTop=false;
    const ind=getPullIndicator();
    ind.classList.add('spinning','ready','visible');
    ind.querySelector('.pull-text').textContent='Refreshing...';
    setTimeout(()=>{window.location.reload()},150);
    return;
  }
  touchAtTop=false;
  if(pullIndicator){
    pullIndicator.classList.remove('visible','ready');
    pullIndicator.style.transform='';
  }

  // 1. Horizontal section transition
  if(dt<800&&Math.abs(dx)>=40&&Math.abs(dx)>Math.abs(dy)*1.2){
    if(dx<0) go(getNextSection(currentSection));
    else go(getPrevSection(currentSection));
    return;
  }

  // 2. Vertical section transition when boundary reached
  if(dt<800&&Math.abs(dy)>=50&&Math.abs(dy)>Math.abs(dx)*1.2){
    const isDown = dy < 0; // swiping up moves down to next section
    const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    const atTop = window.scrollY <= 10;
    const atBottom = maxScroll <= 10 || (window.scrollY >= maxScroll - 20);
    if(isDown && atBottom) go(getNextSection(currentSection));
    else if(!isDown && atTop) go(getPrevSection(currentSection));
  }
},{passive:true});

window.addEventListener('touchcancel',()=>{
  touchTracking=false;
  touchAtTop=false;
  if(pullIndicator){
    pullIndicator.classList.remove('visible','ready');
    pullIndicator.style.transform='';
  }
},{passive:true});

// 2. MOUSE DRAG SWIPE (Desktop mouse pointer)
let ptrStartX=0,ptrStartY=0,ptrStartTime=0,ptrTracking=false;
document.addEventListener('pointerdown',e=>{
  if(e.pointerType!=='mouse'||e.button!==0)return;
  if(blocked(e.target)||(e.target.closest&&e.target.closest('#arena3d')))return;
  ptrStartX=e.clientX;ptrStartY=e.clientY;ptrStartTime=performance.now();ptrTracking=true;
});
document.addEventListener('pointerup',e=>{
  if(!ptrTracking||e.pointerType!=='mouse')return;
  ptrTracking=false;
  const dx=e.clientX-ptrStartX,dy=e.clientY-ptrStartY;
  const dt=performance.now()-ptrStartTime;
  if(dt<800&&Math.abs(dx)>=50&&Math.abs(dx)>Math.abs(dy)*1.4){
    if(!String(window.getSelection()||'').length){
      if(dx<0) go(getNextSection(currentSection));
      else go(getPrevSection(currentSection));
    }
  }
});

// 3. WHEEL & TRACKPAD NAVIGATION (Vertical mouse wheel + horizontal trackpad swipe)
let wheelLock=false,wheelAccX=0,wheelAccY=0,wheelResetTimer=null;
window.addEventListener('wheel',e=>{
  if(blocked(e.target))return;

  // 3A. Horizontal trackpad swipe
  if(Math.abs(e.deltaX)>Math.abs(e.deltaY)*1.15&&Math.abs(e.deltaX)>6){
    if(e.cancelable)e.preventDefault();
    if(wheelLock)return;
    wheelAccX+=e.deltaX;
    clearTimeout(wheelResetTimer);
    wheelResetTimer=setTimeout(()=>{wheelAccX=0;wheelAccY=0;},280);
    if(Math.abs(wheelAccX)>=40){
      wheelLock=true;
      const dir=wheelAccX>0?1:-1;
      wheelAccX=0;
      if(dir>0) go(getNextSection(currentSection));
      else go(getPrevSection(currentSection));
      setTimeout(()=>{wheelLock=false},600);
    }
    return;
  }

  // 3B. Vertical mouse wheel or trackpad scroll
  if(Math.abs(e.deltaY)>Math.abs(e.deltaX)*1.15&&Math.abs(e.deltaY)>6){
    const isDown=e.deltaY>0;
    const maxScroll=Math.max(0,document.documentElement.scrollHeight-window.innerHeight);
    const atTop=window.scrollY<=10;
    const atBottom=maxScroll<=10||(window.scrollY>=maxScroll-16);

    if((isDown&&atBottom)||(!isDown&&atTop)){
      if(e.cancelable)e.preventDefault();
      if(wheelLock)return;
      wheelAccY+=e.deltaY;
      clearTimeout(wheelResetTimer);
      wheelResetTimer=setTimeout(()=>{wheelAccX=0;wheelAccY=0;},280);
      if(Math.abs(wheelAccY)>=40){
        wheelLock=true;
        wheelAccY=0;
        if(isDown) go(getNextSection(currentSection));
        else go(getPrevSection(currentSection));
        setTimeout(()=>{wheelLock=false},600);
      }
    }
  }
},{passive:false});

// 4. KEYBOARD ARROWS
document.addEventListener('keydown',e=>{
  if(e.target.closest&&e.target.closest('input,select,textarea'))return;
  if(document.querySelector('.overlay.show,.admin.show'))return;
  if(e.key==='ArrowRight'||e.key==='ArrowDown'||e.key==='PageDown'){
    go(getNextSection(currentSection));
  }else if(e.key==='ArrowLeft'||e.key==='ArrowUp'||e.key==='PageUp'){
    go(getPrevSection(currentSection));
  }
});

// 5. BROWSER HISTORY INTEGRATION (Back button navigates previous section without leaving site)
window.addEventListener('popstate',e=>{
  if(e.state&&typeof e.state.section==='number'){
    go(e.state.section,false);
  }else if(location.hash&&location.hash.startsWith('#s')){
    const s=parseInt(location.hash.slice(2),10);
    if(!isNaN(s))go(s,false);
  }
});
try{
  const initSec=location.hash&&location.hash.startsWith('#s')?parseInt(location.hash.slice(2),10):0;
  history.replaceState({section:isNaN(initSec)?0:initSec},'',location.hash||'#s0');
}catch(err){}

/* upright event cards - tilt and skew removed */
const grid=$('eventGrid');
if(grid){
  grid.style.setProperty('--rx','0deg');
  grid.style.setProperty('--ry','0deg');
}
document.querySelectorAll('.pager button').forEach(b=>b.addEventListener('click',()=>go(+b.dataset.section)));
})();
function formatModeLabel(m, label){
  if(label==='Website registration'||m==='WEBSITE'||label==='Online registration')return 'Online registration';
  if(label==='Both'||m==='BOTH'||label==='Both on-spot and online registration')return 'Both on-spot and online registration';
  if(label==='On-spot registration'||m==='ON_SPOT')return 'On-spot registration';
  return label||'Online registration';
}
function eventById(id){return events.find(e=>e.id===id||e.code===id)||null}

function openEventDetails(ev){
  if(!ev)return;
  const brochureImg = ev.brochureUrl || ev.imageUrl;
  const topBrochure = brochureImg ? '<div class="detail-brochure-card" data-lightbox-src="'+esc(brochureImg)+'" data-lightbox-title="'+esc(ev.name)+' Brochure &amp; Poster" title="Click to view full screen"><img class="detail-brochure-img" src="'+esc(brochureImg)+'" alt="'+esc(ev.name)+' brochure" onerror="this.parentElement.remove()"><div class="detail-brochure-badge">🔍 Tap to open full screen</div></div>' : '';
  const statusStr = ev.registrationOpen ? 'OPEN' : (ev.closedReason==='FULL'?'FULL':ev.closedReason==='ON_SPOT_ONLY'?'ON-SPOT':ev.closedReason==='CANCELLED'?'CANCELLED':ev.closedReason==='COMPLETED'?'COMPLETED':'CLOSED');
  const metaGrid = '<div class="detail-meta-grid">'
    + '<div class="detail-meta-card"><span class="detail-label">VENUE</span><b class="detail-val">'+esc(ev.venue)+'</b></div>'
    + '<div class="detail-meta-card"><span class="detail-label">DATE &amp; TIME</span><b class="detail-val">'+esc(ev.dateLabel)+' • '+esc(ev.timeLabel)+'</b></div>'
    + '<div class="detail-meta-card"><span class="detail-label">REGISTRATION MODE</span><b class="detail-val">'+esc(formatModeLabel(ev.registrationMode, ev.modeLabel))+'</b></div>'
    + '<div class="detail-meta-card"><span class="detail-label">STATUS</span><b class="detail-val '+(ev.registrationOpen?'st-open':'st-closed')+'">'+statusStr+'</b></div>'
    + '</div>';
  const descBox = '<div class="detail-desc-box"><h4>About this event</h4><p>'+esc(ev.description)+'</p>'
    + (ev.registrationDeadlineLabel ? '<div class="detail-deadline">⏰ Online registration closes: <strong>'+esc(ev.registrationDeadlineLabel)+'</strong></div>' : '')
    + '</div>';
  const body = topBrochure + metaGrid + descBox + (ev.registrationOpen ? '<div class="actions" style="margin-top:14px"><button class="cta" id="detailRegister">Register for this event</button></div>' : '<div class="notice" style="margin-top:14px">'+esc(ev.closedMessage||'Registration is closed for this event.')+'</div>');
  showInfo(ev.name, ev.categoryLabel+' • '+ev.code, body);
  const dr=$('detailRegister');if(dr)dr.onclick=()=>{closeInfo();selectEvent(ev);go(2)};
}


const cardTextureCache = new Map();
const cardImageElementCache = new Map();

function drawEventCardCanvas(ev, img) {
  const width = 520;
  const height = 1000;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  const r = 36;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.lineTo(width - r, 0);
  ctx.arcTo(width, 0, width, r, r);
  ctx.lineTo(width, height - r);
  ctx.arcTo(width, height, width - r, height, r);
  ctx.lineTo(r, height);
  ctx.arcTo(0, height, 0, height - r, r);
  ctx.lineTo(0, r);
  ctx.arcTo(0, 0, r, 0, r);
  ctx.closePath();
  ctx.clip();

  // Clean white card background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  // Top poster image
  const imgH = 400;
  if (img && img.complete && img.naturalWidth) {
    const imgAspect = img.naturalWidth / img.naturalHeight;
    const targetAspect = width / imgH;
    let sx = 0, sy = 0, sw = img.naturalWidth, sh = img.naturalHeight;
    if (imgAspect > targetAspect) {
      sw = sh * targetAspect;
      sx = (img.naturalWidth - sw) / 2;
    } else {
      sh = sw / targetAspect;
      sy = (img.naturalHeight - sh) / 2;
    }
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, width, imgH);
  } else {
    const grad = ctx.createLinearGradient(0, 0, width, imgH);
    grad.addColorStop(0, '#1e293b');
    grad.addColorStop(1, '#0f172a');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, imgH);
  }

  // Neon top accent stripe
  const topStripe = ctx.createLinearGradient(0, 0, width, 0);
  topStripe.addColorStop(0, '#38bdf8');
  topStripe.addColorStop(0.5, '#6366f1');
  topStripe.addColorStop(1, '#ec4899');
  ctx.fillStyle = topStripe;
  ctx.fillRect(0, 0, width, 6);

  // Content area
  const padX = 36;
  const contentTop = imgH + 40;

  // Code: E04
  ctx.fillStyle = '#64748b';
  ctx.font = '700 19px "JetBrains Mono", monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(ev.code || 'E01', padX, contentTop);

  // Category badge: NON-TECHNICAL (pill)
  const catText = (ev.categoryLabel || ev.category || 'EVENT').toUpperCase();
  ctx.font = '700 13px "JetBrains Mono", monospace';
  const catW = ctx.measureText(catText).width;
  const pillW = catW + 32;
  const pillH = 34;
  const pillX = width - padX - pillW;
  const pillY = contentTop - pillH / 2;

  ctx.fillStyle = '#e8efff';
  ctx.beginPath();
  ctx.arc(pillX + pillH / 2, pillY + pillH / 2, pillH / 2, Math.PI / 2, Math.PI * 1.5);
  ctx.arc(pillX + pillW - pillH / 2, pillY + pillH / 2, pillH / 2, -Math.PI / 2, Math.PI / 2);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#3b5bfd';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(catText, pillX + pillW / 2, pillY + pillH / 2);

  // Title: IPL AUCTION
  const titleY = contentTop + 44;
  ctx.fillStyle = '#0f172a';
  ctx.font = '800 32px "DM Sans", sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  
  let title = (ev.name || '').toUpperCase();
  if (ctx.measureText(title).width > (width - padX * 2)) {
    while (title.length > 3 && ctx.measureText(title + '...').width > (width - padX * 2)) {
      title = title.slice(0, -1);
    }
    title += '...';
  }
  ctx.fillText(title, padX, titleY);

  // Description with emojis
  const descY = titleY + 52;
  ctx.fillStyle = '#475569';
  ctx.font = '400 16.5px "DM Sans", sans-serif';
  ctx.textBaseline = 'top';

  const descText = ev.description || 'Experience cutting-edge events at Spark26.';
  const words = descText.split(' ');
  let line = '';
  let lineY = descY;
  let lines = 0;
  for (let n = 0; n < words.length; n++) {
    const test = line + words[n] + ' ';
    if (ctx.measureText(test).width > (width - padX * 2) && n > 0) {
      ctx.fillText(line.trim(), padX, lineY);
      line = words[n] + ' ';
      lineY += 26;
      lines++;
      if (lines >= 4) break;
    } else {
      line = test;
    }
  }
  if (lines < 4 && line.trim()) {
    ctx.fillText(line.trim(), padX, lineY);
  }

  // KV Grid
  const kvTop = 670;
  const col2X = width / 2 + 10;

  // VENUE & TIME
  ctx.fillStyle = '#94a3b8';
  ctx.font = '700 12px "JetBrains Mono", monospace';
  ctx.fillText('VENUE', padX, kvTop);
  ctx.fillText('TIME', col2X, kvTop);

  ctx.fillStyle = '#0f172a';
  ctx.font = '700 19px "DM Sans", sans-serif';
  ctx.fillText(ev.venue || 'Campus Venue', padX, kvTop + 22);
  
  const timeText = (ev.dateLabel || '15 Oct') + ' · ' + (ev.timeLabel ? ev.timeLabel.split('–')[0].trim() : '10:00 AM');
  ctx.font = '700 14.5px "DM Sans", sans-serif';
  ctx.fillText(timeText, col2X, kvTop + 22);

  // MODE & STATUS
  const row2Y = kvTop + 62;
  ctx.fillStyle = '#94a3b8';
  ctx.font = '700 12px "JetBrains Mono", monospace';
  ctx.fillText('MODE', padX, row2Y);
  ctx.fillText('STATUS', col2X, row2Y);

  const modeText = formatModeLabel(ev.registrationMode, ev.modeLabel);
  ctx.fillStyle = '#0f172a';
  ctx.font = modeText.length > 20 ? '700 13px "DM Sans", sans-serif' : '700 19px "DM Sans", sans-serif';
  ctx.fillText(modeText, padX, row2Y + 22);

  const isOpen = ev.registrationOpen;
  ctx.fillStyle = isOpen ? '#2563eb' : '#dc2626';
  ctx.font = '800 18px "DM Sans", sans-serif';
  ctx.fillText(isOpen ? 'OPEN' : 'CLOSED', col2X, row2Y + 22);

  // Action buttons
  const btnY = height - 100;
  const btnH = 54;
  const btnW = (width - padX * 2 - 18) / 2;

  // Register button (purple/blue pill)
  const regX = padX;
  const regGrad = ctx.createLinearGradient(regX, 0, regX + btnW, 0);
  regGrad.addColorStop(0, '#3b5bfd');
  regGrad.addColorStop(1, '#5a38ec');
  ctx.fillStyle = regGrad;
  ctx.beginPath();
  ctx.arc(regX + btnH / 2, btnY + btnH / 2, btnH / 2, Math.PI / 2, Math.PI * 1.5);
  ctx.arc(regX + btnW - btnH / 2, btnY + btnH / 2, btnH / 2, -Math.PI / 2, Math.PI / 2);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#ffffff';
  ctx.font = '700 19px "DM Sans", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Register', regX + btnW / 2, btnY + btnH / 2);

  // Details button (white pill with outline)
  const detX = width / 2 + 9;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(detX + btnH / 2, btnY + btnH / 2, btnH / 2, Math.PI / 2, Math.PI * 1.5);
  ctx.arc(detX + btnW - btnH / 2, btnY + btnH / 2, btnH / 2, -Math.PI / 2, Math.PI / 2);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 1.8;
  ctx.stroke();

  ctx.fillStyle = '#1e293b';
  ctx.font = '700 19px "DM Sans", sans-serif';
  ctx.fillText('Details', detX + btnW / 2, btnY + btnH / 2);

  ctx.restore();

  // Subtle card border
  ctx.save();
  ctx.strokeStyle = 'rgba(219, 234, 254, 0.7)';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.lineTo(width - r, 0);
  ctx.arcTo(width, 0, width, r, r);
  ctx.lineTo(width, height - r);
  ctx.arcTo(width, height, width - r, height, r);
  ctx.lineTo(r, height);
  ctx.arcTo(0, height, 0, height - r, r);
  ctx.lineTo(0, r);
  ctx.arcTo(0, 0, r, 0, r);
  ctx.closePath();
  ctx.stroke();
  ctx.restore();

  return canvas.toDataURL('image/png');
}

function getEventCardTexture(ev, onReady) {
  const imgSrc = ev.imageUrl || ev.brochureUrl || '/images/spark25-showcase-tracks.png';
  const cacheKey = ev.id + '_' + ev.registrationOpen + '_' + imgSrc;
  if (cardTextureCache.has(cacheKey)) {
    return cardTextureCache.get(cacheKey);
  }

  let cachedImg = cardImageElementCache.get(imgSrc);
  if (cachedImg && cachedImg.complete && cachedImg.naturalWidth) {
    const dataUrl = drawEventCardCanvas(ev, cachedImg);
    cardTextureCache.set(cacheKey, dataUrl);
    return dataUrl;
  }

  // Pre-generate with gradient/fallback
  const tempUrl = drawEventCardCanvas(ev, null);
  cardTextureCache.set(cacheKey, tempUrl);

  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    cardImageElementCache.set(imgSrc, img);
    const readyUrl = drawEventCardCanvas(ev, img);
    cardTextureCache.set(cacheKey, readyUrl);
    if (onReady) onReady();
  };
  img.onerror = () => {
    cardImageElementCache.set(imgSrc, img);
  };
  img.src = imgSrc;

  return tempUrl;
}

function updateCircularGallery(){
  const root = $('circularGalleryRoot');
  if(!root || typeof window.mountSparkCircularGallery !== 'function') return;
  if(!events || !events.length) return;

  const filtered = activeFilter === 'ALL' ? events : events.filter(e => e.category === activeFilter);
  let listToDisplay = filtered.length ? [...filtered] : [...events];
  const iplIdx = listToDisplay.findIndex(e => (e.name||'').toLowerCase().includes('ipl') || e.code === 'E04');
  if (iplIdx > 0) {
    const [ipl] = listToDisplay.splice(iplIdx, 1);
    listToDisplay.unshift(ipl);
  }

  let refreshScheduled = false;
  const onPosterReady = () => {
    if (!refreshScheduled) {
      refreshScheduled = true;
      setTimeout(() => { updateCircularGallery(); }, 60);
    }
  };

  const galleryItems = listToDisplay.map(e => ({
    id: e.id,
    image: getEventCardTexture(e, onPosterReady),
    text: e.name,
    description: (e.categoryLabel || 'Spark\'26 Event') + ' • ' + (e.venue || 'Campus Venue') + ' • ' + (e.dateLabel || 'Event Day'),
    alt: e.name + ' poster',
    category: e.category,
    categoryLabel: e.categoryLabel,
    code: e.code
  }));

  window.mountSparkCircularGallery(root, {
    items: galleryItems,
    onItemClick: (item, index, hitLocal) => {
      const ev = eventById(item.id || item.text) || listToDisplay[index] || events[index];
      if (!ev) return;
      // In card texture canvas, bottom button row is at normY <= -0.12
      // Register button is situated on left half (normX <= 0.06)
      const isRegisterClick = hitLocal && hitLocal.normY <= -0.12 && hitLocal.normX <= 0.06;
      if (isRegisterClick) {
        if (!ev.registrationOpen) {
          showInfo(ev.name, 'Registration closed', '<div class="notice">' + esc(ev.closedMessage || 'Registration is closed for this event.') + '</div>');
          return false;
        }
        selectEvent(ev);
        go(2);
        toast('Event selected', 'Fill in your details to register for ' + ev.name);
        return false;
      }
      openEventDetails(ev);
    }
  });
}


function cardMedia(e){const fb='<span>'+esc(e.code)+'</span><b>'+esc(e.categoryLabel)+'</b>';return e.imageUrl?'<div class="card-media"><img loading="lazy" alt="'+esc(e.name)+' poster" src="'+esc(e.imageUrl)+'" onerror="this.onerror=null;this.parentElement.className=\'card-media fallback\';this.parentElement.innerHTML=\''+fb+'\'"></div>':'<div class="card-media fallback">'+fb+'</div>'}
function seatLabel(e){return ''}
function renderEvents(){const q=$('eventSearch')?$('eventSearch').value.trim().toLowerCase():'',grid=$('eventGrid');
const list=events.filter(e=>(activeFilter==='ALL'||e.category===activeFilter)&&(!q||[e.name,e.description,e.venue,e.categoryLabel,e.code].join(' ').toLowerCase().includes(q)));
grid.innerHTML=list.length?list.map(e=>{const open=e.registrationOpen;const statusText=open?'OPEN':(e.closedReason==='FULL'?'FULL':e.closedReason==='ON_SPOT_ONLY'?'ON-SPOT':e.closedReason==='CANCELLED'?'CANCELLED':e.closedReason==='COMPLETED'?'COMPLETED':'CLOSED');
return '<article class="card" data-event="'+esc(e.id)+'">'+cardMedia(e)+'<div class="meta"><span>'+esc(e.code)+'</span><span class="tag">'+esc(e.categoryLabel)+'</span></div><h3>'+esc(e.name)+'</h3><p>'+esc(e.description)+'</p><div class="kv"><div>VENUE<b>'+esc(e.venue)+'</b></div><div>TIME<b>'+esc(e.dateLabel)+' · '+esc(e.timeLabel)+'</b></div><div>MODE<b>'+esc(formatModeLabel(e.registrationMode, e.modeLabel))+'</b></div><div>STATUS<b class="'+(open?'st-open':'st-closed')+'">'+statusText+'</b></div></div><div class="actions"><button class="mini primary" data-reg="'+esc(e.id)+'"'+(open?'':' disabled title="'+esc(e.closedMessage||'Registration closed')+'"')+'>'+(open?'Register':'Registration closed')+'</button><button class="mini" data-info="'+esc(e.id)+'">Details</button></div></article>'}).join(''):'<div class="empty">'+(loadState==='loading'?'Loading events from the server…':loadState==='error'?'Events could not be loaded from the server. Please refresh the page to try again.':'No published events match your search.')+'</div>';
if($('countEvents'))$('countEvents').textContent=String(events.length).padStart(2,'0');
if($('countTechnical'))$('countTechnical').textContent=String(events.filter(e=>e.category==='TECHNICAL').length).padStart(2,'0');
if($('countRegs'))$('countRegs').textContent=String(events.reduce((a,e)=>a+(e.registeredCount||0),0)).padStart(2,'0');updateCircularGallery()}
async function loadEvents(){
  loadState='loading';
  renderEvents();
  try{
    const d=await api('/api/events');
    const list=d.events||[];
    list.forEach(e=>{e.modeLabel=formatModeLabel(e.registrationMode,e.modeLabel);});
    const iplIdx=list.findIndex(e=>(e.name||'').toLowerCase().includes('ipl')||e.code==='E04');
    if(iplIdx>0){
      const [ipl]=list.splice(iplIdx,1);
      list.unshift(ipl);
    }
    events=list;
    loadState='ready';
  }catch(err){
    loadState='error';
    events=[];
    toast('Events unavailable',err.message);
  }
  renderEvents();
  if(selectedId&&!eventById(selectedId))selectedId='';
  if(!selectedId){
    try{
      const params=new URLSearchParams(window.location.search);
      const code=params.get('event');
      if(code&&eventById(code))selectedId=eventById(code).id;
    }catch(_){}
  }
  updateSelected();
}
document.querySelectorAll('.filter[data-filter]').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('.filter[data-filter]').forEach(x=>x.classList.remove('active'));b.classList.add('active');activeFilter=b.dataset.filter;renderEvents()}));
if($('eventSearch'))$('eventSearch').addEventListener('input',renderEvents);
$('eventGrid').addEventListener('click',e=>{const r=e.target.closest('[data-reg]'),d=e.target.closest('[data-info]');
if(r){if(r.disabled)return;const ev=eventById(r.dataset.reg);if(!ev)return;if(!ev.registrationOpen){showInfo(ev.name,'Registration closed','<div class="notice">'+esc(ev.closedMessage||'Registration is closed for this event.')+'</div>');return}selectEvent(ev);go(2)}
if(d){const ev=eventById(d.dataset.info);if(!ev)return;openEventDetails(ev);}});
function selectEvent(ev){if(!ev)return;selectedId=ev.id;updateSelected()}

let currentTeamMembers = [];

function getEventTeamRules(ev){
  if(!ev) return { min: 1, max: 3, name: 'Event', hint: 'Individual or team of up to 3 members.' };
  const norm = String(ev.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const code = String(ev.code || '').toUpperCase();
  if(norm.includes('neuroforge') || norm.includes('neuraforge')){
    return {
      name: 'NeuroForge',
      min: 3,
      max: 4,
      reqMinAdditional: 2,
      maxAdditional: 3,
      hint: 'NeuroForge team rules: Minimum 3 members, maximum 4 members (4th member is optional).'
    };
  }
  if(norm.includes('auragen')){
    return {
      name: 'AuraGen',
      min: 1,
      max: 3,
      reqMinAdditional: 0,
      maxAdditional: 2,
      hint: 'AuraGen team rules: Maximum 3 members (1, 2, or 3 members only — 4th member not allowed).'
    };
  }
  if(norm.includes('creovate')){
    return {
      name: 'Creovate',
      min: 1,
      max: 3,
      reqMinAdditional: 0,
      maxAdditional: 2,
      hint: 'Creovate team rules: 1, 2, or 3 members allowed (minimum 1, maximum 3).'
    };
  }
  if(norm.includes('capturetheflag') || norm.includes('ctf') || code === 'E03'){
    return {
      name: 'Capture the Flag',
      min: 1,
      max: 3,
      reqMinAdditional: 0,
      maxAdditional: 2,
      hint: 'Capture the Flag team rules: 1, 2, or 3 members allowed (minimum 1, maximum 3).'
    };
  }
  return {
    name: ev.name || 'Event',
    min: 1,
    max: 3,
    reqMinAdditional: 0,
    maxAdditional: 2,
    hint: 'Team rules: 1, 2, or 3 members allowed.'
  };
}

function saveTeamInputsToState(){
  const cards = document.querySelectorAll('#teamMembersList [data-member-idx]');
  cards.forEach(card => {
    const idx = +card.dataset.memberIdx;
    if(currentTeamMembers[idx]){
      currentTeamMembers[idx].name = card.querySelector('.m-name')?.value || '';
      currentTeamMembers[idx].registerNumber = card.querySelector('.m-regno')?.value || '';
      currentTeamMembers[idx].department = card.querySelector('.m-dept')?.value || '';
      currentTeamMembers[idx].academicYear = card.querySelector('.m-year')?.value || '';
      currentTeamMembers[idx].section = card.querySelector('.m-section')?.value || '';
      currentTeamMembers[idx].email = card.querySelector('.m-email')?.value || '';
      currentTeamMembers[idx].phone = card.querySelector('.m-phone')?.value || '';
    }
  });
}

function renderTeamForm(){
  const ev = eventById(selectedId) || events[0] || null;
  const rules = getEventTeamRules(ev);
  const total = 1 + currentTeamMembers.length;
  if($('teamRulesLabel')) $('teamRulesLabel').textContent = rules.name + ' Team Members (Lead + ' + currentTeamMembers.length + ' = ' + total + ')';
  if($('teamRulesHint')) $('teamRulesHint').textContent = rules.hint;

  const btn = $('addMemberBtn');
  if(btn){
    if(total >= rules.max){
      btn.disabled = true;
      btn.textContent = '+ Add Member (Max ' + rules.max + ')';
      btn.title = 'Maximum team size reached for ' + rules.name;
    }else{
      btn.disabled = false;
      btn.textContent = '+ Add Member';
      btn.title = '';
    }
  }

  const list = $('teamMembersList');
  if(!list) return;
  if(!currentTeamMembers.length){
    list.innerHTML = (rules.min > 1)
      ? '<div class="notice" style="font-size:12px;padding:8px 12px">This event requires at least ' + rules.min + ' members. Click "+ Add Member" to add team members.</div>'
      : '<div class="helper" style="font-size:12px;color:var(--muted)">No additional members added (individual registration). Click "+ Add Member" to form a team.</div>';
    return;
  }

  list.innerHTML = currentTeamMembers.map((m, idx) => {
    const memNum = idx + 2;
    const isRequired = memNum <= rules.min;
    return '<div class="card" data-member-idx="' + idx + '" style="background:rgba(255,255,255,.9);border:1px solid rgba(87,189,232,.3);border-radius:14px;padding:12px 14px;margin-top:4px">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;flex-wrap:wrap;gap:6px">' +
        '<strong style="font-size:12px;color:var(--ink)">Member ' + memNum + ' ' + (isRequired ? '<span style="color:#d44969;font-size:10px;font-weight:700">(Required)</span>' : '<span style="color:#159873;font-size:10px;font-weight:600">(Optional)</span>') + '</strong>' +
        '<div style="display:flex;gap:6px;align-items:center">' +
          '<button type="button" class="mini make-lead-btn" data-make-lead-idx="' + idx + '" style="padding:3px 10px;font-size:10px;border-radius:999px;background:rgba(91,178,240,.15);color:var(--ink);border:1px solid rgba(91,178,240,.4)" title="Set this member as Team Leader">Set as Team Leader</button>' +
          '<button type="button" class="mini danger remove-member-btn" data-remove-idx="' + idx + '" style="padding:3px 10px;font-size:10px;border-radius:999px">Remove</button>' +
        '</div>' +
      '</div>' +
      '<div class="form-grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px">' +
        '<div class="field"><label class="label">Full name</label><input class="m-name" required placeholder="Member name" value="' + esc(m.name || '') + '"></div>' +
        '<div class="field"><label class="label">Department</label><input class="m-dept" placeholder="CSE" value="' + esc(m.department || '') + '"></div>' +
        '<div class="field"><label class="label">Year</label><select class="m-year"><option value="" disabled' + (!m.academicYear ? ' selected' : '') + '>Select Year</option><option value="I"' + (m.academicYear === 'I' ? ' selected' : '') + '>I</option><option value="II"' + (m.academicYear === 'II' ? ' selected' : '') + '>II</option><option value="III"' + (m.academicYear === 'III' ? ' selected' : '') + '>III</option></select></div>' +
        '<div class="field"><label class="label">Section</label><input class="m-section" placeholder="A" value="' + esc(m.section || '') + '"></div>' +
        '<div class="field"><label class="label">Register number</label><input class="m-regno" required placeholder="Member Reg.No" value="' + esc(m.registerNumber || '') + '"></div>' +
        '<div class="field"><label class="label">Email</label><input class="m-email" type="email" placeholder="member@example.com" value="' + esc(m.email || '') + '"></div>' +
        '<div class="field full"><label class="label">Mobile number</label><input class="m-phone" type="tel" placeholder="10-digit mobile number" value="' + esc(m.phone || '') + '"></div>' +
      '</div>' +
    '</div>';
  }).join('');
}

function syncTeamForEvent(ev){
  const rules = getEventTeamRules(ev);
  if(rules.name === 'NeuroForge'){
    while(currentTeamMembers.length < 2){
      currentTeamMembers.push({ name: '', registerNumber: '', department: '', academicYear: '', section: '', email: '', phone: '' });
    }
  }
  const maxAdd = rules.max - 1;
  if(currentTeamMembers.length > maxAdd){
    currentTeamMembers = currentTeamMembers.slice(0, maxAdd);
  }
  renderTeamForm();
}

if($('addMemberBtn')){
  $('addMemberBtn').onclick = () => {
    saveTeamInputsToState();
    const ev = eventById(selectedId) || events[0] || null;
    const rules = getEventTeamRules(ev);
    if(1 + currentTeamMembers.length >= rules.max) return;
    currentTeamMembers.push({ name: '', registerNumber: '', department: '', academicYear: '', section: '', email: '', phone: '' });
    renderTeamForm();
  };
}

if($('teamMembersList')){
  $('teamMembersList').addEventListener('click', e => {
    const leadBtn = e.target.closest('[data-make-lead-idx]');
    if(leadBtn){
      saveTeamInputsToState();
      const idx = +leadBtn.dataset.makeLeadIdx;
      if(idx >= 0 && idx < currentTeamMembers.length){
        const chosen = currentTeamMembers[idx];
        const oldLead = {
          name: $('rName').value.trim(),
          registerNumber: $('rRegno').value.trim(),
          department: $('rDept').value.trim(),
          academicYear: $('rYear').value,
          section: $('rSection').value.trim(),
          email: $('rEmail').value.trim(),
          phone: $('rPhone') ? $('rPhone').value.trim() : ''
        };
        $('rName').value = chosen.name || '';
        $('rRegno').value = chosen.registerNumber || '';
        $('rDept').value = chosen.department || '';
        if(chosen.academicYear) $('rYear').value = chosen.academicYear;
        if(chosen.section) $('rSection').value = chosen.section;
        if(chosen.email && $('rEmail')) $('rEmail').value = chosen.email;
        if(chosen.phone && $('rPhone')) $('rPhone').value = chosen.phone;
        currentTeamMembers[idx] = oldLead;
        renderTeamForm();
        toast('Team Leader changed', 'Please verify ' + (chosen.name || 'the new leader') + "'s details.");
      }
      return;
    }
    const rm = e.target.closest('[data-remove-idx]');
    if(!rm) return;
    saveTeamInputsToState();
    const idx = +rm.dataset.removeIdx;
    currentTeamMembers.splice(idx, 1);
    renderTeamForm();
  });
  $('teamMembersList').addEventListener('input', () => {
    saveTeamInputsToState();
  });
}

function updateSelected(){
  const e=eventById(selectedId);
  if(!e){
    $('selectedTitle').textContent='Choose an event';
    $('selectedMeta').textContent='Please select an event from the Events catalog to register.';
    $('regSubmit').disabled=true;
    $('regSubmit').textContent='Choose an event to register';
    $('regError').textContent='';
    if($('teamContainer'))$('teamContainer').style.display='none';
    return;
  }
  if($('teamContainer'))$('teamContainer').style.display='';
  selectedId=e.id;
  $('selectedTitle').textContent=e.name;
  $('selectedMeta').textContent=e.categoryLabel+' · '+e.venue+' · '+e.dateLabel+' · '+e.timeLabel+' · '+formatModeLabel(e.registrationMode, e.modeLabel);
  $('regSubmit').disabled=!e.registrationOpen;
  $('regSubmit').textContent=e.registrationOpen?'Generate my pass':'Registration closed';
  $('regError').textContent=e.registrationOpen?'':(e.closedMessage||'');
  prefillStudent();
  syncTeamForEvent(e);
}

$('regForm').addEventListener('submit',async e=>{
e.preventDefault();
const form=e.currentTarget,err=$('regError'),btn=$('regSubmit'),label=btn.textContent;
err.textContent='';
if(!form.checkValidity()){err.textContent='Please complete every field with valid details.';form.reportValidity();return}
const ev=eventById(selectedId);
if(!ev){err.textContent='Please choose an event from the Events page.';go(1);return}
if(!ev.registrationOpen){err.textContent=ev.closedMessage||'Registration is closed for this event.';return}

const yearVal = $('rYear').value;
if(!yearVal || yearVal === 'Select Year' || yearVal === 'Select'){
  err.textContent = 'Please choose a valid Year before generating your pass.';
  $('rYear').focus();
  return;
}

saveTeamInputsToState();
const rules = getEventTeamRules(ev);
const validMembers = currentTeamMembers.filter(m => (m.name || '').trim() || (m.registerNumber || '').trim());
const totalMembers = 1 + validMembers.length;

if(totalMembers < rules.min){
  err.textContent = rules.name + ' requires at least ' + rules.min + ' members (minimum ' + rules.min + ', maximum ' + rules.max + '). Currently: ' + totalMembers + ' member' + (totalMembers === 1 ? '' : 's') + '.';
  return;
}
if(totalMembers > rules.max){
  err.textContent = rules.name + ' allows a maximum of ' + rules.max + ' members. Currently: ' + totalMembers + '.';
  return;
}
for(let idx = 0; idx < validMembers.length; idx++){
  const m = validMembers[idx];
  if(!m.name.trim() || !m.registerNumber.trim()){
    err.textContent = 'Please provide both Full Name and Register Number for Member ' + (idx + 2) + '.';
    return;
  }
}

const emailVal = $('rEmail').value.trim();
if(!emailVal){
  err.textContent = "Please enter the team leader's email address.";
  $('rEmail').focus();
  return;
}
const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
if(!emailRe.test(emailVal)){
  err.textContent = "Please enter a valid email address for the team leader.";
  $('rEmail').focus();
  return;
}

const phoneInput = $('rPhone');
const phoneVal = phoneInput ? phoneInput.value.trim() : '';
if(!phoneVal){
  err.textContent = "Please enter the team leader's mobile number.";
  if(phoneInput) phoneInput.focus();
  return;
}
const cleanPhone = phoneVal.replace(/[\s\-\(\)]/g, '');
const isValidPhone = /^(\+?91|0)?[6-9]\d{9}$/.test(cleanPhone) || /^\d{10,12}$/.test(cleanPhone);
if(!isValidPhone){
  err.textContent = "Please enter a valid 10-digit mobile number for the team leader.";
  if(phoneInput) phoneInput.focus();
  return;
}

const teamNameVal = $('rTeamName') ? $('rTeamName').value.trim() : '';
const payload={eventId:ev.id,teamName:teamNameVal,name:$('rName').value.trim(),registerNumber:$('rRegno').value.trim(),department:$('rDept').value.trim(),academicYear:yearVal,section:$('rSection').value.trim(),email:emailVal,phone:phoneVal,teamMembers:validMembers};
btn.disabled=true;btn.textContent='Creating your pass…';
try{
  const data=await api('/api/registrations',{method:'POST',body:payload});
  trackPass(data.pass);
  store.set(LS_STUDENT,{name:payload.name,registerNumber:payload.registerNumber,department:payload.department,academicYear:payload.academicYear,section:payload.section,email:payload.email,phone:payload.phone});
  form.reset();prefillStudent();currentTeamMembers=[];syncTeamForEvent(ev);
  await loadEvents();
  go(3);renderPass();
  updateSelected();
  const teamHtml = (data.pass.teamMembers && data.pass.teamMembers.length)
    ? '<div style="margin-top:8px;font-size:12px;color:var(--ink)">' +
      (data.pass.teamName ? '<strong>Team:</strong> ' + esc(data.pass.teamName) + '<br>' : '') +
      '<strong>Team (' + (data.pass.teamMembers.length + 1) + '):</strong> ' +
      esc(data.pass.student.name) + ' (Lead), ' +
      esc(data.pass.teamMembers.map(m => m.name + ' (' + m.registerNumber + ')').join(', ')) + '</div>'
    : (data.pass.teamName ? '<div style="margin-top:8px;font-size:12px;color:var(--ink)"><strong>Team:</strong> ' + esc(data.pass.teamName) + '</div>' : '');
  showInfo(
    'Registration confirmed',
    'Your Spark’26 pass is ready',
    '<div class="success">Registration ID <b>' + esc(data.pass.registrationId) + '</b> created for <b>' + esc(data.pass.event.name) + '</b>.' +
    teamHtml +
    '<br><span style="display:inline-block;margin-top:6px">Show the QR pass at the venue for check-in.</span></div>' +
    '<div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap">' +
      '<button class="cta" type="button" id="modalDownloadPdf" style="padding:9px 18px;font-size:12px;border-radius:10px">📄 Download Event Pass (PDF)</button>' +
    '</div>'
  );
  setTimeout(() => {
    const b = $('modalDownloadPdf');
    if (b) b.onclick = () => downloadPassPdf(data.pass);
  }, 50);
  toast('Registration confirmed',data.pass.event.name+' · '+data.pass.registrationId);
}catch(ex){
  err.textContent=ex.message||'Registration failed.';
  if(ex.code==='DUPLICATE_REGISTRATION'&&ex.details&&ex.details.registrationId){err.textContent+=' Existing pass: '+ex.details.registrationId+'.';}
}finally{btn.disabled=false;btn.textContent=(ev&&ev.registrationOpen)?'Generate my pass':'Registration closed'}});

async function loadPasses(){const tokens=store.get(LS_TOKENS,[]);if(!tokens.length){passes=[];return passes}
const out=[];
for(const t of tokens){try{const d=await api('/api/passes/token/'+encodeURIComponent(t));out.push(d.pass)}catch(err){if(err.status===404)continue;throw err}}
passes=out;store.set(LS_TOKENS,out.map(p=>p.qr.token));if(passIndex>=passes.length)passIndex=0;return passes}

async function updatePass(){
  try{
    if(!passes.length)await loadPasses();
    if(!passes.length){
      const s=store.get(LS_STUDENT,null);
      if(s&&s.registerNumber&&s.email){
        try{
          const d=await api('/api/passes/lookup',{method:'POST',body:{registerNumber:s.registerNumber,email:s.email}});
          if(d&&d.passes&&d.passes.length){
            d.passes.forEach(rememberPass);
            passes=d.passes;
          }
        }catch(_){}
      }
    }
  }catch(err){
    toast('Pass unavailable',err.message);
  }
  if(selectedId&&passes.length){
    const matchIdx=passes.findIndex(p=>p.event.id===selectedId||p.event.code===selectedId||(p.event.name&&p.event.name.toLowerCase()===selectedId.toLowerCase()));
    if(matchIdx!==-1)passIndex=matchIdx;
  }
  if(passIndex>=passes.length||passIndex<0)passIndex=0;
  renderPass();
}

function renderPassChips(){const box=$('passSwitcher');if(!box)return;box.innerHTML=passes.length>1?passes.map((p,i)=>'<button class="mini'+(i===passIndex?' primary':'')+'" data-pass="'+i+'" type="button">'+esc(p.event.name)+'</button>').join(''):'';box.classList.toggle('hidden',passes.length<2)}

function renderPass(){const ids=['passEvent','passId','passName','passReg','passCategory','passVenue','passTime','passAttendance'],qr=$('qr'),p=passes[passIndex]||null;
renderPassChips();
if(!p){ids.forEach(id=>$(id).textContent=id==='passEvent'?'No registered events found':'—');$('passStatus').textContent='NO PASS';$('passHint').innerHTML='No registered events found. Select an event from the Events catalog to register and generate your verified pass.';if(qr){qr.classList.remove('has-image');qr.innerHTML='';}$('downloadQr').disabled=true;if($('downloadPdf'))$('downloadPdf').disabled=true;return}
$('passEvent').textContent=p.event.name;$('passId').textContent=p.registrationId;$('passName').textContent=p.student.name;$('passReg').textContent=p.student.registerNumber;
$('passCategory').textContent=p.event.categoryLabel;$('passVenue').textContent=p.event.venue;$('passTime').textContent=p.event.dateLabel+' · '+p.event.timeLabel;
$('passAttendance').textContent=p.attendanceVerified?('PRESENT · '+p.checkedInAtLabel):p.attendanceStatus;
$('passStatus').textContent=p.attendanceVerified?'ATTENDANCE VERIFIED':'QR READY';

let teamDetails='';
if(p.teamMembers&&p.teamMembers.length){
  teamDetails='<div style="margin-top:7px;padding-top:5px;border-top:1px dashed rgba(255,255,255,0.15)">'
    + '<div style="font-weight:700;color:var(--cyan);font-size:10.5px;text-transform:uppercase;letter-spacing:0.5px">Team Members ('+(p.teamMembers.length+1)+' participants):</div>'
    + '<div style="font-size:11px;margin-top:2px"><strong>Team Leader:</strong> '+esc(p.student.name)+' ('+esc(p.student.registerNumber)+' · '+esc(p.student.department)+')</div>'
    + p.teamMembers.map((m,idx)=>'<div style="font-size:11px;margin-top:2px"><strong>Member '+(idx+1)+':</strong> '+esc(m.name)+' ('+esc(m.registerNumber||'—')+(m.department?' · '+esc(m.department):'')+((m.academicYear||m.section)?' · Yr '+esc(m.academicYear||'')+' '+esc(m.section||''):'')+(m.email?' · '+esc(m.email):'')+(m.phone?' · 📱 '+esc(m.phone):'')+')</div>').join('')
    + '</div>';
}else{
  teamDetails='<div style="margin-top:5px;font-size:11px;color:rgba(148,163,184,0.8);font-style:italic">No additional team members.</div>';
}

$('passHint').innerHTML='Registered '+esc(p.createdAtLabel)+' IST · '+esc(p.sourceLabel)+'<br>'+esc(p.student.department)+' · Year '+esc(p.student.academicYear)+' · Section '+esc(p.student.section)+teamDetails+(p.attendanceVerified?'<br>Checked in: '+esc(p.checkedInAtLabel):'');
if(qr){qr.classList.add('has-image');qr.innerHTML='<img alt="QR pass '+esc(p.registrationId)+'" src="'+p.qr.svgDataUrl+'">';}
$('downloadQr').disabled=false;if($('downloadPdf'))$('downloadPdf').disabled=false}
function downloadPassPdf(p){
  if(!p)return;
  if(!window.jspdf||!window.jspdf.jsPDF){
    toast('PDF engine loading','Please wait a moment and try again.');
    return;
  }
  const {jsPDF}=window.jspdf;
  const doc=new jsPDF({orientation:'portrait',unit:'mm',format:'a4'});
  const pw=210,mx=16,cw=pw-(mx*2);
  let y=16;

  function drawPageHeader(titleSuffix = '') {
    doc.setFillColor(20,24,54);
    doc.roundedRect(mx,y,cw,30,4,4,'F');
    doc.rect(mx,y+22,cw,8,'F');

    doc.setFillColor(99,102,241);
    doc.rect(mx,y+29,cw,1.5,'F');

    doc.setTextColor(255,255,255);
    doc.setFont('helvetica','bold');
    doc.setFontSize(15);
    doc.text("SPARK'26",mx+8,y+11);

    doc.setFont('helvetica','normal');
    doc.setFontSize(8);
    doc.setTextColor(199,210,254);
    doc.text('NATIONAL LEVEL TECHNICAL EVENT · CSE',mx+8,y+17);

    doc.setFont('helvetica','bold');
    doc.setFontSize(8.5);
    doc.setTextColor(34,211,238);
    doc.text('OFFICIAL EVENT ENTRY PASS' + titleSuffix,mx+cw-8,y+11,{align:'right'});

    doc.setFont('helvetica','normal');
    doc.setFontSize(7.5);
    doc.setTextColor(224,231,255);
    doc.text('ID: '+p.registrationId,mx+cw-8,y+17,{align:'right'});
    y+=36;
  }

  drawPageHeader();

  // Event Banner
  doc.setFillColor(243,246,253);
  doc.roundedRect(mx,y,cw,18,3,3,'F');
  doc.setDrawColor(224,231,255);
  doc.setLineWidth(0.3);
  doc.roundedRect(mx,y,cw,18,3,3,'S');

  doc.setTextColor(30,41,59);
  doc.setFont('helvetica','bold');
  doc.setFontSize(12.5);
  doc.text(p.event.name||'Event',mx+10,y+8);

  doc.setFont('helvetica','normal');
  doc.setFontSize(8);
  doc.setTextColor(79,70,229);
  doc.text(((p.event.categoryLabel||'TECHNICAL')+' EVENT').toUpperCase(),mx+10,y+14);

  // Status Badge
  doc.setFillColor(209,250,229);
  doc.setDrawColor(16,185,129);
  doc.setLineWidth(0.3);
  doc.roundedRect(mx+cw-48,y+4.5,40,9,2,2,'FD');
  doc.setFont('helvetica','bold');
  doc.setFontSize(7);
  doc.setTextColor(5,150,105);
  doc.text('CONFIRMED PASS',mx+cw-28,y+10.5,{align:'center'});

  y+=24;

  // Event Schedule & QR Box (2 Columns)
  const leftColW=(cw-8)*0.62;
  const rightColW=(cw-8)*0.38;
  const rightColX=mx+leftColW+8;

  // Left: Event Schedule & Details
  doc.setFillColor(248,250,252);
  doc.setDrawColor(226,232,240);
  doc.setLineWidth(0.4);
  doc.roundedRect(mx,y,leftColW,56,3,3,'FD');

  doc.setFont('helvetica','bold');
  doc.setFontSize(8.5);
  doc.setTextColor(71,85,105);
  doc.text('EVENT SCHEDULE & VENUE',mx+8,y+6.5);
  doc.setDrawColor(226,232,240);
  doc.line(mx+8,y+8.5,mx+leftColW-8,y+8.5);

  const drawEventDetail=(label,val,rowY)=>{
    doc.setFont('helvetica','bold');
    doc.setFontSize(7.5);
    doc.setTextColor(100,116,139);
    doc.text(label.toUpperCase(),mx+8,rowY);
    doc.setFont('helvetica','bold');
    doc.setFontSize(9);
    doc.setTextColor(15,23,42);
    doc.text(String(val||'—'),mx+36,rowY);
  };
  let ey=y+14;
  drawEventDetail('Event Date',p.event.dateLabel,ey); ey+=7.5;
  drawEventDetail('Event Time',p.event.timeLabel,ey); ey+=7.5;
  drawEventDetail('Event Venue',p.event.venue,ey); ey+=7.5;
  drawEventDetail('Reg. ID',p.registrationId,ey); ey+=7.5;
  drawEventDetail('Attendance',p.attendanceVerified?'PRESENT':'CONFIRMED',ey);

  // Right: Entry Check-in QR Box
  doc.setFillColor(248,250,252);
  doc.setDrawColor(226,232,240);
  doc.roundedRect(rightColX,y,rightColW,56,3,3,'FD');

  doc.setFont('helvetica','bold');
  doc.setFontSize(8);
  doc.setTextColor(71,85,105);
  doc.text('ENTRY CHECK-IN QR',rightColX+rightColW/2,y+6,{align:'center'});

  const qrSize=32;
  const qrx=rightColX+(rightColW-qrSize)/2;
  const qry=y+9;
  if(p.qr&&p.qr.pngDataUrl){
    doc.addImage(p.qr.pngDataUrl,'PNG',qrx,qry,qrSize,qrSize);
  }
  doc.setFont('helvetica','bold');
  doc.setFontSize(8);
  doc.setTextColor(30,41,59);
  doc.text(p.registrationId,rightColX+rightColW/2,qry+qrSize+5,{align:'center'});

  doc.setFont('helvetica','normal');
  doc.setFontSize(6.5);
  doc.setTextColor(100,116,139);
  doc.text('Scan at venue entrance',rightColX+rightColW/2,qry+qrSize+9,{align:'center'});

  y+=62;

  // ── Team Leader & Team Members Section ──
  doc.setFont('helvetica','bold');
  doc.setFontSize(9.5);
  doc.setTextColor(30,41,59);
  doc.text('TEAM LEADER & TEAM MEMBER DETAILS',mx,y);
  y+=3.5;
  doc.setDrawColor(203,213,225);
  doc.setLineWidth(0.4);
  doc.line(mx,y,mx+cw,y);
  y+=5;

  function drawParticipantCard(roleTitle, person, isLeader = false) {
    const cardH = 26;
    if(y + cardH > 268){
      doc.addPage();
      y = 16;
      drawPageHeader(' (Contd.)');
      doc.setFont('helvetica','bold');
      doc.setFontSize(9.5);
      doc.setTextColor(30,41,59);
      doc.text('TEAM MEMBER DETAILS (CONTINUED)',mx,y);
      y+=3.5;
      doc.setDrawColor(203,213,225);
      doc.line(mx,y,mx+cw,y);
      y+=5;
    }

    doc.setFillColor(isLeader ? 245 : 248, isLeader ? 243 : 250, isLeader ? 255 : 252);
    doc.setDrawColor(isLeader ? 196 : 226, isLeader ? 181 : 232, isLeader ? 253 : 240);
    doc.setLineWidth(0.4);
    doc.roundedRect(mx, y, cw, cardH, 2.5, 2.5, 'FD');

    // Role badge
    doc.setFillColor(isLeader ? 124 : 79, isLeader ? 58 : 70, isLeader ? 237 : 229);
    doc.roundedRect(mx + 6, y + 3, 34, 4.8, 1.5, 1.5, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(255, 255, 255);
    doc.text(roleTitle, mx + 23, y + 6.3, { align: 'center' });

    const col1X = mx + 6;
    const col2X = mx + (cw / 2) + 4;
    let r1 = y + 12;

    // Row 1: Full Name (col 1) | Year & Section (col 2)
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text('FULL NAME:', col1X, r1);
    doc.setFontSize(9);
    doc.setTextColor(15, 23, 42);
    doc.text(String(person.name || '—').slice(0, 28), col1X + 24, r1);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text('YEAR & SEC:', col2X, r1);
    doc.setFontSize(9);
    doc.setTextColor(15, 23, 42);
    const yrSec = [person.academicYear ? 'Year ' + person.academicYear : '', person.section ? 'Sec ' + person.section : ''].filter(Boolean).join(' · ') || '—';
    doc.text(yrSec, col2X + 24, r1);

    // Row 2: Register No (col 1) | Email Address (col 2)
    r1 += 5.5;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text('REG. NO:', col1X, r1);
    doc.setFontSize(9);
    doc.setTextColor(15, 23, 42);
    doc.text(String(person.registerNumber || '—'), col1X + 24, r1);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text('EMAIL:', col2X, r1);
    doc.setFontSize(9);
    doc.setTextColor(15, 23, 42);
    doc.text(String(person.email || '—').slice(0, 30), col2X + 24, r1);

    // Row 3: Department (col 1) | Contact Number (col 2)
    r1 += 5.5;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text('DEPT:', col1X, r1);
    doc.setFontSize(9);
    doc.setTextColor(15, 23, 42);
    doc.text(String(person.department || '—').slice(0, 28), col1X + 24, r1);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text('CONTACT:', col2X, r1);
    doc.setFontSize(9);
    doc.setTextColor(15, 23, 42);
    doc.text(String(person.phone || '—'), col2X + 24, r1);

    y += cardH + 3.5;
  }

  // 1. Draw Team Leader first
  drawParticipantCard('TEAM LEADER', p.student, true);

  // 2. Draw Team Members directly below
  const members = Array.isArray(p.teamMembers) ? p.teamMembers : [];
  if (members.length === 0) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139);
    doc.text('No additional team members.', mx + 4, y + 4);
    y += 9;
  } else {
    members.forEach((m, idx) => {
      drawParticipantCard(`TEAM MEMBER ${idx + 1}`, m, false);
    });
  }

  // Guidelines check overflow
  if (y + 24 > 272) {
    doc.addPage();
    y = 16;
    drawPageHeader(' (Guidelines)');
  }

  y += 2;
  doc.setFont('helvetica','bold');
  doc.setFontSize(7.5);
  doc.setTextColor(71,85,105);
  doc.text('IMPORTANT GUIDELINES FOR ATTENDEES:',mx,y);

  doc.setFont('helvetica','normal');
  doc.setFontSize(6.5);
  doc.setTextColor(100,116,139);
  const instructions=[
    '1. Carry this printed pass or show the QR code directly on your mobile device at the registration desk / hall entry.',
    '2. This pass is strictly non-transferable and valid solely for the participant registered under ID '+p.registrationId+'.',
    '3. Attendees must produce their official College Identity Card upon request during check-in.',
    "4. For any queries or assistance, contact the SPARK'26 event help desk or event coordinators."
  ];
  instructions.forEach((ins,idx)=>{
    doc.text(ins,mx,y+3.8+idx*3.4);
  });

  // Footer inside card
  doc.setFont('helvetica','bold');
  doc.setFontSize(6.5);
  doc.setTextColor(148,163,184);
  doc.text("SPARK'26 TECHNICAL EVENTS · AUTOMATED DIGITAL PASS SYSTEM",mx+cw/2,286,{align:'center'});

  const filename='SPARK26_EventPass_'+p.registrationId+'.pdf';
  const blob=doc.output('blob');
  downloadBlob(blob,filename);
  toast('Pass downloaded',filename);
}
$('refreshPass').onclick=async()=>{passes=[];await updatePass();toast('Pass refreshed','Attendance status was re-checked with the server.')};
$('downloadQr').onclick=()=>{const p=passes[passIndex];if(!p)return;const a=document.createElement('a');a.href=p.qr.pngDataUrl;a.download='Spark26_Pass_'+p.registrationId+'.png';document.body.appendChild(a);a.click();a.remove()};
if($('downloadPdf'))$('downloadPdf').onclick=()=>{const p=passes[passIndex];if(!p)return;downloadPassPdf(p)};
$('passSwitcher').addEventListener('click',e=>{const b=e.target.closest('[data-pass]');if(!b)return;passIndex=+b.dataset.pass;if(passes[passIndex])selectedId=passes[passIndex].event.id;renderPass()});
const lookupForm=$('passLookupForm');
if(lookupForm){
  lookupForm.addEventListener('submit',async e=>{
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
    finally{btn.disabled=false;btn.textContent=label}
  });
}
function showInfo(title,lead,body){$('infoTitle').textContent=title;$('infoLead').textContent=lead;$('infoBody').innerHTML=body;$('infoOverlay').classList.add('show');$('infoOverlay').setAttribute('aria-hidden','false')}function closeInfo(){$('infoOverlay').classList.remove('show');$('infoOverlay').setAttribute('aria-hidden','true')}function openLogin(){$('loginError').textContent='';$('loginPassword').value='';$('loginOverlay').classList.add('show');$('loginOverlay').setAttribute('aria-hidden','false');setTimeout(()=>$('loginPassword').focus(),50)}function closeLogin(){$('loginOverlay').classList.remove('show');$('loginOverlay').setAttribute('aria-hidden','true')}$('closeInfo').onclick=closeInfo;$('closeLogin').onclick=closeLogin;$('infoOverlay').addEventListener('click',e=>{if(e.target===e.currentTarget)closeInfo()});$('loginOverlay').addEventListener('click',e=>{if(e.target===e.currentTarget)closeLogin()});$('navAdmin').onclick=async()=>{if(await restoreSession())await openAdmin();else openLogin()};$('forgotBtn').onclick=()=>showInfo('Password reset','Protected admin access','<div class="notice">Admin passwords are reset by the event coordinator with <b>npm run admin:create -- --email … --rotate</b> (see README). There is no public password-reset endpoint by design.</div>');
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
function closeAdmin(){$('adminPortal').classList.remove('show');$('adminPortal').setAttribute('aria-hidden','true');showAdminMainView();go(currentSection)}
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
  onspot.innerHTML=adminEvents.filter(e=>e.status==='PUBLISHED').map(e=>'<option value="'+esc(e.id)+'">'+esc(e.code+' · '+e.name)+' ('+esc(e.modeLabel)+')</option>').join('')||'<option value="">No published events</option>';
  if(keepOn)onspot.value=keepOn;
  const curOnspot = getSelectedOnspotEvent();
  if(curOnspot) syncOnspotTeamForEvent(curOnspot);
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
    box.innerHTML=rows.length?rows.map((r,i)=>{
      const hasTeam=Array.isArray(r.teamMembers)&&r.teamMembers.length>0;
      const teamTitleHtml = r.teamName ? '<div style="font-size:10.5px;color:var(--cyan);font-weight:700;margin-bottom:2px">TEAM: ' + esc(r.teamName) + '</div>' : '';
      const nameHtml=hasTeam
        ? teamTitleHtml + '<div style="font-weight:700"><span class="badge" style="font-size:9px;background:rgba(124,58,237,0.25);color:#c4b5fd;padding:1px 5px;border-radius:4px;margin-right:4px">LEADER</span>'+esc(r.name)+'</div>'
          + '<div style="margin-top:5px;padding-top:4px;border-top:1px dashed rgba(255,255,255,0.15)">'
          + '<div style="font-size:10px;font-weight:700;color:var(--cyan);text-transform:uppercase;letter-spacing:0.5px">Team Members:</div>'
          + r.teamMembers.map((m,idx)=>'<div style="font-size:11px;margin-top:2px;line-height:1.3"><strong>Member '+(idx+2)+':</strong> '+esc(m.name)+(m.registerNumber?'<br><span class="muted" style="font-size:10px">Reg: '+esc(m.registerNumber)+(m.department?' · '+esc(m.department):'')+((m.academicYear||m.section)?' · '+[m.academicYear?'Yr '+esc(m.academicYear):'',m.section?'Sec '+esc(m.section):''].filter(Boolean).join(' '):'')+((m.email||m.phone)?'<br>'+[m.email?esc(m.email):'',m.phone?'📱 '+esc(m.phone):''].filter(Boolean).join(' · '):'')+'</span>':'')+'</div>').join('')
          + '</div>'
        : (teamTitleHtml + '<strong>'+esc(r.name)+'</strong>');
      const regHtml='<div><strong>'+esc(r.registerNumber)+'</strong>'+(hasTeam?'<br>'+r.teamMembers.map((m,idx)=>'<span class="muted" style="font-size:10px" title="Member '+(idx+2)+'">M'+(idx+2)+': '+esc(m.registerNumber||'—')+'</span>').join('<br>'):'')+'</div>';
      const deptHtml='<div>'+esc(r.department)+(hasTeam?'<br>'+r.teamMembers.map((m,idx)=>'<span class="muted" style="font-size:10px" title="Member '+(idx+2)+'">M'+(idx+2)+': '+esc(m.department||'—')+'</span>').join('<br>'):'')+'</div>';
      const yrHtml='<div>'+esc(r.academicYear)+(hasTeam?'<br>'+r.teamMembers.map((m,idx)=>'<span class="muted" style="font-size:10px" title="Member '+(idx+2)+'">M'+(idx+2)+': '+esc(m.academicYear||'—')+'</span>').join('<br>'):'')+'</div>';
      const secHtml='<div>'+esc(r.section)+(hasTeam?'<br>'+r.teamMembers.map((m,idx)=>'<span class="muted" style="font-size:10px" title="Member '+(idx+2)+'">M'+(idx+2)+': '+esc(m.section||'—')+'</span>').join('<br>'):'')+'</div>';
      return '<tr><td>'+(i+1)+'</td><td><strong>'+esc(r.registrationId)+'</strong><br><span class="muted">'+esc(r.sourceLabel)+'</span></td><td>'+nameHtml+'</td><td>'+regHtml+'</td><td>'+deptHtml+'</td><td>'+yrHtml+'</td><td>'+secHtml+'</td><td>'+esc(r.email)+(r.phone?'<br><span class="muted" style="font-size:10.5px">📱 '+esc(r.phone)+'</span>':'')+'</td><td>'+esc(r.createdAtLabel)+'</td><td><span class="status'+(r.attendanceStatus==='PRESENT'?' ok':'')+'">'+esc(r.attendanceStatus)+'</span>'+(r.checkedInAtLabel?'<br><span class="muted">'+esc(r.checkedInAtLabel)+'</span>':'')+'</td><td><div class="table-actions" style="display:flex;gap:6px;align-items:center"><button class="mini '+(r.attendanceStatus==='PRESENT'?'':'success')+'" data-toggle-att="'+esc(r.dbId)+'" data-next="'+(r.attendanceStatus==='PRESENT'?'PENDING':'PRESENT')+'">'+(r.attendanceStatus==='PRESENT'?'Mark pending':'Mark present')+'</button><button class="mini danger" data-del-reg="'+esc(r.dbId)+'" data-del-name="'+esc(r.name)+'" data-del-code="'+esc(r.registrationId)+'" data-del-event="'+esc(r.eventName)+'" title="Delete registration">Delete</button></div></td></tr>';
    }).join(''):'<tr><td colspan="12" class="muted">No students registered for this event yet.</td></tr>';
  }catch(ex){box.innerHTML='<tr><td colspan="12" class="muted">'+esc(ex.message)+'</td></tr>'}
}
/* ── global registration list ── */
function renderRegsTable(){
  const q=$('regSearch').value.trim().toLowerCase(),filter=$('regEventFilter').value;
  const list=adminRegRows.filter(r=>(filter==='ALL'||r.eventId===filter)&&(!q||[r.registrationId,r.name,r.email,r.phone||'',r.registerNumber,r.eventName,r.teamName||''].join(' ').toLowerCase().includes(q)));
  $('regsTable').innerHTML=list.length?list.map(r=>{
    const hasTeam=Array.isArray(r.teamMembers)&&r.teamMembers.length>0;
    const teamTitleHtml = r.teamName ? '<div style="font-size:10.5px;color:var(--cyan);font-weight:700;margin-bottom:2px">TEAM: ' + esc(r.teamName) + '</div>' : '';
    const participantHtml=hasTeam
      ? teamTitleHtml
        + '<div style="margin-bottom:3px"><span class="badge" style="font-size:9px;background:rgba(124,58,237,0.25);color:#c4b5fd;padding:1px 5px;border-radius:4px;font-weight:700">TEAM LEADER</span> <strong style="margin-left:3px">'+esc(r.name)+'</strong><br><span class="muted" style="font-size:11px">'+esc(r.email)+(r.phone?' · 📱 '+esc(r.phone):'')+'</span></div>'
        + '<div style="margin-top:5px;padding-top:4px;border-top:1px dashed rgba(255,255,255,0.15)">'
        + '<div style="font-size:10px;font-weight:700;color:var(--cyan);text-transform:uppercase;letter-spacing:0.5px">Team Members</div>'
        + r.teamMembers.map((m,idx)=>'<div style="font-size:11px;margin-top:2px;line-height:1.3"><strong>Member '+(idx+2)+':</strong> '+esc(m.name)+(m.registerNumber?' · <span class="muted">Reg: '+esc(m.registerNumber)+'</span>':'')+(m.department?' · <span class="muted">'+esc(m.department)+'</span>':'')+((m.academicYear||m.section)?' · <span class="muted">'+[m.academicYear?'Yr '+esc(m.academicYear):'',m.section?'Sec '+esc(m.section):''].filter(Boolean).join(' ')+'</span>':'')+((m.email||m.phone)?'<br><span class="muted" style="font-size:10px">'+[m.email?esc(m.email):'',m.phone?'📱 '+esc(m.phone):''].filter(Boolean).join(' · ')+'</span>':'')+'</div>').join('')
        + '</div>'
      : (teamTitleHtml + '<strong>'+esc(r.name)+'</strong><br><span class="muted">'+esc(r.email)+(r.phone?' · 📱 '+esc(r.phone):'')+'</span>');
    const academicHtml=hasTeam
      ? '<div><span class="muted" style="font-size:10.5px">Lead:</span> '+esc(r.department)+' · Year '+esc(r.academicYear)+' · '+esc(r.section)+'<br><span class="muted">Reg: '+esc(r.registerNumber)+'</span></div>'
      : esc(r.department)+' · Year '+esc(r.academicYear)+' · '+esc(r.section)+'<br>'+esc(r.registerNumber);
    return '<tr><td>'+participantHtml+'</td><td>'+esc(r.eventName)+'<br><span class="muted">'+esc(r.registrationId)+'</span></td><td>'+academicHtml+'</td><td><span class="status'+(r.attendanceStatus==='PRESENT'?' ok':'')+'">'+esc(r.attendanceStatus)+'</span><br><span class="muted">'+esc(r.sourceLabel)+'</span></td><td><div class="table-actions" style="display:flex;gap:6px;align-items:center"><button class="mini '+(r.attendanceStatus==='PRESENT'?'':'success')+'" data-att-row="'+esc(r.dbId)+'" data-next="'+(r.attendanceStatus==='PRESENT'?'PENDING':'PRESENT')+'">'+(r.attendanceStatus==='PRESENT'?'Verified':'Verify')+'</button><button class="mini danger" data-del-reg="'+esc(r.dbId)+'" data-del-name="'+esc(r.name)+'" data-del-code="'+esc(r.registrationId)+'" data-del-event="'+esc(r.eventName)+'" title="Delete registration">Delete</button></div></td></tr>';
  }).join(''):'<tr><td colspan="5" class="muted">No registrations match the selected filters.</td></tr>';
}
/* ── delete confirmation modal & actions ── */
let pendingDelete=null;
function openDeleteConfirm(item){
  pendingDelete=item;
  if($('delStudentName'))$('delStudentName').textContent=item.name||'Unknown Student';
  if($('delRegistrationCode'))$('delRegistrationCode').textContent=item.code||'';
  if($('delEventName'))$('delEventName').textContent=item.event||'';
  const confirmBtn=$('confirmDeleteBtn'),cancelBtn=$('cancelDeleteBtn');
  if(confirmBtn){confirmBtn.disabled=false;confirmBtn.textContent='Confirm Delete'}
  if(cancelBtn)cancelBtn.disabled=false;
  if($('deleteConfirmOverlay')){$('deleteConfirmOverlay').classList.add('show');$('deleteConfirmOverlay').setAttribute('aria-hidden','false')}
}
function closeDeleteConfirm(){
  if($('deleteConfirmOverlay')){$('deleteConfirmOverlay').classList.remove('show');$('deleteConfirmOverlay').setAttribute('aria-hidden','true')}
  pendingDelete=null;
}
if($('closeDeleteConfirm'))$('closeDeleteConfirm').onclick=closeDeleteConfirm;
if($('cancelDeleteBtn'))$('cancelDeleteBtn').onclick=closeDeleteConfirm;
if($('deleteConfirmOverlay'))$('deleteConfirmOverlay').addEventListener('click',e=>{if(e.target===e.currentTarget)closeDeleteConfirm()});
if($('confirmDeleteBtn'))$('confirmDeleteBtn').onclick=async()=>{
  if(!pendingDelete||!pendingDelete.id)return;
  const btn=$('confirmDeleteBtn'),cancelBtn=$('cancelDeleteBtn');
  if(btn){btn.disabled=true;btn.textContent='Deleting…'}
  if(cancelBtn)cancelBtn.disabled=true;
  try{
    const res=await api('/api/admin/registrations/'+encodeURIComponent(pendingDelete.id),{method:'DELETE'});
    toast('Registration deleted','Removed '+(pendingDelete.code||'registration')+'.');
    closeDeleteConfirm();
    await Promise.all([loadParticipants(),refreshAdmin(),refreshCounts(),refreshPassesFromServer()]);
  }catch(ex){
    toast('Deletion failed',ex.message||'Could not delete registration.');
    if(btn){btn.disabled=false;btn.textContent='Confirm Delete'}
    if(cancelBtn)cancelBtn.disabled=false;
  }
};
$('regsTable').addEventListener('click',async e=>{
  const delBtn=e.target.closest('[data-del-reg]');
  if(delBtn){
    openDeleteConfirm({id:delBtn.dataset.delReg,name:delBtn.dataset.delName,code:delBtn.dataset.delCode,event:delBtn.dataset.delEvent,triggerButton:delBtn});
    return;
  }
  const b=e.target.closest('[data-att-row]');if(!b)return;
  b.disabled=true;
  try{const d=await api('/api/admin/registrations/'+encodeURIComponent(b.dataset.attRow)+'/attendance',{method:'PATCH',body:{attendanceStatus:b.dataset.next}});
    toast('Attendance updated',d.registration.name+' → '+d.registration.attendanceStatus);
    await refreshAdmin();await refreshPassesFromServer();}
  catch(ex){toast('Update failed',ex.message)}finally{b.disabled=false}
});
$('participantsBody').addEventListener('click',async e=>{
  const delBtn=e.target.closest('[data-del-reg]');
  if(delBtn){
    openDeleteConfirm({id:delBtn.dataset.delReg,name:delBtn.dataset.delName,code:delBtn.dataset.delCode,event:delBtn.dataset.delEvent,triggerButton:delBtn});
    return;
  }
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
  const filter=$('regEventFilter').value;
  const url=(filter&&filter!=='ALL')
    ? '/api/admin/events/'+encodeURIComponent(filter)+'/registrations.csv'
    : '/api/admin/export/registrations.csv';
  try{const name=await downloadFile(url,'Spark26_Registrations.csv');toast('CSV ready',name+' saved to your downloads.')}
  catch(ex){toast('Export failed',ex.message)}
};
/* ── event create / edit form ── */
const EVENT_FIELD_MAP={eName:'name',eCategory:'category',eVenue:'venue',eDate:'eventDate',eStart:'startTime',eEnd:'endTime',eMode:'registrationMode',eDesc:'description',eDeadline:'registrationDeadline',eCapacity:'maxCapacity',eStatus:'status'};
function showAdminEventForm(mode='create',ev=null){
  const mainView=$('adminMainView'),formView=$('adminEventCreateView');
  if(mainView)mainView.classList.add('hidden');
  if(formView)formView.classList.remove('hidden');
  $('adminPortal').scrollTo({top:0,behavior:'smooth'});
  if(mode==='edit'&&ev)fillEventForm(ev);
  else{resetEventForm();const f=$('eName');f&&f.focus()}
}
function showAdminMainView(){
  const formView=$('adminEventCreateView'),mainView=$('adminMainView');
  if(formView)formView.classList.add('hidden');
  if(mainView)mainView.classList.remove('hidden');
  $('adminPortal').scrollTo({top:0,behavior:'smooth'});
}
function resetEventForm(){
  $('eventForm').reset();$('editEventId').value='';
  if($('eventPageHeading'))$('eventPageHeading').textContent='Create an Event';
  $('eventFormTitle').textContent='Create an Event';
  $('eventSubmit').textContent='Save Event';
  $('cancelEdit').classList.remove('hidden');
  $('brochurePreview').classList.add('hidden');$('brochurePreview').src='';
  $('imagePreview').classList.add('hidden');$('imagePreview').src='';
  if($('eImageFilename'))$('eImageFilename').textContent='';
  if($('eBrochureFilename'))$('eBrochureFilename').textContent='';
  $('eventFormError').textContent='';$('eStatus').value='PUBLISHED';
}
function fillEventForm(ev){
  $('editEventId').value=ev.id;$('eName').value=ev.name;$('eCategory').value=ev.category;$('eVenue').value=ev.venue;
  $('eDate').value=ev.dateInput;$('eStart').value=ev.startInput;$('eEnd').value=ev.endInput;$('eMode').value=ev.registrationMode;
  $('eDesc').value=ev.description;$('eDeadline').value=ev.registrationDeadlineInput||'';$('eCapacity').value=ev.maxCapacity??'';$('eStatus').value=ev.status;
  if($('eventPageHeading'))$('eventPageHeading').textContent='Edit '+ev.name;
  $('eventFormTitle').textContent='Edit '+ev.name;$('eventSubmit').textContent='Save Event';
  $('cancelEdit').classList.remove('hidden');$('eventFormError').textContent='';
  if(ev.imageUrl){$('imagePreview').src=ev.imageUrl;$('imagePreview').classList.remove('hidden')}else $('imagePreview').classList.add('hidden');
  if(ev.brochureUrl){$('brochurePreview').src=ev.brochureUrl;$('brochurePreview').classList.remove('hidden')}else $('brochurePreview').classList.add('hidden');
  if($('eImageFilename'))$('eImageFilename').textContent=ev.imageUrl?'Current image uploaded':'';
  if($('eBrochureFilename'))$('eBrochureFilename').textContent=ev.brochureName||(ev.brochureUrl?'Current brochure uploaded':'');
}
$('newEventBtn').onclick=()=>showAdminEventForm('create');
$('cancelEdit').onclick=()=>showAdminMainView();
if($('backToEventsBtn'))$('backToEventsBtn').onclick=()=>showAdminMainView();
$('eImage').addEventListener('change',e=>{
  const f=e.target.files[0],fn=$('eImageFilename'),err=$('eventFormError');
  if(!f){if(fn)fn.textContent='';return}
  const allowed=['image/jpeg','image/jpg','image/png','image/webp'];
  if(!allowed.includes(f.type)&&!/\.(jpe?g|png|webp)$/i.test(f.name)){
    err.textContent='Event image must be JPG, PNG, or WEBP.';e.target.value='';
    if(fn)fn.textContent='';$('imagePreview').classList.add('hidden');return;
  }
  if(f.size>5*1024*1024){
    err.textContent='Event image must be 5 MB or smaller.';e.target.value='';
    if(fn)fn.textContent='';$('imagePreview').classList.add('hidden');return;
  }
  err.textContent='';
  if(fn)fn.textContent=f.name+' ('+(f.size/1024).toFixed(1)+' KB)';
  const r=new FileReader();
  r.onload=()=>{$('imagePreview').src=r.result;$('imagePreview').classList.remove('hidden')};
  r.readAsDataURL(f);
});
$('eBrochure').addEventListener('change',e=>{
  const f=e.target.files[0],fn=$('eBrochureFilename'),err=$('eventFormError');
  if(!f){if(fn)fn.textContent='';return}
  if(f.size>10*1024*1024){
    err.textContent='Brochure file must be 10 MB or smaller.';e.target.value='';
    if(fn)fn.textContent='';$('brochurePreview').classList.add('hidden');return;
  }
  err.textContent='';
  if(fn)fn.textContent=f.name+' ('+(f.size/1024).toFixed(1)+' KB)';
  if(f.type.startsWith('image/')){
    const r=new FileReader();
    r.onload=()=>{$('brochurePreview').src=r.result;$('brochurePreview').classList.remove('hidden')};
    r.readAsDataURL(f);
  }else $('brochurePreview').classList.add('hidden');
});
let isSavingEvent=false;
$('eventForm').addEventListener('submit',async e=>{
  e.preventDefault();
  if(isSavingEvent)return;
  const form=e.currentTarget,err=$('eventFormError'),btn=$('eventSubmit'),id=$('editEventId').value,label=btn.textContent;
  err.textContent='';
  if(!form.checkValidity()){err.textContent='Complete the required event details before saving.';form.reportValidity();return}

  const eDate=$('eDate').value,eStart=$('eStart').value,eEnd=$('eEnd').value;
  if(eStart&&eEnd&&eEnd<=eStart){
    err.textContent='End time must be later than the start time.';
    $('eEnd').focus();return;
  }

  const eMode=$('eMode').value,eDeadline=$('eDeadline').value;
  if(eMode!=='ON_SPOT'&&!eDeadline){
    err.textContent='Online registration closing date and time is required when website registration is enabled.';
    $('eDeadline').focus();return;
  }
  if(eDeadline&&eDate&&eStart){
    const startDt=eDate+'T'+eStart;
    if(eDeadline>startDt){
      err.textContent='Online registration closing time cannot be later than the event start time.';
      $('eDeadline').focus();return;
    }
  }

  const eCapacity=$('eCapacity').value;
  if(eCapacity!==''&&(!Number.isInteger(Number(eCapacity))||Number(eCapacity)<1)){
    err.textContent='Maximum participants must be a positive integer.';
    $('eCapacity').focus();return;
  }

  const image=$('eImage').files[0];
  if(image){
    const allowed=['image/jpeg','image/jpg','image/png','image/webp'];
    if(!allowed.includes(image.type)&&!/\.(jpe?g|png|webp)$/i.test(image.name)){
      err.textContent='Event image must be JPG, PNG, or WEBP.';return;
    }
    if(image.size>5*1024*1024){
      err.textContent='Event image must be 5 MB or smaller.';return;
    }
  }

  if(!adminAuthed&&!(await restoreSession())){openLogin();return}
  isSavingEvent=true;btn.disabled=true;btn.textContent='Saving…';
  const fd=new FormData();
  Object.keys(EVENT_FIELD_MAP).forEach(k=>{const el=$(k);if(el)fd.append(EVENT_FIELD_MAP[k],el.value)});
  if(image)fd.append('image',image);
  const brochure=$('eBrochure').files[0];if(brochure)fd.append('brochure',brochure);
  try{
    const d=await api(id?('/api/admin/events/'+encodeURIComponent(id)):'/api/admin/events',{method:id?'PATCH':'POST',form:fd});
    toast(id?'Event updated':'Event saved',d.event.name+' · '+d.event.statusLabel);
    resetEventForm();showAdminMainView();await refreshAdmin();await loadEvents();
  }catch(ex){
    err.textContent=ex.message+(ex.details?(' '+Object.values(ex.details).join(' · ')):'');
  }finally{btn.disabled=false;btn.textContent=label;isSavingEvent=false}
});
$('adminEventsTable').addEventListener('click',async e=>{
  const b=e.target.closest('button');if(!b)return;
  const id=b.dataset.edit||b.dataset.publish||b.dataset.draft||b.dataset.delete||b.dataset.participants||b.dataset.archive;
  const ev=adminEvents.find(x=>x.id===id);if(!ev)return;
  if(b.dataset.edit){showAdminEventForm('edit',ev);const f=$('eName');f&&f.focus();return}
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
let onspotTeamMembers = [];

function saveOnspotTeamInputsToState(){
  const cards = document.querySelectorAll('#onspotTeamMembersList [data-onspot-member-idx]');
  cards.forEach(card => {
    const idx = +card.dataset.onspotMemberIdx;
    if(onspotTeamMembers[idx]){
      const currentMem = onspotTeamMembers[idx];
      currentMem.name = card.querySelector('.m-name')?.value || '';
      currentMem.registerNumber = card.querySelector('.m-regno')?.value || '';
      currentMem.department = card.querySelector('.m-dept')?.value || '';
      currentMem.academicYear = card.querySelector('.m-year')?.value || '';
      currentMem.section = card.querySelector('.m-section')?.value || '';
      currentMem.email = card.querySelector('.m-email')?.value || '';
      currentMem.phone = card.querySelector('.m-phone')?.value || '';
    }
  });
}

function getSelectedOnspotEvent(){
  const sel = $('onspotEventSelect');
  if(!sel || !sel.value) return null;
  return adminEvents.find(e => e.id === sel.value) || eventById(sel.value) || null;
}

function renderOnspotTeamForm(){
  const ev = getSelectedOnspotEvent() || adminEvents[0] || null;
  const rules = getEventTeamRules(ev);
  const total = 1 + onspotTeamMembers.length;
  if($('onspotTeamRulesLabel')) $('onspotTeamRulesLabel').textContent = rules.name + ' Team Members (Lead + ' + onspotTeamMembers.length + ' = ' + total + ')';
  if($('onspotTeamRulesHint')) $('onspotTeamRulesHint').textContent = rules.hint;

  const btn = $('onspotAddMemberBtn');
  if(btn){
    if(total >= rules.max){
      btn.disabled = true;
      btn.textContent = '+ Add Member (Max ' + rules.max + ')';
      btn.title = 'Maximum team size reached for ' + rules.name;
    }else{
      btn.disabled = false;
      btn.textContent = '+ Add Member';
      btn.title = '';
    }
  }

  const list = $('onspotTeamMembersList');
  if(!list) return;
  if(!onspotTeamMembers.length){
    list.innerHTML = (rules.min > 1)
      ? '<div class="notice" style="font-size:12px;padding:8px 12px">This event requires at least ' + rules.min + ' members. Click "+ Add Member" to add team members.</div>'
      : '<div class="helper" style="font-size:12px;color:var(--muted)">No additional members added (individual registration). Click "+ Add Member" to form a team.</div>';
    return;
  }

  list.innerHTML = onspotTeamMembers.map((m, idx) => {
    const memNum = idx + 2;
    const isRequired = memNum <= rules.min;
    return '<div class="card" data-onspot-member-idx="' + idx + '" style="background:rgba(255,255,255,.9);border:1px solid rgba(87,189,232,.3);border-radius:14px;padding:12px 14px;margin-top:4px">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;flex-wrap:wrap;gap:6px">' +
        '<strong style="font-size:12px;color:var(--ink)">Member ' + memNum + ' ' + (isRequired ? '<span style="color:#d44969;font-size:10px;font-weight:700">(Required)</span>' : '<span style="color:#159873;font-size:10px;font-weight:600">(Optional)</span>') + '</strong>' +
        '<div style="display:flex;gap:6px;align-items:center">' +
          '<button type="button" class="mini make-lead-btn" data-onspot-make-lead-idx="' + idx + '" style="padding:3px 10px;font-size:10px;border-radius:999px;background:rgba(91,178,240,.15);color:var(--ink);border:1px solid rgba(91,178,240,.4)" title="Set this member as Team Leader">Set as Team Leader</button>' +
          '<button type="button" class="mini danger remove-member-btn" data-onspot-remove-idx="' + idx + '" style="padding:3px 10px;font-size:10px;border-radius:999px">Remove</button>' +
        '</div>' +
      '</div>' +
      '<div class="form-grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px">' +
        '<div class="field"><label class="label">Full name</label><input class="m-name" required placeholder="Member name" value="' + esc(m.name || '') + '"></div>' +
        '<div class="field"><label class="label">Department</label><input class="m-dept" placeholder="CSE" value="' + esc(m.department || '') + '"></div>' +
        '<div class="field"><label class="label">Year</label><select class="m-year"><option value="" disabled' + (!m.academicYear ? ' selected' : '') + '>Select Year</option><option value="I"' + (m.academicYear === 'I' ? ' selected' : '') + '>I</option><option value="II"' + (m.academicYear === 'II' ? ' selected' : '') + '>II</option><option value="III"' + (m.academicYear === 'III' ? ' selected' : '') + '>III</option></select></div>' +
        '<div class="field"><label class="label">Section</label><input class="m-section" placeholder="A" value="' + esc(m.section || '') + '"></div>' +
        '<div class="field"><label class="label">Register number</label><input class="m-regno" required placeholder="Member Reg.No" value="' + esc(m.registerNumber || '') + '"></div>' +
        '<div class="field"><label class="label">Email</label><input class="m-email" type="email" placeholder="member@example.com" value="' + esc(m.email || '') + '"></div>' +
        '<div class="field full"><label class="label">Mobile number</label><input class="m-phone" type="tel" placeholder="10-digit mobile number" value="' + esc(m.phone || '') + '"></div>' +
      '</div>' +
    '</div>';
  }).join('');
}

function syncOnspotTeamForEvent(ev){
  const rules = getEventTeamRules(ev);
  if(rules.name === 'NeuroForge'){
    while(onspotTeamMembers.length < 2){
      onspotTeamMembers.push({ name: '', registerNumber: '', department: '', academicYear: '', section: '', email: '', phone: '' });
    }
  }
  const maxAdd = rules.max - 1;
  if(onspotTeamMembers.length > maxAdd){
    onspotTeamMembers = onspotTeamMembers.slice(0, maxAdd);
  }
  renderOnspotTeamForm();
}

if($('onspotAddMemberBtn')){
  $('onspotAddMemberBtn').onclick = () => {
    saveOnspotTeamInputsToState();
    const ev = getSelectedOnspotEvent() || adminEvents[0] || null;
    const rules = getEventTeamRules(ev);
    if(1 + onspotTeamMembers.length >= rules.max) return;
    onspotTeamMembers.push({ name: '', registerNumber: '', department: '', academicYear: '', section: '', email: '', phone: '' });
    renderOnspotTeamForm();
  };
}

if($('onspotTeamMembersList')){
  $('onspotTeamMembersList').addEventListener('click', e => {
    const leadBtn = e.target.closest('[data-onspot-make-lead-idx]');
    if(leadBtn){
      saveOnspotTeamInputsToState();
      const idx = +leadBtn.dataset.onspotMakeLeadIdx;
      if(idx >= 0 && idx < onspotTeamMembers.length){
        const chosen = onspotTeamMembers[idx];
        const oldLead = {
          name: $('spotName').value.trim(),
          registerNumber: $('spotRegno').value.trim(),
          department: $('spotDept').value.trim(),
          academicYear: $('spotYear').value,
          section: $('spotSection').value.trim(),
          email: $('spotEmail').value.trim(),
          phone: $('spotPhone') ? $('spotPhone').value.trim() : ''
        };
        $('spotName').value = chosen.name || '';
        $('spotRegno').value = chosen.registerNumber || '';
        $('spotDept').value = chosen.department || '';
        if(chosen.academicYear) $('spotYear').value = chosen.academicYear;
        if(chosen.section) $('spotSection').value = chosen.section;
        if(chosen.email && $('spotEmail')) $('spotEmail').value = chosen.email;
        if(chosen.phone && $('spotPhone')) $('spotPhone').value = chosen.phone;
        onspotTeamMembers[idx] = oldLead;
        renderOnspotTeamForm();
        toast('Team Leader changed', 'Please verify ' + (chosen.name || 'the new leader') + "'s details.");
      }
      return;
    }
    const rm = e.target.closest('[data-onspot-remove-idx]');
    if(!rm) return;
    saveOnspotTeamInputsToState();
    const idx = +rm.dataset.onspotRemoveIdx;
    onspotTeamMembers.splice(idx, 1);
    renderOnspotTeamForm();
  });
  $('onspotTeamMembersList').addEventListener('input', () => {
    saveOnspotTeamInputsToState();
  });
}

if($('onspotEventSelect')){
  $('onspotEventSelect').addEventListener('change', () => {
    const ev = getSelectedOnspotEvent();
    if(ev) syncOnspotTeamForEvent(ev);
  });
}

$('onspotForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const f=e.currentTarget,msg=$('onspotMsg'),btn=$('onspotSubmit'),label=btn.textContent;
  msg.textContent='';
  if(!f.checkValidity()){
    msg.textContent='Please complete every field with valid details.';
    f.reportValidity();
    return;
  }
  const eventId=$('onspotEventSelect').value;
  if(!eventId){
    msg.textContent='Please choose an event.';
    return;
  }
  const ev=getSelectedOnspotEvent();
  if(!ev){
    msg.textContent='Selected event is not found.';
    return;
  }

  const spotYearVal=$('spotYear').value;
  if(!spotYearVal || spotYearVal === 'Select Year' || spotYearVal === 'Select'){
    msg.textContent='Please choose a valid Year before registering on-spot.';
    $('spotYear').focus();
    return;
  }

  saveOnspotTeamInputsToState();
  const rules = getEventTeamRules(ev);
  const validMembers = onspotTeamMembers.filter(m => (m.name || '').trim() || (m.registerNumber || '').trim());
  const totalMembers = 1 + validMembers.length;

  if(totalMembers < rules.min){
    msg.textContent = rules.name + ' requires at least ' + rules.min + ' members (minimum ' + rules.min + ', maximum ' + rules.max + '). Currently: ' + totalMembers + ' member' + (totalMembers === 1 ? '' : 's') + '.';
    return;
  }
  if(totalMembers > rules.max){
    msg.textContent = rules.name + ' allows a maximum of ' + rules.max + ' members. Currently: ' + totalMembers + '.';
    return;
  }
  for(let idx = 0; idx < validMembers.length; idx++){
    const m = validMembers[idx];
    if(!m.name.trim() || !m.registerNumber.trim()){
      msg.textContent = 'Please provide both Full Name and Register Number for Member ' + (idx + 2) + '.';
      return;
    }
  }

  const spotEmailVal = $('spotEmail').value.trim();
  if(!spotEmailVal){
    msg.textContent = "Please enter the team leader's email address.";
    $('spotEmail').focus();
    return;
  }
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if(!emailRe.test(spotEmailVal)){
    msg.textContent = "Please enter a valid email address for the team leader.";
    $('spotEmail').focus();
    return;
  }

  const phoneInput = $('spotPhone');
  const spotPhoneVal = phoneInput ? phoneInput.value.trim() : '';
  if(!spotPhoneVal){
    msg.textContent = "Please enter the team leader's mobile number.";
    if(phoneInput) phoneInput.focus();
    return;
  }
  const cleanPhone = spotPhoneVal.replace(/[\s\-\(\)]/g, '');
  const isValidPhone = /^(\+?91|0)?[6-9]\d{9}$/.test(cleanPhone) || /^\d{10,12}$/.test(cleanPhone);
  if(!isValidPhone){
    msg.textContent = "Please enter a valid 10-digit mobile number for the team leader.";
    if(phoneInput) phoneInput.focus();
    return;
  }

  btn.disabled=true;btn.textContent='Registering…';
  try{
    const teamNameVal = $('spotTeamName') ? $('spotTeamName').value.trim() : '';
    const payload = {
      eventId,
      teamName: teamNameVal,
      name: $('spotName').value.trim(),
      registerNumber: $('spotRegno').value.trim(),
      department: $('spotDept').value.trim(),
      academicYear: spotYearVal,
      section: $('spotSection').value.trim(),
      email: spotEmailVal,
      phone: spotPhoneVal,
      teamMembers: validMembers
    };

    const d=await api('/api/admin/registrations',{method:'POST',body:payload});
    msg.textContent='Pass created · '+d.pass.registrationId;
    toast('On-spot registration',d.pass.student.name+' → '+d.pass.event.name);

    const teamHtml = (d.pass.teamMembers && d.pass.teamMembers.length)
      ? '<div style="margin-top:8px;font-size:12px;color:var(--ink)">' +
        (d.pass.teamName ? '<strong>Team:</strong> ' + esc(d.pass.teamName) + '<br>' : '') +
        '<strong>Team (' + (d.pass.teamMembers.length + 1) + '):</strong> ' +
        esc(d.pass.student.name) + ' (Lead), ' +
        esc(d.pass.teamMembers.map(m => m.name + ' (' + m.registerNumber + ')').join(', ')) + '</div>'
      : (d.pass.teamName ? '<div style="margin-top:8px;font-size:12px;color:var(--ink)"><strong>Team:</strong> ' + esc(d.pass.teamName) + '</div>' : '');

    showInfo(
      'On-spot pass created',
      d.pass.registrationId+' · '+d.pass.sourceLabel,
      '<div class="success">'+esc(d.pass.student.name)+' ('+esc(d.pass.student.registerNumber)+') registered for '+esc(d.pass.event.name)+'.'+
      teamHtml+
      '<br><span style="display:inline-block;margin-top:6px">Scan this QR at the desk or download the official PDF pass.</span></div>'+
      '<div class="qr-inline"><img alt="QR pass" src="'+d.pass.qr.svgDataUrl+'"></div>'+
      '<div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap;justify-content:center">'+
        '<button class="cta" type="button" id="onspotDownloadPdf" style="padding:9px 18px;font-size:12px;border-radius:10px">📄 Download Event Pass (PDF)</button>'+
      '</div>'
    );
    setTimeout(() => {
      const b = $('onspotDownloadPdf');
      if (b) b.onclick = () => downloadPassPdf(d.pass);
    }, 50);

    f.reset();
    onspotTeamMembers = [];
    syncOnspotTeamForEvent(ev);
    await refreshAdmin();
    await loadEvents();
  }catch(ex){
    msg.textContent=ex.message||'On-spot registration failed.';
  }finally{
    btn.disabled=false;
    btn.textContent=label;
  }
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
/* ── Home Showcase Gallery & Lightbox Controller ── */
let currentZoom = 1;
server.galleryImages = [];

function renderHomeGallery(imgs){
  const grid = $('homeShowcaseGrid'), wrap = $('homeShowcase');
  if(!grid || !wrap) return;
  const list = Array.isArray(imgs) ? imgs.filter(Boolean) : (imgs ? [imgs] : []);
  if(!list.length){
    wrap.classList.add('hidden');
    grid.innerHTML = '';
    return;
  }
  grid.innerHTML = list.map((src, i) =>
    '<div class="showcase-card" data-lightbox-src="'+esc(src)+'" data-lightbox-title="Event Poster '+(i+1)+'">'
    + '<img src="'+esc(src)+'" alt="Event Poster '+(i+1)+'" loading="lazy">'
    + '<div class="zoom-pill">🔍 Tap full screen</div>'
    + '</div>'
  ).join('');
  wrap.classList.remove('hidden');
}

function renderAdminGallery(){
  const box = $('adminGalleryList');
  if(!box) return;
  const list = server.galleryImages || [];
  if(!list.length){
    box.innerHTML = '<span class="helper">No photos uploaded yet.</span>';
    return;
  }
  box.innerHTML = list.map((src, i) =>
    '<div class="admin-gallery-item">'
    + '<img src="'+esc(src)+'" alt="Gallery item '+(i+1)+'">'
    + '<button class="del-btn" data-del-img="'+i+'" type="button" title="Delete this image">✕</button>'
    + '</div>'
  ).join('');
}

function openLightbox(src, title){
  const overlay = $('lightboxOverlay'), img = $('lightboxImg'), t = $('lightboxTitle');
  if(!overlay || !img) return;
  img.src = src;
  if(t) t.textContent = title || 'Brochure Viewer';
  currentZoom = 1;
  img.style.transform = 'scale(1)';
  overlay.classList.add('show');
  overlay.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
}

function closeLightbox(){
  const overlay = $('lightboxOverlay'), img = $('lightboxImg');
  if(!overlay) return;
  overlay.classList.remove('show');
  overlay.setAttribute('aria-hidden', 'true');
  if(img){ img.src = ''; img.style.transform = 'scale(1)'; }
  document.body.style.overflow = '';
}

function setLightboxZoom(delta, absolute){
  const img = $('lightboxImg');
  if(!img) return;
  if(absolute !== undefined) currentZoom = absolute;
  else currentZoom = Math.min(3.5, Math.max(0.6, currentZoom + delta));
  img.style.transform = 'scale(' + currentZoom.toFixed(2) + ')';
  const rBtn = $('lightboxZoomReset');
  if(rBtn) rBtn.textContent = Math.round(currentZoom * 100) + '%';
}

document.addEventListener('click', e => {
  const trigger = e.target.closest('[data-lightbox-src]');
  if(trigger){
    e.preventDefault();
    openLightbox(trigger.dataset.lightboxSrc, trigger.dataset.lightboxTitle);
    return;
  }
  const delBtn = e.target.closest('[data-del-img]');
  if(delBtn){
    e.preventDefault();
    const idx = parseInt(delBtn.dataset.delImg, 10);
    deleteGalleryImg(idx);
    return;
  }
});

async function deleteGalleryImg(idx){
  if(!adminAuthed && !(await restoreSession())){ openLogin(); return; }
  $('heroMsg').textContent = 'Removing photo…';
  try{
    const d = await api('/api/admin/settings/home-gallery/' + idx, { method: 'DELETE' });
    server.galleryImages = d.homeGalleryImages || [];
    renderHomeGallery(server.galleryImages);
    renderAdminGallery();
    $('heroMsg').textContent = 'Photo removed.';
    toast('Photo removed', 'Gallery updated.');
  }catch(ex){
    $('heroMsg').textContent = ex.message;
  }
}

if($('lightboxClose')) $('lightboxClose').addEventListener('click', closeLightbox);
if($('lightboxZoomIn')) $('lightboxZoomIn').addEventListener('click', () => setLightboxZoom(0.3));
if($('lightboxZoomOut')) $('lightboxZoomOut').addEventListener('click', () => setLightboxZoom(-0.3));
if($('lightboxZoomReset')) $('lightboxZoomReset').addEventListener('click', () => setLightboxZoom(0, 1));
if($('lightboxViewport')) $('lightboxViewport').addEventListener('click', e => {
  if(e.target === $('lightboxViewport')) closeLightbox();
  else if(e.target === $('lightboxImg')) {
    setLightboxZoom(0, currentZoom === 1 ? 1.6 : 1);
  }
});
window.addEventListener('keydown', e => {
  if(e.key === 'Escape' && $('lightboxOverlay') && $('lightboxOverlay').classList.contains('show')){
    closeLightbox();
  }
});

/* ── home page photo & gallery upload ── */
$('heroFile').addEventListener('change', async e => {
  const files = Array.from(e.target.files);
  if(!files.length) return;
  const oversized = files.filter(f => f.size > 4.8 * 1024 * 1024);
  if(oversized.length){
    $('heroMsg').textContent = 'Each image must be smaller than 4.8 MB.';
    return;
  }
  if(!adminAuthed && !(await restoreSession())){ openLogin(); return; }
  $('heroMsg').textContent = 'Uploading ' + files.length + ' photo' + (files.length > 1 ? 's' : '') + '…';
  const fd = new FormData();
  files.forEach(f => {
    fd.append('images', f);
  });
  if(files[0]) fd.append('image', files[0]);
  try{
    const d = await api('/api/admin/settings/home-hero', { method: 'POST', form: fd });
    server.galleryImages = d.homeGalleryImages || [];
    renderHomeGallery(server.galleryImages);
    renderAdminGallery();
    $('heroFile').value = '';
    $('heroMsg').textContent = files.length + ' photo' + (files.length > 1 ? 's' : '') + ' added to the showcase.';
    toast('Photos uploaded', 'Live on the Home page showcase.');
  }catch(ex){
    $('heroMsg').textContent = ex.message;
  }
});

$('heroReset').addEventListener('click', async () => {
  if(!adminAuthed && !(await restoreSession())){ openLogin(); return; }
  $('heroMsg').textContent = 'Clearing photos…';
  try{
    await api('/api/admin/settings/home-hero', { method: 'DELETE' });
    server.galleryImages = [];
    renderHomeGallery([]);
    renderAdminGallery();
    $('heroFile').value = '';
    $('heroMsg').textContent = 'All photos removed from the showcase.';
    toast('Photos cleared', 'Showcase reset.');
  }catch(ex){
    $('heroMsg').textContent = ex.message;
  }
});

/* ═════════════════════════════ BOOT ═════════════════════════════ */
(async function boot(){
  try{
    const d = await api('/api/settings');
    server.galleryImages = d.settings.homeGalleryImages || (d.settings.homeHeroImageUrl ? [d.settings.homeHeroImageUrl] : []);
    renderHomeGallery(server.galleryImages);
    renderAdminGallery();
  }catch(ex){}
  await loadEvents();
  prefillStudent();
  renderEvents();updateSelected();
  try{await updatePass()}catch(ex){}
  renderAdminStats();
  await restoreSession();   /* keeps an existing admin session alive across refreshes */
})();
})();
