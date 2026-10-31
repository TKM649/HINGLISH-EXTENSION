// background.js — service worker. Saari network calls yahin hoti hain
// (content script CORS ke andar hai, isliye fetch() waha nahi ho sakta).
//
// Mode A: Google Translate (bina key) + hinglishify() rules.
// Mode B: Gemini (free key) — primary jab key available ho, warna Mode A.

import { hinglishify } from "./hinglishify.js";
import { getCached, setCached } from "./cache.js";
import { SYSTEM_INSTRUCTION, RESPONSE_SCHEMA, buildPrompt, parseGeminiResponse } from "./gemini.js";
import { checkSafety } from "./safety.js";

const GOOGLE_ENDPOINT = "https://translate.googleapis.com/translate_a/single";
const SPLIT_MARKER = "zzsplitzz"; // segments ko join karne ka marker — live-tested,
// Google isse untouched chhod deta hai dono translation aur romanization me.

// ---- Mode A: Google Translate (bina key) ----
//
// Batching note (live testing se pata chala): repeated `q=a&q=b` params
// KAAM NAHI KARTE — Google sirf akhri q translate karta hai. Isliye saare
// segments ko ek hi `q` me SPLIT_MARKER se jodte hain, phir wapas split karte hain.
// Agar split count match nahi karta (Google ne marker ko translate/tod diya —
// live dekha: PDF me aadhe sentence pe tooti lines "plan on zzsplitzz Sunday
// night" ko Google jod deta hai), to pehle poori batch fail ho jaati thi aur
// Basic mode me poora page English reh jaata tha. Ab batch ko aadha-aadha karke
// dobara bhejte hain; akela segment bhi fail ho tabhi null (caller original
// text pe rehta hai). Google Translate free hai, extra requests ka quota nahi.
export async function translateGoogleRaw(texts) {
  if (texts.length === 0) return [];
  const parts = await translateGoogleJoined(texts);
  if (parts) return parts;
  if (texts.length === 1) return [null];
  const mid = Math.ceil(texts.length / 2);
  const [left, right] = await Promise.all([
    translateGoogleRaw(texts.slice(0, mid)),
    translateGoogleRaw(texts.slice(mid)),
  ]);
  return [...left, ...right];
}

async function translateGoogleJoined(texts) {

  const joined = texts.join(` ${SPLIT_MARKER} `);

  const url = new URL(GOOGLE_ENDPOINT);
  url.searchParams.set("client", "gtx");
  url.searchParams.set("sl", "auto");
  url.searchParams.set("tl", "hi");
  url.searchParams.append("dt", "t");
  url.searchParams.append("dt", "rm");
  url.searchParams.set("q", joined);

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`Google Translate ${res.status}`);
  }
  const data = await res.json();

  const romanized = extractRomanization(data);
  const parts = romanized.split(SPLIT_MARKER).map((p) => p.trim());

  // Split count match nahi = yeh batch bharose layak nahi (upar wala caller tod ke retry karega)
  if (parts.length !== texts.length || parts.some((p) => !p)) return null;
  return parts;
}

// Google ka response undocumented nested array hai, aur shape thodi badalti
// rehti hai. Live testing se pattern mila: romanization ek array me hoti hai
// jiska shape `[null, null, "roman text"]` hota hai (pehle do items null/falsy,
// teesra ek non-empty string). Isliye poore tree me recursively yeh pattern
// dhoondte hain — hardcoded index path pe bharosa nahi karte, taaki Google
// thoda shape badle to bhi na tute.
export function extractRomanization(data) {
  const found = findRomanizationNode(data, 0);
  return found || "";
}

function findRomanizationNode(node, depth) {
  if (depth > 8 || node == null) return null;

  if (Array.isArray(node)) {
    // Direct match: [null, null, "roman text", ...]
    if (
      node.length >= 3 &&
      !node[0] &&
      !node[1] &&
      typeof node[2] === "string" &&
      node[2].length > 0
    ) {
      return node[2];
    }
    for (const child of node) {
      const result = findRomanizationNode(child, depth + 1);
      if (result) return result;
    }
  }
  return null;
}

// Cache ke saath Mode A: pehle cache check, phir jo bacha usi ke liye API call.
// Content script formatting ke liye <0>...</0> aur <1/> jaise markers bhejta
// hai. Pehle Mode A inhe hata deta tha (links/bold plain ban jaate the). 29 Oct
// 2026 ko live naapa: Google Translate inhe Hindi aur romanization dono me
// sahi jagah (word order badalne pe bhi) rakhta hai — isliye ab bhejte hain.
// Kabhi marker toot bhi jaye to content.js ka parser fallback sambhal leta hai.
// stripLinkMarkers sirf purane tests/helpers ke liye bacha hai.
export function stripLinkMarkers(text) {
  return text.replace(/<(\d+)>([\s\S]*?)<\/\1>/g, "$2");
}

async function translateGoogle(segments) {
  const results = new Array(segments.length);
  const toFetch = []; // { index, text, cacheKey }

  for (let i = 0; i < segments.length; i++) {
    const text = segments[i].text;
    const cacheKey = `A:${text}`;
    const cached = await getCached(cacheKey);
    if (cached !== undefined) {
      results[i] = { id: segments[i].id, text: cached, ok: true };
    } else {
      toFetch.push({ index: i, text, cacheKey });
    }
  }

  if (toFetch.length > 0) {
    const rawParts = await translateGoogleRaw(toFetch.map((t) => t.text));
    for (let j = 0; j < toFetch.length; j++) {
      const { index, text, cacheKey } = toFetch[j];
      const raw = rawParts[j];
      if (raw === null) {
        results[index] = { id: segments[index].id, text, ok: false };
        continue;
      }
      const finalText = hinglishify(raw);
      await setCached(cacheKey, finalText);
      results[index] = { id: segments[index].id, text: finalText, ok: true };
    }
  }

  return results;
}

// ---- Mode B: Gemini (free key) ----

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";
const GEMINI_MODEL_CACHE_KEY = "geminiModelCache"; // chrome.storage.local: { model, ts }
const GEMINI_MODEL_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 1 din
const GEMINI_MAX_RPM = 10; // free tier ~15 RPM hoti hai, thoda margin rakha
const GEMINI_TIMEOUT_MS = 25_000; // 3.5-flash-lite 20 segments ~3s me deta hai; 25s = bahut margin
const GEMINI_COOLDOWN_MS = 2 * 60 * 1000; // repeated failure ke baad 2 min ke liye Mode A pe hi raho

// In-memory state — service worker restart pe reset ho jati hai, jo theek hai
// (yeh sirf ek soft safety margin hai, correctness ke liye zaroori nahi).
let geminiCooldownUntil = 0;
const geminiRequestTimestamps = [];

class GeminiUnavailableError extends Error {}

async function getGeminiApiKey() {
  const { geminiApiKey } = await chrome.storage.local.get("geminiApiKey");
  return geminiApiKey || null;
}

// Model discovery. Yeh pehle buggy tha: ListModels se jo bhi pehla "flash-lite"
// milta tha wahi utha lete the — aur wo aksar koi preview/experimental model
// hota hai jiska FREE TIER QUOTA ZERO hota hai. Us wajah se pehli hi request
// pe 429 ("limit khatam") aata tha, chahe ek bhi request na chali ho.
//
// Ab: preview/exp/thinking/image/audio variants filter karte hain, aur bache
// hue stable models me se sabse sasta/tez chunte hain.
// Models ko behtar-se-behtar order me lagata hai.
//
// Purana bug: code `gemini-2.0-flash-lite` utha leta tha jiska free quota
// "limit: 0" tha — pehli hi request pe 429. Ab aise dead model ko callGemini()
// runtime pe skip karke agle model pe jaata hai (neeche scoreModel ka note dekho).
export function rankModels(models) {
  return (models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"))
    .map((m) => m.name)
    .filter((name) => !/preview|exp|experimental|thinking|image|audio|tts|vision|embedding|learnlm/i.test(name))
    .map((name) => ({ name, score: scoreModel(name) }))
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.name);
}

// UPDATE (23 Oct 2026, live naapa): "version sabse pehle" ne naya bug banaya.
// List me sabse naya `gemini-3.8-flash` tha, wahi chuna gaya. Wo "minimal"
// thinking pe 400 deta hai, aur bina thinking ke 20 segments me 86 SECOND leta
// hai — Chrome ka service worker itna wait nahi karta, isliye Gemini "kaam hi
// nahi karta" laga. Usi key pe `gemini-3.5-flash-lite` ne wahi kaam 3.2s me kiya.
// Ab TYPE pehle (lite > flash > pro), phir version. Retired/zero-quota model
// (purana 2.0-flash-lite case) ko callGemini() runtime pe skip karta hai:
// 429 / 404 / timeout -> ranked list ka agla model.
function scoreModel(name) {
  // Translation mechanical kaam hai: flash-lite sabse tez aur sabse zyada free
  // quota wala. Pro ka free quota bahut kam hota hai.
  let typeScore = 0;
  if (/flash-lite/i.test(name)) typeScore = 300;
  else if (/flash/i.test(name)) typeScore = 200;
  else if (/pro/i.test(name)) typeScore = 100;
  typeScore *= 100_000;

  // Same type ke andar naya version behtar (e.g. "gemini-3.5-flash-lite" -> 3.5).
  const versionMatch = name.match(/gemini-(\d+)\.(\d+)/i);
  const major = versionMatch ? Number(versionMatch[1]) : 0;
  const minor = versionMatch ? Number(versionMatch[2]) : 0;
  const versionScore = (major * 10 + minor) * 100;

  // Plain naam (gemini-2.5-flash) ko numbered variant (gemini-2.5-flash-001) se
  // upar rakho — plain hamesha current stable version pe point karta hai.
  const plainBonus = /-\d{3}$/.test(name) ? 0 : 10;

  return versionScore + typeScore + plainBonus;
}

export function chooseModelName(models) {
  return rankModels(models)[0] || null;
}

async function listGeminiModels(apiKey) {
  const res = await fetch(`${GEMINI_BASE}/models`, { headers: { "x-goog-api-key": apiKey } });
  if (!res.ok) {
    throw new GeminiUnavailableError(`Model list nahi mili: ${await readApiError(res)}`);
  }
  const data = await res.json();
  return data.models || [];
}

// Ranked list me diye gaye model ke baad wala agla candidate deta hai.
// Har call pe ek hi step aage badhta hai, taaki ek hi model par loop na lage.
async function nextModelAfter(apiKey, currentModel) {
  const ranked = rankModels(await listGeminiModels(apiKey).catch(() => []));
  const idx = ranked.indexOf(currentModel);
  if (idx === -1) return ranked[0] && ranked[0] !== currentModel ? ranked[0] : null;
  return ranked[idx + 1] || null;
}

async function pickGeminiModel(apiKey) {
  const stored = await chrome.storage.local.get(["geminiModelOverride", GEMINI_MODEL_CACHE_KEY]);
  if (stored.geminiModelOverride) return stored.geminiModelOverride;

  const cached = stored[GEMINI_MODEL_CACHE_KEY];
  if (cached && Date.now() - cached.ts < GEMINI_MODEL_CACHE_TTL_MS) {
    return cached.model;
  }

  const model = chooseModelName(await listGeminiModels(apiKey));
  if (!model) throw new GeminiUnavailableError("koi usable model nahi mila");

  await chrome.storage.local.set({ [GEMINI_MODEL_CACHE_KEY]: { model, ts: Date.now() } });
  return model;
}

// Google ke error response se asli message nikalta hai. Pehle hum yeh phenk
// dete the aur apna generic message dikhate the — isliye diagnose karna
// impossible tha ("limit khatam" dikh raha tha jabki asli wajah kuch aur thi).
async function readApiError(res) {
  let detail = "";
  try {
    const body = await res.json();
    detail = body?.error?.message || "";
  } catch {
    // JSON nahi mila — sirf status code se kaam chalao
  }
  return detail ? `${res.status} — ${detail}` : `${res.status}`;
}

async function respectRateLimit() {
  const now = Date.now();
  while (geminiRequestTimestamps.length && now - geminiRequestTimestamps[0] > 60_000) {
    geminiRequestTimestamps.shift();
  }
  if (geminiRequestTimestamps.length >= GEMINI_MAX_RPM) {
    const waitMs = 60_000 - (now - geminiRequestTimestamps[0]) + 50;
    await sleep(waitMs);
    return respectRateLimit();
  }
  geminiRequestTimestamps.push(Date.now());
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// SABSE BADA LATENCY FIX. Naye Gemini models me "thinking" DEFAULT ON hota hai
// (2.5-flash, 3.x flash/pro sab), aur 3.5-flash-lite tak minimal thinking karta
// hai. Translation jaisa mechanical kaam thinking se behtar nahi hota, sirf
// 20-40 second extra lagta hai — yahi "bahut slow" ki asli wajah thi.
//
// Field model version pe depend karta hai (dono ek saath bhejne pe 400 aata hai):
//   2.x  -> thinkingConfig.thinkingBudget = 0   (poora off)
//   3.x+ -> thinkingConfig.thinkingLevel = "minimal" (3.x pe full off allowed nahi)
// Model support na kare to 400 pe bina thinkingConfig retry hota hai (neeche).
export function thinkingConfigFor(model) {
  const major = Number((model.match(/gemini-(\d+)\./i) || [])[1] || 0);
  if (major >= 3) return { thinkingLevel: "minimal" };
  if (major === 2) return { thinkingBudget: 0 };
  return null;
}

// Ranked list ka agla model try karta hai aur use cache me likh deta hai, taaki
// agli batches seedha wahi use karein. List khatam = asli error upar bhejo.
async function callNextModel(model, apiKey, segments, useSchema, useThinking, reason) {
  const next = await nextModelAfter(apiKey, model);
  if (!next) throw new GeminiUnavailableError(reason);
  console.warn(`Gemini: ${reason} -> trying ${next}`);
  await chrome.storage.local.set({ [GEMINI_MODEL_CACHE_KEY]: { model: next, ts: Date.now() } });
  return callGemini(next, apiKey, segments, 0, useSchema, useThinking);
}

async function callGemini(model, apiKey, segments, attempt = 0, useSchema = true, useThinking = true) {
  const url = `${GEMINI_BASE}/${model}:generateContent`;
  const generationConfig = { temperature: 0.3, responseMimeType: "application/json" };
  // Structured output har model pe support nahi hota. Pehle schema ke saath
  // try karte hain (sabse reliable), aur 400 aane pe bina schema retry — warna
  // ek unsupported field poore Gemini mode ko band kar deti.
  if (useSchema) generationConfig.responseSchema = RESPONSE_SCHEMA;
  const thinking = useThinking ? thinkingConfigFor(model) : null;
  if (thinking) generationConfig.thinkingConfig = thinking;

  const body = {
    contents: [{ parts: [{ text: buildPrompt(segments) }] }],
    systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
    generationConfig,
  };

  // Timeout zaroori hai: bina iske ek slow model (3.8-flash = 86s) pe request
  // latki rehti thi aur page pe kuch hota hi nahi dikhta tha. Timeout pe agla model.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    if (err?.name !== "AbortError") throw err;
    return callNextModel(model, apiKey, segments, useSchema, useThinking, `${model} — ${GEMINI_TIMEOUT_MS / 1000}s timeout`);
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 429 && attempt < 2) {
    await sleep(1000 * 2 ** attempt); // 1s, 2s
    return callGemini(model, apiKey, segments, attempt + 1, useSchema, useThinking);
  }
  if (res.status === 429) {
    // Yahan pahunche matlab retries ke baad bhi 429. Do wajah ho sakti hain:
    // (a) is model ka free quota 0 hai (retired model), ya (b) sach me limit
    // khatam. Case (a) ke liye RANKED LIST me AGLE model pe jao — wahi model
    // dobara try karne ka koi matlab nahi.
    return callNextModel(model, apiKey, segments, useSchema, useThinking, `${model} — ${await readApiError(res)}`);
  }
  if (res.status === 503) {
    // Live dekha: "This model is currently experiencing high demand". Model
    // overloaded hai — wait karne se behtar agla model.
    return callNextModel(model, apiKey, segments, useSchema, useThinking, `${model} — ${await readApiError(res)}`);
  }
  if (res.status === 404) {
    // Model retire ho gaya (live dekha: "gemini-2.5-flash-lite is no longer
    // available to new users"). Fresh discovery wahi model dobara chun sakti thi,
    // isliye seedha ranked list ka agla model.
    return callNextModel(model, apiKey, segments, useSchema, useThinking, `${model} — ${await readApiError(res)}`);
  }
  if (res.status === 400 && thinking) {
    // Is model pe thinkingConfig ka yeh form support nahi — usse hata ke retry.
    // Schema se pehle yeh gira rahe hain kyunki schema quality ke liye zaroori hai.
    return callGemini(model, apiKey, segments, attempt, useSchema, false);
  }
  if (res.status === 400 && useSchema) {
    // Ho sakta hai is model pe responseSchema support na ho — bina schema retry.
    return callGemini(model, apiKey, segments, attempt, false, useThinking);
  }
  if (!res.ok) {
    throw new GeminiUnavailableError(await readApiError(res));
  }

  return res.json();
}

// Cache ke saath Mode B. Cache-miss segments ek hi Gemini call me batch hoti hain.
async function translateGemini(segments, apiKey) {
  if (Date.now() < geminiCooldownUntil) {
    throw new GeminiUnavailableError("cooldown active");
  }

  const results = new Array(segments.length);
  const toFetch = [];

  for (let i = 0; i < segments.length; i++) {
    const text = segments[i].text;
    // "B2": 29 Oct 2026 ko prompt "aap" form pe gaya. Purane "B:" entries me
    // "karo/tum" wala text cached hai — naya version unhe kabhi nahi padhta
    // (2000-entry limit unhe khud hata degi). Prompt ka tone badle to yeh number badhao.
    const cacheKey = `B2:${text}`;
    const cached = await getCached(cacheKey);
    if (cached !== undefined) {
      results[i] = { id: segments[i].id, text: cached, ok: true };
    } else {
      toFetch.push({ index: i, id: segments[i].id, text, cacheKey });
    }
  }

  if (toFetch.length > 0) {
    await respectRateLimit();
    const model = await pickGeminiModel(apiKey);
    const apiResponse = await callGemini(
      model,
      apiKey,
      toFetch.map((t) => ({ id: t.id, text: t.text }))
    );
    const parsed = parseGeminiResponse(
      apiResponse,
      toFetch.map((t) => t.id)
    );

    if (!parsed.ok) {
      geminiCooldownUntil = Date.now() + GEMINI_COOLDOWN_MS;
      throw new GeminiUnavailableError(`parse failed: ${parsed.reason}`);
    }

    const byId = new Map(parsed.results.map((r) => [r.id, r.text]));
    for (const item of toFetch) {
      const text = byId.get(item.id);
      results[item.index] = { id: item.id, text, ok: true };
      await setCached(item.cacheKey, text);
    }
    await bumpGeminiRequestCount();
  }

  return results;
}

// Diagnostic: key ko asli me test karta hai aur Google ka asli jawab lauta deta
// hai. Isse guess karne ki zarurat nahi rehti ki problem kya hai.
async function diagnoseKey() {
  const apiKey = await getGeminiApiKey();
  if (!apiKey) {
    return { ok: false, step: "key", error: "Koi key save nahi hai. Upar key paste karke Save dabao." };
  }

  let models;
  try {
    models = await listGeminiModels(apiKey);
  } catch (err) {
    return { ok: false, step: "models", error: String(err?.message || err) };
  }

  const usableNames = models
    .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"))
    .map((m) => m.name);
  // Override set ho to asli translation wahi use karti hai (pickGeminiModel) —
  // test bhi wahi model check kare, warna test pass aur asli kaam fail hota tha.
  const { geminiModelOverride } = await chrome.storage.local.get("geminiModelOverride");
  const chosen = geminiModelOverride || chooseModelName(models);

  if (!chosen) {
    return { ok: false, step: "models", error: "Koi usable model nahi mila.", usableNames };
  }

  // Ab ek asli chhoti translate request bhejo — yahi batayega ki sach me chalega ya nahi.
  try {
    const apiResponse = await callGemini(chosen, apiKey, [{ id: "t1", text: "Most people use this app every day." }]);
    const parsed = parseGeminiResponse(apiResponse, ["t1"]);
    if (!parsed.ok) {
      return { ok: false, step: "parse", error: `Response samajh nahi aaya (${parsed.reason})`, chosen, usableNames };
    }
    return { ok: true, chosen, sample: parsed.results[0].text, usableNames };
  } catch (err) {
    return { ok: false, step: "call", error: String(err?.message || err), chosen, usableNames };
  }
}

async function bumpGeminiRequestCount() {
  const today = new Date().toISOString().slice(0, 10);
  const { geminiUsage } = await chrome.storage.local.get("geminiUsage");
  const usage = geminiUsage?.date === today ? geminiUsage : { date: today, count: 0 };
  usage.count++;
  await chrome.storage.local.set({ geminiUsage: usage });
}

// ---- Message router ----
// Guard: yeh file Node me bhi import hoti hai (automated tests ke liye,
// bina Chrome ke) — waha `chrome` global exist nahi karta.
if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "TRANSLATE_BATCH") {
      handleTranslateBatch(message)
        .then((payload) => sendResponse({ ok: true, ...payload }))
        .catch((err) => sendResponse({ ok: false, error: String(err?.message || err) }));
      return true; // async response
    }
    if (message?.type === "DIAGNOSE_KEY") {
      diagnoseKey()
        .then((report) => sendResponse(report))
        .catch((err) => sendResponse({ ok: false, error: String(err?.message || err) }));
      return true;
    }
    return false;
  });
}

// ---- Right-click context menu: sirf selected text translate karo ----
if (typeof chrome !== "undefined" && chrome.runtime?.onInstalled) {
  chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
      id: "hinglish-selection",
      title: "Read in Hinglish",
      contexts: ["selection"],
    });
  });

  chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId !== "hinglish-selection" || !info.selectionText || !tab?.id) return;
    try {
      // Right-click wala rasta bhi wahi safety gate se guzre jo popup lagata hai —
      // pehle yeh bank/login/"is site pe off" sab pe chal jaata tha.
      if (!(await isTabAllowed(tab))) return;
      const { results } = await handleTranslateBatch({
        segments: [{ id: "sel", text: info.selectionText }],
      });
      const translated = results[0]?.text;
      if (!translated) return;
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: replaceSelectionWithText,
        args: [translated],
      });
    } catch (err) {
      console.warn("Selection translate failed:", err);
    }
  });
}

// popup.js ke computeSafety() jaisa hi gate. Password check fail/timeout ho to
// "password field hai" maano (fail closed) — sirf auth-jaise URL pe asar padta hai.
async function isTabAllowed(tab) {
  if (!tab.url || !/^https?:/.test(tab.url)) return false;
  const { perSiteOff } = await chrome.storage.local.get("perSiteOff");
  let hasPasswordField = true;
  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => !!document.querySelector('input[type="password"]'),
    });
    hasPasswordField = !!res?.result;
  } catch {
    // inject nahi hua — safe side pe raho
  }
  return checkSafety({
    url: tab.url,
    hostname: new URL(tab.url).hostname,
    hasPasswordField,
    perSiteOff: perSiteOff || [],
  }).allowed;
}

// Page context me chalta hai (executeScript ke through) — isliye self-contained
// hona chahiye, bahar ka koi variable/import use nahi kar sakta.
function replaceSelectionWithText(newText) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  // Sirf simple case handle karte hain: selection ek hi text node ke andar ho.
  // Complex multi-node selections ke liye chhedte nahi — DOM tod sakta hai.
  if (range.startContainer !== range.endContainer || range.startContainer.nodeType !== Node.TEXT_NODE) {
    return;
  }
  range.deleteContents();
  range.insertNode(document.createTextNode(newText));
  sel.removeAllRanges();
}

// Gemini hi asli Gen-Z Hinglish deta hai. Google Translate wala rasta
// (English -> shuddh Hindi -> Roman letters) structurally kabhi Gen-Z Hinglish
// nahi de sakta — wo hamesha "adhikansh log", "prayas", "pushti" jaisa
// Devanagari-Hindi-in-Roman-letters hi dega, chahe glossary kitni bhi badi ho.
//
// Isliye ab fallback CHUP-CHAAP nahi hota. Agar Gemini na chale to result ke
// saath ek `warning` bhi jata hai jo status pill me saaf dikhta hai — taaki
// pata rahe ki abhi kya chal raha hai aur kyun.
async function handleTranslateBatch(message) {
  const { segments } = message;
  const apiKey = await getGeminiApiKey();

  if (!apiKey) {
    const results = await translateGoogle(segments);
    return { results, mode: "google", warning: "no-key" };
  }

  try {
    const results = await translateGemini(segments, apiKey);
    return { results, mode: "gemini", warning: null };
  } catch (err) {
    const reason = String(err?.message || err);
    console.warn("Gemini failed, falling back to Google Translate:", reason);
    const results = await translateGoogle(segments);
    return { results, mode: "google", warning: "gemini-failed", detail: reason };
  }
}
