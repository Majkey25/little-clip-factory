import { createState, restoreState } from './game.js';

const SAVE_KEY = 'little-clip-factory:save';
const LANG_KEY = 'little-clip-factory:lang';
const PROBE_KEY = 'little-clip-factory:probe';
// A real save is a few kilobytes; anything far larger is treated as corrupt.
const MAX_SAVE_CHARS = 200_000;

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

    /** @returns {{ state: import('./game.js').GameState, status: 'new' | 'loaded' | 'corrupt' | 'blocked' }} */
    loadGame() {
      if (!storage) return { state: createState(), status: 'blocked' };
      try {
        const raw = storage.getItem(SAVE_KEY);
        if (raw === null) return { state: createState(), status: 'new' };
        const state = raw.length <= MAX_SAVE_CHARS ? restoreState(JSON.parse(raw)) : null;
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

    clearGame() {
      try {
        storage?.removeItem(SAVE_KEY);
      } catch {
        // Nothing to clear when storage is gone.
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
