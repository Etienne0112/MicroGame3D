/*
 * MicroGame3D 레포의 GitHub Pages 산출물 빌더.
 * 이 레포는 https://etienne0112.github.io/MicroGame3D/ 하위에 배포되는 독립 프로젝트 사이트이므로,
 * 자기 robots.txt와 sitemap.xml을 직접 들고 있어야 하고 자산은 상대 경로로만 참조합니다.
 */
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const projectRoot = process.cwd();
const outputRoot = path.join(projectRoot, 'dist');
const runtimeFiles = [
  'index.html',
  'style.css',
  'subsite-shell.css',
  'game.js',
  'core.js',
  'subsite-shell.js',
  'og.png',
  'robots.txt',
  'sitemap.xml',
];

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });

for (const file of runtimeFiles) {
  await copyFile(path.join(projectRoot, file), path.join(outputRoot, file));
}

// GitHub Pages의 Jekyll 처리를 건너뛰게 합니다. (밑줄로 시작하는 파일이 사라지는 것을 막습니다.)
await writeFile(path.join(outputRoot, '.nojekyll'), '', 'utf8');

const html = await readFile(path.join(outputRoot, 'index.html'), 'utf8');
if (!html.includes('MicroGame3D') || !html.includes('game.js" type="module"')) {
  throw new Error('Static output validation failed.');
}
if (!html.includes('subsite-shell.css') || !html.includes('subsite-shell.js')) {
  throw new Error('Shared subsite shell is missing from the static output.');
}

console.log(`Built ${runtimeFiles.length + 1} static files in dist/.`);
