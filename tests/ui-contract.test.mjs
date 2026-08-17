import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);

test('keeps every gameplay control and the shared site navigation', async () => {
  const [html, game, shell] = await Promise.all([
    readFile(new URL('index.html', root), 'utf8'),
    readFile(new URL('game.js', root), 'utf8'),
    readFile(new URL('subsite-shell.js', root), 'utf8'),
  ]);

  for (const id of [
    'board', 'board-wrapper', 'size-select', 'mode-btn',
    'restart-btn', 'reset-btn', 'banner', 'overlay', 'sound-toggle', 'theme-toggle',
  ]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }

  // 공용 셸이 SITES 메뉴와 테마를 붙일 수 있어야 합니다.
  for (const id of ['site-network-menu', 'site-network-popover']) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }

  assert.match(html, /script src="game\.js" type="module"/);
  assert.match(html, /script src="subsite-shell\.js"/);
  assert.match(game, /from '\.\/core\.js'/);
  assert.match(shell, /id: 'main'/);
  assert.match(shell, /id: 'blog'/);
  assert.match(shell, /id: 'study'/);
  assert.match(shell, /id: 'micro3d'/);
  assert.match(shell, /https:\/\/github\.com\/Etienne0112\/MicroGame3D/);
});

test('drops the isometric view mode entirely', async () => {
  const [html, game, css] = await Promise.all([
    readFile(new URL('index.html', root), 'utf8'),
    readFile(new URL('game.js', root), 'utf8'),
    readFile(new URL('style.css', root), 'utf8'),
  ]);

  assert.doesNotMatch(html, /view-btn/);
  assert.doesNotMatch(game, /isometric|view-btn/);
  assert.doesNotMatch(css, /isometric|view-3d-active/);
  assert.match(html, /id="board" class="layer-view"/);
});

test('preserves the saved-game and input contracts', async () => {
  const game = await readFile(new URL('game.js', root), 'utf8');

  assert.match(game, /myMeowDoku\.save/);
  assert.match(game, /addEventListener\('click'/);
  assert.match(game, /addEventListener\('dblclick'/);
  assert.match(game, /addEventListener\('touchmove'/);
  assert.match(game, /autoMarkAround/);
  assert.match(game, /MAX_MISTAKES = 3/);
});
