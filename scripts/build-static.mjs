import { copyFile, mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';

const projectRoot = process.cwd();
const outputRoot = path.join(projectRoot, 'dist');
const runtimeFiles = [
  'index.html',
  'style.css',
  'game.js',
  'core.js',
  'site-network.js',
  'og.png',
];

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });

for (const file of runtimeFiles) {
  await copyFile(path.join(projectRoot, file), path.join(outputRoot, file));
}

const html = await readFile(path.join(outputRoot, 'index.html'), 'utf8');
if (!html.includes('MicroGame3D') || !html.includes('game.js" type="module"')) {
  throw new Error('Static output validation failed.');
}

console.log(`Built ${runtimeFiles.length} static files in dist/.`);
