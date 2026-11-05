// Apply only the reviewed staged backend files; refuse concurrent edits.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const root = path.resolve(__dirname, '../../backend');
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'manifest.json'), 'utf8'));
for (const {file, hash} of manifest) {
  const target = path.resolve(root, file);
  if (!target.startsWith(root + path.sep)) throw Error('Invalid target');
  const current = fs.existsSync(target) ? crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex') : null;
  if (current !== hash) throw Error('Concurrent edit detected: ' + file);
}
for (const {file} of manifest) {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), {recursive:true});
  fs.copyFileSync(path.join(__dirname, 'backend', file), target);
  console.log(file);
}
