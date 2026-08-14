window.DESERTROSE_SITE_NETWORK = {
  sites: [
    { id: 'main', name: 'Everything of My Workspace', label: '모든 작업 공간을 잇는 메인 허브', url: 'https://etienne0112.github.io/MainSite/', repository: 'https://github.com/Etienne0112/MainSite', mark: 'EOW', accent: '#c8f03b' },
    { id: 'blog', name: "DesertRose's Blog", label: '짧게 적어 둔 개발 기록', url: 'https://etienne0112.github.io/DesertRose-s-Blog/', repository: 'https://github.com/Etienne0112/DesertRose-s-Blog', mark: 'DR', accent: '#ed4c34' },
    { id: 'study', name: 'Study Archive', label: '공부하면서 쌓아 둔 긴 문서', url: 'https://etienne0112.github.io/Study/', repository: 'https://github.com/Etienne0112/Study', mark: 'SA', accent: '#2457f5' },
    { id: 'micro3d', name: 'MicroGame3D', label: '세 축에서 고양이를 찾는 3D 논리 퍼즐', url: 'https://etienne0112.github.io/MicroGame3D/', repository: 'https://github.com/Etienne0112/MicroGame3D', mark: 'M3D', accent: '#c8f03b' },
    { id: 'template', name: 'My Site Template', label: '새 사이트를 빠르게 시작하는 공통 템플릿', url: 'https://etienne0112.github.io/SiteTemplate/', repository: 'https://github.com/Etienne0112/SiteTemplate', mark: 'TPL', accent: '#171716' }
  ],
  mainSiteId: 'main'
};

const escapeHTML = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[character]);

function networkSites() {
  const network = window.DESERTROSE_SITE_NETWORK || { sites: [] };
  const currentSiteId = document.body.dataset.siteId || 'micro3d';
  return network.sites.filter((site) => site.id !== currentSiteId);
}

function networkUtilities() {
  const network = window.DESERTROSE_SITE_NETWORK || { sites: [] };
  const currentSiteId = document.body.dataset.siteId || 'micro3d';
  const mainSite = network.sites.find((site) => site.id === (network.mainSiteId || 'main'));
  const currentSite = network.sites.find((site) => site.id === currentSiteId);
  return [
    mainSite && { ...mainSite, id: 'main-site', name: 'Main Site', label: '모든 작업 공간의 메인 허브' },
    currentSite?.repository && { id: 'repository', name: 'This Repository', label: `${currentSite.name} 소스 코드`, url: currentSite.repository, mark: 'GH', accent: '#171716', type: 'repository' }
  ].filter(Boolean);
}

function linkHTML(site) {
  return `<a class="site-network-link" href="${escapeHTML(site.url)}" target="_blank" rel="noopener" style="--network-accent:${escapeHTML(site.accent || '#2457f5')}">
    <span class="site-network-mark">${escapeHTML(site.mark)}</span>
    <span class="site-network-copy"><strong>${escapeHTML(site.name)}</strong><small>${escapeHTML(site.label)}</small></span>
    <span class="site-network-arrow" aria-hidden="true">↗</span>
  </a>`;
}

function renderSiteNetwork() {
  const sites = networkSites();
  const utilities = networkUtilities();
  const popover = document.getElementById('site-network-popover');
  if (!popover) return;
  popover.innerHTML = `
    <section class="site-network-group"><p class="site-network-heading">OTHER SITES / ${String(sites.length).padStart(2, '0')}</p>${sites.map(linkHTML).join('')}</section>
    <section class="site-network-group site-network-group--direct"><p class="site-network-heading">DIRECT LINKS / ${String(utilities.length).padStart(2, '0')}</p>${utilities.map(linkHTML).join('')}</section>`;
}

document.addEventListener('DOMContentLoaded', renderSiteNetwork);
document.addEventListener('desertrose-network-updated', renderSiteNetwork);
document.addEventListener('click', (event) => {
  const menu = document.getElementById('site-network-menu');
  if (menu?.open && !menu.contains(event.target)) menu.removeAttribute('open');
});

fetch('https://etienne0112.github.io/MainSite/site-network.json', { cache: 'no-store' })
  .then((response) => response.ok ? response.json() : Promise.reject(new Error('site network unavailable')))
  .then((network) => {
    if (!Array.isArray(network.sites) || !network.mainSiteId) return;
    window.DESERTROSE_SITE_NETWORK = network;
    document.dispatchEvent(new CustomEvent('desertrose-network-updated'));
  })
  .catch(() => {});
