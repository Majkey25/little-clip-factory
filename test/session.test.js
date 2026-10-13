import assert from 'node:assert/strict';
import test from 'node:test';
import { advance, buyMaker, createState, makeClip, setPolicy, setRunning, CONFIG } from '../src/game.js';
import { createGameSession, createStore, SAVE_KEY } from '../src/storage.js';

const flush = () => new Promise((resolve) => setImmediate(resolve));

// The fixture models an exclusive browser lock, including queued aborts and promise-held ownership.
function lockManager() {
  let held = null;
  const queue = [];
  function drain() {
    if (held || queue.length === 0) return;
    const item = queue.shift();
    held = item;
    Promise.resolve().then(() => item.callback({ name: item.name, mode: 'exclusive' })).then(
      (value) => { held = null; item.resolve(value); drain(); },
      (error) => { held = null; item.reject(error); drain(); },
    );
  }
  return {
    request(name, options, callback) {
      if (options.ifAvailable && (held || queue.length > 0)) return Promise.resolve().then(() => callback(null));
      return new Promise((resolve, reject) => {
        const item = { name, callback, resolve, reject };
        options.signal?.addEventListener('abort', () => {
          const index = queue.indexOf(item);
          if (index < 0) return;
          queue.splice(index, 1);
          reject(new DOMException('Aborted', 'AbortError'));
        }, { once: true });
        queue.push(item);
        drain();
      });
    },
    query() {
      const info = (item) => ({ name: item.name, mode: 'exclusive', clientId: 'fixture' });
      return Promise.resolve({ held: held ? [info(held)] : [], pending: queue.map(info) });
    },
  };
}

function fixture(t) {
  let saved = createState();
  let failWrites = false;
  let blockReads = false;
  let writes = 0;
  const peers = new Set();
  const sessions = [];
  const store = {
    available: true,
    loadGame: () => blockReads
      ? { state: createState(), status: 'blocked' }
      : { state: structuredClone(saved), status: 'loaded' },
    saveGame(state) {
      writes += 1;
      if (failWrites) return false;
      saved = structuredClone(state);
      return true;
    },
  };
  const locks = lockManager();
  const query = locks.query;
  function channelFactory() {
    const channel = {
      onmessage: null,
      postMessage(data) {
        for (const peer of peers) {
          if (peer !== channel) queueMicrotask(() => peer.onmessage?.({ data: structuredClone(data) }));
        }
      },
      close() { peers.delete(channel); channel.onmessage = null; },
    };
    peers.add(channel);
    return channel;
  }
  t.after(() => sessions.forEach((session) => session.stop()));
  return {
    get saved() { return saved; },
    get writes() { return writes; },
    set failWrites(value) { failWrites = value; },
    set blockReads(value) { blockReads = value; },
    set failQuery(value) {
      locks.query = value ? () => Promise.reject(new DOMException('Blocked', 'SecurityError')) : query;
    },
    deferQuery() {
      let reply;
      locks.query = () => {
        const snapshot = query();
        return new Promise((resolve) => { reply = () => snapshot.then(resolve); });
      };
      return () => { locks.query = query; reply?.(); };
    },
    session(options = {}, sessionStore = store) {
      const session = createGameSession(sessionStore, { locks, channelFactory, onChange() {}, ...options });
      sessions.push(session);
      return session;
    },
  };
}

test('a paused secondary cannot overwrite purchases or undo a reset', async (t) => {
  const f = fixture(t);
  const owner = f.session();
  const secondary = f.session();
  owner.start();
  secondary.start();
  await flush();
  assert.equal(owner.status, 'active');
  assert.equal(secondary.status, 'readonly');
  owner.commit(buyMaker(owner.state));
  owner.commit(setRunning(owner.state, false));
  assert.equal(secondary.commit(advance(secondary.state, 2)), false);
  assert.equal(secondary.commit(makeClip(secondary.state)), false);
  secondary.save();
  assert.equal(f.writes, 0);
  owner.save();
  secondary.refresh();
  assert.equal(secondary.state.makers, 1);
  assert.equal(secondary.state.funds, 10);
  assert.equal(secondary.state.running, false);
  owner.commit(createState());
  owner.save();
  secondary.save();
  secondary.refresh();
  assert.equal(secondary.state.makers, 0);
  assert.equal(f.saved.funds, 15);
});

test('handoff flushes unsaved purchases and reloads before the new owner can act', async (t) => {
  const f = fixture(t);
  const first = f.session();
  const second = f.session();
  first.start();
  second.start();
  await flush();
  first.commit(buyMaker(first.state));
  second.requestControl();
  await flush();
  assert.equal(first.status, 'readonly');
  assert.equal(second.status, 'active');
  assert.equal(second.state.makers, 1);
  assert.equal(second.state.funds, 10);
  assert.equal(first.commit(makeClip(first.state)), false);
  second.commit(makeClip(second.state));
  second.stop();
  first.requestControl();
  await flush();
  assert.equal(first.status, 'active');
  assert.equal(first.state.clips, 1);
  assert.equal(first.state.makers, 1);
});

test('simultaneous queued handoffs reach every requester without a second click', async (t) => {
  const f = fixture(t);
  const first = f.session();
  const second = f.session();
  const third = f.session();
  first.start();
  second.start();
  third.start();
  await flush();
  first.commit(buyMaker(first.state));
  second.requestControl();
  third.requestControl();
  await flush();
  assert.equal(first.status, 'readonly');
  assert.equal(second.status, 'readonly');
  assert.equal(third.status, 'active');
  assert.equal(third.state.makers, 1);
  assert.equal(third.state.funds, 10);
  assert.equal(first.commit(makeClip(first.state)), false);
  assert.equal(second.commit(makeClip(second.state)), false);
});

test('failed saves retry without another action and clear their warning after success', async (t) => {
  const f = fixture(t);
  const session = f.session();
  session.start();
  await flush();
  const near = { ...createState(), clips: CONFIG.target - 1 };
  session.commit(makeClip(setPolicy(near, 'protect')));
  assert.equal(session.state.ending, 'safe');
  f.failWrites = true;
  assert.equal(session.save(), false);
  assert.equal(session.note, 'storageFailed');
  assert.equal(session.commit(advance(session.state, 2)), false);
  f.failWrites = false;
  assert.equal(session.save(), true);
  assert.equal(f.saved.ending, 'safe');
  assert.equal(session.note, null);
  const writes = f.writes;
  session.save();
  assert.equal(f.writes, writes);
});

test('a failed handoff keeps the current owner and its unsaved progress', async (t) => {
  const f = fixture(t);
  const first = f.session();
  const second = f.session();
  first.start();
  second.start();
  await flush();
  first.commit(buyMaker(first.state));
  f.failWrites = true;
  second.requestControl();
  await flush();
  assert.equal(first.status, 'active');
  assert.equal(first.state.makers, 1);
  assert.equal(first.note, 'storageFailed');
  assert.equal(second.status, 'readonly');
  assert.equal(second.note, 'sessionTransferFailed');
  f.failWrites = false;
  second.requestControl();
  await flush();
  assert.equal(second.status, 'active');
  assert.equal(second.state.makers, 1);
});

test('pagehide cancels a queued takeover and a cached page reloads newer progress', async (t) => {
  const f = fixture(t);
  const first = f.session();
  const second = f.session();
  first.start();
  second.start();
  await flush();
  second.requestControl();
  second.stop();
  await flush();
  assert.equal(second.status, 'closed');
  assert.equal(first.status, 'active');
  first.commit(buyMaker(first.state));
  first.stop();
  await flush();
  second.start();
  await flush();
  assert.equal(second.status, 'active');
  second.commit(makeClip(second.state));
  second.save();
  first.start();
  await flush();
  assert.equal(first.status, 'readonly');
  assert.equal(first.state.makers, 1);
  assert.equal(first.state.clips, 1);
});

test('an unsaved cached page keeps its own session without overwriting the shared save', async (t) => {
  const f = fixture(t);
  const session = f.session();
  session.start();
  await flush();
  session.commit(buyMaker(session.state));
  f.failWrites = true;
  session.stop();
  f.failWrites = false;
  session.start();
  assert.equal(session.status, 'local');
  assert.equal(session.state.makers, 1);
  session.commit(makeClip(session.state));
  session.save();
  assert.equal(f.saved.makers, 0);
  assert.equal(f.saved.clips, 0);
});

test('unsupported coordination permits page-only play without changing an existing save', (t) => {
  const f = fixture(t);
  for (const missing of [{ locks: undefined }, { channelFactory: undefined }]) {
    const session = f.session(missing);
    session.start();
    assert.equal(session.status, 'local');
    assert.equal(session.note, 'sessionUnavailable');
    assert.equal(session.commit(buyMaker(session.state)), true);
    session.save();
    session.stop();
    session.start();
    assert.equal(session.state.makers, 1);
  }
  assert.equal(f.writes, 0);
  assert.equal(f.saved.makers, 0);
});

test('a failed read during handoff never replaces an unreadable save with a fresh game', async (t) => {
  const f = fixture(t);
  const first = f.session();
  const second = f.session();
  first.start();
  second.start();
  await flush();
  first.commit(buyMaker(first.state));
  f.blockReads = true;
  second.requestControl();
  await flush();
  assert.equal(second.status, 'local');
  assert.equal(second.note, 'storageBlocked');
  assert.equal(f.saved.makers, 1);
  const writes = f.writes;
  second.commit(makeClip(second.state));
  second.save();
  assert.equal(f.writes, writes);
  assert.equal(f.saved.makers, 1);
});

test('the actual store preserves newer-version saves and rejects malformed version claims', async (t) => {
  const f = fixture(t);
  const values = new Map();
  const localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage } });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'window', previous);
    else delete globalThis.window;
  });
  const future = JSON.stringify({ ...createState(), version: CONFIG.schemaVersion + 1, makers: 9 });
  values.set(SAVE_KEY, future);
  const store = createStore();
  assert.equal(store.loadGame().status, 'newer');
  values.set(SAVE_KEY, JSON.stringify(createState()));
  const session = f.session({}, store);
  values.set(SAVE_KEY, future);
  session.start();
  await flush();
  assert.equal(session.status, 'local');
  assert.equal(session.note, 'storageNewer');
  session.commit(buyMaker(session.state));
  session.save();
  session.stop();
  assert.equal(values.get(SAVE_KEY), future);
  for (const invalid of [
    { version: String(CONFIG.schemaVersion + 1) },
    { version: CONFIG.schemaVersion + 0.5 },
    { version: Number.MAX_SAFE_INTEGER + 1 },
    { version: CONFIG.schemaVersion + 1, payload: 'x'.repeat(200_000) },
  ]) {
    values.set(SAVE_KEY, JSON.stringify(invalid));
    assert.equal(store.loadGame().status, 'corrupt');
  }
});

test('a full but readable store restores progress and refuses a failed save handoff', async (t) => {
  const f = fixture(t);
  let raw = JSON.stringify(buyMaker(createState()));
  const original = raw;
  let full = true;
  const localStorage = {
    getItem: (key) => key === SAVE_KEY ? raw : null,
    setItem(key, value) {
      if (full) throw new DOMException('Full', 'QuotaExceededError');
      if (key === SAVE_KEY) raw = value;
    },
    removeItem() {},
  };
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage } });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'window', previous);
    else delete globalThis.window;
  });
  const store = createStore();
  assert.equal(store.loadGame().status, 'loaded');
  assert.equal(store.loadGame().state.makers, 1);
  const first = f.session({}, store);
  const second = f.session({}, store);
  first.start();
  second.start();
  await flush();
  first.commit(makeClip(first.state));
  second.requestControl();
  await flush();
  assert.equal(first.status, 'active');
  assert.equal(first.note, 'storageFailed');
  assert.equal(second.status, 'readonly');
  assert.equal(raw, original);
  full = false;
  assert.equal(first.save(), true);
  second.requestControl();
  await flush();
  assert.equal(second.status, 'active');
  assert.equal(second.state.makers, 1);
  assert.equal(second.state.clips, 1);
});

test('a failed lock query does not demote the active owner', async (t) => {
  const f = fixture(t);
  const first = f.session();
  const second = f.session();
  first.start();
  second.start();
  await flush();
  first.commit(buyMaker(first.state));
  f.failQuery = true;
  second.requestControl();
  await flush();
  assert.equal(first.status, 'active');
  assert.equal(second.status, 'waiting');
  assert.equal(first.commit(makeClip(first.state)), true);
  first.save();
  assert.equal(f.saved.makers, 1);
  assert.equal(f.saved.clips, 1);
});

test('a late query result cannot release a cached page\'s new ownership', async (t) => {
  const f = fixture(t);
  const first = f.session();
  const second = f.session();
  first.start();
  second.start();
  await flush();
  first.commit(buyMaker(first.state));
  const reply = f.deferQuery();
  second.requestControl();
  await flush();
  assert.equal(first.status, 'active');
  assert.equal(second.status, 'waiting');
  first.stop();
  await flush();
  assert.equal(second.status, 'active');
  second.stop();
  await flush();
  first.start();
  await flush();
  assert.equal(first.status, 'active');
  reply();
  await flush();
  assert.equal(first.status, 'active');
  assert.equal(first.state.makers, 1);
});
