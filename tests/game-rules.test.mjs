import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SUPPORTED_SIZES,
  getCoords,
  getNumCats,
  makeBoard,
  validateBoard,
} from '../core.js';

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

for (const size of SUPPORTED_SIZES) {
  test(`${size}³ board preserves every game rule`, () => {
    for (const seed of [11, 37, 101]) {
      const board = makeBoard(size, seededRandom(seed));
      assert.deepEqual(validateBoard(board, size), []);
      assert.equal(board.isDiamond.flat().filter(Boolean).length, getNumCats(size));
    }
  });
}

test('screen coordinates map to x, y, z without slice leakage', () => {
  assert.deepEqual(getCoords(9, 4, 5 * 9 + 7), { x: 7, y: 4, z: 5 });
  assert.deepEqual(getCoords(16, 15, 15 * 16 + 15), { x: 15, y: 15, z: 15 });
});
