// scripts/package-cpanel.js
// Packages built frontend (dist) and backend files into upload-ready zip archives for Namecheap cPanel.

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const rootDir = process.cwd();
const frontendDist = path.join(rootDir, 'frontend', 'dist');
const backendDir = path.join(rootDir, 'backend');

console.log('========================================================');
console.log('📦  [SalonOS] Packaging for Namecheap cPanel Deployment');
console.log('========================================================\n');

// 1. Verify frontend build exists
if (!fs.existsSync(frontendDist) || !fs.existsSync(path.join(frontendDist, 'index.html'))) {
  console.error('❌ Error: frontend/dist/index.html not found!');
  console.error('👉 Please build the frontend first by running: npm run build:frontend\n');
  process.exit(1);
}

// 2. Package Frontend
console.log('1️⃣  Packaging Frontend (frontend-build.zip)...');
const frontendZip = path.join(rootDir, 'frontend-build.zip');
if (fs.existsSync(frontendZip)) fs.unlinkSync(frontendZip);

// Safety Guardrail: Ensure no local env or hidden development files are in frontend dist
const forbiddenFrontend = ['.env', '.env.local', '.env.development', '.git'];
for (const f of forbiddenFrontend) {
  const p = path.join(frontendDist, f);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

try {
  // Use tar -a on Windows / Linux to zip the contents of frontend/dist
  execSync(`tar -a -cf "${frontendZip}" *`, { cwd: frontendDist, stdio: 'inherit' });
  console.log(`✅ Frontend packaged successfully: ${frontendZip}\n`);
} catch (err) {
  console.error('❌ Failed to package frontend:', err.message);
}

// 3. Package Backend (without node_modules and tests)
console.log('2️⃣  Packaging Backend (backend-build.zip)...');
const backendZip = path.join(rootDir, 'backend-build.zip');
if (fs.existsSync(backendZip)) fs.unlinkSync(backendZip);

// Prepare temporary staging folder for clean backend upload
const stagingDir = path.join(rootDir, '.backend_staging');
if (fs.existsSync(stagingDir)) fs.rmSync(stagingDir, { recursive: true, force: true });
fs.mkdirSync(stagingDir, { recursive: true });

try {
  // Copy essential backend files
  const itemsToCopy = ['src', 'prisma', 'server.js', 'package.json', 'package-lock.json', 'public'];
  for (const item of itemsToCopy) {
    const srcPath = path.join(backendDir, item);
    const destPath = path.join(stagingDir, item);
    if (fs.existsSync(srcPath)) {
      fs.cpSync(srcPath, destPath, { recursive: true });
    }
  }

  // Copy .env.example as .env.example in staging
  const envExample = path.join(backendDir, '.env.example');
  if (fs.existsSync(envExample)) {
    fs.copyFileSync(envExample, path.join(stagingDir, '.env.example'));
  }

  // Safety Guardrail: Strictly guarantee NO local .env or secret file is in backend package
  const forbiddenBackend = ['.env', '.env.local', '.env.development', '.git', 'tests', 'test', '.backend_staging'];
  for (const f of forbiddenBackend) {
    const p = path.join(stagingDir, f);
    if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
  }

  // Package staging directory
  execSync(`tar -a -cf "${backendZip}" *`, { cwd: stagingDir, stdio: 'inherit' });
  console.log(`✅ Backend packaged successfully (100% clean of local .env & dev files): ${backendZip}\n`);
} catch (err) {
  console.error('❌ Failed to package backend:', err.message);
} finally {
  // Clean up staging directory
  if (fs.existsSync(stagingDir)) {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }
}

console.log('========================================================');
console.log('🎉  Both packages are ready for upload:');
console.log('    1. frontend-build.zip -> Extract inside public_html (or subdomain directory)');
console.log('    2. backend-build.zip  -> Extract inside your cPanel Node.js app folder');
console.log('========================================================\n');

