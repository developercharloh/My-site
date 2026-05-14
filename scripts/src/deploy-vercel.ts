import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../');
const siteDir = path.resolve(root, 'artifacts/my-site');
const vercelBin = path.resolve(__dirname, '../node_modules/.bin/vercel');

const token = process.env.VERCEL_TOKEN;
const projectId = process.env.VERCEL_PROJECT_ID;
const orgId = process.env.VERCEL_ORG_ID;

if (!token || !projectId || !orgId) {
    console.error('Missing required env vars: VERCEL_TOKEN, VERCEL_PROJECT_ID, VERCEL_ORG_ID');
    process.exit(1);
}

// Ensure .vercel/project.json is in place
const vercelProjectFile = path.join(siteDir, '.vercel/project.json');
fs.mkdirSync(path.dirname(vercelProjectFile), { recursive: true });
fs.writeFileSync(vercelProjectFile, JSON.stringify({ projectId, orgId }, null, 2));

// Ensure .vercel/output/config.json is in place
const outputConfig = path.join(siteDir, '.vercel/output/config.json');
fs.mkdirSync(path.dirname(outputConfig), { recursive: true });
fs.writeFileSync(outputConfig, JSON.stringify({
    version: 3,
    routes: [
        { src: '/static/(.*)', headers: { 'cache-control': 'public, max-age=31536000, immutable' }, continue: true },
        { handle: 'filesystem' },
        { src: '/(.*)', dest: '/index.html' },
    ],
}, null, 2));

const env = { ...process.env, VERCEL_TOKEN: token, VERCEL_PROJECT_ID: projectId, VERCEL_ORG_ID: orgId };

// Step 1: Build
console.log('Building Mr CharlohFX...');
execSync('pnpm run build', { cwd: siteDir, env: { ...env, PORT: '19578' }, stdio: 'inherit' });

// Step 2: Copy dist → .vercel/output/static
const staticDir = path.join(siteDir, '.vercel/output/static');
fs.mkdirSync(staticDir, { recursive: true });
execSync(`cp -r ${siteDir}/dist/. ${staticDir}/`, { stdio: 'inherit' });
console.log('Copied build output to .vercel/output/static');

// Step 3: Deploy prebuilt
const isProd = process.argv.includes('--prod');
const prodFlag = isProd ? '--prod' : '';
console.log(`Deploying to Vercel${isProd ? ' (production)' : ''}...`);

try {
    const result = execSync(
        `${vercelBin} deploy --prebuilt ${prodFlag} --token=${token} --yes`,
        { cwd: siteDir, env, stdio: 'pipe', encoding: 'utf-8' }
    );
    console.log('Deploy successful!');
    console.log(result.trim());
} catch (err: any) {
    console.error('Deploy failed:', err.stdout || err.stderr || err.message);
    process.exit(1);
}
