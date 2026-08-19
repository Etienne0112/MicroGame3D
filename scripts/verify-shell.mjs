/*
 * 공용 셸 계약 검사기.
 * SUBSITE SHELL CONTRACT 1.0.0
 *
 * DesertRose-s-Blog / Study / SiteTemplate / MicroGame3D 네 레포가 같은 내용으로 복사해 쓰는 파일입니다.
 * 원본은 SiteTemplate이고 `npm run sync-shell`로 배포합니다.
 *
 * 네 사이트는 서로 다른 레포지토리이므로 각 레포의 CI는 **자기 레포만** 봅니다. 그래서 이 검사기는
 * 다른 레포를 참조하지 않고, 이 레포 안에서 확인할 수 있는 것만 검사합니다.
 *
 *   1. subsite-shell.css / subsite-shell.js가 있고 기대한 계약 버전을 달고 있는지
 *   2. 공용 CSS가 필요한 토큰과 셀렉터를 모두 정의하는지
 *   3. 공용 JS가 필요한 API와 사이트 목록 폴백을 모두 가지고 있는지
 *   4. 이 레포의 모든 HTML 진입점이 마크업 계약을 지키는지
 *      (data-site-id, 헤더 구조, SITES 메뉴 id, 컨트롤 순서, 푸터, style.css 뒤에 공용 CSS)
 *   5. GitHub Pages 프로젝트 사이트(/<레포명>/ 하위)에서도 동작하도록 자산 경로가 상대 경로인지
 *
 * 실행: node scripts/verify-shell.mjs [추가로 검사할 HTML 경로...]
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const SHELL_CONTRACT = '1.0.0';
const ROOT = path.resolve(import.meta.dirname, '..');

const REQUIRED_CSS_TOKENS = [
  '--sub-font-sans', '--sub-font-mono', '--sub-shell-width', '--sub-shell-gutter',
  '--sub-control-height', '--sub-brand-size', '--sub-network-mark-size', '--sub-popover-width'
];

const REQUIRED_CSS_SELECTORS = [
  '.navbar', '.nav-container', '.nav-brand', '.brand-mark', '.brand-copy', '.issue-label',
  '.nav-actions', '.nav-button', '.icon-button', '.language-select', '.search-box',
  '.site-network-menu', '.site-network-popover', '.site-network-group', '.site-network-heading',
  '.site-network-link', '.site-network-mark', '.site-network-copy', '.site-network-arrow',
  '.primary-button', '.ghost-button', '.site-footer', '.footer-inner', '.toast', '.eyebrow'
];

const REQUIRED_JS_FRAGMENTS = [
  "const THEME_KEY = 'desertrose.theme'",
  'global.DesertRoseShell',
  // 각 사이트 app.js가 이스케이프와 두 자리 번호 매기기를 셸에서 가져다 쓰므로 반드시 노출돼야 합니다.
  '    escapeHTML,',
  '    pad2,',
  'DESERTROSE_NORMALIZE_SITE_NETWORK',
  'function normalizeSiteNetwork',
  'function renderNetwork',
  'function applyTheme',
  'site-network-popover',
  'site-network-footer',
  'theme-toggle'
];

// 폴백 목록은 MainSite의 site-network.json을 못 읽을 때도 메뉴가 비지 않게 하는 안전망입니다.
const REQUIRED_SITE_IDS = ['main', 'blog', 'study', 'micro3d', 'template'];

// 헤더 컨트롤 순서: SITES → 사이트 고유 동작 → SEARCH → LANGUAGE → 테마
const CONTROL_ORDER = [
  { name: 'SITES 메뉴', pattern: /id="site-network-menu"/ },
  { name: 'LANGUAGE 선택', pattern: /class="language-select"/ },
  { name: '테마 토글', pattern: /id="theme-toggle"/ }
];

const problems = [];
const fail = (file, message) => problems.push(`${file}: ${message}`);

async function readIfPresent(relativePath) {
  try {
    return await readFile(path.join(ROOT, relativePath), 'utf8');
  } catch {
    return null;
  }
}

/** 이 레포에서 셸을 사용하는 HTML 진입점을 모읍니다. (빌드 산출물과 의존성 폴더는 제외) */
async function collectHtmlEntryPoints(extraPaths) {
  const skipped = new Set(['node_modules', '_site', 'dist', 'build', '.git', '.github', 'posts', 'translations', 'articles', 'documents']);
  const found = [];

  async function walk(directory, depth) {
    const entries = await readdir(path.join(ROOT, directory || '.'), { withFileTypes: true });
    for (const entry of entries) {
      const relativePath = directory ? `${directory}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (depth >= 1 || skipped.has(entry.name) || entry.name.startsWith('.')) continue;
        await walk(relativePath, depth + 1);
      } else if (entry.name.endsWith('.html') && !entry.name.startsWith('google')) {
        found.push(relativePath);
      }
    }
  }

  await walk('', 0);
  for (const extra of extraPaths) {
    try {
      const info = await stat(path.join(ROOT, extra));
      // 생성된 페이지는 수천 개일 수 있으므로, 디렉터리를 주면 대표 한 장만 검사합니다.
      // 한 생성기가 모든 페이지를 같은 껍데기로 찍어내므로 표본 검사로 충분합니다.
      const target = info.isDirectory() ? await firstHtmlFile(extra) : extra;
      if (target) found.push(target);
      else fail(extra, '검사할 HTML 파일이 이 디렉터리에 없습니다.');
    } catch {
      fail(extra, '검사 대상으로 지정했지만 경로가 없습니다.');
    }
  }
  return [...new Set(found)];
}

async function firstHtmlFile(directory) {
  const entries = (await readdir(path.join(ROOT, directory), { withFileTypes: true }))
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.html')) return `${directory}/${entry.name}`;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const nested = await firstHtmlFile(`${directory}/${entry.name}`);
    if (nested) return nested;
  }
  return null;
}

function verifyContractStamp(file, source) {
  if (!source.includes(`SUBSITE SHELL CONTRACT ${SHELL_CONTRACT}`)) {
    fail(file, `계약 버전 표시가 없거나 다릅니다. 'SUBSITE SHELL CONTRACT ${SHELL_CONTRACT}'가 있어야 합니다.`);
  }
}

function verifyShellCss(source) {
  verifyContractStamp('subsite-shell.css', source);
  for (const token of REQUIRED_CSS_TOKENS) {
    if (!source.includes(`${token}:`)) fail('subsite-shell.css', `공용 토큰 ${token}을 정의하지 않습니다.`);
  }
  for (const selector of REQUIRED_CSS_SELECTORS) {
    if (!new RegExp(`\\${selector}[\\s,:.[{]`).test(source)) {
      fail('subsite-shell.css', `공용 셀렉터 ${selector} 규칙이 없습니다.`);
    }
  }
}

function verifyShellJs(source) {
  verifyContractStamp('subsite-shell.js', source);
  if (!source.includes(`const SHELL_CONTRACT = '${SHELL_CONTRACT}'`)) {
    fail('subsite-shell.js', `SHELL_CONTRACT 상수가 '${SHELL_CONTRACT}'가 아닙니다.`);
  }
  for (const fragment of REQUIRED_JS_FRAGMENTS) {
    if (!source.includes(fragment)) fail('subsite-shell.js', `필요한 코드가 없습니다: ${fragment}`);
  }
  for (const id of REQUIRED_SITE_IDS) {
    if (!source.includes(`id: '${id}'`)) fail('subsite-shell.js', `폴백 사이트 목록에 '${id}'가 없습니다.`);
  }
  if (!source.includes("https://etienne0112.github.io/MainSite/site-network.json")) {
    fail('subsite-shell.js', '사이트 목록 원본(MainSite/site-network.json) 주소가 없습니다.');
  }
}

/** 헤더에 JS가 붙는 페이지인지 판단합니다. 정적 문서 페이지는 셸 스크립트를 싣지 않습니다. */
function isInteractivePage(html) {
  return /<script[^>]+src="[^"]*subsite-shell\.js"/.test(html);
}

function verifyHtml(file, html) {
  if (!/<body[^>]+data-site-id="[a-z0-9-]+"/.test(html)) {
    fail(file, '<body>에 data-site-id가 없습니다. 셸이 현재 사이트를 구분할 수 없습니다.');
  }

  const styleIndex = html.indexOf('href="');
  const shellCssMatch = /<link[^>]+href="([^"]*subsite-shell\.css)"/.exec(html);
  const siteCssMatch = /<link[^>]+href="([^"]*style\.css)"/.exec(html);
  if (!shellCssMatch) fail(file, 'subsite-shell.css를 불러오지 않습니다.');
  if (!siteCssMatch) fail(file, 'style.css를 불러오지 않습니다.');
  if (shellCssMatch && siteCssMatch && html.indexOf(shellCssMatch[0]) < html.indexOf(siteCssMatch[0])) {
    fail(file, 'subsite-shell.css를 style.css보다 먼저 불러옵니다. 공용 셸이 사이트 색상 토큰을 덮어쓸 수 없습니다.');
  }
  void styleIndex;

  // GitHub Pages 프로젝트 사이트는 /<레포명>/ 하위에서 서비스되므로 루트 절대 경로는 깨집니다.
  for (const match of html.matchAll(/(?:href|src)="(\/[^/][^"]*)"/g)) {
    fail(file, `루트 절대 경로 ${match[1]}는 /<레포명>/ 하위 배포에서 깨집니다. 상대 경로를 쓰세요.`);
  }

  for (const [selector, description] of [
    ['class="navbar"', '헤더 .navbar'],
    ['class="nav-container"', '헤더 폭 컨테이너 .nav-container'],
    ['class="nav-brand"', '브랜드 링크 .nav-brand'],
    ['class="brand-mark"', '로고 마크 .brand-mark'],
    ['class="brand-copy"', '로고 문구 .brand-copy'],
    ['class="nav-actions"', '헤더 컨트롤 묶음 .nav-actions'],
    ['class="site-footer"', '푸터 .site-footer'],
    ['class="footer-inner"', '푸터 내부 폭 컨테이너 .footer-inner']
  ]) {
    if (!html.includes(selector)) fail(file, `${description}가 없습니다.`);
  }

  if (/class="(logo|logo-mark|logo-copy|nav-inner|network-menu|network-popover)"/.test(html)) {
    fail(file, '통일 이전의 옛 클래스(.logo / .nav-inner / .network-*)가 남아 있습니다.');
  }

  if (!isInteractivePage(html)) return;

  for (const id of ['site-network-menu', 'site-network-popover', 'theme-toggle']) {
    if (!html.includes(`id="${id}"`)) fail(file, `공용 셸이 요구하는 id="${id}" 요소가 없습니다.`);
  }

  const positions = CONTROL_ORDER
    .map(control => ({ ...control, index: html.search(control.pattern) }))
    .filter(control => control.index >= 0);
  for (let i = 1; i < positions.length; i += 1) {
    if (positions[i].index < positions[i - 1].index) {
      fail(file, `헤더 컨트롤 순서가 어긋납니다. ${positions[i - 1].name}가 ${positions[i].name}보다 앞이어야 합니다.`);
    }
  }
}

const [shellCss, shellJs] = await Promise.all([
  readIfPresent('subsite-shell.css'),
  readIfPresent('subsite-shell.js')
]);

if (!shellCss) fail('subsite-shell.css', '파일이 없습니다.');
else verifyShellCss(shellCss);

if (!shellJs) fail('subsite-shell.js', '파일이 없습니다.');
else verifyShellJs(shellJs);

const htmlFiles = await collectHtmlEntryPoints(process.argv.slice(2));
if (htmlFiles.length === 0) fail('.', '검사할 HTML 진입점을 찾지 못했습니다.');

for (const file of htmlFiles) {
  verifyHtml(file, await readFile(path.join(ROOT, file), 'utf8'));
}

if (problems.length) {
  console.error(`공용 셸 계약 검사 실패 (${problems.length}건):`);
  for (const problem of problems) console.error(`- ${problem}`);
  process.exitCode = 1;
} else {
  console.log(`공용 셸 계약 ${SHELL_CONTRACT} 확인: HTML 진입점 ${htmlFiles.length}개 통과.`);
}
