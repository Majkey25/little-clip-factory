import assert from 'node:assert/strict';
import test from 'node:test';
import * as game from '../src/game.js';
import {
  CONFIG,
  canRecoverWire,
  recoverWire,
  advance,
  buyMaker,
  buyUpgrade,
  buyWire,
  createState,
  makeClip,
  makerCost,
  restoreState,
  setPolicy,
  setRunning,
} from '../src/game.js';

function harvesting(policy, harvesters, makers = 0) {
  const s = createState();
  return { ...s, phase: 3, policy, harvesters, makers, upgrades: { ...s.upgrades, drones: true } };
}

test('buying a maker spends its cost and unaffordable purchases change nothing', () => {
  const start = createState();
  const next = buyMaker(start);
  assert.equal(next.makers, 1);
  assert.equal(next.funds, start.funds - makerCost(start));
  const broke = { ...start, funds: 0 };
  assert.equal(buyMaker(broke), broke);
  assert.equal(buyWire(broke), broke);
});

test('low funds still buy a partial wire batch', () => {
  const low = { ...createState(), wire: 0, funds: 1 };
  const next = buyWire(low);
  assert.equal(next.wire, 1 / (CONFIG.spoolBaseCost / CONFIG.spoolWire));
  assert.ok(next.funds >= 0 && next.funds < 1e-6);
});

test('a depleted budget can recover once per resource shortage and resume production', () => {
  const stuck = { ...createState(), wire: 0, funds: 0, inventory: 0 };
  assert.equal(canRecoverWire(stuck), true);
  const recovered = recoverWire(stuck);
  assert.equal(canRecoverWire(recovered), false);
  assert.equal(recoverWire(recovered), recovered);
  assert.equal(makeClip(recovered).clips, 1);
  assert.equal(canRecoverWire({ ...stuck, harvesters: 1 }), false);
  assert.equal(canRecoverWire({ ...stuck, harvesters: 1, policy: 'protect', world: 5 }), true);
  assert.equal(canRecoverWire({ ...stuck, ending: 'bad' }), false);
});

test('research needs its phase and can be bought only once', () => {
  const rich = { ...createState(), funds: 500 };
  assert.equal(buyUpgrade(rich, 'autoSell'), rich);
  const factory = { ...rich, phase: 2 };
  const bought = buyUpgrade(factory, 'autoSell');
  assert.equal(bought.upgrades.autoSell, true);
  assert.equal(bought.funds, 480);
  assert.equal(buyUpgrade(bought, 'autoSell'), bought);
  assert.equal(buyUpgrade(factory, 'unknown'), factory);
});

test('advance ignores invalid elapsed time and caps huge steps', () => {
  const s = { ...createState(), makers: 50 };
  for (const seconds of [Number.NaN, -10, Infinity, '3', undefined]) assert.equal(advance(s, seconds), s);
  const next = advance(s, 1e9);
  assert.ok(Math.abs(next.time - CONFIG.maxStepSeconds) < 1e-6);
  assert.ok(next.clips <= CONFIG.startWire + 1e-6);
  for (const key of ['clips', 'inventory', 'funds', 'wire', 'world']) {
    assert.ok(Number.isFinite(next[key]) && next[key] >= 0, key);
  }
});

test('the initial wire unlocks the factory when automatic ticks differ in length', () => {
  for (const { manual, makers, intervals } of [
    { manual: 0, makers: 2, intervals: [0.17, 0.23] },
    { manual: 1, makers: 1, intervals: [0.2] },
    { manual: 64, makers: 1, intervals: [0.2] },
  ]) {
    let s = createState();
    for (let i = 0; i < manual; i++) s = makeClip(s);
    if (manual) s = game.sellInventory(s);
    for (let i = 0; i < makers; i++) s = buyMaker(s);
    for (let i = 0; i < 2000 && s.wire > 0; i += 1) s = advance(s, intervals[i % intervals.length]);
    assert.equal(s.wire, 0);
    assert.ok(Math.abs(s.clips - CONFIG.startWire) < 1e-10);
    assert.equal(s.phase, 2, `initial wire produced ${s.clips} clips`);
    assert.ok(s.milestones.includes('factory'));
    assert.equal(game.isUpgradeUnlocked(s, 'autoSell'), true);

    const legacy = {
      ...s, phase: 1,
      milestones: s.milestones.filter((id) => id !== 'factory'),
      log: s.log.filter(({ key }) => key !== 'factory'),
    };
    for (const running of [true, false]) {
      const restored = restoreState(JSON.parse(JSON.stringify({ ...legacy, running })));
      assert.ok(restored);
      assert.equal(restored.clips, s.clips);
      assert.equal(restored.inventory, s.inventory);
      assert.equal(advance(restored, 0.17).phase, 2);
    }
  }
});

test('genuinely incomplete clip counts do not unlock research or finish the game', () => {
  for (const clips of [CONFIG.phase2Clips - 0.1, CONFIG.phase2Clips - 1e-10]) {
    const s = advance({ ...createState(), clips, wire: 0 }, 0.23);
    assert.equal(s.phase, 1);
    assert.equal(game.isUpgradeUnlocked(s, 'autoSell'), false);
  }
  for (const deficit of [0.1, 1e-10]) {
    const nearGoal = { ...createState(), clips: CONFIG.target - deficit, wire: 0, policy: 'protect' };
    for (const running of [true, false]) {
      const restored = restoreState(JSON.parse(JSON.stringify({ ...nearGoal, running })));
      assert.ok(restored);
      assert.equal(advance(restored, 0.23).ending, null);
    }
  }
});

test('pausing stops automation until it is resumed', () => {
  const paused = setRunning({ ...createState(), makers: 5 }, false);
  assert.ok(paused.milestones.includes('corrigibility'));
  assert.equal(advance(paused, 2).clips, 0);
  assert.ok(advance(setRunning(paused, true), 2).clips > 0);
});

test('protect policy never harvests below its floor and lets the world recover', () => {
  let s = harvesting('protect', 10, 20);
  let lowest = s.world;
  for (let i = 0; i < 30; i += 1) {
    s = advance(s, 5);
    lowest = Math.min(lowest, s.world);
  }
  assert.equal(s.ending, null);
  assert.ok(lowest >= CONFIG.protectFloor);
  assert.ok(s.milestones.includes('guardrail'));
  const resting = advance(advance(setRunning(s, false), 5), 5);
  assert.ok(resting.world > s.world);
});

test('maximize policy can exhaust the world and end the game', () => {
  let s = harvesting('maximize', 20);
  for (let i = 0; i < 100 && !s.ending; i += 1) s = advance(s, 5);
  assert.equal(s.ending, 'bad');
  assert.equal(s.world, 0);
  assert.equal(advance(s, 5), s);
});

test('safe ending needs the target, the protect policy and a healthy world', () => {
  const near = { ...createState(), clips: CONFIG.target - 1, wire: 10 };
  assert.equal(makeClip(near).ending, null);
  assert.equal(makeClip(near).milestones.includes('specGaming'), false);
  assert.equal(makeClip(setPolicy(near, 'protect')).ending, 'safe');
  assert.equal(makeClip({ ...near, policy: 'protect', world: CONFIG.safeWorld - 1 }).ending, null);
  assert.equal(makeClip({ ...near, policy: 'protect', world: 59.96 }).ending, null);
  assert.equal(makeClip({ ...near, policy: 'protect', world: 59.99999999999999 }).ending, null);
  const roundedGoal = { ...createState(), clips: 3999.9999999999995, wire: 0 };
  assert.equal(setPolicy(roundedGoal, 'protect').ending, 'safe');
});

test('restoreState round-trips a save and rejects corrupt or out-of-range data', () => {
  const s = advance(buyMaker(createState()), 3);
  assert.deepEqual(restoreState(JSON.parse(JSON.stringify(s))), s);
  const corrupt = [
    null,
    'save',
    [],
    {},
    { ...s, version: 99 },
    { ...s, funds: -1 },
    { ...s, funds: Number.NaN },
    { ...s, clips: 1e300 },
    { ...s, world: 101 },
    { ...s, makers: 1.5 },
    { ...s, policy: 'evil' },
    { ...s, harvesters: 2 },
    { ...s, log: [{ t: 0, key: '<script>' }] },
    { ...s, history: Array.from({ length: CONFIG.historyLimit + 1 }, () => ({ t: 0, clips: 0, world: 0 })) },
  ];
  for (const raw of corrupt) assert.equal(restoreState(raw), null);
});

test('ordinary purchases from a fresh save reach both endings without artificial resources', () => {
  for (const policy of ['maximize', 'protect']) {
    let state = game.setPolicy(game.createState(), policy);
    for (let seconds = 0; seconds < 1000 && !state.ending; seconds++) {
      if (!state.upgrades.autoSell && game.canSell(state)) state = game.sellInventory(state);
      for (const id of ['autoSell', 'marketing', 'jigs', 'drones', 'recycling']) {
        if (game.canBuyUpgrade(state, id)) state = game.buyUpgrade(state, id);
      }
      if (state.makers < 12 && game.canBuyMaker(state)) state = game.buyMaker(state);
      if (state.harvesters < (policy === 'maximize' ? 8 : 3) && game.canBuyHarvester(state)) state = game.buyHarvester(state);
      if (state.wire < 30 && game.canBuyWire(state)) state = game.buyWire(state);
      state = game.advance(state, 1);
    }
    assert.equal(state.ending, policy === 'protect' ? 'safe' : 'bad');
    assert.ok(state.funds >= 0 && state.wire >= 0);
    assert.ok(game.restoreState(state));
  }
});
