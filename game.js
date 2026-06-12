'use strict';

const MIN_SIZE = 5;
const MAX_SIZE = 12;
const SAVE_KEY = 'myMeowDoku.save';
const MAX_MISTAKES = 3;
const DBLCLICK_DELAY = 250; // ms: 싱글클릭 확정 대기 시간

// 영역마다 서로 다른 고양이 — 카드를 뒤집으면 그 영역의 고양이가 나온다 (최대 12)
const CAT_FACES = [
  '😺', '😸', '😹', '😻', '😼', '😽', '🙀', '😿', '😾', '🐱',
  '🐈', '🐈‍⬛',
];

// 색 영역(같은 색 = 연결된 카드 묶음) 뒷면 색상 — 최대 12개
const REGION_COLORS = [
  '#f9c74f', '#90be6d', '#f8961e', '#43aa8b', '#577590',
  '#f94144', '#c77dff', '#4cc9f0', '#ff99c8', '#a98467',
  '#f72585', '#e0e1dd',
];

// 칸 상태 mark: 'none' | 'paw'(사용자/자동 마킹) | 'wrong'(오답 붉은 마킹)
let level = 1;
let size = MIN_SIZE;
let board = null;      // { diamondCols: number[], regions: number[][] }
let cells = [];        // 2D [r][c] -> { revealed, mark }
let mistakes = 0;
let locked = false;    // 애니메이션/오버레이 중 입력 차단
let flashing = null;   // 오답 카드 잠깐 보여주기: {r, c}
let clickTimer = null;
let drag = null;           // { mode:'paw'|'none', startR, startC, moved, visited:Set }
let suppressClick = false; // 드래그 직후 발생하는 click 이벤트 무시

const boardEl = document.getElementById('board');
const levelEl = document.getElementById('level-display');
const livesEl = document.getElementById('lives-display');
const overlayEl = document.getElementById('overlay');
const overlayTitleEl = document.getElementById('overlay-title');
const overlayMsgEl = document.getElementById('overlay-message');
const overlayBtnEl = document.getElementById('overlay-btn');

// ---------- 보드 생성 ----------

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// 행마다 다이아몬드 1개: 열 중복 금지, 연속 행은 열 차이 2 이상(8방향 인접 금지)
function generateDiamonds(n) {
  const cols = [];
  function place(row) {
    if (row === n) return true;
    for (const c of shuffle([...Array(n).keys()])) {
      if (cols.includes(c)) continue;
      if (row > 0 && Math.abs(c - cols[row - 1]) < 2) continue;
      cols.push(c);
      if (place(row + 1)) return true;
      cols.pop();
    }
    return false;
  }
  place(0);
  return cols;
}

// 각 다이아몬드를 시드로 랜덤 성장 flood-fill → 영역마다 다이아몬드 정확히 1개.
// 난이도 조절: 두 영역은 1~2칸으로 제한해 쉬운 시작점을 제공
function generateRegions(n, diamondCols) {
  for (;;) {
    const region = tryGenerateRegions(n, diamondCols);
    if (region) return region;
  }
}

function tryGenerateRegions(n, diamondCols) {
  const region = Array.from({ length: n }, () => Array(n).fill(-1));
  const sizes = Array(n).fill(1);
  const caps = Array(n).fill(Infinity);
  for (const k of shuffle([...Array(n).keys()]).slice(0, 2)) {
    caps[k] = 1 + Math.floor(Math.random() * 2);
  }

  const frontier = [];
  for (let r = 0; r < n; r++) {
    region[r][diamondCols[r]] = r;
    frontier.push([r, diamondCols[r]]);
  }
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  let remaining = n * n - n;
  while (remaining > 0) {
    // 크기 제한된 영역에 막혀 채울 수 없는 칸이 생기면 재시도
    if (frontier.length === 0) return null;
    const i = Math.floor(Math.random() * frontier.length);
    const [r, c] = frontier[i];
    if (sizes[region[r][c]] >= caps[region[r][c]]) {
      frontier.splice(i, 1);
      continue;
    }
    const open = dirs
      .map(([dr, dc]) => [r + dr, c + dc])
      .filter(([nr, nc]) => nr >= 0 && nr < n && nc >= 0 && nc < n && region[nr][nc] === -1);
    if (open.length === 0) {
      frontier.splice(i, 1);
      continue;
    }
    const [nr, nc] = open[Math.floor(Math.random() * open.length)];
    region[nr][nc] = region[r][c];
    sizes[region[r][c]]++;
    frontier.push([nr, nc]);
    remaining--;
  }
  return region;
}

// 영역 배치가 허용하는 정답들을 찾는다 (limit개 도달 시 조기 중단).
// 제약: 행/열/영역당 다이아몬드 1개, 연속 행의 열 차이 2 이상(8방향 인접 금지)
function findSolutions(n, regions, limit) {
  const usedCols = new Array(n).fill(false);
  const usedRegions = new Array(n).fill(false);
  const current = [];
  const found = [];
  function place(row, prevCol) {
    if (row === n) {
      found.push(current.slice());
      return;
    }
    for (let c = 0; c < n; c++) {
      if (usedCols[c]) continue;
      if (row > 0 && Math.abs(c - prevCol) < 2) continue;
      const k = regions[row][c];
      if (usedRegions[k]) continue;
      usedCols[c] = true;
      usedRegions[k] = true;
      current.push(c);
      place(row + 1, c);
      current.pop();
      usedCols[c] = false;
      usedRegions[k] = false;
      if (found.length >= limit) return;
    }
  }
  place(0, -2);
  return found;
}

// 영역 k에서 (rm, cm)을 떼어내도 k가 연결 상태를 유지하는지 (시드 = k의 다이아몬드 칸)
function connectedWithout(n, regions, k, rm, cm, diamondCols) {
  let total = 0;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) if (regions[r][c] === k) total++;
  }
  const seen = new Set();
  const start = k * n + diamondCols[k];
  seen.add(start);
  const queue = [start];
  while (queue.length) {
    const v = queue.pop();
    const r = Math.floor(v / n), c = v % n;
    for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nr = r + dr, nc = c + dc;
      if (nr < 0 || nr >= n || nc < 0 || nc >= n) continue;
      if (nr === rm && nc === cm) continue;
      const u = nr * n + nc;
      if (regions[nr][nc] === k && !seen.has(u)) {
        seen.add(u);
        queue.push(u);
      }
    }
  }
  return seen.size === total - 1;
}

// 대체 해를 죽이는 영역 수선: 대체 해가 다이아몬드를 놓는 칸 하나를 이웃 영역으로 넘긴다.
// (그 칸은 절대 정답 다이아몬드 칸이 아니므로 정답 해는 보존된다)
function repairOnce(n, diamondCols, regions, alt) {
  const rows = shuffle([...Array(n).keys()].filter((r) => alt[r] !== diamondCols[r]));
  for (const r of rows) {
    const c = alt[r];
    const k = regions[r][c];
    if (!connectedWithout(n, regions, k, r, c, diamondCols)) continue;
    const neighbors = new Set();
    for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nr = r + dr, nc = c + dc;
      if (nr < 0 || nr >= n || nc < 0 || nc >= n) continue;
      if (regions[nr][nc] !== k) neighbors.add(regions[nr][nc]);
    }
    if (neighbors.size === 0) continue;
    const sizes = Array(n).fill(0);
    for (let rr = 0; rr < n; rr++) for (let cc = 0; cc < n; cc++) sizes[regions[rr][cc]]++;
    // 1~2칸 영역(쉬운 시작점)은 키우지 않도록 큰 영역 우선
    const candidates = shuffle([...neighbors]);
    candidates.sort((a, b) => (sizes[b] >= 3 ? 1 : 0) - (sizes[a] >= 3 ? 1 : 0));
    regions[r][c] = candidates[0];
    return true;
  }
  return false;
}

function smallRegionCount(n, regions) {
  const sizes = Array(n).fill(0);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) sizes[regions[r][c]]++;
  return sizes.filter((s) => s <= 2).length;
}

// 보드 생성 작업을 단계(슬라이스) 단위로 수행하는 잡 생성기.
// step()을 반복 호출하면 완성 시 보드를, 진행 중이면 null을 반환한다.
// 큰 판은 단순 재시도로 유일해가 사실상 안 나오므로, 해가 여럿이면
// 대체 해를 죽이는 수선을 반복해 유일해로 수렴시킨다.
function createBoardJob(n) {
  const MAX_REPAIRS = 300;
  let diamondCols = null;
  let regions = null;
  let repairs = 0;
  return function step() {
    if (!regions) {
      diamondCols = generateDiamonds(n);
      regions = generateRegions(n, diamondCols);
      repairs = 0;
    }
    const sols = findSolutions(n, regions, 2);
    if (sols.length === 1) {
      if (smallRegionCount(n, regions) >= 2) {
        const board = { diamondCols, regions };
        regions = null;
        return board;
      }
      regions = null; // 쉬운 시작점(1~2칸 영역 2개) 조건 깨짐 → 새로 생성
      return null;
    }
    const alt = sols.find((s) => s.some((c, r) => c !== diamondCols[r]));
    if (!repairOnce(n, diamondCols, regions, alt) || ++repairs > MAX_REPAIRS) {
      regions = null; // 수선 불가 → 새로 생성
    }
    return null;
  };
}

// 해가 유일한 판만 내보낸다 → 논리만으로 항상 풀 수 있음을 보장
function makeBoard(n) {
  const step = createBoardJob(n);
  for (;;) {
    const board = step();
    if (board) return board;
  }
}

// 큰 판은 유일해 수렴에 수백 ms가 걸릴 수 있어,
// 현재 레벨을 푸는 동안 다음 레벨 보드를 잘게 나눠 미리 생성해 둔다
let nextBoard = null; // { size, diamondCols, regions }
let prepareToken = 0;

function prepareNextBoard() {
  const token = ++prepareToken;
  const nextSize = Math.min(MIN_SIZE + level, MAX_SIZE);
  nextBoard = null;
  const job = createBoardJob(nextSize);
  const slice = () => {
    if (token !== prepareToken) return;
    const board = job();
    if (board) {
      nextBoard = { size: nextSize, ...board };
      return;
    }
    setTimeout(slice, 30);
  };
  setTimeout(slice, 100);
}

function newBoard() {
  if (nextBoard && nextBoard.size === size) {
    board = { diamondCols: nextBoard.diamondCols, regions: nextBoard.regions };
  } else {
    board = makeBoard(size); // 미리 만든 보드가 없으면 동기 생성
  }
  saveProgress();
  prepareNextBoard();
  resetRound();
}

function resetRound() {
  cells = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => ({ revealed: false, mark: 'none' }))
  );
  mistakes = 0;
  locked = false;
  flashing = null;
  hideOverlay();
  render();
}

// ---------- 입력 ----------

function isDiamond(r, c) {
  return board.diamondCols[r] === c;
}

let pendingR = -1, pendingC = -1; // 보류 중인 싱글클릭의 위치

function onCellClick(r, c) {
  if (suppressClick) return;
  if (clickTimer) {
    clearTimeout(clickTimer);
    clickTimer = null;
    if (pendingR === r && pendingC === c) {
      // 같은 칸 연속 클릭 → 더블클릭으로 처리 (dblclick 이벤트가 없는 iOS 등 대비)
      doubleClick(r, c);
      return;
    }
    singleClick(pendingR, pendingC); // 다른 칸의 보류된 클릭은 즉시 확정
  }
  pendingR = r;
  pendingC = c;
  clickTimer = setTimeout(() => {
    clickTimer = null;
    singleClick(r, c);
  }, DBLCLICK_DELAY);
}

// ----- 드래그 마킹: 시작 카드의 토글 결과를 지나가는 카드 전체에 적용 -----

function startDrag(r, c) {
  if (locked) return;
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
  if (e.button !== 0) return;
  e.preventDefault(); // 네이티브 드래그/텍스트 선택 방지
  startDrag(r, c);
}

function onCellEnter(r, c) {
  if (!drag || locked) return;
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
  if (cell.revealed || cell.mark === 'wrong') return; // 예외: 공개된 다이아몬드, 오답 마킹
  if (cell.mark !== drag.mode) {
    cell.mark = drag.mode;
    render();
  }
}

document.addEventListener('mouseup', () => {
  if (drag && drag.moved) {
    // 드래그로 처리됐으므로 곧이어 오는 click은 무시
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 0);
  }
  drag = null;
});

// ----- 터치 드래그: 손가락 아래의 카드를 찾아 마우스 드래그와 동일하게 처리 -----

boardEl.addEventListener('touchstart', (e) => {
  const card = e.target.closest('.card');
  if (!card) return;
  startDrag(+card.dataset.r, +card.dataset.c);
});

boardEl.addEventListener('touchmove', (e) => {
  if (!drag || locked) return;
  const t = e.touches[0];
  const el = document.elementFromPoint(t.clientX, t.clientY);
  const card = el && el.closest('.card');
  if (!card) return;
  const r = +card.dataset.r, c = +card.dataset.c;
  // 시작 카드 안에서의 미세한 움직임은 드래그로 보지 않는다 (탭/더블탭 보존)
  if (!drag.moved && r === drag.startR && c === drag.startC) return;
  onCellEnter(r, c);
}, { passive: true });

function endTouch() {
  if (drag && drag.moved) {
    suppressClick = true;
    // 터치의 합성 click은 touchend보다 늦게 올 수 있어 여유를 둔다
    setTimeout(() => { suppressClick = false; }, 350);
  }
  drag = null;
}
document.addEventListener('touchend', endTouch);
document.addEventListener('touchcancel', endTouch);

function onCellDblClick(r, c) {
  clearTimeout(clickTimer);
  clickTimer = null;
  doubleClick(r, c);
}

function singleClick(r, c) {
  if (locked) return;
  const cell = cells[r][c];
  if (cell.revealed || cell.mark === 'wrong') return;
  cell.mark = cell.mark === 'paw' ? 'none' : 'paw';
  render();
}

function doubleClick(r, c) {
  if (locked) return;
  const cell = cells[r][c];
  if (cell.revealed || cell.mark === 'wrong') return;

  if (isDiamond(r, c)) {
    cell.revealed = true;
    cell.mark = 'none';
    autoMarkAround(r, c);
    render();
    if (board.diamondCols.every((col, row) => cells[row][col].revealed)) {
      onLevelClear();
    }
  } else {
    onMistake(r, c);
  }
}

// 다이아몬드 공개 시: 8방향 이웃 + 해당 행/열 전체 자동 마킹
function autoMarkAround(r, c) {
  const mark = (rr, cc) => {
    if (rr < 0 || rr >= size || cc < 0 || cc >= size) return;
    const cell = cells[rr][cc];
    if (!cell.revealed && cell.mark === 'none') cell.mark = 'paw';
  };
  for (let i = 0; i < size; i++) {
    mark(r, i);
    mark(i, c);
  }
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr || dc) mark(r + dr, c + dc);
    }
  }
}

function onMistake(r, c) {
  mistakes++;
  locked = true;
  flashing = { r, c };
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
      showOverlay('😿 Game Over', '돌멩이를 세 번 뒤집었어요.', 'Restart', resetRound);
    }
  }, 800);
}

function onLevelClear() {
  locked = true;
  showOverlay('🎉 Level Clear!', `고양이 ${size}마리를 모두 찾았어요!`, 'Next Level', () => {
    level++;
    size = Math.min(MIN_SIZE + level - 1, MAX_SIZE);
    newBoard(); // newBoard가 새 레벨 + 새 판을 저장한다
  });
}

// ---------- 렌더링 ----------

function render() {
  levelEl.textContent = `Level ${level} (${size}×${size})`;
  livesEl.textContent =
    '❤️'.repeat(MAX_MISTAKES - mistakes) + '🖤'.repeat(mistakes);

  boardEl.style.gridTemplateColumns = `repeat(${size}, 1fr)`;
  boardEl.style.gridTemplateRows = `repeat(${size}, 1fr)`;
  boardEl.innerHTML = '';

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const cell = cells[r][c];
      const el = document.createElement('div');
      el.className = 'card';
      el.dataset.r = r;
      el.dataset.c = c;

      // 다른 색 영역과 맞닿은 변에 굵은 경계선
      const reg = board.regions[r][c];
      if (r === 0 || board.regions[r - 1][c] !== reg) el.classList.add('bt');
      if (r === size - 1 || board.regions[r + 1][c] !== reg) el.classList.add('bb');
      if (c === 0 || board.regions[r][c - 1] !== reg) el.classList.add('bl');
      if (c === size - 1 || board.regions[r][c + 1] !== reg) el.classList.add('br');

      const isFlash = flashing && flashing.r === r && flashing.c === c;
      if (cell.revealed) {
        el.classList.add('revealed');
        el.textContent = CAT_FACES[reg];
      } else if (isFlash) {
        el.classList.add('revealed', 'flash-stone');
        el.textContent = '🪨';
      } else {
        el.style.backgroundColor = REGION_COLORS[reg];
        if (cell.mark === 'paw') el.textContent = '🐾';
        if (cell.mark === 'wrong') {
          el.classList.add('wrong');
          el.textContent = '✕';
        }
      }

      el.addEventListener('click', () => onCellClick(r, c));
      el.addEventListener('dblclick', () => onCellDblClick(r, c));
      el.addEventListener('mousedown', (e) => onCellDown(r, c, e));
      el.addEventListener('mouseenter', () => onCellEnter(r, c));
      boardEl.appendChild(el);
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

// ---------- 진행 저장: 항상 마지막 도달 레벨에서 시작 ----------
// 큰 판은 생성에 수 초가 걸릴 수 있어 레벨과 함께 판 자체를 저장한다
// → 페이지를 다시 열면 생성 없이 즉시 복원

function saveProgress() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      level,
      diamondCols: board.diamondCols,
      regions: board.regions,
    }));
  } catch (e) { /* 저장 불가 환경(시크릿 모드 등)이면 무시 */ }
}

function loadProgress() {
  try {
    const data = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (!data || !(data.level >= 1)) return null;
    return data;
  } catch (e) {
    return null;
  }
}

function startGame() {
  const saved = loadProgress();
  if (saved) {
    level = saved.level;
    size = Math.min(MIN_SIZE + level - 1, MAX_SIZE);
    const validBoard =
      Array.isArray(saved.diamondCols) && saved.diamondCols.length === size &&
      Array.isArray(saved.regions) && saved.regions.length === size &&
      saved.regions.every((row) => Array.isArray(row) && row.length === size);
    if (validBoard) {
      board = { diamondCols: saved.diamondCols, regions: saved.regions };
      prepareNextBoard();
      resetRound();
      return;
    }
  }
  newBoard();
}

startGame();
