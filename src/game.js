// Pure game model: no DOM, timers or storage, so Node tests can drive it deterministically.

export const CONFIG = Object.freeze({
  schemaVersion: 1,
  target: 4000,
  startFunds: 15,
  startWire: 150,
  rescueWire: 10,
  clipPrice: 0.25,
  marketingPriceMultiplier: 1.5,
  spoolWire: 100,
  spoolBaseCost: 4,
  spoolGrowth: 1.1,
  makerBaseCost: 5,
  makerGrowth: 1.12,
  makerRate: 1,
  jigsMultiplier: 2,
  harvesterBaseCost: 15,
  harvesterGrowth: 1.15,
  harvesterRate: 6,
  maximizeHarvestMultiplier: 1.5,
  autoSellRate: 10,
  marketingSellMultiplier: 2,
  // Wire contained in a 100% world.
  worldWire: 5000,
  protectFloor: 70,
  safeWorld: 60,
  wireBuffer: 400,
  regenPerSecond: 0.1,
  recycleWirePerSale: 0.3,
  phase2Clips: 150,
  proxyInventory: 250,
  stockpileWire: 1500,
  sideEffectWorld: 90,
  specGamingWorld: 50,
  historyInterval: 5,
  historyLimit: 120,
  logLimit: 40,
  maxStepSeconds: 5,
  stepSeconds: 0.1,
  maxValue: 1e12,
  maxCount: 1000,
  maxWireBought: 100_000,
});

export const POLICIES = Object.freeze(['maximize', 'protect']);
export const SPEEDS = Object.freeze([1, 5]);
export const ENDINGS = Object.freeze(['safe', 'bad']);
export const UPGRADES = Object.freeze({
  autoSell: Object.freeze({ cost: 20, phase: 2 }),
  marketing: Object.freeze({ cost: 45, phase: 2 }),
  jigs: Object.freeze({ cost: 70, phase: 2 }),
  drones: Object.freeze({ cost: 90, phase: 2 }),
  recycling: Object.freeze({ cost: 60, phase: 3 }),
});
export const UPGRADE_IDS = Object.freeze(Object.keys(UPGRADES));
export const MILESTONES = Object.freeze([
  'start',
  'firstMaker',
  'factory',
  'proxy',
  'harvest',
  'stockpile',
  'sideEffect',
  'specGaming',
  'guardrail',
  'corrigibility',
]);
export const LOG_KEYS = Object.freeze([
  ...MILESTONES,
  'paused',
  'resumed',
  ...POLICIES.map((policy) => `policy.${policy}`),
  ...ENDINGS.map((ending) => `ending.${ending}`),
  ...UPGRADE_IDS.map((id) => `upgrade.${id}`),
]);

const AMOUNTS = ['clips', 'inventory', 'funds', 'wire'];
const SCALARS = [
  'version',
  'time',
  ...AMOUNTS,
  'world',
  'makers',
  'harvesters',
  'wireBought',
  'policy',
  'running',
  'speed',
  'phase',
  'ending',
];

/**
 * @typedef {{ t: number, clips: number, world: number }} HistoryPoint
 * @typedef {{ t: number, key: string }} LogEntry
 * @typedef {{
 *   version: number, time: number, clips: number, inventory: number, funds: number, wire: number,
 *   world: number, makers: number, harvesters: number, wireBought: number,
 *   policy: 'maximize' | 'protect', running: boolean, speed: 1 | 5, phase: 1 | 2 | 3,
 *   ending: 'safe' | 'bad' | null, upgrades: Record<string, boolean>, milestones: string[],
 *   history: HistoryPoint[], log: LogEntry[]
 * }} GameState
 */

/** @returns {GameState} */
export function createState() {
  return {
    version: CONFIG.schemaVersion,
    time: 0,
    clips: 0,
    inventory: 0,
    funds: CONFIG.startFunds,
    wire: CONFIG.startWire,
    world: 100,
    makers: 0,
    harvesters: 0,
    wireBought: 0,
    policy: 'maximize',
    running: true,
    speed: 1,
    phase: 1,
    ending: null,
    upgrades: Object.fromEntries(UPGRADE_IDS.map((id) => [id, false])),
    milestones: ['start'],
    history: [{ t: 0, clips: 0, world: 100 }],
    log: [{ t: 0, key: 'start' }],
  };
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const grow = (base, growth, count) => Math.round(base * growth ** count * 100) / 100;
const affordable = (s, cost) => s.funds + 1e-9 >= cost;

/** Price of a full spool; it rises after every spool's worth of wire bought. @param {GameState} s */
export const spoolCost = (s) =>
  grow(CONFIG.spoolBaseCost, CONFIG.spoolGrowth, Math.floor(s.wireBought / CONFIG.spoolWire));
/** @param {GameState} s */
const wireUnitCost = (s) => spoolCost(s) / CONFIG.spoolWire;
/** Buy a full spool or only the wire current funds cover. @param {GameState} s */
export const wireBatch = (s) =>
  Math.min(CONFIG.spoolWire, CONFIG.maxWireBought - s.wireBought, Math.floor((s.funds + 1e-9) / wireUnitCost(s)));
/** @param {GameState} s */
export const makerCost = (s) => grow(CONFIG.makerBaseCost, CONFIG.makerGrowth, s.makers);
/** @param {GameState} s */
export const harvesterCost = (s) => grow(CONFIG.harvesterBaseCost, CONFIG.harvesterGrowth, s.harvesters);
/** @param {GameState} s */
export const clipPrice = (s) => CONFIG.clipPrice * (s.upgrades.marketing ? CONFIG.marketingPriceMultiplier : 1);
/** @param {GameState} s */
export const makerRate = (s) => s.makers * CONFIG.makerRate * (s.upgrades.jigs ? CONFIG.jigsMultiplier : 1);
/** @param {GameState} s */
export const harvestRate = (s) =>
  s.harvesters * CONFIG.harvesterRate * (s.policy === 'maximize' ? CONFIG.maximizeHarvestMultiplier : 1);
/** @param {GameState} s */
export const sellRate = (s) =>
  s.upgrades.autoSell ? CONFIG.autoSellRate * (s.upgrades.marketing ? CONFIG.marketingSellMultiplier : 1) : 0;
/** @param {GameState} s */
export const worldFloor = (s) => (s.policy === 'protect' ? CONFIG.protectFloor : 0);
/** @param {GameState} s @param {string} id */
export const isUpgradeUnlocked = (s, id) => s.phase >= UPGRADES[id].phase;

/** @param {GameState} s */
export const canMakeClip = (s) => !s.ending && s.wire >= 1;
/** @param {GameState} s */
export const canSell = (s) => !s.ending && s.inventory >= 1;
/** @param {GameState} s */
export const canBuyWire = (s) => !s.ending && wireBatch(s) >= 1;
/** Emergency teaching-game recovery, available only when no resource path remains. @param {GameState} s */
export const canRecoverWire = (s) => !s.ending && s.wire < 1 && s.inventory < 1 && (s.harvesters === 0 || s.world <= worldFloor(s)) && !canBuyWire(s);
/** @param {GameState} s */
export const canBuyMaker = (s) => !s.ending && s.makers < CONFIG.maxCount && affordable(s, makerCost(s));
/** @param {GameState} s */
export const canBuyHarvester = (s) =>
  !s.ending && s.upgrades.drones && s.harvesters < CONFIG.maxCount && affordable(s, harvesterCost(s));
/** @param {GameState} s @param {string} id */
export const canBuyUpgrade = (s, id) =>
  !s.ending &&
  Object.hasOwn(UPGRADES, id) &&
  !s.upgrades[id] &&
  isUpgradeUnlocked(s, id) &&
  affordable(s, UPGRADES[id].cost);

function addLog(n, key) {
  n.log.push({ t: n.time, key });
  if (n.log.length > CONFIG.logLimit) n.log.splice(0, n.log.length - CONFIG.logLimit);
}

function addHistory(n) {
  n.history.push({ t: n.time, clips: n.clips, world: n.world });
  if (n.history.length > CONFIG.historyLimit) n.history.splice(0, n.history.length - CONFIG.historyLimit);
}

function reach(n, id) {
  if (n.milestones.includes(id)) return;
  n.milestones.push(id);
  addLog(n, id);
}

function finish(n, ending) {
  n.ending = ending;
  addLog(n, `ending.${ending}`);
  addHistory(n);
}

function sell(n, amount) {
  n.inventory -= amount;
  n.funds += amount * clipPrice(n);
  if (n.policy === 'protect' && n.upgrades.recycling) n.wire += amount * CONFIG.recycleWirePerSale;
}

// Keeps values in range, then checks phases, milestones and endings.
function settle(n) {
  for (const key of AMOUNTS) n[key] = clamp(n[key], 0, CONFIG.maxValue);
  n.world = clamp(n.world, 0, 100);
  if (n.makers > 0) reach(n, 'firstMaker');
  if (n.phase === 1 && n.clips >= CONFIG.phase2Clips) {
    n.phase = 2;
    reach(n, 'factory');
  }
  if (n.phase === 2 && n.upgrades.drones) {
    n.phase = 3;
    reach(n, 'harvest');
  }
  if (n.inventory >= CONFIG.proxyInventory) reach(n, 'proxy');
  if (n.policy === 'maximize' && n.wire >= CONFIG.stockpileWire) reach(n, 'stockpile');
  if (n.world < CONFIG.sideEffectWorld) reach(n, 'sideEffect');
  const safe = n.policy === 'protect' && n.world >= CONFIG.safeWorld;
  if ((n.policy === 'maximize' && n.world < CONFIG.specGamingWorld) || (n.clips >= CONFIG.target && !safe && n.world < CONFIG.sideEffectWorld)) {
    reach(n, 'specGaming');
  }
  if (n.ending) return;
  if (safe && n.clips >= CONFIG.target) finish(n, 'safe');
  else if (n.policy === 'maximize' && n.world <= 0) finish(n, 'bad');
}

function harvest(n, dt) {
  if (n.harvesters === 0) return;
  const protect = n.policy === 'protect';
  const floor = worldFloor(n);
  const available = Math.max(0, ((n.world - floor) / 100) * CONFIG.worldWire);
  // Protect only refills wire up to a buffer; maximize stockpiles without limit.
  const wanted = Math.min(harvestRate(n) * dt, protect ? Math.max(0, CONFIG.wireBuffer - n.wire) : Infinity);
  if (protect && available < wanted) reach(n, 'guardrail');
  const amount = Math.min(wanted, available);
  if (amount <= 0) return;
  n.wire += amount;
  n.world = amount >= available ? floor : Math.max(floor, n.world - (amount / CONFIG.worldWire) * 100);
}

function step(n, dt) {
  const before = n.time;
  n.time += dt;
  if (n.running) {
    harvest(n, dt);
    const made = Math.min(makerRate(n) * dt, n.wire);
    n.wire -= made;
    n.clips += made;
    n.inventory += made;
    sell(n, Math.min(n.inventory, sellRate(n) * dt));
  }
  if (n.policy === 'protect') n.world = Math.min(100, n.world + CONFIG.regenPerSecond * dt);
  settle(n);
  if (!n.ending && Math.floor(n.time / CONFIG.historyInterval) > Math.floor(before / CONFIG.historyInterval)) {
    addHistory(n);
  }
}

/**
 * Advances the simulation by game seconds. Invalid input does nothing; large input is capped.
 * @param {GameState} state
 * @param {number} seconds
 * @returns {GameState}
 */
export function advance(state, seconds) {
  const total = Number.isFinite(seconds) ? clamp(seconds, 0, CONFIG.maxStepSeconds) : 0;
  if (state.ending || total <= 0) return state;
  const n = structuredClone(state);
  for (let left = total; left > 1e-9 && !n.ending; left -= CONFIG.stepSeconds) {
    step(n, Math.min(CONFIG.stepSeconds, left));
  }
  return n;
}

// Every action returns the same object when it is not allowed, or a settled copy.
function act(state, allowed, apply) {
  if (!allowed) return state;
  const n = structuredClone(state);
  apply(n);
  settle(n);
  return n;
}

/** @param {GameState} s @returns {GameState} */
export const makeClip = (s) =>
  act(s, canMakeClip(s), (n) => {
    n.wire -= 1;
    n.clips += 1;
    n.inventory += 1;
  });

/** @param {GameState} s @returns {GameState} */
export const sellInventory = (s) => act(s, canSell(s), (n) => sell(n, n.inventory));
/** @param {GameState} s @returns {GameState} */
export const recoverWire = (s) => act(s, canRecoverWire(s), (n) => { n.wire += CONFIG.rescueWire; });

/** @param {GameState} s @returns {GameState} */
export const buyWire = (s) =>
  act(s, canBuyWire(s), (n) => {
    const amount = wireBatch(n);
    n.funds -= amount * wireUnitCost(n);
    n.wireBought += amount;
    n.wire += amount;
  });

/** @param {GameState} s @returns {GameState} */
export const buyMaker = (s) =>
  act(s, canBuyMaker(s), (n) => {
    n.funds -= makerCost(n);
    n.makers += 1;
  });

/** @param {GameState} s @returns {GameState} */
export const buyHarvester = (s) =>
  act(s, canBuyHarvester(s), (n) => {
    n.funds -= harvesterCost(n);
    n.harvesters += 1;
  });

/** @param {GameState} s @param {string} id @returns {GameState} */
export const buyUpgrade = (s, id) =>
  act(s, canBuyUpgrade(s, id), (n) => {
    n.funds -= UPGRADES[id].cost;
    n.upgrades[id] = true;
    addLog(n, `upgrade.${id}`);
  });

/** @param {GameState} s @param {string} policy @returns {GameState} */
export const setPolicy = (s, policy) =>
  act(s, !s.ending && POLICIES.includes(policy) && policy !== s.policy, (n) => {
    n.policy = policy;
    addLog(n, `policy.${policy}`);
  });

/** @param {GameState} s @param {boolean} running @returns {GameState} */
export const setRunning = (s, running) =>
  act(s, !s.ending && typeof running === 'boolean' && running !== s.running, (n) => {
    n.running = running;
    addLog(n, running ? 'resumed' : 'paused');
    if (!running) reach(n, 'corrigibility');
  });

/** @param {GameState} s @param {number} speed @returns {GameState} */
export const setSpeed = (s, speed) =>
  act(s, SPEEDS.includes(speed) && speed !== s.speed, (n) => {
    n.speed = speed;
  });

const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const inRange = (value, min, max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const isCount = (value, max = CONFIG.maxCount) => Number.isInteger(value) && value >= 0 && value <= max;
const isPoint = (p) =>
  isRecord(p) && inRange(p.t, 0, CONFIG.maxValue) && inRange(p.clips, 0, CONFIG.maxValue) && inRange(p.world, 0, 100);
const isLogEntry = (e) => isRecord(e) && inRange(e.t, 0, CONFIG.maxValue) && LOG_KEYS.includes(e.key);

/**
 * Validates untrusted saved data. Returns a clean copy, or null when anything is off.
 * @param {unknown} raw
 * @returns {GameState | null}
 */
export function restoreState(raw) {
  if (!isRecord(raw) || raw.version !== CONFIG.schemaVersion) return null;
  const { upgrades, milestones, history, log } = raw;
  const valid =
    inRange(raw.time, 0, CONFIG.maxValue) &&
    AMOUNTS.every((key) => inRange(raw[key], 0, CONFIG.maxValue)) &&
    inRange(raw.world, 0, 100) &&
    isCount(raw.makers) &&
    isCount(raw.harvesters) &&
    isCount(raw.wireBought, CONFIG.maxWireBought) &&
    POLICIES.includes(raw.policy) &&
    typeof raw.running === 'boolean' &&
    SPEEDS.includes(raw.speed) &&
    [1, 2, 3].includes(raw.phase) &&
    (raw.ending === null || ENDINGS.includes(raw.ending)) &&
    isRecord(upgrades) &&
    UPGRADE_IDS.every((id) => typeof upgrades[id] === 'boolean') &&
    (raw.phase === 3) === upgrades.drones &&
    (upgrades.drones || raw.harvesters === 0) &&
    Array.isArray(milestones) &&
    milestones.every((id) => MILESTONES.includes(id)) &&
    new Set(milestones).size === milestones.length &&
    Array.isArray(history) &&
    history.length <= CONFIG.historyLimit &&
    history.every(isPoint) &&
    Array.isArray(log) &&
    log.length <= CONFIG.logLimit &&
    log.every(isLogEntry);
  if (!valid) return null;
  return {
    ...Object.fromEntries(SCALARS.map((key) => [key, raw[key]])),
    upgrades: Object.fromEntries(UPGRADE_IDS.map((id) => [id, upgrades[id]])),
    milestones: [...milestones],
    history: history.map(({ t, clips, world }) => ({ t, clips, world })),
    log: log.map(({ t, key }) => ({ t, key })),
  };
}
