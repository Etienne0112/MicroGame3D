import {
  SUPPORTED_SIZES,
  getCoords as getCoreCoords,
  getNumCats as getCoreNumCats,
  getOrthogonalNeighbors,
  getScreenCols as getCoreScreenCols,
  getScreenRows as getCoreScreenRows,
  makeBoard as createBoard,
} from './core.js';

'use strict';

const SAVE_KEY = 'myMeowDoku.save';
const SOUND_KEY = 'myMeowDoku.sound';
const MAX_MISTAKES = 3;
const DBLCLICK_DELAY = 250; // ms: 싱글클릭 확정 대기 시간

// 영역마다 서로 다른 고양이 — 카드를 뒤집으면 그 영역의 고양이가 나온다
const CAT_FACES = [
  '😺', '😸', '😹', '😻', '😼', '😽', '🙀', '😿', '😾', '🐱',
  '🐈', '🐈‍⬛', '🦁', '🐯', '🐅', '🐆',
];

let regionColors = [];

function createRegionPalette(count = 32) {
  return Array.from({ length: count }, (_, index) => {
    // 황금각 순서로 색을 뽑으면 연속 인덱스끼리도 충분히 멀리 떨어진다.
    const hue = Math.round((index * 137.508 + 18) % 360);
    const saturation = index % 2 === 0 ? 64 : 56;
    const lightness = index % 3 === 0 ? 69 : 62;
    return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
  });
}

// 맞닿은 영역끼리 같은 색이 되지 않도록 3D 인접 그래프를 채색한다.
function computeRegionColors() {
  if (!board || !board.regions) return;
  const rows = getScreenRows();
  const cols = getScreenCols();
  const numRegions = getNumCats();
  const adj = Array.from({ length: numRegions }, () => new Set());

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const reg = board.regions[r][c];
      for (const [nr, nc] of get3DNeighbors(r, c)) {
        const nreg = board.regions[nr][nc];
        if (nreg !== reg) {
          adj[reg].add(nreg);
          adj[nreg].add(reg);
        }
      }
    }
  }

  const palette = createRegionPalette();
  const colorsAssigned = Array(numRegions).fill(-1);
  const regionOrder = [...Array(numRegions).keys()]
    .sort((a, b) => adj[b].size - adj[a].size);

  for (const reg of regionOrder) {
    const used = new Set(
      [...adj[reg]]
        .map((neighbor) => colorsAssigned[neighbor])
        .filter((color) => color !== -1)
    );
    const available = palette.findIndex((_, color) => !used.has(color));
    colorsAssigned[reg] = available === -1 ? reg % palette.length : available;
  }

  regionColors = colorsAssigned.map((index) => palette[index]);
}

let highlightedEls = [];
let pendingHighlight = null;
let highlightFrame = 0;
let lastHighlightKey = '';

function clearHighlights() {
  for (const el of highlightedEls) {
    el.classList.remove('highlight-hover', 'highlight-axis', 'highlight-adj');
  }
  highlightedEls = [];
}

function resetHighlights() {
  pendingHighlight = null;
  lastHighlightKey = '';
  if (highlightFrame) cancelAnimationFrame(highlightFrame);
  highlightFrame = 0;
  clearHighlights();
}

function addHighlight(r, c, className) {
  const el = cellEls[r]?.[c];
  if (!el) return;
  el.classList.add(className);
  highlightedEls.push(el);
}

// 전체 N³ 셀을 훑지 않고 축 3N개와 주변 최대 26개만 갱신한다.
function updateHighlights(r, c) {
  clearHighlights();
  if (locked || r < 0 || c < 0) return;

  const { x, y, z } = getCoords(r, c);
  addHighlight(r, c, 'highlight-hover');

  for (let px = 0; px < N; px++) {
    if (px !== x) addHighlight(y, z * N + px, 'highlight-axis');
  }
  for (let py = 0; py < N; py++) {
    if (py !== y) addHighlight(py, c, 'highlight-axis');
  }
  for (let pz = 0; pz < N; pz++) {
    if (pz !== z) addHighlight(y, pz * N + x, 'highlight-axis');
  }

  for (let dz = -1; dz <= 1; dz++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0 && dz === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        const nz = z + dz;
        if (nx < 0 || ny < 0 || nz < 0 || nx >= N || ny >= N || nz >= N) continue;
        const el = cellEls[ny]?.[nz * N + nx];
        if (el && !el.classList.contains('highlight-axis')) {
          el.classList.add('highlight-adj');
          highlightedEls.push(el);
        }
      }
    }
  }
}

function queueHighlights(r, c) {
  const key = `${r},${c}`;
  if (key === lastHighlightKey) return;
  lastHighlightKey = key;
  pendingHighlight = { r, c };
  if (highlightFrame) return;
  highlightFrame = requestAnimationFrame(() => {
    highlightFrame = 0;
    const target = pendingHighlight;
    pendingHighlight = null;
    if (target) updateHighlights(target.r, target.c);
  });
}

let N = 9;
let winStreak = 0;

let board = null;      // { isDiamond: boolean[][], regions: number[][] }
let cells = [];        // 2D [r][c] -> { revealed, mark }
let cellEls = [];      // 2D [r][c] -> 카드 요소
let mistakes = 0;
let locked = false;    // 애니메이션/오버레이 중 입력 차단
let flashing = null;   // 오답 카드 잠깐 보여주기: {r, c}
let clickTimer = null;
let drag = null;           // { mode:'paw'|'none', startR, startC, moved, visited:Set }
let suppressClick = false; // 드래그 직후 발생하는 click 이벤트 무시
let revealedCatsCount = 0; // 스테이지 클리어 판정을 위한 카운터
let statusMessage = '축과 영역의 교차점을 읽어 보세요.';

const boardEl = document.getElementById('board');
const boardWrapperEl = document.getElementById('board-wrapper');
const levelEl = document.getElementById('level-display');
const livesEl = document.getElementById('lives-display');
const overlayEl = document.getElementById('overlay');
const bannerEl = document.getElementById('banner');
const bannerMsgEl = document.getElementById('banner-msg');
const bannerBtnEl = document.getElementById('banner-btn');
const overlayTitleEl = document.getElementById('overlay-title');
const overlayMsgEl = document.getElementById('overlay-message');
const overlayBtnEl = document.getElementById('overlay-btn');
const sizeSelect = document.getElementById('size-select');
const streakEl = document.getElementById('streak-display');
const coordsEl = document.getElementById('coords-display');
const restartBtnEl = document.getElementById('restart-btn');
const resetBtnEl = document.getElementById('reset-btn');
const catsEl = document.getElementById('cats-display');
const catsProgressEl = document.getElementById('cats-progress');
const statusCopyEl = document.getElementById('status-copy');
const soundToggleEl = document.getElementById('sound-toggle');

function readPreference(key, fallback) {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

function writePreference(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch { /* 저장할 수 없는 환경에서는 현재 세션 상태만 유지한다. */ }
}

// 화면 테마는 공용 subsite-shell.js가 처리합니다.

function setStatus(message) {
  statusMessage = message;
  if (statusCopyEl) statusCopyEl.textContent = message;
}

// ----- 조작 및 화면 이동 모드 상태 -----
let panMode = false; // false = 마킹 모드, true = 보드 판 이동 모드
let isPanning = false;
let panStartX = 0;
let panStartY = 0;
let panScrollLeft = 0;
let panScrollTop = 0;

const modeBtnEl = document.getElementById('mode-btn');

modeBtnEl.addEventListener('click', () => {
  panMode = !panMode;
  modeBtnEl.textContent = panMode ? '✋ 이동 모드' : '🐾 마킹 모드';
  modeBtnEl.classList.toggle('pan-active', panMode);
  modeBtnEl.setAttribute('aria-pressed', String(panMode));
  document.body.classList.toggle('pan-active', panMode);
  setStatus(panMode ? '보드를 끌어 원하는 층으로 이동할 수 있습니다.' : '카드를 클릭하거나 드래그해 발자국을 표시하세요.');
  resetHighlights();
});

// ---------- 3D 격자 매핑 공식 ----------

// 스크린상의 가로(Col) 개수 반환 (3D: N * N)
function getScreenCols() {
  return getCoreScreenCols(N);
}

// 스크린상의 세로(Row) 개수 반환 (3D: N)
function getScreenRows() {
  return getCoreScreenRows(N);
}

// 총 배치되어야 하는 고양이 수 반환 (3D: N^2)
function getNumCats() {
  return getCoreNumCats(N);
}

// 스크린 셀 (R, C)을 3D 공간 좌표 (x, y, z)로 변환
function getCoords(r, c) {
  return getCoreCoords(N, r, c);
}

// ---------- 보드 생성 ----------

function get3DNeighbors(r, c) {
  return getOrthogonalNeighbors(N, r, c);
}

function makeBoard() {
  return createBoard(N);
}

let nextBoard = null;
let prepareToken = 0;

function prepareNextBoard() {
  const token = ++prepareToken;
  nextBoard = null;
  const generate = () => {
    if (token !== prepareToken) return;
    nextBoard = makeBoard();
  };

  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(generate, { timeout: 2000 });
  } else {
    setTimeout(generate, 600);
  }
}

function newBoard() {
  const rows = getScreenRows();
  const cols = getScreenCols();
  const preparedBoardMatchesSize = nextBoard &&
    isValidSavedMatrix(nextBoard.isDiamond, rows, cols) &&
    isValidSavedMatrix(nextBoard.regions, rows, cols);

  if (preparedBoardMatchesSize) {
    board = { isDiamond: nextBoard.isDiamond, regions: nextBoard.regions };
  } else {
    board = makeBoard(); // 동기 생성
  }
  saveProgress();
  prepareNextBoard();
  resetRound();
}

function resetRound() {
  const rows = getScreenRows();
  const cols = getScreenCols();
  cells = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => ({ revealed: false, mark: 'none' }))
  );
  mistakes = 0;
  revealedCatsCount = 0;
  locked = false;
  flashing = null;
  setStatus('새 큐브가 준비됐습니다. 축과 영역의 교차점을 읽어 보세요.');
  hideOverlay();
  bannerEl.classList.add('hidden');

  resetHighlights();
  computeRegionColors();
  buildBoard();
  renderAll();
  // 보드 새로 생성 시 좌측 상단으로 스크롤 리셋
  boardWrapperEl.scrollLeft = 0;
  boardWrapperEl.scrollTop = 0;
}

// ---------- 효과음 (Web Audio 합성) ----------

let audioCtx = null;
let soundEnabled = readPreference(SOUND_KEY, 'on') !== 'off';

function renderSoundPreference() {
  soundToggleEl.textContent = soundEnabled ? '♪' : '×';
  soundToggleEl.setAttribute('aria-pressed', String(soundEnabled));
  soundToggleEl.setAttribute('aria-label', soundEnabled ? '효과음 끄기' : '효과음 켜기');
}

renderSoundPreference();

function getAudio() {
  if (!soundEnabled) return null;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!audioCtx) audioCtx = new AC();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

document.addEventListener('mousedown', getAudio, { once: true });
document.addEventListener('touchstart', getAudio, { once: true });

soundToggleEl.addEventListener('click', () => {
  soundEnabled = !soundEnabled;
  writePreference(SOUND_KEY, soundEnabled ? 'on' : 'off');
  renderSoundPreference();
  if (soundEnabled) {
    getAudio();
    playPop(false);
    setStatus('효과음을 켰습니다. 고양이 신호를 들어 보세요.');
  } else {
    audioCtx?.suspend();
    setStatus('효과음을 껐습니다. 게임 규칙과 진행은 그대로 유지됩니다.');
  }
});

let lastPopAt = 0;

function playPop(erase) {
  const now = performance.now();
  if (now - lastPopAt < 35) return;
  lastPopAt = now;
  const ctx = getAudio();
  if (!ctx) return;
  const t = ctx.currentTime;
  const base = (erase ? 280 : 480) * (0.9 + Math.random() * 0.2);
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(base, t);
  osc.frequency.exponentialRampToValueAtTime(base * 2.3, t + 0.06);
  gain.gain.setValueAtTime(0.25, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + 0.1);
}

function playChime() {
  const ctx = getAudio();
  if (!ctx) return;
  const t = ctx.currentTime;
  const notes = [
    { freq: 659.25, start: t, dur: 0.7 },
    { freq: 523.25, start: t + 0.28, dur: 0.9 },
  ];
  for (const { freq, start, dur } of notes) {
    for (const [mult, vol] of [[1, 0.25], [2, 0.08], [3, 0.03]]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq * mult;
      gain.gain.setValueAtTime(vol, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + dur);
    }
  }
}

function playFanfare() {
  const ctx = getAudio();
  if (!ctx) return;
  const t = ctx.currentTime + 0.3;
  const C5 = 523.25, E5 = 659.25, G5 = 783.99, C6 = 1046.5;
  const note = (freq, start, dur, vol) => {
    for (const [mult, v, type] of [[1, vol, 'triangle'], [1, vol * 0.4, 'sawtooth']]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq * mult;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(v, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + dur);
    }
  };
  note(C5, t, 0.25, 0.18);
  note(E5, t + 0.13, 0.25, 0.18);
  note(G5, t + 0.26, 0.25, 0.18);
  for (const f of [C5, E5, G5, C6]) note(f, t + 0.42, 1.0, 0.12);
}

function playWarning() {
  const ctx = getAudio();
  if (!ctx) return;
  const t = ctx.currentTime;
  for (let i = 0; i < 2; i++) {
    const start = t + i * 0.17;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(220, start);
    osc.frequency.linearRampToValueAtTime(150, start + 0.13);
    gain.gain.setValueAtTime(0.15, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.15);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + 0.16);
  }
}

function updateCoordsDisplay(r, c) {
  const { x, y, z } = getCoords(r, c);
  coordsEl.textContent = `x ${x + 1} · y ${y + 1} · z ${z + 1}`;
}

// ---------- 입력 ----------

function isDiamond(r, c) {
  return board.isDiamond[r][c];
}

let pendingR = -1, pendingC = -1; // 보류 중인 싱글클릭의 위치

function onCellClick(r, c) {
  if (panMode || suppressClick) return;
  if (clickTimer) {
    clearTimeout(clickTimer);
    clickTimer = null;
    if (pendingR === r && pendingC === c) {
      doubleClick(r, c);
      return;
    }
    singleClick(pendingR, pendingC);
  }
  pendingR = r;
  pendingC = c;
  clickTimer = setTimeout(() => {
    clickTimer = null;
    singleClick(r, c);
  }, DBLCLICK_DELAY);
}

// ----- 드래그 마킹 -----

function startDrag(r, c) {
  if (locked || panMode) return;
  const cell = cells[r][c];
  if (cell.revealed || cell.mark === 'wrong') return;
  drag = {
    mode: cell.mark === 'paw' ? 'none' : 'paw',
    startR: r,
    startC: c,
    moved: false,
    visited: new Set(),
  };
}

function onCellDown(r, c, e) {
  if (e.button !== 0 || panMode) return;
  e.preventDefault();
  updateCoordsDisplay(r, c);
  startDrag(r, c);
}

function onCellEnter(r, c) {
  updateCoordsDisplay(r, c);
  queueHighlights(r, c);
  if (!drag || locked || panMode) return;
  if (!drag.moved) {
    drag.moved = true;
    applyDragMark(drag.startR, drag.startC);
  }
  applyDragMark(r, c);
}

function applyDragMark(r, c) {
  const key = r + ',' + c;
  if (drag.visited.has(key)) return;
  drag.visited.add(key);
  const cell = cells[r][c];
  if (cell.revealed || cell.mark === 'wrong') return;
  if (cell.mark !== drag.mode) {
    cell.mark = drag.mode;
    playPop(drag.mode === 'none');
    renderCell(r, c);
  }
}

function getEventCard(event) {
  const card = event.target.closest?.('.card');
  return card && boardEl.contains(card) ? card : null;
}

boardEl.addEventListener('click', (event) => {
  const card = getEventCard(event);
  if (card) onCellClick(+card.dataset.r, +card.dataset.c);
});

boardEl.addEventListener('dblclick', (event) => {
  const card = getEventCard(event);
  if (card) onCellDblClick(+card.dataset.r, +card.dataset.c);
});

boardEl.addEventListener('mousedown', (event) => {
  const card = getEventCard(event);
  if (card) onCellDown(+card.dataset.r, +card.dataset.c, event);
});

boardEl.addEventListener('mouseover', (event) => {
  const card = getEventCard(event);
  if (!card) return;
  const previous = event.relatedTarget?.closest?.('.card');
  if (previous === card) return;
  onCellEnter(+card.dataset.r, +card.dataset.c);
});

document.addEventListener('mouseup', () => {
  if (drag && drag.moved) {
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 0);
  }
  drag = null;
});

// ----- 터치 드래그 -----

boardEl.addEventListener('touchstart', (e) => {
  if (panMode) return;
  const card = e.target.closest('.card');
  if (!card) return;
  const r = +card.dataset.r, c = +card.dataset.c;
  updateCoordsDisplay(r, c);
  startDrag(r, c);
});

boardEl.addEventListener('touchmove', (e) => {
  if (!drag || locked || panMode) return;
  const t = e.touches[0];
  const el = document.elementFromPoint(t.clientX, t.clientY);
  const card = el && el.closest('.card');
  if (!card) return;
  const r = +card.dataset.r, c = +card.dataset.c;
  updateCoordsDisplay(r, c);
  if (!drag.moved && r === drag.startR && c === drag.startC) return;
  onCellEnter(r, c);
}, { passive: true });

function endTouch() {
  if (drag && drag.moved) {
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 350);
  }
  drag = null;
  resetHighlights();
}
document.addEventListener('touchend', endTouch);
document.addEventListener('touchcancel', endTouch);

boardEl.addEventListener('mouseleave', () => {
  coordsEl.textContent = 'x — · y — · z —';
  resetHighlights();
});

function onCellDblClick(r, c) {
  if (panMode) return;
  clearTimeout(clickTimer);
  clickTimer = null;
  doubleClick(r, c);
}

function singleClick(r, c) {
  if (locked || panMode) return;
  const cell = cells[r][c];
  if (cell.revealed || cell.mark === 'wrong') return;
  cell.mark = cell.mark === 'paw' ? 'none' : 'paw';
  playPop(cell.mark === 'none');
  renderCell(r, c);
}

function doubleClick(r, c) {
  if (locked || panMode) return;
  const cell = cells[r][c];
  if (cell.revealed || cell.mark === 'wrong') return;

  if (isDiamond(r, c)) {
    cell.revealed = true;
    cell.mark = 'none';
    playChime();
    revealedCatsCount++;
    setStatus(`CAT SIGNAL / ${revealedCatsCount}번째 고양이를 찾았습니다.`);
    const changed = autoMarkAround(r, c);
    changed.add(`${r},${c}`);
    renderCells(changed);
    renderStatus();
    if (revealedCatsCount === getNumCats()) {
      onLevelClear();
    }
  } else {
    onMistake(r, c);
  }
}

// 다이아몬드 공개 시: 3D 각 축(X, Y, Z)의 1D 라인 + 3D 인접 칸 자동 마킹
function autoMarkAround(r, c) {
  const rows = getScreenRows();
  const cols = getScreenCols();
  const changed = new Set();
  const mark = (rr, cc) => {
    if (rr < 0 || rr >= rows || cc < 0 || cc >= cols) return;
    const cell = cells[rr][cc];
    if (!cell.revealed && cell.mark === 'none') {
      cell.mark = 'paw';
      changed.add(`${rr},${cc}`);
    }
  };
  
  // 1. X축 1D 라인 마킹 (동일한 슬라이스 z 내의 동일 행 r)
  const zStart = Math.floor(c / N) * N;
  for (let xp = 0; xp < N; xp++) {
    const colIndex = zStart + xp;
    if (colIndex !== c) {
      mark(r, colIndex);
    }
  }
  
  // 2. Y축 1D 라인 마킹 (동일 스크린 열 c)
  for (let yp = 0; yp < N; yp++) {
    if (yp !== r) {
      mark(yp, c);
    }
  }
  
  // 3. Z축 1D 라인 마킹 (모든 슬라이스 zp를 가로질러 동일한 로컬 (x, y) 위치)
  const xOffset = c % N;
  for (let zp = 0; zp < N; zp++) {
    const colIndex = zp * N + xOffset;
    if (colIndex !== c) {
      mark(r, colIndex);
    }
  }
  
  // 4. 현재 좌표 주변 최대 26칸만 확인한다.
  const { x, y, z } = getCoords(r, c);
  for (let dz = -1; dz <= 1; dz++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0 && dz === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        const nz = z + dz;
        if (nx < 0 || ny < 0 || nz < 0 || nx >= N || ny >= N || nz >= N) continue;
        mark(ny, nz * N + nx);
      }
    }
  }

  return changed;
}

function onMistake(r, c) {
  mistakes++;
  locked = true;
  flashing = { r, c };
  setStatus(`STONE SIGNAL / 남은 기회 ${MAX_MISTAKES - mistakes}`);
  playWarning();
  renderStatus();
  renderCell(r, c);
  boardEl.classList.add('shake');
  setTimeout(() => {
    boardEl.classList.remove('shake');
    flashing = null;
    cells[r][c].mark = 'wrong';
    locked = false;
    renderStatus();
    renderCell(r, c);
    if (mistakes >= MAX_MISTAKES) {
      locked = true;
      const oldStreak = winStreak;
      winStreak = 0; // 게임오버 시 연승 초기화
      renderStatus();
      saveProgress();
      showOverlay('😿 Game Over', `${oldStreak}연승에서 멈췄습니다. 돌멩이를 세 번 뒤집었어요.`, '다시 시작', resetRound);
    }
  }, 800);
}

// 클리어 축하 배너
function onLevelClear() {
  locked = true;
  playFanfare();
  winStreak++;
  setStatus(`CUBE COMPLETE / 고양이 ${getNumCats()}마리를 모두 찾았습니다.`);
  renderStatus();
  saveProgress();
  bannerMsgEl.textContent = `🎉 고양이 ${getNumCats()}마리를 모두 찾았습니다! (${winStreak}연승 중!)`;
  bannerEl.classList.remove('hidden');
}

bannerBtnEl.addEventListener('click', () => {
  newBoard();
});

// ---------- 드래그 스크롤 마우스/터치 기능 제어 (이동 모드) ----------

boardWrapperEl.addEventListener('mousedown', (e) => {
  if (!panMode) return;
  isPanning = true;
  panStartX = e.pageX - boardWrapperEl.offsetLeft;
  panStartY = e.pageY - boardWrapperEl.offsetTop;
  panScrollLeft = boardWrapperEl.scrollLeft;
  panScrollTop = boardWrapperEl.scrollTop;
});

document.addEventListener('mousemove', (e) => {
  if (!isPanning || !panMode) return;
  e.preventDefault();
  const x = e.pageX - boardWrapperEl.offsetLeft;
  const y = e.pageY - boardWrapperEl.offsetTop;
  const walkX = x - panStartX;
  const walkY = y - panStartY;
  boardWrapperEl.scrollLeft = panScrollLeft - walkX;
  boardWrapperEl.scrollTop = panScrollTop - walkY;
});

document.addEventListener('mouseup', () => {
  isPanning = false;
});

boardWrapperEl.addEventListener('touchstart', (e) => {
  if (!panMode) return;
  isPanning = true;
  const t = e.touches[0];
  panStartX = t.pageX - boardWrapperEl.offsetLeft;
  panStartY = t.pageY - boardWrapperEl.offsetTop;
  panScrollLeft = boardWrapperEl.scrollLeft;
  panScrollTop = boardWrapperEl.scrollTop;
});

boardWrapperEl.addEventListener('touchmove', (e) => {
  if (!isPanning || !panMode) return;
  const t = e.touches[0];
  const x = t.pageX - boardWrapperEl.offsetLeft;
  const y = t.pageY - boardWrapperEl.offsetTop;
  const walkX = x - panStartX;
  const walkY = y - panStartY;
  boardWrapperEl.scrollLeft = panScrollLeft - walkX;
  boardWrapperEl.scrollTop = panScrollTop - walkY;
}, { passive: true });

boardWrapperEl.addEventListener('touchend', () => {
  isPanning = false;
});

// ---------- 격자 크기 선택창 기능 ----------

function populateSizeSelect(defaultSize) {
  sizeSelect.innerHTML = '';

  for (const n of SUPPORTED_SIZES) {
    const opt = document.createElement('option');
    opt.value = n;
    opt.textContent = n === 16 ? `${n} × ${n} × ${n} · 고사양` : `${n} × ${n} × ${n}`;
    if (n === defaultSize) opt.selected = true;
    sizeSelect.appendChild(opt);
  }
}

sizeSelect.addEventListener('change', () => {
  const nextSize = parseInt(sizeSelect.value);
  if (nextSize === N) return;
  prepareToken++;
  nextBoard = null;
  N = nextSize;
  setStatus(`${N} × ${N} × ${N} 큐브를 생성하고 있습니다.`);
  newBoard();
});

// ---------- 렌더링 ----------

function buildBoard() {
  const cols = getScreenCols();
  const rows = getScreenRows();
  const cellSize = N >= 16 ? 15 : Math.max(20, Math.min(26, Math.floor(224 / N)));
  const fragment = document.createDocumentFragment();

  boardEl.style.setProperty('--slice-columns', 3);
  boardEl.style.setProperty('--layer-gap', N >= 16 ? '10px' : '18px');
  cellEls = Array.from({ length: rows }, () => Array(cols).fill(null));

  for (let z = 0; z < N; z++) {
    const sliceEl = document.createElement('div');
    sliceEl.className = 'slice-container';
    sliceEl.style.setProperty('--slice-z', z);
    sliceEl.style.gridTemplateColumns = `repeat(${N}, ${cellSize}px)`;
    sliceEl.style.gridTemplateRows = `26px repeat(${N}, ${cellSize}px)`;

    const labelEl = document.createElement('div');
    labelEl.className = 'slice-label';
    labelEl.innerHTML = `Z ${String(z + 1).padStart(2, '0')} <span>${N} × ${N}</span>`;
    sliceEl.appendChild(labelEl);

    for (let r = 0; r < rows; r++) {
      for (let x = 0; x < N; x++) {
        const c = z * N + x;
        const el = document.createElement('div');
        el.className = 'card';
        el.style.width = `${cellSize}px`;
        el.style.height = `${cellSize}px`;
        el.style.fontSize = `${Math.floor(cellSize * 0.7)}px`;
        el.style.backgroundColor = regionColors[board.regions[r][c]];
        el.dataset.r = r;
        el.dataset.c = c;

        // 다른 색 영역과 맞닿은 변에 굵은 경계선 (각 슬라이스 평면 독립 판정)
        const reg = board.regions[r][c];
        if (r === 0 || board.regions[r - 1][c] !== reg) el.classList.add('bt');
        if (r === rows - 1 || board.regions[r + 1][c] !== reg) el.classList.add('bb');
        if (x === 0 || board.regions[r][c - 1] !== reg) el.classList.add('bl');
        if (x === N - 1 || board.regions[r][c + 1] !== reg) el.classList.add('br');

        cellEls[r][c] = el;
        sliceEl.appendChild(el);
      }
    }
    fragment.appendChild(sliceEl);
  }

  // 보드 생성 시에만 DOM을 교체한다. 플레이 중 상태 변경은 개별 셀만 갱신한다.
  boardEl.replaceChildren(fragment);
}

function renderStatus() {
  levelEl.textContent = `${N} × ${N} × ${N} 큐브`;
  streakEl.textContent = `🔥 ${winStreak}`;
  livesEl.textContent =
    '❤️'.repeat(MAX_MISTAKES - mistakes) + '🖤'.repeat(mistakes);
  catsEl.textContent = `${revealedCatsCount} / ${getNumCats()}`;
  catsProgressEl.style.width = `${(revealedCatsCount / getNumCats()) * 100}%`;
  statusCopyEl.textContent = statusMessage;
}

function renderCell(r, c) {
  const cell = cells[r][c];
  const el = cellEls[r]?.[c];
  if (!el) return;
  const reg = board.regions[r][c];
  const isFlash = flashing && flashing.r === r && flashing.c === c;

  el.classList.toggle('revealed', cell.revealed || isFlash);
  el.classList.toggle('flash-stone', Boolean(isFlash));
  el.classList.toggle('wrong', !cell.revealed && !isFlash && cell.mark === 'wrong');

  if (cell.revealed) {
    el.textContent = CAT_FACES[reg % CAT_FACES.length];
  } else if (isFlash) {
    el.textContent = '🪨';
  } else {
    el.textContent = cell.mark === 'paw' ? '🐾' : cell.mark === 'wrong' ? '✕' : '';
  }
}

function renderCells(keys) {
  for (const key of keys) {
    const [r, c] = key.split(',').map(Number);
    renderCell(r, c);
  }
}

function renderAll() {
  const rows = getScreenRows();
  const cols = getScreenCols();
  renderStatus();

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      renderCell(r, c);
    }
  }
}

function showOverlay(title, message, btnLabel, onClick) {
  overlayTitleEl.textContent = title;
  overlayMsgEl.textContent = message;
  overlayBtnEl.textContent = btnLabel;
  overlayBtnEl.onclick = onClick;
  overlayEl.classList.remove('hidden');
}

function hideOverlay() {
  overlayEl.classList.add('hidden');
}

restartBtnEl.addEventListener('click', () => {
  if (!overlayEl.classList.contains('hidden')) return;
  setStatus('같은 큐브를 처음 상태로 되돌렸습니다.');
  resetRound();
});

// 연승 정보 초기화 및 재생성
resetBtnEl.addEventListener('click', () => {
  winStreak = 0;
  setStatus('연승을 초기화하고 새 큐브를 준비합니다.');
  newBoard();
});

// ---------- 진행 저장 ----------
function saveProgress() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      N,
      winStreak,
      isDiamond: board.isDiamond,
      regions: board.regions,
    }));
  } catch (e) { /* 무시 */ }
}

function loadProgress() {
  try {
    const data = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (!data) return null;
    return data;
  } catch (e) {
    return null;
  }
}

function isValidSavedMatrix(matrix, rows, cols) {
  return Array.isArray(matrix) &&
    matrix.length === rows &&
    matrix.every((row) => Array.isArray(row) && row.length === cols);
}

function startGame() {
  const saved = loadProgress();
  const savedSize = Number(saved?.N);
  if (saved && SUPPORTED_SIZES.includes(savedSize) && saved.winStreak !== undefined) {
    N = savedSize;
    winStreak = saved.winStreak;
    
    populateSizeSelect(N);
    
    const rows = getScreenRows();
    const cols = getScreenCols();
    
    const validBoard =
      isValidSavedMatrix(saved.isDiamond, rows, cols) &&
      isValidSavedMatrix(saved.regions, rows, cols);
      
    if (validBoard) {
      board = { isDiamond: saved.isDiamond, regions: saved.regions };
      prepareNextBoard();
      
      revealedCatsCount = 0;
      for (let rr = 0; rr < rows; rr++) {
        for (let cc = 0; cc < cols; cc++) {
          if (cells[rr] && cells[rr][cc] && cells[rr][cc].revealed && board.isDiamond[rr][cc]) {
            revealedCatsCount++;
          }
        }
      }
      
      resetRound();
      return;
    }
  } else {
    N = 9;
    winStreak = 0;
    populateSizeSelect(N);
  }
  newBoard();
}

startGame();
