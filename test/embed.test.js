import assert from 'node:assert/strict';
import test from 'node:test';
import { approvedParentOrigin } from '../src/embed.js';

const game = 'https://majkey25.github.io/little-clip-factory/?embed=1';
const guide = 'https://majkey25.github.io/little-ai/';

test('only the direct guide frame receives access to the game session', () => {
  assert.equal(approvedParentOrigin(game, `${guide}?lang=cs`, true), new URL(guide).origin);
  for (const referrer of ['', 'invalid', 'null', 'https://attacker.example/',
    'https://majkey25.github.io.attacker.example/little-ai/',
    'https://majkey25.github.io/another-project/', 'http://127.0.0.1:4173/']) {
    assert.equal(approvedParentOrigin(game, referrer, true), null, referrer);
  }
  assert.equal(approvedParentOrigin(game, guide, false), null);
});

test('the documented local guide works without granting arbitrary loopback ports', () => {
  const localGame = 'http://127.0.0.1:4174/?embed=1';
  assert.equal(approvedParentOrigin(localGame, 'http://127.0.0.1:4173/', true), 'http://127.0.0.1:4173');
  assert.equal(approvedParentOrigin(localGame, 'http://127.0.0.1:4175/', true), null);
  assert.equal(approvedParentOrigin(localGame, 'http://127.0.0.1:4173/', false), null);
});
