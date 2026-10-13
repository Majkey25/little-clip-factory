import './style.css';
import {
  CONFIG,
  UPGRADE_IDS,
  UPGRADES,
  advance,
  buyHarvester,
  buyMaker,
  buyUpgrade,
  buyWire,
  canBuyHarvester,
  canBuyMaker,
  canBuyUpgrade,
  canBuyWire,
  canMakeClip,
  canRecoverWire,
  canSell,
  clipPrice,
  createState,
  harvestRate,
  harvesterCost,
  isUpgradeUnlocked,
  makeClip,
  makerCost,
  makerRate,
  recoverWire,
  reachesClips,
  sellInventory,
  sellRate,
  setPolicy,
  setRunning,
  setSpeed,
  spoolCost,
  wireBatch,
  worldFloor,
} from './game.js';
import { STRINGS } from './i18n.js';
import { createGameSession, createStore, SAVE_KEY } from './storage.js';
import { createFactoryScene } from './scene.js';

const TICK_MS = 200;
const SAVE_MS = 2000;
// Real seconds per tick are capped, so a sleeping tab never fast-forwards the world.
const MAX_REAL_SECONDS = 1;
const GRAPH = { left: 38, right: 310, top: 10, bottom: 130 };

const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));
const params = new URLSearchParams(window.location.search);
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
let motionEnabled = params.get('motion') !== 'off';
const factoryScene = createFactoryScene(/** @type {HTMLCanvasElement} */ ($('factory-canvas')));
const store = createStore();
const session = createGameSession(store, {
  locks: navigator.locks,
  channelFactory: typeof BroadcastChannel === 'function' ? () => new BroadcastChannel(`${SAVE_KEY}:session`) : undefined,
  onChange() {
    const tookControl = previousStatus === 'waiting' && session.status === 'active';
    previousStatus = session.status;
    state = session.state;
    if (!session.canPlay && dialog.open) dialog.close('cancel');
    renderStorageNote();
    render();
    if (tookControl) $('controls').focus();
  },
});

let state = session.state;
let previousStatus = session.status;
let lang = readLanguage();
let shownEnding = state.ending;
let logKey = '';
// Log already announced to screen readers; only entries after it are read out.
let announcedLog = state.log;
let seenInsight = state.milestones.at(-1) ?? 'start';
/** @type {import('./game.js').HistoryPoint[] | null} */
let graphHistory = null;
let fmt = makeFormatters();
let rules = makeRules();

function readLanguage() {
  const current = new URLSearchParams(window.location.search);
  return current.get('lang') === 'cs' || (!current.has('lang') && store.loadLang() === 'cs') ? 'cs' : 'en';
}

function makeFormatters() {
  const locale = lang === 'cs' ? 'cs-CZ' : 'en-US';
  return {
    int: new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }),
    dec: new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }),
    money: new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' }),
    price: new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 3 }),
  };
}

function makeRules() {
  return {
    target: fmt.int.format(CONFIG.target),
    phase2: fmt.int.format(CONFIG.phase2Clips),
    safe: CONFIG.safeWorld,
    floor: CONFIG.protectFloor,
    buffer: fmt.int.format(CONFIG.wireBuffer),
    sell: CONFIG.autoSellRate,
    recycle: fmt.dec.format(CONFIG.recycleWirePerSale),
    rescue: CONFIG.rescueWire,
    regen: fmt.dec.format(CONFIG.regenPerSecond),
    pricePct: Math.round((CONFIG.marketingPriceMultiplier - 1) * 100),
    harvestPct: Math.round((CONFIG.maximizeHarvestMultiplier - 1) * 100),
    sellMult: CONFIG.marketingSellMultiplier,
    jigsMult: CONFIG.jigsMultiplier,
  };
}

const fill = (text, vars = {}) => text.replace(/\{(\w+)\}/g, (_, name) => String({ ...rules, ...vars }[name] ?? ''));
const strings = () => STRINGS[lang];
const t = (key, vars) => fill(strings().ui[key] ?? key, vars);
const count = (value) => fmt.int.format(Math.floor(value));
const money = (value) => fmt.money.format(value);
const clock = (seconds) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
// Floor to one decimal so 59.96% never displays as a safe 60%.
const worldPct = (world) => fmt.dec.format(Math.floor(world * 10) / 10);

function worldStatus(world) {
  if (world <= 0) return 'worldExhausted';
  if (world >= 80) return 'worldHealthy';
  if (world >= CONFIG.safeWorld) return 'worldStrained';
  if (world >= 30) return 'worldDamaged';
  return 'worldCritical';
}

function logText(key) {
  const text = strings();
  if (key.startsWith('upgrade.')) return fill(text.events.upgrade, { name: text.upgrades[key.slice(8)].name });
  return text.events[key] ?? text.story[key]?.title ?? key;
}

/**
 * One concrete suggestion from the current state. It never acts or chooses for the player.
 * @param {import('./game.js').GameState} s
 * @returns {[string, Record<string, string>?]}
 */
function nextStep(s) {
  // Affordable: the specific tip. Otherwise name the next buy and how to get the money.
  const buy = (canBuy, key, name, cost) => {
    if (canBuy) return [key, { money: money(cost) }];
    const sellFirst = s.inventory >= 1 && !s.upgrades.autoSell;
    return [sellFirst ? 'guideSellFor' : 'guideSaveFor', { name, money: money(cost) }];
  };
  const study = (id, key) => buy(canBuyUpgrade(s, id), key, strings().upgrades[id].name, UPGRADES[id].cost);

  if (reachesClips(s.clips, CONFIG.target)) {
    if (s.policy === 'maximize') return ['guideQuota'];
    if (s.world < CONFIG.safeWorld) return ['guideHeal'];
  }
  if (canRecoverWire(s)) return ['guideDonation'];
  // Drones still bringing wire is not a stall.
  if (s.wire < 1 && !(s.running && s.harvesters > 0 && s.world > worldFloor(s))) {
    if (canBuyWire(s)) return ['guideBuyWire'];
    if (s.inventory >= 1) return ['guideSellForWire'];
    return [s.running ? 'guideWaitWire' : 'guidePaused'];
  }
  if (!s.running && (s.makers > 0 || s.harvesters > 0 || s.upgrades.autoSell)) return ['guidePaused'];
  if (s.phase === 1) {
    if (s.clips < 1) return ['guideMake'];
    if (s.makers === 0 && s.funds === CONFIG.startFunds && s.inventory >= 1) return ['guideSell'];
    if (s.makers === 0) return buy(canBuyMaker(s), 'guideBuyMaker', t('makerName'), makerCost(s));
    return [canBuyMaker(s) ? 'guideMoreMakers' : 'guideFactory', { money: money(makerCost(s)) }];
  }
  if (s.phase === 2) return s.upgrades.autoSell ? study('drones', 'guideDrones') : study('autoSell', 'guideSalesCart');
  if (s.harvesters === 0) return buy(canBuyHarvester(s), 'guideBuildDrone', t('droneName'), harvesterCost(s));
  if (s.policy === 'maximize') return ['guidePolicy'];
  if (!s.upgrades.recycling) return study('recycling', 'guideRecycling');
  return [s.world < CONFIG.safeWorld ? 'guideHeal' : 'guideFinish'];
}

/**
 * Real progress toward the next phase, or toward the clip goal in the last one.
 * @param {import('./game.js').GameState} s
 * @returns {[number, string]}
 */
function phaseProgress(s) {
  if (s.phase === 2) {
    const cost = UPGRADES.drones.cost;
    const saved = Math.min(s.funds, cost);
    return [saved / cost, t('progressDrones', { money: money(saved), cost: money(cost) })];
  }
  const goal = s.phase === 1 ? CONFIG.phase2Clips : CONFIG.target;
  const made = Math.min(s.clips, goal);
  return [made / goal, t('progressClips', { n: count(made), goal: fmt.int.format(goal) })];
}

/** Short reason under a purchase that cannot be made yet. @param {import('./game.js').GameState} s */
function missing(s, canBuy, cost, maxed = false) {
  if (canBuy || s.ending) return '';
  // Match purchase tolerance so floating-point residue never adds a phantom cent.
  return maxed ? t('maxed') : t('need', { money: money(Math.ceil((cost - s.funds - 1e-9) * 100) / 100) });
}

const research = UPGRADE_IDS.map((id) => {
  const item = document.createElement('li');
  const text = document.createElement('div');
  const name = document.createElement('strong');
  const desc = document.createElement('p');
  const note = document.createElement('p');
  const button = document.createElement('button');
  note.className = 'need';
  note.id = `research-note-${id}`;
  button.type = 'button';
  button.className = 'btn small';
  button.setAttribute('aria-describedby', note.id);
  button.addEventListener('click', () => {
    act((s) => buyUpgrade(s, id), '#stat-funds');
    // A bought row loses its button, so keep keyboard focus in the research panel.
    if (button.hidden) $('research-title').focus();
  });
  text.append(name, desc, note);
  item.append(text, button);
  $('research-list').append(item);
  return { id, item, name, desc, note, button };
});

const policyInputs = /** @type {NodeListOf<HTMLInputElement>} */ (document.querySelectorAll('input[name="policy"]'));
const speedButtons = /** @type {NodeListOf<HTMLButtonElement>} */ (document.querySelectorAll('[data-speed]'));
const resetButtons = /** @type {NodeListOf<HTMLButtonElement>} */ (document.querySelectorAll('[data-action="reset"]'));
const press = /** @type {HTMLButtonElement} */ ($('scene-make'));
press.addEventListener('click', () => {
  $('make-clip').click();
  if (press.disabled && !state.ending) $('controls').focus({ preventScroll: true });
});

function renderExplainer() {
  const list = $('explain-list');
  const entries = [...list.querySelectorAll('details')];
  const active = document.activeElement;
  const focused = entries.findIndex((el) => el.contains(active));
  const open = new Set(entries.flatMap((el, i) => (el.open ? [i] : [])));
  list.replaceChildren(
    ...strings().explain.map((entry, i) => {
      const details = document.createElement('details');
      const summary = document.createElement('summary');
      const body = document.createElement('p');
      details.open = open.has(i);
      summary.textContent = entry.title;
      body.textContent = entry.body;
      details.append(summary, body);
      if (entry.source) {
        const source = document.createElement('p');
        const link = document.createElement('a');
        source.className = 'source';
        link.href = entry.source.url;
        link.target = '_blank';
        link.rel = 'noopener';
        link.textContent = entry.source.label;
        source.append(`${t('sourceLabel')} `, link);
        details.append(source);
      }
      return details;
    }),
  );
  const control = active?.tagName === 'A' ? 'a' : 'summary';
  list.querySelectorAll('details')[focused]?.querySelector(control)?.focus({ preventScroll: true });
}

function applyLanguage() {
  fmt = makeFormatters();
  rules = makeRules();
  document.documentElement.lang = lang;
  document.title = t('pageTitle');
  for (const el of document.querySelectorAll('[data-i18n]')) setText(/** @type {HTMLElement} */ (el), t(el.dataset.i18n));
  $('factory-canvas').setAttribute('aria-label', t('sceneAlt'));
  const toggle = $('lang-toggle');
  setText(toggle, t('langToggle'));
  toggle.setAttribute('aria-label', t('langToggleLabel'));
  toggle.setAttribute('lang', lang === 'cs' ? 'en' : 'cs');
  const courseLink = /** @type {HTMLAnchorElement} */ (document.querySelector('[data-i18n="course"]'));
  const courseUrl = new URL(courseLink.href);
  courseUrl.searchParams.set('lang', lang);
  courseLink.href = courseUrl.href;
  logKey = '';
  renderExplainer();
  renderStorageNote();
  render();
}

function renderStorageNote() {
  const note = $('storage-note');
  note.hidden = session.note === null;
  setText('storage-note', session.note ? t(session.note) : '');
}

/** @param {string | HTMLElement} target @param {string} value */
function setText(target, value) {
  const el = typeof target === 'string' ? $(target) : target;
  if (el.textContent !== value) el.textContent = value;
}

/** @param {Element} el @param {string} name @param {string} value */
function setAttr(el, name, value) {
  if (el.getAttribute(name) !== value) el.setAttribute(name, value);
}

function renderSession() {
  const mode = session.status;
  const keys = {
    connecting: 'sessionConnecting', active: 'sessionActive', readonly: 'sessionReadonly',
    waiting: 'sessionWaiting', local: 'sessionLocal', closed: 'sessionConnecting',
  };
  $('session-bar').hidden = mode === 'active' || mode === 'closed';
  setText('session-note', t(keys[mode]));
  const button = /** @type {HTMLButtonElement} */ ($('continue-here'));
  button.hidden = mode !== 'readonly' && mode !== 'waiting';
  button.disabled = mode === 'waiting';
  button.setAttribute('aria-busy', String(mode === 'waiting'));
  setText('continue-here', t('sessionContinue'));
  $('session-active').hidden = mode !== 'active';
  setText('session-active', t('sessionActive'));
  setText('reset-text', t(mode === 'local' ? 'resetLocalText' : 'resetText'));
  setText('reset-confirm', t(mode === 'local' ? 'resetLocalConfirm' : 'resetConfirm'));
}

function setButton(id, text, enabled) {
  const button = /** @type {HTMLButtonElement} */ ($(id));
  setText(button, text);
  button.disabled = !session.canPlay || !enabled;
}

function renderGraph() {
  const points = state.history.length ? state.history : [{ t: state.time, clips: state.clips, world: state.world }];
  const previous = graphHistory;
  if (!previous || previous.length !== points.length || points.some((p, i) =>
    p.t !== previous[i].t || p.clips !== previous[i].clips || p.world !== previous[i].world)) {
    const start = points[0].t;
    setText('graph-time-start', clock(start));
    setText('graph-time-end', clock(points.at(-1).t));
    const span = Math.max(points.at(-1).t - start, 1);
    const x = (time) => GRAPH.left + ((time - start) / span) * (GRAPH.right - GRAPH.left);
    const y = (share) => GRAPH.bottom - share * (GRAPH.bottom - GRAPH.top);
    const line = (share) => points.map((p) => `${x(p.t).toFixed(1)},${y(share(p)).toFixed(1)}`).join(' ');
    $('graph-clips').setAttribute('points', line((p) => Math.min(1, p.clips / CONFIG.target)));
    $('graph-world').setAttribute('points', line((p) => p.world / 100));
    graphHistory = points.map(({ t, clips, world }) => ({ t, clips, world }));
  }
  setText('graph-desc', t('graphDesc', {
    time: clock(state.time),
    from: clock(points[0].t),
    to: clock(points.at(-1).t),
    clips: fmt.dec.format(state.clips),
    world: worldPct(state.world),
  }));
}

function renderLog() {
  const last = state.log.at(-1);
  const key = `${lang}|${state.log.length}|${last?.t}|${last?.key}`;
  if (key === logKey) return;
  logKey = key;
  $('log').replaceChildren(
    ...[...state.log].reverse().map((entry) => {
      const item = document.createElement('li');
      const time = document.createElement('span');
      time.className = 'log-time';
      time.textContent = clock(entry.t);
      item.append(time, ` ${logText(entry.key)}`);
      return item;
    }),
  );
}

// Reads out new log entries (phases, upgrades, policy, pause, endings), never counter ticks.
function renderAnnouncement() {
  const log = state.log;
  if (log === announcedLog) return;
  const last = announcedLog.at(-1);
  const from = last ? log.findLastIndex((e) => e.t === last.t && e.key === last.key) : -1;
  announcedLog = log;
  // An unknown history (reset or another tab's save) is not announced.
  const fresh = from < 0 ? [] : log.slice(from + 1);
  if (fresh.length) setText('announcer', fresh.map((e) => logText(e.key)).join(' '));
}

function renderEnding() {
  const panel = $('ending');
  panel.hidden = !state.ending;
  if (!state.ending) {
    shownEnding = null;
    return;
  }
  const ending = strings().endings[state.ending];
  setText('ending-title', ending.title);
  setText('ending-text', fill(ending.text, { world: worldPct(state.world) }));
  if (shownEnding !== state.ending) {
    shownEnding = state.ending;
    if (session.canPlay) $('ending-title').focus();
  }
}

function render() {
  const s = state;
  const text = strings();
  const playable = session.canPlay && !s.ending;

  setText('phase-step', t('phaseStep', { n: s.phase }));
  setText('phase-name', t(`phase${s.phase}`));
  setText('goal', t(`goal${s.phase}`));
  const [share, progress] = phaseProgress(s);
  const bar = $('phase-progress');
  setAttr(bar, 'aria-valuenow', String(Math.floor(share * 100)));
  setAttr(bar, 'aria-valuetext', progress);
  $('phase-fill').style.width = `${share * 100}%`;
  setText('progress-text', progress);

  $('guide').hidden = Boolean(s.ending);
  const [guide, guideVars] = nextStep(s);
  setText('guide-text', t(guide, guideVars));
  const automated = s.makers > 0 || s.harvesters > 0 || s.upgrades.autoSell;
  const run = $('toggle-run');
  run.hidden = s.running && !automated;
  run.classList.toggle('primary', !s.running);
  setButton('toggle-run', t(s.running ? 'pause' : 'resume'), !s.ending);
  setAttr(run, 'aria-label', t(s.running ? 'pauseLabel' : 'resumeLabel'));

  setText('stat-wire', count(s.wire));
  setText('stat-inventory', fmt.dec.format(s.inventory));
  setText('stat-clips', fmt.dec.format(s.clips));
  setText('stat-funds', money(s.funds));
  setText('stat-price', fmt.price.format(clipPrice(s)));
  setButton('make-clip', t('makeClip'), canMakeClip(s));
  setButton('sell', t('sell', { money: money(s.inventory * clipPrice(s)) }), canSell(s));
  const batch = wireBatch(s) || CONFIG.spoolWire;
  setButton('buy-wire', t('buyWire', { n: batch, money: money((batch * spoolCost(s)) / CONFIG.spoolWire) }), canBuyWire(s));
  $('recover-wire').hidden = !canRecoverWire(s);
  setButton('recover-wire', t('recoverWire', { n: CONFIG.rescueWire }), true);

  $('world').hidden = s.phase < 3;
  const status = worldStatus(s.world);
  const gauge = $('world-gauge');
  const worldText = t('worldValue', { pct: worldPct(s.world), status: t(status) });
  setText('world-value', worldText);
  setAttr(gauge, 'aria-valuenow', String(s.world));
  setAttr(gauge, 'aria-valuetext', worldText);
  gauge.dataset.level = status;
  $('world-fill').style.width = `${s.world}%`;

  $('speed').hidden = !automated;
  for (const button of speedButtons) {
    setAttr(button, 'aria-pressed', String(Number(button.dataset.speed) === s.speed));
    button.disabled = !playable;
  }

  setText('maker-info', t('makerInfo', { n: s.makers, rate: fmt.dec.format(makerRate(s)) }));
  setButton('buy-maker', t('buyMaker', { money: money(makerCost(s)) }), canBuyMaker(s));
  setText('maker-need', missing(s, canBuyMaker(s), makerCost(s), s.makers >= CONFIG.maxCount));
  $('harvester-row').hidden = !s.upgrades.drones;
  setText('harvest-info', t('harvestInfo', { n: s.harvesters, rate: fmt.dec.format(harvestRate(s)) }));
  setButton('buy-harvester', t('buyHarvester', { money: money(harvesterCost(s)) }), canBuyHarvester(s));
  setText('harvester-need', missing(s, canBuyHarvester(s), harvesterCost(s), s.harvesters >= CONFIG.maxCount));
  setText('sell-info', s.upgrades.autoSell ? t('sellAuto', { rate: sellRate(s) }) : t('sellManual'));

  $('research-locked').hidden = s.phase > 1;
  setText('research-locked', t('researchOpens', { n: count(s.clips) }));
  for (const row of research) {
    const done = s.upgrades[row.id];
    const upgrade = text.upgrades[row.id];
    const canBuy = canBuyUpgrade(s, row.id);
    const label = t('research', { money: money(UPGRADES[row.id].cost) });
    row.item.hidden = !done && !isUpgradeUnlocked(s, row.id);
    row.item.classList.toggle('done', done);
    setText(row.name, upgrade.name);
    setText(row.desc, fill(upgrade.desc));
    setText(row.note, [
      done ? t('researchDone') : missing(s, canBuy, UPGRADES[row.id].cost),
      row.id === 'recycling' && s.policy !== 'protect' ? t('needProtect') : '',
    ].filter(Boolean).join(' '));
    row.button.hidden = done;
    setText(row.button, label);
    row.button.disabled = !session.canPlay || !canBuy;
    setAttr(row.button, 'aria-label', `${upgrade.name}: ${label}`);
  }

  const policy = $('policy-panel');
  // A protect choice from a save stays visible even before the factory phase.
  policy.hidden = s.phase < 2 && s.policy !== 'protect';
  policy.classList.toggle('prominent', s.phase === 3);
  for (const input of policyInputs) {
    input.checked = input.value === s.policy;
    input.disabled = !playable;
  }
  for (const button of resetButtons) button.disabled = !session.canPlay;

  press.disabled = /** @type {HTMLButtonElement} */ ($('make-clip')).disabled;
  setAttr(press, 'aria-label', t('makeClip'));
  setAttr(press, 'title', t('makeClip'));
  factoryScene.update(s, { motion: motionEnabled && !reducedMotion.matches, canPlay: session.canPlay, lang });

  const insight = /** @type {HTMLDetailsElement} */ ($('insight'));
  const storyKey = s.milestones.at(-1) ?? 'start';
  const story = text.story[storyKey];
  setText('story-title', story.title);
  setText('story-text', fill(story.text));
  if (insight.open) seenInsight = storyKey;
  insight.classList.toggle('fresh', storyKey !== seenInsight);

  renderGraph();
  renderLog();
  renderAnnouncement();
  renderEnding();
  renderSession();
}

const POP = [{ transform: 'scale(1)' }, { transform: 'scale(1.12)' }, { transform: 'scale(1)' }];
// Briefly pop what a manual action changed, so the cause and effect are visible.
function pop(...selectors) {
  if (!motionEnabled || reducedMotion.matches) return;
  for (const selector of selectors) document.querySelector(selector)?.animate(POP, { duration: 260 });
}
function act(action, ...selectors) {
  if (!session.canPlay) return;
  const next = action(state);
  if (next === state) return;
  pop(...selectors);
  session.commit(next);
}

$('make-clip').addEventListener('click', () => {
  act(makeClip, '#stat-wire', '#stat-inventory');
});
$('sell').addEventListener('click', () => act(sellInventory, '#stat-inventory', '#stat-funds'));
$('buy-wire').addEventListener('click', () => act(buyWire, '#stat-wire', '#stat-funds'));
$('recover-wire').addEventListener('click', () => act(recoverWire, '#stat-wire'));
$('buy-maker').addEventListener('click', () => act(buyMaker, '#maker-info', '#stat-funds'));
$('buy-harvester').addEventListener('click', () => act(buyHarvester, '#harvest-info', '#stat-funds'));
$('toggle-run').addEventListener('click', () => {
  act((s) => setRunning(s, !s.running));
  // Resuming before any automation hides the button, so keep focus in the game.
  if ($('toggle-run').hidden) $('controls').focus({ preventScroll: true });
});
$('insight').addEventListener('toggle', render);
for (const input of policyInputs) {
  input.addEventListener('change', () => act((s) => setPolicy(s, input.value)));
}
for (const button of speedButtons) {
  button.addEventListener('click', () => act((s) => setSpeed(s, Number(button.dataset.speed))));
}

const dialog = /** @type {HTMLDialogElement} */ ($('reset-dialog'));
for (const button of resetButtons) {
  button.addEventListener('click', () => {
    if (!session.canPlay) return;
    dialog.returnValue = '';
    dialog.showModal();
  });
}
dialog.addEventListener('close', () => {
  if (dialog.returnValue !== 'confirm' || !session.canPlay) return;
  session.commit(createState());
  session.save();
  $('make-clip').focus();
});

$('lang-toggle').addEventListener('click', () => {
  lang = lang === 'cs' ? 'en' : 'cs';
  if (session.shared) store.saveLang(lang);
  const url = new URL(window.location.href);
  url.searchParams.set('lang', lang);
  window.history.replaceState(window.history.state, '', url);
  applyLanguage();
});
window.addEventListener('popstate', () => {
  const next = readLanguage();
  if (next === lang) return;
  lang = next;
  applyLanguage();
});
$('continue-here').addEventListener('click', () => session.requestControl());

if (params.get('embed') === '1') document.body.classList.add('embed');
if (!motionEnabled) document.body.classList.add('motion-off');
$('mark-safe').style.left = `${CONFIG.safeWorld}%`;
$('mark-floor').style.left = `${CONFIG.protectFloor}%`;
applyLanguage();
reducedMotion.addEventListener('change', render);

let last = performance.now();
setInterval(() => {
  const now = performance.now();
  const real = Math.min((now - last) / 1000, MAX_REAL_SECONDS);
  last = now;
  if (!session.canPlay) return;
  const next = advance(state, real * state.speed);
  if (next === state) render();
  else session.commit(next);
}, TICK_MS);
setInterval(() => session.save(), SAVE_MS);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') session.save();
});
window.addEventListener('storage', (event) => {
  if (event.key === SAVE_KEY) session.refresh();
});
window.addEventListener('pagehide', (event) => {
  session.stop();
  if (!event.persisted) factoryScene.dispose();
});
window.addEventListener('pageshow', () => {
  last = performance.now();
  session.start();
});
session.start();

if (params.get('embed') === '1' && window.parent !== window) {
  const parentUrl = new URL(document.referrer || window.location.origin);
  const localParent = window.location.hostname === '127.0.0.1' && parentUrl.hostname === '127.0.0.1';
  if (parentUrl.origin === window.location.origin || localParent) {
    window.addEventListener('message', (event) => {
      if (event.source !== window.parent || event.origin !== parentUrl.origin ||
        event.data?.type !== 'little-ai:preferences' ||
        !['en', 'cs'].includes(event.data.lang) || typeof event.data.motion !== 'boolean') return;
      lang = event.data.lang;
      motionEnabled = event.data.motion;
      const url = new URL(window.location.href);
      url.searchParams.set('lang', lang);
      if (motionEnabled) url.searchParams.delete('motion');
      else url.searchParams.set('motion', 'off');
      window.history.replaceState(window.history.state, '', url);
      document.body.classList.toggle('motion-off', !motionEnabled);
      applyLanguage();
    });
    window.parent.postMessage({ type: 'little-clip-factory:ready' }, parentUrl.origin);
  }
}
