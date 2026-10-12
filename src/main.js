import './style.css';
import '@fontsource/nunito/400.css';
import '@fontsource/nunito/700.css';
import '@fontsource/nunito/900.css';
import {
  canRecoverWire,
  recoverWire,
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
  canSell,
  clipPrice,
  createState,
  harvestRate,
  harvesterCost,
  isUpgradeUnlocked,
  makeClip,
  makerCost,
  makerRate,
  sellInventory,
  sellRate,
  setPolicy,
  setRunning,
  setSpeed,
  spoolCost,
  wireBatch,
} from './game.js';
import { STRINGS } from './i18n.js';
import { createGameSession, createStore, SAVE_KEY } from './storage.js';

const TICK_MS = 200;
const SAVE_MS = 2000;
// Real seconds per tick are capped, so a sleeping tab never fast-forwards the world.
const MAX_REAL_SECONDS = 1;
const BELT_ICONS = 14;
const GRAPH = { left: 38, right: 310, top: 10, bottom: 130 };

const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));
const params = new URLSearchParams(window.location.search);
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const motionEnabled = params.get('motion') !== 'off';
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
let manualUntil = 0;
let shownEnding = state.ending;
let logKey = '';
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

// Static parts: belt icons and research rows are created once.
function buildBelt() {
  const belt = $('belt');
  for (let i = 0; i < BELT_ICONS * 2; i += 1) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', '#clip-icon');
    svg.setAttribute('class', `belt-clip tone-${i % 3}`);
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.append(use);
    belt.append(svg);
  }
}

const research = UPGRADE_IDS.map((id) => {
  const item = document.createElement('li');
  const text = document.createElement('div');
  const name = document.createElement('strong');
  const desc = document.createElement('p');
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn small';
  button.addEventListener('click', () => act((s) => buyUpgrade(s, id)));
  text.append(name, desc);
  item.append(text, button);
  $('research-list').append(item);
  return { id, item, name, desc, button };
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
  $('robot').setAttribute('alt', t('robotAlt'));
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
  const story = text.story[s.milestones.at(-1) ?? 'start'];
  setText('phase-label', t('phaseLabel', { n: s.phase, name: t(`phase${s.phase}`) }));
  setText('story-title', story.title);
  setText('story-text', fill(story.text));
  setText('goal', t(`goal${s.phase}`));

  setText('stat-clips', fmt.dec.format(s.clips));
  setText('stat-target', t('statTarget'));
  setText('stat-inventory', fmt.dec.format(s.inventory));
  setText('stat-funds', money(s.funds));
  setText('stat-wire', count(s.wire));

  const status = worldStatus(s.world);
  const gauge = $('world-gauge');
  const worldText = t('worldValue', { pct: worldPct(s.world), status: t(status) });
  setText('world-value', worldText);
  gauge.setAttribute('aria-valuenow', String(s.world));
  gauge.setAttribute('aria-valuetext', worldText);
  gauge.dataset.level = status;
  $('world-fill').style.width = `${s.world}%`;
  $('mark-safe').style.left = `${CONFIG.safeWorld}%`;
  $('mark-floor').style.left = `${CONFIG.protectFloor}%`;
  setText('world-legend', t('worldLegend'));

  setButton('make-clip', t('makeClip'), canMakeClip(s));
  setButton('sell', t('sell', { n: fmt.dec.format(s.inventory), money: money(s.inventory * clipPrice(s)) }), canSell(s));
  $('recover-wire').hidden = !canRecoverWire(s);
  setText('recover-wire', t('recoverWire', { n: CONFIG.rescueWire }));
  $('recover-wire').disabled = !session.canPlay;
  const batch = wireBatch(s) || CONFIG.spoolWire;
  const batchCost = (batch * spoolCost(s)) / CONFIG.spoolWire;
  setButton('buy-wire', t('buyWire', { n: batch, money: money(batchCost) }), canBuyWire(s));
  setText('market-hint', t('marketHint', { price: fmt.price.format(clipPrice(s)) }));
  setButton('buy-maker', t('buyMaker', { money: money(makerCost(s)) }), canBuyMaker(s));
  setText('maker-info', t('makerInfo', { n: s.makers, rate: fmt.dec.format(makerRate(s)) }));
  setButton('buy-harvester', t('buyHarvester', { money: money(harvesterCost(s)) }), canBuyHarvester(s));
  setText('harvest-info', s.upgrades.drones
    ? t('harvestInfo', { n: s.harvesters, rate: fmt.dec.format(harvestRate(s)) })
    : t('harvestLocked'));
  setText('sell-info', s.upgrades.autoSell ? t('sellAuto', { rate: sellRate(s) }) : t('sellManual'));

  for (const row of research) {
    const upgrade = text.upgrades[row.id];
    const label = s.upgrades[row.id]
      ? t('researchDone')
      : isUpgradeUnlocked(s, row.id)
        ? t('research', { money: money(UPGRADES[row.id].cost) })
        : t('researchLocked', { n: UPGRADES[row.id].phase });
    setText(row.name, upgrade.name);
    setText(row.desc, fill(upgrade.desc));
    setText(row.button, label);
    row.button.disabled = !session.canPlay || !canBuyUpgrade(s, row.id);
    row.button.setAttribute('aria-label', `${upgrade.name}: ${label}`);
    row.item.classList.toggle('done', s.upgrades[row.id]);
  }

  for (const input of document.querySelectorAll('input[name="policy"]')) {
    input.checked = input.value === s.policy;
    input.disabled = !session.canPlay || Boolean(s.ending);
  }
  const run = /** @type {HTMLButtonElement} */ ($('toggle-run'));
  setText(run, s.running ? t('pause') : t('resume'));
  run.disabled = !session.canPlay || Boolean(s.ending);
  for (const button of document.querySelectorAll('[data-speed]')) {
    button.setAttribute('aria-pressed', String(Number(button.dataset.speed) === s.speed));
    button.disabled = !session.canPlay || Boolean(s.ending);
  }
  for (const button of document.querySelectorAll('[data-action="reset"]')) {
    button.disabled = !session.canPlay;
  }

  const busy = session.canPlay && !s.ending && s.running;
  const conveyor = $('conveyor');
  conveyor.classList.toggle('moving', (busy && makerRate(s) > 0 && s.wire > 0) || performance.now() < manualUntil);
  conveyor.style.setProperty('--belt-duration', s.speed === 5 ? '2.5s' : '7s');
  $('robot').classList.toggle('working', busy && (s.makers > 0 || s.harvesters > 0));

  renderGraph();
  renderLog();
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
  if (!session.canPlay) return;
  if (canMakeClip(state)) manualUntil = performance.now() + 700;
  act(makeClip, '#robot-wrap', '#stat-clips', '.flow-clip');
});
$('sell').addEventListener('click', () => act(sellInventory, '#stat-funds', '.flow-funds'));
$('buy-wire').addEventListener('click', () => act(buyWire, '#stat-wire', '.flow-wire'));
$('recover-wire').addEventListener('click', () => act(recoverWire));
$('buy-maker').addEventListener('click', () => act(buyMaker));
$('buy-harvester').addEventListener('click', () => act(buyHarvester));
$('toggle-run').addEventListener('click', () => act((s) => setRunning(s, !s.running)));
for (const input of document.querySelectorAll('input[name="policy"]')) {
  input.addEventListener('change', () => act((s) => setPolicy(s, input.value)));
}
for (const button of document.querySelectorAll('[data-speed]')) {
  button.addEventListener('click', () => act((s) => setSpeed(s, Number(button.dataset.speed))));
}

const dialog = /** @type {HTMLDialogElement} */ ($('reset-dialog'));
for (const button of document.querySelectorAll('[data-action="reset"]')) {
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
buildBelt();
applyLanguage();

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
window.addEventListener('pagehide', () => session.stop());
window.addEventListener('pageshow', () => {
  last = performance.now();
  session.start();
});
session.start();
