import { CONFIG, createState, restoreState } from './game.js';

export const SAVE_KEY = 'little-clip-factory:save';
const LANG_KEY = 'little-clip-factory:lang';
const PROBE_KEY = 'little-clip-factory:probe';
// A real save is a few kilobytes; anything far larger is treated as corrupt.
const MAX_SAVE_CHARS = 200_000;
const HANDOFF_WAIT_MS = 10_000;

// Private browsing or strict settings can make localStorage throw on access.
function openStorage() {
  try {
    const storage = window.localStorage;
    storage.setItem(PROBE_KEY, '1');
    storage.removeItem(PROBE_KEY);
    return storage;
  } catch {
    return null;
  }
}

export function createStore() {
  const storage = openStorage();
  return {
    available: storage !== null,

    /** @returns {{ state: import('./game.js').GameState, status: 'new' | 'loaded' | 'corrupt' | 'blocked' | 'newer' }} */
    loadGame() {
      if (!storage) return { state: createState(), status: 'blocked' };
      let raw;
      try {
        raw = storage.getItem(SAVE_KEY);
      } catch {
        return { state: createState(), status: 'blocked' };
      }
      if (raw === null) return { state: createState(), status: 'new' };
      try {
        /** @type {unknown} */
        const parsed = raw.length <= MAX_SAVE_CHARS ? JSON.parse(raw) : null;
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) &&
          'version' in parsed && typeof parsed.version === 'number' &&
          Number.isSafeInteger(parsed.version) && parsed.version > CONFIG.schemaVersion) {
          return { state: createState(), status: 'newer' };
        }
        const state = restoreState(parsed);
        if (state) return { state, status: 'loaded' };
      } catch {
        // Unreadable JSON falls through to a fresh game.
      }
      return { state: createState(), status: 'corrupt' };
    },

    /** @returns {boolean} */
    saveGame(state) {
      if (!storage) return false;
      try {
        storage.setItem(SAVE_KEY, JSON.stringify(state));
        return true;
      } catch {
        return false;
      }
    },

    /** @returns {string | null} */
    loadLang() {
      try {
        return storage?.getItem(LANG_KEY) ?? null;
      } catch {
        return null;
      }
    },

    saveLang(lang) {
      try {
        storage?.setItem(LANG_KEY, lang);
      } catch {
        // The language preference is optional.
      }
    },
  };
}

/**
 * One owner advances and saves; other tabs observe or request a saved handoff.
 * @param {Pick<ReturnType<typeof createStore>, 'available' | 'loadGame' | 'saveGame'>} store
 * @param {{ locks?: LockManager, channelFactory?: () => BroadcastChannel, onChange: () => void }} options
 */
export function createGameSession(store, { locks, channelFactory, onChange }) {
  let loaded = store.loadGame();
  let state = loaded.state;
  let note = loadNote(loaded.status);
  let dirty = loaded.status !== 'loaded';
  /** @type {'closed' | 'connecting' | 'active' | 'readonly' | 'waiting' | 'local'} */
  let status = 'closed';
  /** @type {BroadcastChannel | null} */
  let channel = null;
  /** @type {{ controller: AbortController, release: (() => void) | null, timer: ReturnType<typeof setTimeout> | null } | null} */
  let request = null;
  let preserveLocal = false;

  function reload() {
    loaded = store.loadGame();
    note = loadNote(loaded.status);
    if (loaded.status === 'blocked' || loaded.status === 'newer') return;
    state = loaded.state;
    dirty = loaded.status !== 'loaded';
  }

  function clearRequest() {
    const previous = request;
    request = null;
    if (!previous) return;
    if (previous.timer !== null) clearTimeout(previous.timer);
    previous.controller.abort();
    previous.release?.();
  }

  /** @param {boolean} ifAvailable */
  function claim(ifAvailable) {
    if (!locks) return;
    /** @type {NonNullable<typeof request>} */
    const next = { controller: new AbortController(), release: null, timer: null };
    request = next;
    if (!ifAvailable) {
      next.timer = setTimeout(() => {
        if (request !== next) return;
        clearRequest();
        status = 'readonly';
        note = 'sessionTransferFailed';
        onChange();
      }, HANDOFF_WAIT_MS);
    }
    const options = ifAvailable ? { ifAvailable: true } : { signal: next.controller.signal };
    locks.request(SAVE_KEY, options, (lock) => {
      if (request !== next) return;
      if (next.timer !== null) clearTimeout(next.timer);
      if (!lock) {
        reload();
        request = null;
        status = 'readonly';
        onChange();
        return;
      }
      reload();
      if (loaded.status === 'blocked' || loaded.status === 'newer') {
        clearRequest();
        channel?.close();
        channel = null;
        status = 'local';
        onChange();
        return;
      }
      status = 'active';
      onChange();
      return new Promise((resolve) => { next.release = () => resolve(undefined); });
    }).catch(() => {
      if (request !== next) return;
      clearRequest();
      channel?.close();
      channel = null;
      status = 'local';
      note = 'sessionUnavailable';
      onChange();
    });
  }

  const session = {
    get state() { return state; },
    get status() { return status; },
    get note() { return note; },
    get canPlay() { return status === 'active' || status === 'local'; },
    get shared() { return status !== 'local' && status !== 'closed'; },

    start() {
      if (status !== 'closed') return;
      if (preserveLocal || !store.available || loaded.status === 'blocked' || loaded.status === 'newer' || !locks || !channelFactory) {
        status = 'local';
        if (!preserveLocal && store.available && loaded.status !== 'blocked' && loaded.status !== 'newer') note = 'sessionUnavailable';
        onChange();
        return;
      }
      try {
        channel = channelFactory();
      } catch {
        status = 'local';
        note = 'sessionUnavailable';
        onChange();
        return;
      }
      channel.onmessage = async ({ data }) => {
        if (data?.type === 'handoff' && status === 'active') {
          const owner = request;
          let pending;
          try {
            const snapshot = await locks.query();
            pending = snapshot.pending.some((lock) => lock.name === SAVE_KEY && lock.mode === 'exclusive');
          } catch {
            return;
          }
          if (status !== 'active' || request !== owner || !pending) return;
          if (!session.save()) {
            channel?.postMessage({ type: 'failed' });
            return;
          }
          status = 'readonly';
          clearRequest();
          onChange();
        } else if (data?.type === 'failed' && status === 'waiting') {
          clearRequest();
          status = 'readonly';
          note = 'sessionTransferFailed';
          onChange();
        }
      };
      status = 'connecting';
      onChange();
      claim(true);
    },

    requestControl() {
      if (status !== 'readonly' || request || !channel) return;
      status = 'waiting';
      note = null;
      onChange();
      claim(false);
      channel.postMessage({ type: 'handoff' });
    },

    /** @param {import('./game.js').GameState} next */
    commit(next) {
      if (!session.canPlay || next === state) return false;
      state = next;
      dirty = true;
      onChange();
      return true;
    },

    save() {
      if (status !== 'active' || !dirty) return true;
      if (!store.saveGame(state)) {
        note = 'storageFailed';
        onChange();
        return false;
      }
      dirty = false;
      if (note === 'storageFailed') {
        note = null;
        onChange();
      }
      return true;
    },

    refresh() {
      if (status !== 'readonly' && status !== 'waiting') return;
      reload();
      if (loaded.status === 'newer') {
        clearRequest();
        channel?.close();
        channel = null;
        status = 'local';
      }
      onChange();
    },

    stop() {
      if (status === 'closed') return;
      preserveLocal = status === 'local' || !session.save();
      status = 'closed';
      clearRequest();
      channel?.close();
      channel = null;
      onChange();
    },
  };
  return session;
}

/** @param {'new' | 'loaded' | 'corrupt' | 'blocked' | 'newer'} status @returns {string | null} */
function loadNote(status) {
  if (status === 'newer') return 'storageNewer';
  return status === 'blocked' ? 'storageBlocked' : status === 'corrupt' ? 'storageCorrupt' : null;
}
