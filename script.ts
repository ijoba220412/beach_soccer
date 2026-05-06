import fs from 'fs';
let content = fs.readFileSync('src/App.tsx', 'utf8');
content = content.replace(/sky-/g, 'emerald-');
fs.writeFileSync('src/App.tsx', content);
