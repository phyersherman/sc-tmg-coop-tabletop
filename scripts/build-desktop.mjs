/**
 * Builds the desktop apps: the site into dist/, then an Electron app for macOS and one for Windows under release/,
 * each zipped beside it.
 *
 *   npm run desktop                          both platforms, the full app
 *   node scripts/build-desktop.mjs mac|win   one platform
 *   --edition tabletop                       the tabletop edition alone (what is published): only its own files
 *
 * Where the full app is not there (the published tabletop branch) the tabletop edition is built either way.
 */
import { execSync } from 'node:child_process';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { packager } from '@electron/packager';

const args = process.argv.slice(2);
const which = args.find((a) => a === 'mac' || a === 'win' || a === 'all') ?? 'all';
const root = process.cwd();
const flag = args.indexOf('--edition');
const edition = flag >= 0 ? args[flag + 1] : existsSync(path.join(root, 'src', 'main.tsx')) ? 'full' : 'tabletop';
if (edition !== 'full' && edition !== 'tabletop') throw new Error(`Unknown edition "${edition}": use full or tabletop.`);
const tabletop = edition === 'tabletop';
const out = path.join(root, 'release');

if (!args.includes('--no-build')) execSync(`npx vite build${tabletop ? ' --mode tabletop' : ''}`, { stdio: 'inherit' });
if (!existsSync(path.join(root, 'dist', 'index.html'))) throw new Error('dist/index.html missing: the site did not build');
// The Electron shell reads this to title the window and keep this edition's saves apart.
writeFileSync(path.join(root, 'dist', 'edition.json'), JSON.stringify({ edition }));

const common = {
  dir: root,
  out,
  overwrite: true,
  name: tabletop ? 'Co-op Command Tabletop' : 'SC TMG Co-op Command',
  appBundleId: tabletop ? 'com.sctmg.coopcommand.tabletop' : 'com.sctmg.coopcommand',
  appCategoryType: 'public.app-category.board-games',
  prune: true,
  // Only the built site and the Electron entry go in: not the sources, research data or node_modules.
  ignore: [/^\/(?!dist(\/|$)|electron(\/|$)|package\.json$)/],
  asar: false,
};

const targets = [];
// The packager also looks for a modern Icon Composer ".icon" file and warns when there is none; the ".icns" it
// then copies is the app's icon, so that warning is noise.
if (which === 'all' || which === 'mac') targets.push({ platform: 'darwin', arch: process.arch === 'arm64' ? 'arm64' : 'x64', icon: existsSync('build/icon.icns') ? 'build/icon.icns' : undefined });
if (which === 'all' || which === 'win') targets.push({ platform: 'win32', arch: 'x64' });

for (const t of targets) {
  console.log(`\nPackaging ${common.name} for ${t.platform} ${t.arch}…`);
  // Clear the last build first: Finder can drop a .DS_Store into the folder while it is being replaced.
  rmSync(path.join(out, `${common.name}-${t.platform}-${t.arch}`), { recursive: true, force: true, maxRetries: 5 });
  const [dir] = await packager({ ...common, ...t });
  const base = path.basename(dir);
  const zip = path.join(out, `${base}.zip`);
  rmSync(zip, { force: true });
  console.log(`Zipping ${base}…`);
  if (t.platform === 'darwin') execSync(`ditto -c -k --sequesterRsrc --keepParent "${path.join(dir, `${common.name}.app`)}" "${zip}"`, { stdio: 'inherit' });
  else if (process.platform === 'win32') execSync(`powershell -NoProfile -Command "Compress-Archive -Path '${dir}' -DestinationPath '${zip}' -Force"`, { stdio: 'inherit' });
  else execSync(`cd "${out}" && zip -qr "${zip}" "${base}"`, { stdio: 'inherit' });
  console.log(`Done: ${dir}\n      ${zip}`);
}
