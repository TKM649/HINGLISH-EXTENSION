// cache.js — translated text ko cache karta hai.
// Scroll wapas upar / same site dobara visit → zero network requests.
//
// PERFORMANCE (yeh pehle ek bada bug tha): pehle har get/set poora cache object
// chrome.storage.local se padhta AUR wapas likhta tha. 30 segments ke ek batch
// me yeh 60+ full read/writes ban jate the — page visibly hang ho jata tha.
// Ab: sab kuch memory me hota hai, aur storage pe sirf debounced write jaata hai.

const CACHE_KEY = "hlCache";
const MAX_ENTRIES = 2000;
const PERSIST_DEBOUNCE_MS = 3000;

/** @type {Map<string, {v: string, t: number}> | null} */
let memoryCache = null;
let loadPromise = null;
let persistTimer = null;
let dirty = false;

// Storage se ek hi baar load hota hai (service worker ke poore lifetime me).
// Concurrent callers same promise share karte hain — double-load nahi hoti.
function ensureLoaded() {
  if (memoryCache) return Promise.resolve();
  if (loadPromise) return loadPromise;

  loadPromise = chrome.storage.local
    .get(CACHE_KEY)
    .then((data) => {
      memoryCache = new Map(Object.entries(data[CACHE_KEY] || {}));
    })
    .catch(() => {
      memoryCache = new Map(); // storage fail ho to bhi extension chalta rahe
    });

  return loadPromise;
}

/**
 * @param {string} key
 * @returns {Promise<string|undefined>}
 */
export async function getCached(key) {
  await ensureLoaded();
  const entry = memoryCache.get(hashKey(key));
  if (!entry) return undefined;
  entry.t = Date.now(); // LRU touch — sirf memory me, storage write nahi
  dirty = true;
  schedulePersist();
  return entry.v;
}

/**
 * @param {string} key
 * @param {string} value
 */
export async function setCached(key, value) {
  await ensureLoaded();
  memoryCache.set(hashKey(key), { v: value, t: Date.now() });
  dirty = true;
  schedulePersist();
}

// Debounced persist — ek batch ke 30 writes milke sirf 1 storage write banti hai.
function schedulePersist() {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    persist();
  }, PERSIST_DEBOUNCE_MS);
}

async function persist() {
  if (!dirty || !memoryCache) return;
  dirty = false;

  // Cap enforcement sirf yahan hota hai (har set pe sort karna mehnga tha).
  if (memoryCache.size > MAX_ENTRIES) {
    const sorted = [...memoryCache.entries()].sort((a, b) => a[1].t - b[1].t);
    for (const [key] of sorted.slice(0, memoryCache.size - MAX_ENTRIES)) {
      memoryCache.delete(key);
    }
  }

  try {
    await chrome.storage.local.set({ [CACHE_KEY]: Object.fromEntries(memoryCache) });
  } catch {
    // Storage full/unavailable — memory cache phir bhi kaam karta rahega.
  }
}

// Fast, non-cryptographic hash (djb2) — cache key ke liye kaafi hai, security
// ki zarurat nahi. Storage keys ko chhota aur consistent rakhta hai.
function hashKey(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}
