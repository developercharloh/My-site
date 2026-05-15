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
const githubToken = process.env.GITHUB_TOKEN;
const githubRepo = 'https://developercharloh:' + githubToken + '@github.com/developercharloh/My-site.git';

if (!token || !projectId || !orgId) {
    console.error('❌ Missing: VERCEL_TOKEN, VERCEL_PROJECT_ID, or VERCEL_ORG_ID');
    process.exit(1);
}
if (!githubToken) {
    console.error('❌ Missing: GITHUB_TOKEN');
    process.exit(1);
}

const run = (cmd: string, opts: object = {}) =>
    execSync(cmd, { stdio: 'inherit', ...opts });

const isProd = process.argv.includes('--prod');

// ─── STEP 1: Git — commit & push to GitHub ──────────────────────────────────
console.log('\n🔀  Step 1: Pushing changes to GitHub...');
try {
    // Configure git identity if not set
    try { run('git config user.email "deploy@mrcharlohfx.site"', { cwd: root }); } catch {}
    try { run('git config user.name "Mr CharlohFX Deploy"', { cwd: root }); } catch {}

    // Set GitHub remote (add or update)
    try {
        run(`git remote add github ${githubRepo}`, { cwd: root });
    } catch {
        run(`git remote set-url github ${githubRepo}`, { cwd: root });
    }

    // Stage all changes — exclude .github/workflows/ (requires 'workflow' PAT scope)
    run('git add -A', { cwd: root });
    try { run('git rm --cached -r .github/workflows 2>/dev/null || true', { cwd: root, stdio: 'pipe' }); } catch {}

    // Commit only if there are staged changes
    const status = execSync('git status --porcelain', { cwd: root, encoding: 'utf-8' }).trim();
    if (status) {
        const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
        run(`git commit -m "deploy: ${timestamp}"`, { cwd: root });
        console.log('✅  Committed changes.');
    } else {
        console.log('ℹ️  No changes to commit — pushing existing HEAD.');
    }

    // Push to GitHub main branch
    run('git push github HEAD:main --force', { cwd: root });
    console.log('✅  Pushed to GitHub → github.com/developercharloh/My-site');
} catch (err: any) {
    console.error('❌  GitHub push failed:', err.message);
    process.exit(1);
}

// ─── STEP 2: Build ──────────────────────────────────────────────────────────
console.log('\n🔨  Step 2: Building Mr CharlohFX...');
const env = { ...process.env, VERCEL_TOKEN: token, VERCEL_PROJECT_ID: projectId, VERCEL_ORG_ID: orgId, PORT: '19578' };
run('pnpm run build', { cwd: siteDir, env });
console.log('✅  Build complete.');

// ─── STEP 3: Prepare Vercel output ──────────────────────────────────────────
console.log('\n📦  Step 3: Preparing Vercel output...');

const vercelProjectFile = path.join(siteDir, '.vercel/project.json');
fs.mkdirSync(path.dirname(vercelProjectFile), { recursive: true });
fs.writeFileSync(vercelProjectFile, JSON.stringify({ projectId, orgId }, null, 2));

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

const staticDir = path.join(siteDir, '.vercel/output/static');
fs.mkdirSync(staticDir, { recursive: true });
run(`cp -r ${siteDir}/dist/. ${staticDir}/`);
console.log('✅  Output staged.');

// ─── STEP 4: Deploy to Vercel ───────────────────────────────────────────────
const prodFlag = isProd ? '--prod' : '';
console.log(`\n🚀  Step 4: Deploying to Vercel${isProd ? ' (production → mrcharlohfx.site)' : ' (preview)'}...`);
try {
    const result = execSync(
        `${vercelBin} deploy --prebuilt ${prodFlag} --token=${token} --yes`,
        { cwd: siteDir, env, stdio: 'pipe', encoding: 'utf-8' }
    );
    console.log('✅  Vercel deploy successful!');
    const url = result.trim().split('\n').find(l => l.includes('https://')) ?? result.trim();
    console.log(`🌐  Live at: ${url}`);
} catch (err: any) {
    console.error('❌  Vercel deploy failed:', err.stdout || err.stderr || err.message);
    process.exit(1);
}

console.log('\n✅  All done! Changes are live on GitHub and mrcharlohfx.site\n');
