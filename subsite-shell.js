/*
 * DesertRose 서브사이트 공용 셸 스크립트.
 * SUBSITE SHELL CONTRACT 1.0.0
 *
 * 네 사이트는 **각각 별도의 GitHub 레포지토리**이고 각자 GitHub Pages로 배포됩니다.
 *   Etienne0112/DesertRose-s-Blog · Etienne0112/Study · Etienne0112/SiteTemplate · Etienne0112/MicroGame3D
 * 그래서 이 파일은 네 레포에 **같은 내용으로 복사되어** 들어갑니다. 레포가 다르므로 한 곳을 고쳐도
 * 나머지가 따라오지 않습니다. 원본(upstream)은 SiteTemplate이며 다음 순서를 지킵니다.
 *
 *   1. SiteTemplate에서 이 파일과 subsite-shell.css를 고칩니다.
 *   2. SiteTemplate에서 `npm run sync-shell`을 실행해 형제 폴더로 체크아웃된 레포에 복사합니다.
 *   3. 각 레포에서 `npm run check`를 돌립니다. (scripts/verify-shell.mjs가 계약 위반을 잡습니다.)
 *   4. 레포마다 따로 커밋·푸시합니다.
 *
 * 위 버전 문자열은 verify-shell.mjs가 검사합니다. 계약을 바꾸면 버전을 올리고 네 레포를 함께 갱신하세요.
 *
 * 담당 범위
 *   - 사이트 네트워크 목록을 검증해서 읽어 오고 헤더의 SITES 메뉴를 그립니다.
 *   - 화면 테마 토글을 처리합니다. (다섯 사이트가 같은 출처라 선택한 테마가 그대로 따라갑니다.)
 *
 * 필요한 마크업
 *   <body data-site-id="...">                                현재 사이트를 목록에서 제외하는 데 사용합니다.
 *   <details class="site-network-menu" id="site-network-menu">
 *     <div class="site-network-popover" id="site-network-popover"></div>
 *   </details>
 *   <button class="icon-button" id="theme-toggle">◑</button>  (선택) 테마 토글
 *   <span id="site-network-footer"></span>                    (선택) 푸터의 바로가기 링크
 *
 * 테마 토글에 data-theme-label-light / data-theme-label-dark를 두면 상태에 맞는 aria-label을 넣어 줍니다.
 * 사이트별로 메뉴 문구를 바꿔야 하면 DesertRoseShell.setLabels({ ... }) 뒤에 renderNetwork()를 부릅니다.
 */
(function initializeSubsiteShell(global) {
  'use strict';

  const SHELL_CONTRACT = '1.0.0';
  // 사이트 목록의 단일 원본은 MainSite 레포입니다. 다섯 사이트가 같은 출처라 CORS 문제가 없습니다.
  const NETWORK_URL = 'https://etienne0112.github.io/MainSite/site-network.json';
  const MAX_RESPONSE_BYTES = 64 * 1024;
  const MAX_SITES = 32;
  const SAFE_ID = /^[a-z0-9-]{1,64}$/;
  const SAFE_ACCENT = /^#[0-9a-f]{6}$/i;
  const DEFAULT_ACCENT = '#2457f5';
  const REPOSITORY_ACCENT = '#171716';
  const UPDATED_EVENT = 'desertrose-network-updated';
  const THEME_KEY = 'desertrose.theme';
  const THEME_GLYPHS = { light: '◒', dark: '◑' };

  // 중앙 목록을 읽지 못했을 때도 메뉴가 동작하도록 두는 최소 목록입니다.
  const fallbackNetwork = {
    sites: [
      {
        id: 'main',
        name: 'Everything of My Workspace',
        label: '모든 작업 공간을 잇는 메인 허브',
        url: 'https://etienne0112.github.io/MainSite/',
        repository: 'https://github.com/Etienne0112/MainSite',
        mark: 'EOW',
        accent: '#c8f03b'
      },
      {
        id: 'blog',
        name: "DesertRose's Blog",
        label: '짧게 적어 둔 개발 기록',
        url: 'https://etienne0112.github.io/DesertRose-s-Blog/',
        repository: 'https://github.com/Etienne0112/DesertRose-s-Blog',
        mark: 'DR',
        accent: '#ed4c34'
      },
      {
        id: 'study',
        name: 'Study Archive',
        label: '공부하면서 쌓아 둔 긴 문서',
        url: 'https://etienne0112.github.io/Study/',
        repository: 'https://github.com/Etienne0112/Study',
        mark: 'SA',
        accent: '#2457f5'
      },
      {
        id: 'micro3d',
        name: 'MicroGame3D',
        label: '세 축에서 고양이를 찾는 3D 논리 퍼즐',
        url: 'https://etienne0112.github.io/MicroGame3D/',
        repository: 'https://github.com/Etienne0112/MicroGame3D',
        mark: 'M3D',
        accent: '#c8f03b'
      },
      {
        id: 'template',
        name: 'My Site Template',
        label: '새 사이트를 빠르게 시작하는 공통 템플릿',
        url: 'https://etienne0112.github.io/SiteTemplate/',
        repository: 'https://github.com/Etienne0112/SiteTemplate',
        mark: 'TPL',
        accent: '#171716'
      }
    ],
    mainSiteId: 'main'
  };

  const labels = {
    otherSites: 'OTHER SITES',
    directLinks: 'DIRECT LINKS',
    mainSite: 'Main Site',
    mainSiteLabel: '모든 작업 공간의 메인 허브',
    repository: 'This Repository',
    // {site} 자리에 현재 사이트 이름이 들어갑니다.
    repositoryLabel: '{site} 소스 코드'
  };

  // ---------- 사이트 목록 검증 ----------

  function boundedString(value, maximumLength, { allowEmpty = false } = {}) {
    if (typeof value !== 'string') return null;
    const normalized = value.trim();
    if ((!allowEmpty && normalized.length === 0) || normalized.length > maximumLength) return null;
    return normalized;
  }

  function safeHttpsUrl(value) {
    const candidate = boundedString(value, 2048);
    if (!candidate) return null;
    try {
      const parsed = new URL(candidate);
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return null;
      return parsed.href;
    } catch {
      return null;
    }
  }

  function normalizeSiteNetwork(candidate) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
    if (!Array.isArray(candidate.sites) || candidate.sites.length === 0 || candidate.sites.length > MAX_SITES) return null;
    if (typeof candidate.mainSiteId !== 'string' || !SAFE_ID.test(candidate.mainSiteId)) return null;

    const seenIds = new Set();
    const sites = [];
    for (const site of candidate.sites) {
      if (!site || typeof site !== 'object' || Array.isArray(site)) return null;
      const id = typeof site.id === 'string' && SAFE_ID.test(site.id) ? site.id : null;
      const name = boundedString(site.name, 120);
      const label = boundedString(site.label, 240, { allowEmpty: true });
      const mark = boundedString(site.mark, 12);
      const url = safeHttpsUrl(site.url);
      const repository = site.repository === undefined ? undefined : safeHttpsUrl(site.repository);
      const accent = typeof site.accent === 'string' && SAFE_ACCENT.test(site.accent) ? site.accent.toLowerCase() : null;
      if (!id || seenIds.has(id) || !name || label === null || !mark || !url || !accent || (site.repository !== undefined && !repository)) return null;
      seenIds.add(id);
      sites.push(Object.freeze({ id, name, label, url, ...(repository ? { repository } : {}), mark, accent }));
    }

    if (!seenIds.has(candidate.mainSiteId)) return null;
    return Object.freeze({ sites: Object.freeze(sites), mainSiteId: candidate.mainSiteId });
  }

  // ---------- 목록 조회 ----------

  const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);

  const pad2 = value => String(value).padStart(2, '0');
  const hasDom = () => typeof document !== 'undefined' && typeof document.getElementById === 'function';

  function currentNetwork() {
    return normalizeSiteNetwork(global.DESERTROSE_SITE_NETWORK) || { sites: [], mainSiteId: 'main' };
  }

  function currentSiteId() {
    return (typeof document !== 'undefined' && document.body && document.body.dataset.siteId) || '';
  }

  /** 현재 사이트를 제외한 나머지 사이트입니다. */
  function otherSites() {
    const id = currentSiteId();
    return currentNetwork().sites.filter(site => site.id !== id);
  }

  /** 메인 허브와 현재 사이트 저장소로 가는 바로가기입니다. */
  function directLinks() {
    const network = currentNetwork();
    const mainSite = network.sites.find(site => site.id === network.mainSiteId);
    const currentSite = network.sites.find(site => site.id === currentSiteId());
    return [
      mainSite && {
        ...mainSite,
        id: 'main-site',
        name: labels.mainSite,
        label: labels.mainSiteLabel,
        type: 'main'
      },
      currentSite && currentSite.repository && {
        id: 'repository',
        name: labels.repository,
        label: labels.repositoryLabel.replace('{site}', currentSite.name),
        url: currentSite.repository,
        mark: 'GH',
        accent: REPOSITORY_ACCENT,
        type: 'repository'
      }
    ].filter(Boolean);
  }

  // ---------- 사이트 네트워크 메뉴 ----------

  function linkHTML(entry) {
    return `<a class="site-network-link" href="${escapeHTML(entry.url)}" target="_blank" rel="noopener noreferrer" style="--network-accent:${escapeHTML(entry.accent || DEFAULT_ACCENT)}">` +
      `<span class="site-network-mark">${escapeHTML(entry.mark)}</span>` +
      `<span class="site-network-copy"><strong>${escapeHTML(entry.name)}</strong><small>${escapeHTML(entry.label)}</small></span>` +
      `<span class="site-network-arrow" aria-hidden="true">↗</span></a>`;
  }

  function groupHTML(heading, entries, modifier = '') {
    return `<section class="site-network-group${modifier}">` +
      `<p class="site-network-heading">${escapeHTML(heading)} / ${pad2(entries.length)}</p>` +
      entries.map(linkHTML).join('') +
      '</section>';
  }

  function renderNetwork() {
    if (!hasDom()) return;
    const sites = otherSites();
    const utilities = directLinks();

    const popover = document.getElementById('site-network-popover');
    if (popover) {
      popover.innerHTML = groupHTML(labels.otherSites, sites) +
        groupHTML(labels.directLinks, utilities, ' site-network-group--direct');
    }

    const footer = document.getElementById('site-network-footer');
    if (footer) {
      footer.innerHTML = utilities
        .map(entry => `<a href="${escapeHTML(entry.url)}" target="_blank" rel="noopener noreferrer">${escapeHTML(entry.name.toUpperCase())} ↗</a> · `)
        .join('');
    }
  }

  function setLabels(overrides) {
    for (const [key, value] of Object.entries(overrides || {})) {
      if (key in labels && typeof value === 'string' && value) labels[key] = value;
    }
  }

  function closeOpenMenus(target) {
    for (const menu of document.querySelectorAll('details.site-network-menu[open]')) {
      if (!target || !menu.contains(target)) menu.removeAttribute('open');
    }
  }

  // ---------- 화면 테마 ----------

  function readStoredTheme() {
    try {
      const stored = localStorage.getItem(THEME_KEY);
      return stored === 'light' || stored === 'dark' ? stored : null;
    } catch {
      return null;
    }
  }

  function prefersDark() {
    return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
  }

  function applyTheme(theme, { persist = true } = {}) {
    const next = theme === 'dark' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    if (persist) {
      try {
        localStorage.setItem(THEME_KEY, next);
      } catch { /* 저장할 수 없는 환경에서는 현재 세션 상태만 유지합니다. */ }
    }
    const toggle = document.getElementById('theme-toggle');
    if (!toggle) return next;
    toggle.textContent = THEME_GLYPHS[next];
    const label = toggle.dataset[next === 'dark' ? 'themeLabelDark' : 'themeLabelLight'];
    if (label) toggle.setAttribute('aria-label', label);
    return next;
  }

  function currentTheme() {
    return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  }

  function setUpTheme() {
    const stored = readStoredTheme();
    applyTheme(stored || (prefersDark() ? 'dark' : 'light'), { persist: false });
    document.getElementById('theme-toggle')
      ?.addEventListener('click', () => applyTheme(currentTheme() === 'dark' ? 'light' : 'dark'));
  }

  // ---------- 초기화 ----------

  global.DESERTROSE_SITE_NETWORK = normalizeSiteNetwork(fallbackNetwork);

  Object.defineProperty(global, 'DESERTROSE_NORMALIZE_SITE_NETWORK', {
    value: normalizeSiteNetwork,
    configurable: false,
    enumerable: false,
    writable: false
  });

  global.DesertRoseShell = Object.freeze({
    contract: SHELL_CONTRACT,
    escapeHTML,
    pad2,
    normalize: normalizeSiteNetwork,
    otherSites,
    directLinks,
    linkHTML,
    renderNetwork,
    setLabels,
    applyTheme,
    currentTheme
  });

  // 정적 검증 환경에는 DOM 이벤트가 없으므로 있을 때만 연결합니다.
  const canListen = typeof document !== 'undefined' && typeof document.addEventListener === 'function';

  if (canListen) {
    const start = () => {
      setUpTheme();
      renderNetwork();
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();

    document.addEventListener('click', event => closeOpenMenus(event.target));
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') closeOpenMenus(null);
    });
  }

  fetch(NETWORK_URL, { cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' })
    .then(async response => {
      if (!response.ok) throw new Error('site network unavailable');
      const declaredLength = Number(response.headers.get('content-length'));
      if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) throw new Error('site network too large');
      const text = await response.text();
      if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) throw new Error('site network too large');
      return JSON.parse(text);
    })
    .then(network => {
      const normalized = normalizeSiteNetwork(network);
      if (!normalized) return;
      global.DESERTROSE_SITE_NETWORK = normalized;
      renderNetwork();
      if (canListen) document.dispatchEvent(new CustomEvent(UPDATED_EVENT));
    })
    .catch(() => {});
})(window);
