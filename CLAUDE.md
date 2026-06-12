# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

myMeowDoku — a browser puzzle game (Korean UI). Find all hidden cats in an n×n grid of face-down cards (the rest are stones). Same constraint structure as LinkedIn's Queens puzzle: exactly one cat per row, per column, and per color region, and no two cats may touch (including diagonally).

Naming note: the code calls the target cards "diamonds" throughout (`diamondCols`, `isDiamond`, `generateDiamonds`) — the visual theme was changed to cats later, with each region revealing a distinct cat emoji (`CAT_FACES[region]`), but the internal naming was kept.

## Running

No build step, no dependencies. Open `index.html` directly in a browser, or serve the folder (e.g. `python -m http.server`) and visit it. There is no test framework; game-logic invariants can be checked by extracting the pure generation functions from `game.js` and running them in Node (they sit above `function newBoard` and have no DOM dependencies).

## Architecture

Three files, all vanilla:

- `game.js` — all state and logic. Module-level state: `level`, `size`, `board` (the puzzle: `diamondCols[r]` = diamond column for row r, plus `regions[r][c]` color-region ids), `cells[r][c]` (per-cell play state: `revealed`, `mark`), `mistakes`, `locked`.
- `index.html` — static shell; `game.js` renders the grid into `#board`.
- `style.css` — region borders, shake animation, overlay.

Key design points that span the code:

- **Board generation** (`generateDiamonds` + `generateRegions`): row-by-row backtracking places diamonds (column unused, consecutive rows differ by ≥2 columns — sufficient for the 8-neighbor rule since there's one diamond per row). Regions are grown by random multi-source flood-fill seeded at each diamond, which guarantees exactly one diamond per region and region connectivity. Difficulty tuning: two regions per board are capped at 1–2 cells (easy entry points for the player); if capped regions wall off unfillable cells, `generateRegions` retries from scratch.
- **Unique-solution guarantee**: every board has exactly one valid placement, so it's solvable by logic alone — no forced guessing, and no "valid-but-not-the-answer" punishments. Naive regenerate-until-unique fails above 10×10 (unique layouts become vanishingly rare), so `createBoardJob` uses repair-based convergence: `findSolutions` (backtracking solver, early-exit at 2) finds an alternative solution, and `repairOnce` kills it by reassigning one cell the alternative uses to a neighboring region (never an intended diamond cell, connectivity checked via `connectedWithout`, preferring targets of size ≥3 to keep the small easy regions small). After `MAX_REPAIRS` or an unfixable state it regenerates from scratch. 12×12 takes ~0.6s median (max seen ~5s).
- **Generation never blocks gameplay**: `prepareNextBoard` runs the next level's board job in small `setTimeout` slices (one solver step each) while the player plays; `newBoard` uses it when ready, falling back to synchronous `makeBoard`. `prepareToken` cancels stale background jobs. On page load the saved board is restored from localStorage, so no generation happens at startup.
- **Rendering**: `buildBoard()` creates the grid DOM once per board (cells stored in `cellEls`, region-boundary `bt/bb/bl/br` border classes are static per board); `render()` only updates each cell's classes/text/background in place. Do NOT rebuild the grid on state changes (`innerHTML = ''`): removing the touchstart target element kills the in-flight touch event stream, which silently breaks touch drag-marking mid-drag.
- **Click vs double-click**: single-click action is deferred by `DBLCLICK_DELAY` (250ms) and cancelled when a dblclick arrives. Single click toggles a 🐾 "not a diamond" mark; double-click flips the card.
- **Drag-marking**: mousedown/touchstart fixes the drag mode (the toggle result of the start cell — mark or erase); dragging applies that mode to every cell entered, skipping revealed diamonds and `'wrong'` cells. After a real drag, `suppressClick` swallows the click event that follows mouseup/touchend so the start cell isn't toggled twice (350ms window for touch, since the synthesized click can lag touchend).
- **Touch support**: touch events don't fire `mouseenter`, so board-level `touchmove` maps the finger position to a card via `document.elementFromPoint` + `data-r`/`data-c` attributes and feeds the same `onCellEnter` path. `#board` has `touch-action: none` so dragging marks instead of scrolling. iOS Safari may not fire `dblclick`, so `onCellClick` also detects two quick clicks on the same cell (within `DBLCLICK_DELAY`) and treats them as a double-click; a pending single-click on a *different* cell is committed immediately.
- **Mark states**: `'none' | 'paw' | 'wrong'`. `'paw'` covers both user marks and auto-marks (revealing a diamond auto-marks its row, column, and 8 neighbors). `'wrong'` is the red mistake mark from double-clicking a stone — it cannot be cleared, and 3 of them ends the game.
- **Sound**: all SFX are synthesized with Web Audio (`playChime`/`playPop`/`playWarning`) — no audio assets. The AudioContext is created/resumed by a one-time `mousedown`/`touchstart` listener because iOS only allows audio to start inside a user gesture, and the single-click path runs in a `setTimeout` (not a gesture context). Auto-marks after a cat reveal are intentionally silent (only the reveal chime plays).
- **`locked` flag** gates all input during the mistake animation (stone flashes for 800ms, board shakes, then the red mark lands) and while an overlay is up. `flashing` holds the cell being briefly shown.
- **Game flow**: Restart replays the *same* board (`resetRound()` keeps `board`, resets `cells`/`mistakes`); clearing a level generates a new board (`newBoard()`). Grid grows by 1 per level from 5×5, capped at 12×12 (`MAX_SIZE`).
- **Persistence**: `saveProgress` stores `{level, diamondCols, regions}` as JSON in localStorage (`myMeowDoku.save`) on every `newBoard`; `startGame` restores it (with shape validation) so the player always resumes at their last level with the same board. Mid-level marks are not saved.
- `REGION_COLORS` and `CAT_FACES` have exactly 12 entries — one per possible region at max size. Raising `MAX_SIZE` requires more of both, and beware: unique-board generation cost grows steeply with size (15×15 was abandoned for this reason).
