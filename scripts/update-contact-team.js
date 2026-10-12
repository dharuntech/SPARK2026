const fs = require('fs');
const path = require('path');

const indexPath = path.join(__dirname, '..', 'public', 'index.html');
let content = fs.readFileSync(indexPath, 'utf8');

// 1. New CSS for contact section
const oldCssPattern = /\/\* ===== Contacts page \+ fresh light palette finishing layer ===== \*\/[\s\S]*?@media\(prefers-reduced-motion:reduce\)\{\.section\.show \.contact-card\{animation:none!important\}\.contact-card\{transition:none\}\}/;

const newCss = `/* ===== Contacts page + fresh light palette finishing layer ===== */
:root{color-scheme:light}
.contact-grid{max-width:1160px;margin:0 auto;display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:24px}
.contact-card{position:relative;display:flex;flex-direction:column;align-items:center;text-align:center;padding:34px 20px 28px;border-radius:24px;background:rgba(255,255,255,.92);border:1px solid rgba(124,58,237,.18);box-shadow:0 12px 34px rgba(60,50,170,.12);transition:transform .35s cubic-bezier(.16,.9,.24,1),box-shadow .35s,border-color .35s;grid-column:span 2}
.contact-card:before{content:"";position:absolute;left:24px;right:24px;top:0;height:4px;border-radius:0 0 4px 4px;background:linear-gradient(90deg,#1D4ED8,#7C3AED 60%,#22D3EE)}
.contact-card:hover{transform:translateY(-6px);box-shadow:0 24px 50px rgba(76,70,230,.22);border-color:rgba(124,58,237,.4)}
.contact-card.dev-card-1{grid-column:2 / span 2}
.contact-card.dev-card-2{grid-column:4 / span 2}

.c-photo{width:112px;height:112px;border-radius:50%;overflow:hidden;background:#EEF2FF;border:3.5px solid #fff;box-shadow:0 8px 24px rgba(60,50,170,.2),0 0 0 2px rgba(124,58,237,.25);transition:transform .3s ease,box-shadow .3s ease;margin-bottom:16px;flex-shrink:0}
.contact-card:hover .c-photo{transform:scale(1.04);box-shadow:0 12px 28px rgba(60,50,170,.28),0 0 0 3px rgba(124,58,237,.38)}
.c-photo img{display:block;width:100%;height:100%;object-fit:cover;object-position:center 15%}

.c-body{width:100%;display:flex;flex-direction:column;align-items:center;text-align:center}
.c-body h3,.c-name{font-size:20px;font-weight:800;letter-spacing:-.015em;color:#0B1026;margin:0 0 6px;line-height:1.25}
.c-role{font:700 11.5px var(--mono);letter-spacing:.08em;text-transform:uppercase;color:#6D28D9;margin:0;padding:0;background:none;border-radius:0;display:inline-block}
.c-divider{width:44px;height:3px;border-radius:999px;background:linear-gradient(90deg,#1D4ED8,#7C3AED);margin:12px auto 0;transition:width .3s ease}
.contact-card:hover .c-divider{width:62px}

.section.show .contact-card{animation:fxRise .85s var(--ease-out) backwards}
.section.show .contact-card:nth-child(1){animation-delay:.08s}
.section.show .contact-card:nth-child(2){animation-delay:.14s}
.section.show .contact-card:nth-child(3){animation-delay:.20s}
.section.show .contact-card:nth-child(4){animation-delay:.26s}
.section.show .contact-card:nth-child(5){animation-delay:.32s}
.section.show .contact-card:nth-child(6){animation-delay:.38s}
.section.show .contact-card:nth-child(7){animation-delay:.44s}
.section.show .contact-card:nth-child(8){animation-delay:.50s}

@media(max-width:991px){
  .contact-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}
  .contact-card,.contact-card.dev-card-1,.contact-card.dev-card-2{grid-column:auto!important}
}
@media(max-width:600px){
  .contact-grid{grid-template-columns:1fr;gap:18px}
  .contact-card{padding:28px 16px 24px}
  .c-photo{width:104px;height:104px}
  .c-body h3,.c-name{font-size:18.5px}
}
@media(prefers-reduced-motion:reduce){
  .section.show .contact-card{animation:none!important}
  .contact-card{transition:none!important}
  .c-photo{transition:none!important}
  .c-divider{transition:none!important}
}`;

if (!oldCssPattern.test(content)) {
  console.error('Failed to match oldCssPattern in public/index.html');
  process.exit(1);
}
content = content.replace(oldCssPattern, newCss);
console.log('Successfully updated contact CSS block.');

// 2. Update theme override for .c-role
const oldRoleOverride = /\.c-role\{background:linear-gradient\(135deg,#E3EAFF,#EBE3FF\)!important;color:#4C1D95!important\}/;
const newRoleOverride = `.c-role{background:none!important;color:#6D28D9!important;padding:0!important}`;

if (!oldRoleOverride.test(content)) {
  console.error('Failed to match oldRoleOverride in public/index.html');
  process.exit(1);
}
content = content.replace(oldRoleOverride, newRoleOverride);
console.log('Successfully updated .c-role theme override.');

// 3. Update HTML for section s4
const oldSectionS4Pattern = /<section class="section" id="s4"><div class="section-head"><div class="eyebrow">→ Get in touch<\/div><h2>Meet the team\.<span class="dim">Say hello\.<\/span><\/h2><p>The students behind the Spark’26 website\. Reach out for anything about the event or the site\.<\/p><\/div>\s*<div class="contact-grid">[\s\S]*?<\/div><\/section>/;

const newSectionS4 = `<section class="section" id="s4"><div class="section-head"><div class="eyebrow">→ Get in touch</div><h2>Meet the team.<span class="dim">Say hello.</span></h2><p>The students behind the Spark’26 website. Reach out for anything about the event or the site.</p></div>
<div class="contact-grid">
  <!-- Row 1: Chairpersons -->
  <article class="contact-card">
    <div class="c-photo"><img src="/team/thiruvelan-chair-cse.jpeg" alt="C. Thiruvelan" width="112" height="112" loading="lazy"></div>
    <div class="c-body">
      <h3 class="c-name">C. Thiruvelan</h3>
      <span class="c-role">CHAIRPERSON / CSE</span>
      <div class="c-divider" aria-hidden="true"></div>
    </div>
  </article>
  <article class="contact-card">
    <div class="c-photo"><img src="/team/subash-chair-aiml.jpeg" alt="N. Subash" width="112" height="112" loading="lazy"></div>
    <div class="c-body">
      <h3 class="c-name">N. Subash</h3>
      <span class="c-role">CHAIRPERSON / AIML</span>
      <div class="c-divider" aria-hidden="true"></div>
    </div>
  </article>
  <article class="contact-card">
    <div class="c-photo"><img src="/team/nagulan-chair-csd.jpeg" alt="V. Nagulan" width="112" height="112" loading="lazy"></div>
    <div class="c-body">
      <h3 class="c-name">V. Nagulan</h3>
      <span class="c-role">CHAIRPERSON / CSD</span>
      <div class="c-divider" aria-hidden="true"></div>
    </div>
  </article>

  <!-- Row 2: Secretaries -->
  <article class="contact-card">
    <div class="c-photo"><img src="/team/adarsha-sec-cse.jpeg" alt="Adarsha Murmu" width="112" height="112" loading="lazy"></div>
    <div class="c-body">
      <h3 class="c-name">Adarsha Murmu</h3>
      <span class="c-role">SECRETARY / CSE</span>
      <div class="c-divider" aria-hidden="true"></div>
    </div>
  </article>
  <article class="contact-card">
    <div class="c-photo"><img src="/team/dev-sec-aiml.jpeg" alt="M. V. Dev" width="112" height="112" loading="lazy"></div>
    <div class="c-body">
      <h3 class="c-name">M. V. Dev</h3>
      <span class="c-role">SECRETARY / AIML</span>
      <div class="c-divider" aria-hidden="true"></div>
    </div>
  </article>
  <article class="contact-card">
    <div class="c-photo"><img src="/team/sanjay-sec-csd.jpeg" alt="G. Sanjay" width="112" height="112" loading="lazy"></div>
    <div class="c-body">
      <h3 class="c-name">G. Sanjay</h3>
      <span class="c-role">SECRETARY / CSD</span>
      <div class="c-divider" aria-hidden="true"></div>
    </div>
  </article>

  <!-- Final row: Web Developers -->
  <article class="contact-card dev-card dev-card-1">
    <div class="c-photo"><img src="/team/dharun.jpg" alt="Dharun M" width="112" height="112" loading="lazy"></div>
    <div class="c-body">
      <h3 class="c-name">Dharun M</h3>
      <span class="c-role">WEB DEVELOPMENT</span>
      <div class="c-divider" aria-hidden="true"></div>
    </div>
  </article>
  <article class="contact-card dev-card dev-card-2">
    <div class="c-photo"><img src="/team/armaan.jpg" alt="Armaan Ahmed N" width="112" height="112" loading="lazy"></div>
    <div class="c-body">
      <h3 class="c-name">Armaan Ahmed N</h3>
      <span class="c-role">WEB DEVELOPMENT</span>
      <div class="c-divider" aria-hidden="true"></div>
    </div>
  </article>
</div></section>`;

if (!oldSectionS4Pattern.test(content)) {
  console.error('Failed to match oldSectionS4Pattern in public/index.html');
  process.exit(1);
}
content = content.replace(oldSectionS4Pattern, newSectionS4);
console.log('Successfully updated section #s4 HTML with 8 team cards.');

fs.writeFileSync(indexPath, content, 'utf8');
console.log('public/index.html saved successfully.');
