#!/usr/bin/env python3
"""Spark'26 frontend patch (HTML): add the mobile Contact link, real-input admin form fields,
participant list, QR scanner panel, on-spot registration, pass retrieval UI and additive styles.
The existing design, sections, IDs and animations are preserved."""
P = '/home/user/spark26/public/index.html'
src = open(P, encoding='utf-8').read()


def one(anchor):
    n = src.count(anchor)
    if n != 1:
        raise SystemExit('anchor appears %d times: %r' % (n, anchor[:110]))
    return src.index(anchor)


def replace(old, new, label):
    global src
    if src.count(old) != 1:
        raise SystemExit('count %d for %s' % (src.count(old), label))
    src = src.replace(old, new)
    print('  ✓', label)


# 1 ── mobile Contact link in the main nav (visible on phones, like the Admin link)
replace(
    '<a data-section="3">My Pass</a><a data-section="4">Contacts</a><button class="cta nav-cta" id="navReg">Register now</button>',
    '<a data-section="3">My Pass</a><a data-section="4" class="nav-contact">Contact</a><a data-section="4" class="nav-contacts-desktop">Contacts</a><button class="cta nav-cta" id="navReg">Register now</button>',
    'mobile Contact link',
)

# 2 ── admin login: no prefilled demo email, identifiable submit button
replace(
    '<input id="loginEmail" type="email" required autocomplete="username" value="admin@spark26.local">',
    '<input id="loginEmail" type="email" required autocomplete="username" placeholder="you@college.edu">',
    'login email placeholder',
)
replace('<button class="cta" type="submit">Open admin</button>', '<button class="cta" type="submit" id="loginSubmit">Open admin</button>', 'login submit id')

# 3 ── My Pass: switcher, hint, QR download
replace(
    '<div class="actions" style="justify-content:flex-start"><button class="mini primary" id="refreshPass">Refresh pass</button></div>',
    '<div class="pass-switcher hidden" id="passSwitcher"></div><p class="helper pass-hint" id="passHint"></p>'
    '<div class="actions" style="justify-content:flex-start"><button class="mini primary" id="refreshPass">Refresh pass</button>'
    '<button class="mini" id="downloadQr" type="button" disabled>Download QR</button></div>',
    'pass switcher + hint + download',
)

# 4 ── My Pass: secure retrieval panel
PASS_LOOKUP = (
    '</div><div class="pass-grid" style="margin-top:18px"><div class="panel" style="grid-column:1/-1">'
    '<span class="label">Pass retrieval</span><h3>Find my pass</h3>'
    '<p class="helper">Passes are private to each student. Enter the register number and email you registered with to restore your passes on this device — '
    'a registration ID alone is never enough to open someone else’s pass.</p>'
    '<form id="passLookupForm"><div class="form-grid">'
    '<div class="field"><label class="label" for="lookupRegno">Register number</label><input id="lookupRegno" required placeholder="24CSE001"></div>'
    '<div class="field"><label class="label" for="lookupEmail">Email</label><input id="lookupEmail" type="email" required placeholder="you@example.com"></div>'
    '</div><div id="passLookupMsg" class="form-error" role="alert"></div>'
    '<div class="actions"><button class="cta" type="submit" id="passLookupBtn">Find my pass</button></div></form>'
    '</div></div></section>'
)
replace('<div class="qrbox"><div id="qr" class="qr" aria-label="QR pass"></div></div></div></section>',
        '<div class="qrbox"><div id="qr" class="qr" aria-label="QR pass"></div></div></div>' + PASS_LOOKUP,
        'pass retrieval panel')

# 5 ── admin event form: real date/time, deadline, capacity, status, event image upload
replace(
    '<div class="field"><label class="label" for="eTime">Date &amp; time</label><input id="eTime" required placeholder="18 Oct · 10:00 AM"></div>',
    '<div class="field"><label class="label" for="eDate">Event date</label><input id="eDate" type="date" required></div>'
    '<div class="field"><label class="label" for="eStart">Start time (IST)</label><input id="eStart" type="time" required value="10:00"></div>'
    '<div class="field"><label class="label" for="eEnd">End time (IST)</label><input id="eEnd" type="time" required value="12:00"></div>'
    '<div class="field"><label class="label" for="eDeadline">Online registration closes (IST)</label><input id="eDeadline" type="datetime-local"></div>'
    '<div class="field"><label class="label" for="eCapacity">Maximum participants (optional)</label><input id="eCapacity" type="number" min="1" max="2000" placeholder="No limit"></div>'
    '<div class="field"><label class="label" for="eStatus">Status</label><select id="eStatus"><option value="DRAFT">Draft</option><option value="PUBLISHED">Published</option><option value="COMPLETED">Completed</option><option value="CANCELLED">Cancelled</option></select></div>',
    'event date/time/capacity/status fields',
)
replace(
    '<div class="field full"><label class="label" for="eBrochure">Brochure / poster (optional)</label>',
    '<div class="field full"><label class="label" for="eImage">Event image / poster (JPG, PNG or WEBP · max 5 MB)</label>'
    '<input class="file-input" id="eImage" type="file" accept="image/png,image/jpeg,image/webp">'
    '<img id="imagePreview" class="preview hidden" alt="Event image preview"></div>'
    '<div class="field full"><label class="label" for="eBrochure">Brochure / poster (optional)</label>',
    'event image upload field',
)

# 6 ── admin panels: participants, scanner, on-spot registration
ADMIN_PANELS = (
    '<tbody id="regsTable"></tbody></table></div></section>'
    '<section class="admin-panel" id="participantsPanel" style="margin-top:17px"><h3>Event participants</h3>'
    '<div class="admin-filters">'
    '<select class="filter" id="adminEventSelect" aria-label="Select an event"></select>'
    '<label class="search"><span>⌕</span><input id="participantSearch" placeholder="Search name, email, register no. or ID" aria-label="Search participants"></label>'
    '<select class="filter" id="participantAttFilter" aria-label="Filter by attendance"><option value="ALL">All attendance</option><option value="PENDING">Pending</option><option value="PRESENT">Present</option><option value="ABSENT">Absent</option></select>'
    '<button class="mini primary" id="downloadEventXlsx" type="button">Download Excel</button>'
    '<button class="mini" id="downloadMasterXlsx" type="button">Master workbook</button></div>'
    '<div class="participant-head"><div><h4 id="participantTitle">Select an event</h4><span class="helper" id="participantMeta"></span></div>'
    '<span class="status" id="participantCount">0 registered</span></div>'
    '<div class="table-wrap"><table class="data-table"><thead><tr><th>#</th><th>REGISTRATION</th><th>NAME</th><th>REGISTER NO.</th><th>DEPARTMENT</th><th>YEAR</th><th>SEC</th><th>EMAIL</th><th>REGISTERED</th><th>ATTENDANCE</th><th>ACTION</th></tr></thead>'
    '<tbody id="participantsBody"></tbody></table></div>'
    '<div class="notice" style="margin-top:12px">Workbooks are generated on the server from the live database. Download after check-in so the attendance columns are current. '
    'Attendance can only be changed here or at the scanner — never by editing the exported file.</div></section>'
    '<section class="admin-panel" id="scanPanel" style="margin-top:17px"><h3>QR check-in scanner</h3>'
    '<div class="admin-filters"><select class="filter" id="scanEventSelect" aria-label="Event being checked in"></select>'
    '<button class="cta" id="scanStart" type="button">Start camera</button>'
    '<button class="mini danger" id="scanStop" type="button" disabled>Stop camera</button></div>'
    '<div class="scan-layout"><div class="scan-stage"><div id="scanView" class="scan-view"></div>'
    '<div id="scanResult" class="scan-result" data-kind="idle"><strong>Ready</strong><span>Choose the event, start the camera, then scan each student’s QR pass.</span></div></div>'
    '<div class="scan-side"><span class="label">Manual verification</span>'
    '<form id="scanManualForm"><div class="field"><label class="label" for="scanManualId">Registration ID</label>'
    '<input id="scanManualId" placeholder="SP26-E01-XXXXXX"></div><div class="actions">'
    '<button class="mini primary" type="submit">Verify registration ID</button></div></form>'
    '<div class="notice">The camera needs HTTPS or localhost. If it is unavailable, an authorised admin can verify a student with their registration ID — '
    'every check-in is recorded against the signed-in admin, and duplicates are rejected by the database.</div></div></div></section>'
    '<section class="admin-panel" id="onspotPanel" style="margin-top:17px"><h3>On-spot registration</h3>'
    '<p class="helper" style="margin-bottom:12px">Register a student at the venue for On-spot or Both mode events. The record is stored in PostgreSQL, '
    'gets a real registration ID and QR pass, and appears in the event’s participant list and Excel export.</p>'
    '<form id="onspotForm"><div class="form-grid">'
    '<div class="field full"><label class="label" for="onspotEventSelect">Event</label><select id="onspotEventSelect"></select></div>'
    '<div class="field"><label class="label" for="spotName">Full name</label><input id="spotName" required placeholder="Student name"></div>'
    '<div class="field"><label class="label" for="spotRegno">Register number</label><input id="spotRegno" required placeholder="24CSE001"></div>'
    '<div class="field"><label class="label" for="spotDept">Department</label><input id="spotDept" required placeholder="Computer Science and Engineering"></div>'
    '<div class="field"><label class="label" for="spotYear">Year</label><select id="spotYear" required><option value="">Select</option><option>I</option><option>II</option><option>III</option><option>IV</option></select></div>'
    '<div class="field"><label class="label" for="spotSection">Section</label><input id="spotSection" required placeholder="A"></div>'
    '<div class="field"><label class="label" for="spotEmail">Email</label><input id="spotEmail" type="email" required placeholder="you@example.com"></div>'
    '</div><div class="form-error" id="onspotMsg" role="alert"></div><div class="actions">'
    '<button class="cta" type="submit" id="onspotSubmit">Register on-spot</button></div></form></section>'
    '</div></div>'
)
replace('<tbody id="regsTable"></tbody></table></div></section></div></div>', ADMIN_PANELS, 'admin participants/scanner/on-spot panels')

# 7 ── load the vendored QR scanner plus the app bundle
replace('<script src="/app.js" defer></script>',
        '<script src="/vendor/html5-qrcode.min.js" defer></script>\n<script src="/app.js" defer></script>',
        'scanner + app scripts')

# 8 ── home hero photo: uploads go to the server instead of base64 in localStorage
hero_start = src.rindex('<script>', 0, src.index('const HERO_IMAGE_URL='))
hero_end = src.index('</script>', hero_start) + len('</script>')
HERO_BLOCK = (
    '<script>(function(){\n'
    "const HERO_IMAGE_URL='';/* optional: bake a hosted image URL here as the default hero */\n"
    "const s=document.getElementById('s0');\n"
    'if(!s)return;\n'
    "function apply(d){if(d){s.style.setProperty('--hero-img','url(\"'+d+'\")');s.classList.add('has-photo')}"
    "else{s.style.removeProperty('--hero-img');s.classList.remove('has-photo')}}\n"
    'window.__sparkHero=apply;\n'
    'apply(HERO_IMAGE_URL);\n'
    '})();</script>'
)
src = src[:hero_start] + HERO_BLOCK + src[hero_end:]
print('  ✓ home hero block now uses server-stored images')

# 9 ── additive styles for the new UI (keeps the existing royal-blue / purple language)
CSS = '''<style id="sp26-backend-ui">
/* ── Spark'26 backend UI (additive only — the original design is untouched) ── */
.card-media{margin:-18px -18px 14px;height:132px;overflow:hidden;border-radius:16px 16px 0 0;background:#eef2ff}
.card-media img{width:100%;height:100%;object-fit:cover;display:block}
.card-media.fallback{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;background:linear-gradient(135deg,#7657ee,#2d79f6 55%,#089eb8)}
.card-media.fallback span{font:700 26px var(--mono);color:#fff;letter-spacing:.08em}
.card-media.fallback b{font:600 10px var(--mono);color:rgba(255,255,255,.88);letter-spacing:.14em}
.card-seats{margin:2px 0 10px;font:600 10px var(--mono);letter-spacing:.05em;color:#6b7ba8}
.kv b.st-open{color:#159873}.kv b.st-closed{color:#d44969}
.detail-img{width:100%;max-height:190px;object-fit:cover;border-radius:12px;margin-bottom:10px;display:block}
.qr.has-image{display:block;padding:12px;background:#fff;animation:none}
.qr.has-image img{width:100%;height:100%;object-fit:contain;display:block;border-radius:6px}
.qr-inline img{width:190px;height:190px;display:block;margin:10px auto;border-radius:10px;box-shadow:0 8px 22px rgba(39,72,107,.12)}
.pass-switcher{display:flex;flex-wrap:wrap;gap:7px;margin:12px 0 0}
.pass-hint{margin-top:10px;font-size:12px;line-height:1.55;color:#5d6b91}
.status.ok{color:#159873;border-color:#bfe8d8;background:#effcf7}
.participant-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:14px 0 10px;flex-wrap:wrap}
.participant-head h4{margin:0;font-size:15px;color:#101a3d}
.scan-layout{display:grid;grid-template-columns:minmax(240px,340px) 1fr;gap:16px;margin-top:14px}
.scan-stage{display:flex;flex-direction:column;gap:12px}
.scan-view{width:100%;aspect-ratio:1/1;border-radius:16px;border:1px dashed rgba(118,87,238,.45);background:linear-gradient(145deg,#eef2ff,#f7f4ff);overflow:hidden;display:flex;align-items:center;justify-content:center;position:relative}
.scan-view video{width:100%!important;height:100%!important;object-fit:cover}
.scan-result{padding:14px 16px;border-radius:14px;border:1px solid rgba(70,96,173,.18);background:#f7fbff;display:flex;flex-direction:column;gap:5px;font-size:13px;color:#3b4a70}
.scan-result strong{font-size:14px;color:#101a3d}
.scan-result[data-kind="good"]{border-color:#bfe8d8;background:#effcf7}.scan-result[data-kind="good"] strong{color:#0f7a5c}
.scan-result[data-kind="bad"]{border-color:#f6c9d5;background:#fff5f8}.scan-result[data-kind="bad"] strong{color:#c02b52}
.scan-result[data-kind="warn"]{border-color:#f2e0b6;background:#fffbf0}.scan-result[data-kind="warn"] strong{color:#9a6a10}
.scan-side{display:flex;flex-direction:column;gap:12px}
#participantsPanel .data-table td,#participantsPanel .data-table th{font-size:11px}
@media(max-width:900px){.scan-layout{grid-template-columns:1fr}}
@media(max-width:700px){
  nav#nav a.nav-contact{display:block!important;font-size:12px;padding:8px}
  nav#nav a.nav-contacts-desktop{display:none!important}
}
@media(min-width:701px){nav#nav a.nav-contact{display:none}}
</style>
'''
src = src.replace('</head>', CSS + '</head>', 1)
print('  ✓ additive theme styles')

open(P, 'w', encoding='utf-8').write(src)
print('HTML patched · size', len(src))
