const https = require('https');
const fs = require('fs');

https.get('https://spark26-gamma.vercel.app/', res => {
  let html = '';
  res.on('data', chunk => html += chunk);
  res.on('end', () => {
    fs.writeFileSync('scripts/live_site.html', html);
    console.log('HTML length:', html.length);
    console.log('Has circularGalleryRoot:', html.includes('circularGalleryRoot'));
    console.log('Has circular-gallery.bundle.js:', html.includes('circular-gallery.bundle.js'));
    console.log('Has app.js:', html.includes('app.js'));
    const scripts = html.match(/<script[^>]*>([\s\S]*?)<\/script>/gi) || [];
    console.log('Total script tags:', scripts.length);
  });
}).on('error', err => console.error(err));
