import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, newSoloGame, select, publicState } from '../game.js';

test('private choices and alternating kicks', () => {
  const g = newGame(1, 2, { id: 11, name: 'A' });
  g.players[1] = { id: 22, name: 'B' }; g.status = 'playing';
  assert.equal(select(g, 11, 0), null);
  assert.equal(publicState(g, 22).selected, false);
  assert.equal(publicState(g, 22).results.length, 0);
  assert.throws(() => select(g, 11, 1));
  assert.equal(select(g, 22, 0).result.goal, false);
  assert.equal(g.turn, 1);
  select(g, 22, 4);
  assert.equal(select(g, 11, 3).result.goal, true);
  assert.deepEqual(g.scores, [0, 1]);
});

test('finishes early when lead cannot be caught', () => {
  const g = newGame(1, 2, { id: 11, name: 'A' });
  g.players[1] = { id: 22, name: 'B' }; g.status = 'playing';
  for (let i = 0; i < 6; i++) {
    const k = g.turn % 2 ? 22 : 11, keeper = k === 11 ? 22 : 11;
    select(g, k, 0); select(g, keeper, k === 11 ? 1 : 0);
  }
  assert.equal(g.status, 'finished'); assert.deepEqual(g.scores, [3, 0]);
});

test('sudden death ends after both have kicked', () => {
  const g = newGame(1, 2, { id: 11, name: 'A' });
  g.players[1] = { id: 22, name: 'B' }; g.status = 'playing';
  for (let i = 0; i < 10; i++) {
    const k = g.turn % 2 ? 22 : 11, keeper = k === 11 ? 22 : 11;
    select(g, k, 0); select(g, keeper, 0);
  }
  assert.equal(g.status, 'playing');
  select(g, 11, 0); select(g, 22, 1);
  assert.equal(g.status, 'playing');
  select(g, 22, 0); select(g, 11, 0);
  assert.equal(g.status, 'finished'); assert.deepEqual(g.scores, [1, 0]);
});

test('solo mode lets the user kick five times against simulated Dibu', () => {
  const g = newSoloGame({ id: 11, name: 'A' });
  const first = select(g, 11, 2, () => 0);
  assert.equal(first.result.goal, false);
  assert.equal(publicState(g, 11).role, 'kicker');
  for (let i = 0; i < 4; i++) select(g, 11, 2, () => 0.99);
  assert.equal(g.status, 'finished');
  assert.equal(g.shots[0], 5);
  assert.equal(g.scores[0], 4);
  assert.throws(() => select(g, 11, 2));
  assert.throws(() => select(newSoloGame({ id: 11, name: 'A' }), 22, 2));
});
