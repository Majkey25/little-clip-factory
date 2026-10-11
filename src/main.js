import './style.css';
import '@fontsource/nunito/latin-400.css';
import '@fontsource/nunito/latin-ext-400.css';
import '@fontsource/nunito/latin-700.css';
import '@fontsource/nunito/latin-ext-700.css';
import '@fontsource/nunito/latin-900.css';
import '@fontsource/nunito/latin-ext-900.css';
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
import { createStore } from './storage.js';

const TICK_MS = 200;
const SAVE_MS = 2000;
// Real seconds per tick are capped, so a sleeping tab never fast-forwards the world.
const MAX_REAL_SECONDS = 1;
const BELT_ICONS = 14;
const GRAPH = { left: 30, right: 310, top: 10, bottom: 130 };

const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));
const params = new URLSearchParams(window.location.search);
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const motionEnabled = params.get('motion') !== 'off';
const store = createStore();
const loaded = store.loadGame();

let state = loaded.state;
let lang = params.get('lang') === 'cs' || (!params.has('lang') && store.loadLang() === 'cs') ? 'cs' : 'en';
let storageNote = { blocked: 'storageBlocked', corrupt: 'storageCorrupt' }[loaded.status] ?? null;
let dirty = loaded.status !== 'loaded';
let manualUntil = 0;
let shownEnding = state.ending;
let logKey = '';
let fmt = makeFormatters();
let rules = makeRules();

function makeFormatters() {
  const locale = lang === 'cs' ? 'cs-CZ' : 'en-US';
  return {
    int: new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }),
    dec: new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }),
    money: new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' }),
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

function commit(next) {
  if (next === state) return;
  state = next;
  dirty = true;
  render();
}

function save() {
  if (!dirty) return;
  dirty = false;
  if (store.available && !store.saveGame(state)) {
    storageNote = 'storageFailed';
    renderStorageNote();
  }
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
  button.addEventListener('click', () => commit(buyUpgrade(state, id)));
  text.append(name, desc);
  item.append(text, button);
  $('research-list').append(item);
  return { id, item, name, desc, button };
});

function renderExplainer() {
  const list = $('explain-list');
  const open = new Set([...list.querySelectorAll('details')].flatMap((el, i) => (el.open ? [i] : [])));
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
}

function applyLanguage() {
  fmt = makeFormatters();
  rules = makeRules();
  document.documentElement.lang = lang;
  document.title = t('pageTitle');
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  $('robot').setAttribute('alt', t('robotAlt'));
  const toggle = $('lang-toggle');
  toggle.textContent = t('langToggle');
  toggle.setAttribute('aria-label', t('langToggleLabel'));
  toggle.setAttribute('lang', lang === 'cs' ? 'en' : 'cs');
  logKey = '';
  renderExplainer();
  renderStorageNote();
  render();
}

function renderStorageNote() {
  const note = $('storage-note');
  note.hidden = storageNote === null;
  note.textContent = storageNote ? t(storageNote) : '';
}

function setButton(id, text, enabled) {
  const button = /** @type {HTMLButtonElement} */ ($(id));
  button.textContent = text;
  button.disabled = !enabled;
}

function renderGraph() {
  const points = state.history.length ? state.history : [{ t: state.time, clips: state.clips, world: state.world }];
  const start = points[0].t;
  const span = Math.max(points.at(-1).t - start, 1);
  const clipMax = Math.max(CONFIG.target, ...points.map((p) => p.clips));
  const x = (time) => GRAPH.left + ((time - start) / span) * (GRAPH.right - GRAPH.left);
  const y = (share) => GRAPH.bottom - share * (GRAPH.bottom - GRAPH.top);
  const line = (share) => points.map((p) => `${x(p.t).toFixed(1)},${y(share(p)).toFixed(1)}`).join(' ');
  $('graph-clips').setAttribute('points', line((p) => p.clips / clipMax));
  $('graph-world').setAttribute('points', line((p) => p.world / 100));
  $('graph-desc').textContent = t('graphDesc', {
    time: clock(state.time),
    clips: count(state.clips),
    world: worldPct(state.world),
  });
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
  $('ending-title').textContent = ending.title;
  $('ending-text').textContent = fill(ending.text, { world: worldPct(state.world) });
  if (shownEnding !== state.ending) {
    shownEnding = state.ending;
    $('ending-title').focus();
  }
}

function render() {
  const s = state;
  const text = strings();
  const story = text.story[s.milestones.at(-1) ?? 'start'];
  $('phase-label').textContent = t('phaseLabel', { n: s.phase, name: t(`phase${s.phase}`) });
  $('story-title').textContent = story.title;
  $('story-text').textContent = fill(story.text);
  $('goal').textContent = t(`goal${s.phase}`);

  $('stat-clips').textContent = count(s.clips);
  $('stat-target').textContent = t('statTarget');
  $('stat-inventory').textContent = fmt.dec.format(s.inventory);
  $('stat-funds').textContent = money(s.funds);
  $('stat-wire').textContent = count(s.wire);

  const status = worldStatus(s.world);
  const gauge = $('world-gauge');
  const worldText = t('worldValue', { pct: worldPct(s.world), status: t(status) });
  $('world-value').textContent = worldText;
  gauge.setAttribute('aria-valuenow', s.world.toFixed(1));
  gauge.setAttribute('aria-valuetext', worldText);
  gauge.dataset.level = status;
  $('world-fill').style.width = `${s.world}%`;
  $('mark-safe').style.left = `${CONFIG.safeWorld}%`;
  $('mark-floor').style.left = `${CONFIG.protectFloor}%`;
  $('world-legend').textContent = t('worldLegend');

  setButton('make-clip', t('makeClip'), canMakeClip(s));
  setButton('sell', t('sell', { n: fmt.dec.format(s.inventory), money: money(s.inventory * clipPrice(s)) }), canSell(s));
  $('recover-wire').hidden = !canRecoverWire(s);
  $('recover-wire').textContent = t('recoverWire', { n: CONFIG.rescueWire });
  const batch = wireBatch(s) || CONFIG.spoolWire;
  const batchCost = (batch * spoolCost(s)) / CONFIG.spoolWire;
  setButton('buy-wire', t('buyWire', { n: batch, money: money(batchCost) }), canBuyWire(s));
  $('market-hint').textContent = t('marketHint', { price: money(clipPrice(s)) });
  setButton('buy-maker', t('buyMaker', { money: money(makerCost(s)) }), canBuyMaker(s));
  $('maker-info').textContent = t('makerInfo', { n: s.makers, rate: fmt.dec.format(makerRate(s)) });
  setButton('buy-harvester', t('buyHarvester', { money: money(harvesterCost(s)) }), canBuyHarvester(s));
  $('harvest-info').textContent = s.upgrades.drones
    ? t('harvestInfo', { n: s.harvesters, rate: fmt.dec.format(harvestRate(s)) })
    : t('harvestLocked');
  $('sell-info').textContent = s.upgrades.autoSell ? t('sellAuto', { rate: sellRate(s) }) : t('sellManual');

  for (const row of research) {
    const upgrade = text.upgrades[row.id];
    const label = s.upgrades[row.id]
      ? t('researchDone')
      : isUpgradeUnlocked(s, row.id)
        ? t('research', { money: money(UPGRADES[row.id].cost) })
        : t('researchLocked', { n: UPGRADES[row.id].phase });
    row.name.textContent = upgrade.name;
    row.desc.textContent = fill(upgrade.desc);
    row.button.textContent = label;
    row.button.disabled = !canBuyUpgrade(s, row.id);
    row.button.setAttribute('aria-label', `${upgrade.name}: ${label}`);
    row.item.classList.toggle('done', s.upgrades[row.id]);
  }

  for (const input of document.querySelectorAll('input[name="policy"]')) {
    input.checked = input.value === s.policy;
    input.disabled = Boolean(s.ending);
  }
  const run = /** @type {HTMLButtonElement} */ ($('toggle-run'));
  run.textContent = s.running ? t('pause') : t('resume');
  run.disabled = Boolean(s.ending);
  for (const button of document.querySelectorAll('[data-speed]')) {
    button.setAttribute('aria-pressed', String(Number(button.dataset.speed) === s.speed));
  }

  const busy = !s.ending && s.running;
  const conveyor = $('conveyor');
  conveyor.classList.toggle('moving', (busy && makerRate(s) > 0 && s.wire > 0) || performance.now() < manualUntil);
  conveyor.style.setProperty('--belt-duration', s.speed === 5 ? '2.5s' : '7s');
  $('robot').classList.toggle('working', busy && (s.makers > 0 || s.harvesters > 0));

  renderGraph();
  renderLog();
  renderEnding();
}

$('make-clip').addEventListener('click', () => {
  const next = makeClip(state);
  if (next === state) return;
  manualUntil = performance.now() + 700;
  if (motionEnabled && !reducedMotion.matches) {
    $('robot-wrap').animate([{ transform: 'scale(1)' }, { transform: 'scale(1.05) rotate(-2deg)' }, { transform: 'scale(1)' }], {
      duration: 260,
    });
  }
  commit(next);
});
$('sell').addEventListener('click', () => commit(sellInventory(state)));
$('buy-wire').addEventListener('click', () => commit(buyWire(state)));
$('recover-wire').addEventListener('click', () => commit(recoverWire(state)));
$('buy-maker').addEventListener('click', () => commit(buyMaker(state)));
$('buy-harvester').addEventListener('click', () => commit(buyHarvester(state)));
$('toggle-run').addEventListener('click', () => commit(setRunning(state, !state.running)));
for (const input of document.querySelectorAll('input[name="policy"]')) {
  input.addEventListener('change', () => commit(setPolicy(state, input.value)));
}
for (const button of document.querySelectorAll('[data-speed]')) {
  button.addEventListener('click', () => commit(setSpeed(state, Number(button.dataset.speed))));
}

const dialog = /** @type {HTMLDialogElement} */ ($('reset-dialog'));
for (const button of document.querySelectorAll('[data-action="reset"]')) {
  button.addEventListener('click', () => {
    dialog.returnValue = '';
    dialog.showModal();
  });
}
dialog.addEventListener('close', () => {
  if (dialog.returnValue !== 'confirm') return;
  store.clearGame();
  state = createState();
  dirty = true;
  save();
  render();
  $('make-clip').focus();
});

$('lang-toggle').addEventListener('click', () => {
  lang = lang === 'cs' ? 'en' : 'cs';
  store.saveLang(lang);
  params.set('lang', lang);
  window.history.replaceState(null, '', `?${params}${window.location.hash}`);
  applyLanguage();
});

if (params.get('embed') === '1') document.body.classList.add('embed');
if (!motionEnabled) document.body.classList.add('motion-off');
buildBelt();
applyLanguage();

let last = performance.now();
setInterval(() => {
  const now = performance.now();
  const real = Math.min((now - last) / 1000, MAX_REAL_SECONDS);
  last = now;
  const next = advance(state, real * state.speed);
  if (next === state) render();
  else commit(next);
}, TICK_MS);
setInterval(save, SAVE_MS);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') save();
});
window.addEventListener('pagehide', save);
