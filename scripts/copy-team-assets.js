const fs = require('fs');
const path = require('path');

const teamDir = 'Team';
const pubTeam = 'public/team';
const pubImgTeam = 'public/images/team';

fs.mkdirSync(pubTeam, { recursive: true });
fs.mkdirSync(pubImgTeam, { recursive: true });

const teamFiles = fs.readdirSync(teamDir);
console.log('Copying team files from Team/ to public/team/ and public/images/team/...');

teamFiles.forEach(file => {
  const src = path.join(teamDir, file);
  const dest1 = path.join(pubTeam, file);
  const dest2 = path.join(pubImgTeam, file);
  fs.copyFileSync(src, dest1);
  fs.copyFileSync(src, dest2);
  console.log(`Copied ${file}`);
});

// Also create simplified alias filenames
const aliases = {
  'C Thiruvelan CSE CHAIRPERSON.jpeg': 'thiruvelan-chair-cse.jpeg',
  'N Subash AIML CHAIRPERSON.jpeg': 'subash-chair-aiml.jpeg',
  'V Nagulan CSD CHAIRPERSON.jpeg': 'nagulan-chair-csd.jpeg',
  'Adarsha Murmu CSE SECRETARY.jpeg': 'adarsha-sec-cse.jpeg',
  'M V Dev AIML SECRETARY.jpeg': 'dev-sec-aiml.jpeg',
  'G Sanjay CSD SECRETARY.jpeg': 'sanjay-sec-csd.jpeg',
  'Sharveshvar TR STUDENT COORDINATOR.png': 'sharveshvar-student-coord.png'
};

Object.entries(aliases).forEach(([orig, alias]) => {
  fs.copyFileSync(path.join(teamDir, orig), path.join(pubTeam, alias));
  fs.copyFileSync(path.join(teamDir, orig), path.join(pubImgTeam, alias));
  console.log(`Aliased ${orig} -> ${alias}`);
});

// Ensure dharun and armaan are also in both folders
if (fs.existsSync('public/images/team/dharun.jpg')) {
  fs.copyFileSync('public/images/team/dharun.jpg', 'public/team/dharun.jpg');
}
if (fs.existsSync('public/images/team/armaan.jpg')) {
  fs.copyFileSync('public/images/team/armaan.jpg', 'public/team/armaan.jpg');
}

console.log('All team images copied and verified!');
