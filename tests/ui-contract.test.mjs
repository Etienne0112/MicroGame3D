import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);

test('keeps every gameplay control and the shared site navigation', async () => {
  const [html, game, network] = await Promise.all([
    readFile(new URL('index.html', root), 'utf8'),
    readFile(new URL('game.js', root), 'utf8'),
    readFile(new URL('site-network.js', root), 'utf8'),
  ]);

  for (const id of [
    'board', 'board-wrapper', 'size-select', 'mode-btn', 'view-btn',
    'restart-btn', 'reset-btn', 'banner', 'overlay', 'sound-toggle', 'theme-toggle',
  ]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }

  assert.match(html, /script src="game\.js" type="module"/);
  assert.match(game, /from '\.\/core\.js'/);
  assert.match(network, /id: 'main'/);
  assert.match(network, /id: 'blog'/);
  assert.match(network, /id: 'study'/);
  assert.match(network, /id: 'micro3d'/);
  assert.match(network, /https:\/\/github\.com\/Etienne0112\/MicroGame3D/);
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
