const fs = require('fs');
const content = fs.readFileSync('public/index.html', 'utf8');

console.log('1. rRegno placeholder:', content.includes('id="rRegno" required placeholder="Enter Reg.No"'));
console.log('2. lookupRegno placeholder:', content.includes('id="lookupRegno" required placeholder="Enter Reg.No"'));
console.log('3. spotRegno placeholder:', content.includes('id="spotRegno" required placeholder="Enter Reg.No"'));
console.log('4. 24CSE001 exists in index.html:', content.includes('24CSE001'));
console.log('5. <option>IV</option> exists in index.html:', content.includes('<option>IV</option>'));

const rYearMatch = content.match(/<select id="rYear"[^>]*>([\s\S]*?)<\/select>/);
console.log('6. rYear options:', rYearMatch ? rYearMatch[1] : 'not found');

const spotYearMatch = content.match(/<select id="spotYear"[^>]*>([\s\S]*?)<\/select>/);
console.log('7. spotYear options:', spotYearMatch ? spotYearMatch[1] : 'not found');
