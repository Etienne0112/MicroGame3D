'use strict';

const SAVE_KEY = 'myMeowDoku.save';
const MAX_MISTAKES = 3;
const DBLCLICK_DELAY = 250; // ms: 싱글클릭 확정 대기 시간

// 영역마다 서로 다른 고양이 — 카드를 뒤집으면 그 영역의 고양이가 나온다
const CAT_FACES = [
  '😺', '😸', '😹', '😻', '😼', '😽', '🙀', '😿', '😾', '🐱',
  '🐈', '🐈‍⬛', '🦁', '🐯', '🐅', '🐆',
];

// 색 영역마다 고유하고 서로 대조적인 N^2개의 색상을 생성하는 HSL 제너레이터 (황금비 분할 활용)
function getRegionColor(regId) {
  const goldenRatioConjugate = 0.618033988749895;
  const hue = (regId * goldenRatioConjugate * 360) % 360;
  // 채도: 65% ~ 85%, 밝기: 45% ~ 65% 분산 부여하여 대조 극대화
  const saturation = 65 + (regId % 3) * 10;
  const lightness = 45 + ((regId * 2) % 3) * 10;
  return `hsl(${Math.round(hue)}, ${saturation}%, ${lightness}%)`;
}

// 차원(dim) 및 크기(N), 연승(winStreak) 기본 세팅
const dim = 3;       // 3D 전용 고정
let N = 9;           // 3차원 기본 격자 크기 (9x9x9)
let winStreak = 0;   // 현재 연승 정보

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
  if (panMode) {
    modeBtnEl.textContent = '✋ 이동 모드';
    modeBtnEl.classList.add('pan-active');
  } else {
    modeBtnEl.textContent = '🐾 마킹 모드';
    modeBtnEl.classList.remove('pan-active');
  }
});

// ---------- 3D 격자 매핑 공식 ----------

// 스크린상의 가로(Col) 개수 반환 (3D: N * N)
function getScreenCols() {
  return N * N;
}

// 스크린상의 세로(Row) 개수 반환 (3D: N)
function getScreenRows() {
  return N;
}

// 총 배치되어야 하는 고양이 수 반환 (3D: N^2)
function getNumCats() {
  return N * N;
}

// 스크린 셀 (R, C)을 3D 공간 좌표 (x, y, z)로 변환
function getCoords(r, c) {
  const y = r;
  const z = Math.floor(c / N);
  const x = c % N;
  return { x, y, z };
}

// ---------- 보드 생성 ----------

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// 3D 공간 인접 판정: 활성화된 모든 축(x, y, z)에서 차이가 1 이하일 때 참
function areAdjacent(r1, c1, r2, c2) {
  const c1Coords = getCoords(r1, c1);
  const c2Coords = getCoords(r2, c2);
  
  const dx = Math.abs(c1Coords.x - c2Coords.x);
  const dy = Math.abs(c1Coords.y - c2Coords.y);
  const dz = Math.abs(c1Coords.z - c2Coords.z);
  
  return dx <= 1 && dy <= 1 && dz <= 1;
}

// 3차원 고양이 배치 생성 (N^2개 배치)
// 중복 열 및 행 버그를 완벽하게 차단하는 수학적 무결 배열 대입 방식 도입!
function generateDiamonds3D() {
  const rows = getScreenRows();
  const cols = getScreenCols();
  const isDiamond = Array.from({ length: rows }, () => Array(cols).fill(false));
  const catCoords = [];
  
  // N = 9 및 N = 16에 대해 수학적으로 완벽한 비인접 선형 합동 배치 적용!
  let a = 3;
  let b = 5;
  if (N === 9) {
    a = 4;
    b = 2;
  }

  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      const y = (a * x + b * z) % N;
      const r = y;
      const c = z * N + x;
      isDiamond[r][c] = true;
      catCoords.push([r, c]);
    }
  }
  
  return { isDiamond, catCoords };
}

// 3차원 공간상의 6방향 직교 인접 이웃들을 구함 (Z슬라이스 경계 누출 버그 완전 해결 및 입체 연결성 보장)
function get3DNeighbors(r, c) {
  const neighbors = [];
  const x = c % N;
  const z = Math.floor(c / N);
  const rows = getScreenRows();
  const cols = getScreenCols();
  
  // 1. X축 방향 이웃 (슬라이스 범위 안에서만)
  if (x > 0) neighbors.push([r, c - 1]);
  if (x < N - 1) neighbors.push([r, c + 1]);
  
  // 2. Y축 방향 이웃
  if (r > 0) neighbors.push([r - 1, c]);
  if (r < rows - 1) neighbors.push([r + 1, c]);
  
  // 3. Z축 방향 이웃 (입체적으로 위아래 슬라이스)
  if (z > 0) neighbors.push([r, c - N]);
  if (z < N - 1) neighbors.push([r, c + N]);
  
  return neighbors;
}

// 각 고양이를 시드로 성장시켜 영역 일대일 맵핑 (영역마다 고양이 정확히 1마리 보장)
// 영역 수의 15% 가량을 강제로 크기 1~2로 고정하여 논리적인 첫 단추 실마리(소 영역) 연쇄를 보장
function generateRegions(catCoords) {
  const rows = getScreenRows();
  const cols = getScreenCols();
  const numCats = catCoords.length;
  
  const region = Array.from({ length: rows }, () => Array(cols).fill(-1));
  const sizes = Array(numCats).fill(1);
  const caps = Array(numCats).fill(Infinity);

  const indices = shuffle([...Array(numCats).keys()]);
  const numCaps = Math.max(2, Math.floor(numCats * 0.15));
  for (const k of indices.slice(0, numCaps)) {
    caps[k] = 1 + Math.floor(Math.random() * 2);
  }

  const frontier = [];
  for (let k = 0; k < numCats; k++) {
    const [r, c] = catCoords[k];
    region[r][c] = k;
    frontier.push([r, c]);
  }

  let remaining = rows * cols - numCats;

  while (remaining > 0) {
    if (frontier.length === 0) break;
    const i = Math.floor(Math.random() * frontier.length);
    const [r, c] = frontier[i];
    const regId = region[r][c];

    if (sizes[regId] >= caps[regId]) {
      frontier.splice(i, 1);
      continue;
    }

    // 2D 스크린 이웃 대신 3D 직교 이웃 사용!
    const open = get3DNeighbors(r, c)
      .filter(([nr, nc]) => region[nr][nc] === -1);

    if (open.length === 0) {
      frontier.splice(i, 1);
      continue;
    }

    const [nr, nc] = open[Math.floor(Math.random() * open.length)];
    region[nr][nc] = regId;
    sizes[regId]++;
    frontier.push([nr, nc]);
    remaining--;
  }

  // 아직 안 채워진 셀들을 3D 인근 영역에 흡수
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (region[r][c] === -1) {
        let assignedNeighbor = -1;
        const neighbors = get3DNeighbors(r, c);
        for (const [nr, nc] of neighbors) {
          if (region[nr][nc] !== -1) {
            assignedNeighbor = region[nr][nc];
            break;
          }
        }
        if (assignedNeighbor !== -1) {
          region[r][c] = assignedNeighbor;
        } else {
          region[r][c] = 0;
        }
      }
    }
  }

  return region;
}

function createBoardJob() {
  let isDiamond = null;
  let regions = null;
  return function step() {
    if (!regions) {
      const catsData = generateDiamonds3D();
      
      isDiamond = catsData.isDiamond;
      regions = generateRegions(catsData.catCoords);
    }
    return { isDiamond, regions };
  };
}

function makeBoard() {
  const step = createBoardJob();
  return step();
}

let nextBoard = null;
let prepareToken = 0;

function prepareNextBoard() {
  const token = ++prepareToken;
  nextBoard = null;
  const job = createBoardJob();
  const slice = () => {
    if (token !== prepareToken) return;
    const board = job();
    if (board) {
      nextBoard = board;
      return;
    }
    setTimeout(slice, 30);
  };
  setTimeout(slice, 100);
}

function newBoard() {
  if (nextBoard) {
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
  hideOverlay();
  bannerEl.classList.add('hidden');
  
  // 차원 전용 스냅 레이아웃 클래스 바인딩 (2D 중앙 고정 배치, 3D 가로 전용 스크롤 처리)
  document.body.className = 'dim-' + dim + 'd';
  
  buildBoard();
  render();
  // 보드 새로 생성 시 좌측 상단으로 스크롤 리셋
  boardWrapperEl.scrollLeft = 0;
  boardWrapperEl.scrollTop = 0;
}

// ---------- 효과음 (Web Audio 합성) ----------

let audioCtx = null;

function getAudio() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!audioCtx) audioCtx = new AC();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

document.addEventListener('mousedown', getAudio, { once: true });
document.addEventListener('touchstart', getAudio, { once: true });

function playPop(erase) {
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
  const text = `3D 좌표: (x: ${x}, y: ${y}, z: ${z})`;
  document.getElementById('coords-display').textContent = text;
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
    render();
  }
}

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
}
document.addEventListener('touchend', endTouch);
document.addEventListener('touchcancel', endTouch);

boardEl.addEventListener('mouseleave', () => {
  document.getElementById('coords-display').textContent = '3D 좌표: (x: -, y: -, z: -)';
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
  render();
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
    autoMarkAround(r, c);
    render();
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
  const mark = (rr, cc) => {
    if (rr < 0 || rr >= rows || cc < 0 || cc >= cols) return;
    const cell = cells[rr][cc];
    if (!cell.revealed && cell.mark === 'none') cell.mark = 'paw';
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
  
  // 4. 3차원 대각선 포함 26방향 인접 칸 마킹
  for (let rr = 0; rr < rows; rr++) {
    for (let cc = 0; cc < cols; cc++) {
      if (rr === r && cc === c) continue;
      if (areAdjacent(r, c, rr, cc)) {
        mark(rr, cc);
      }
    }
  }
}

function onMistake(r, c) {
  mistakes++;
  locked = true;
  flashing = { r, c };
  playWarning();
  render();
  boardEl.classList.add('shake');
  setTimeout(() => {
    boardEl.classList.remove('shake');
    flashing = null;
    cells[r][c].mark = 'wrong';
    locked = false;
    render();
    if (mistakes >= MAX_MISTAKES) {
      locked = true;
      const oldStreak = winStreak;
      winStreak = 0; // 게임오버 시 연승 초기화
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
  const options = [9, 16];
  
  for (const n of options) {
    const opt = document.createElement('option');
    opt.value = n;
    opt.textContent = `${n}×${n}`;
    if (n === defaultSize) opt.selected = true;
    sizeSelect.appendChild(opt);
  }
}

sizeSelect.addEventListener('change', () => {
  N = parseInt(sizeSelect.value);
  newBoard();
});

// ---------- 렌더링 ----------

function buildBoard() {
  const cols = getScreenCols();
  const rows = getScreenRows();
  
  // 3D 보드는 세로(M)를 뷰포트 세로에 완전 피팅하여 가로로만 스크롤이 되게 유도
  let cellSize = Math.floor((window.innerHeight * 0.5) / N) - 2;
  cellSize = Math.max(12, Math.min(cellSize, 24));

  boardEl.style.gridTemplateColumns = `repeat(${cols}, ${cellSize}px)`;
  boardEl.style.gridTemplateRows = `repeat(${rows}, ${cellSize}px)`;
  boardEl.innerHTML = '';
  cellEls = [];
  for (let r = 0; r < rows; r++) {
    cellEls.push([]);
    for (let c = 0; c < cols; c++) {
      const el = document.createElement('div');
      el.className = 'card';
      el.style.width = `${cellSize}px`;
      el.style.height = `${cellSize}px`;
      el.style.fontSize = `${Math.floor(cellSize * 0.7)}px`;
      el.dataset.r = r;
      el.dataset.c = c;

      // 다른 색 영역과 맞닿은 변에 굵은 경계선
      const reg = board.regions[r][c];
      if (r === 0 || board.regions[r - 1][c] !== reg) el.classList.add('bt');
      if (r === rows - 1 || board.regions[r + 1][c] !== reg) el.classList.add('bb');
      if (c === 0 || board.regions[r][c - 1] !== reg) el.classList.add('bl');
      if (c === cols - 1 || board.regions[r][c + 1] !== reg) el.classList.add('br');

      // 3차원 서브보드 구분선 추가 (N 크기 격자 구분)
      if (c % N === 0) el.classList.add('sub-bl');
      if (c % N === N - 1) el.classList.add('sub-br');

      el.addEventListener('click', () => onCellClick(r, c));
      el.addEventListener('dblclick', () => onCellDblClick(r, c));
      el.addEventListener('mousedown', (e) => onCellDown(r, c, e));
      cellEls[r].push(el);
      boardEl.appendChild(el);
    }
  }
}

function render() {
  const rows = getScreenRows();
  const cols = getScreenCols();
  
  levelEl.textContent = `모드: 3D (${N}×${N}), ${winStreak}연승 중!`;
  document.getElementById('streak-display').textContent = `🔥 ${winStreak}연승 중!`;
  livesEl.textContent =
    '❤️'.repeat(MAX_MISTAKES - mistakes) + '🖤'.repeat(mistakes);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = cells[r][c];
      const el = cellEls[r][c];
      const reg = board.regions[r][c];
      const isFlash = flashing && flashing.r === r && flashing.c === c;

      el.classList.toggle('revealed', cell.revealed || isFlash);
      el.classList.toggle('flash-stone', isFlash);
      el.classList.toggle('wrong', !cell.revealed && !isFlash && cell.mark === 'wrong');

      const colVal = getRegionColor(reg);
      const catVal = CAT_FACES[reg % CAT_FACES.length];

      if (cell.revealed) {
        el.style.backgroundColor = colVal;
        el.textContent = catVal;
      } else if (isFlash) {
        el.style.backgroundColor = '';
        el.textContent = '🪨';
      } else {
        el.style.backgroundColor = colVal;
        el.textContent = cell.mark === 'paw' ? '🐾' : cell.mark === 'wrong' ? '✕' : '';
      }
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

document.getElementById('restart-btn').addEventListener('click', () => {
  if (!overlayEl.classList.contains('hidden')) return;
  resetRound();
});

// 연승 정보 초기화 및 재생성
document.getElementById('reset-btn').addEventListener('click', () => {
  winStreak = 0;
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

function startGame() {
  const saved = loadProgress();
  if (saved && saved.N && saved.winStreak !== undefined) {
    N = saved.N;
    winStreak = saved.winStreak;
    
    populateSizeSelect(N);
    
    const rows = getScreenRows();
    const cols = getScreenCols();
    
    const validBoard =
      Array.isArray(saved.isDiamond) && saved.isDiamond.length === rows &&
      Array.isArray(saved.regions) && saved.regions.length === rows &&
      saved.regions.every((row) => Array.isArray(row) && row.length === cols);
      
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
