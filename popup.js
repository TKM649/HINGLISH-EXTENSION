// popup.js — toolbar popup. Safety check karta hai, content script inject/toggle
// karta hai, aur status/mode/usage dikhata hai.

import { checkSafety } from "./safety.js";

const toggleBtn = document.getElementById("toggleBtn");
const restoreBtn = document.getElementById("restoreBtn");
const statusText = document.getElementById("statusText");
const statusDot = document.getElementById("statusDot");
const statusRow = document.getElementById("statusRow");
const blockedNotice = document.getElementById("blockedNotice");
const blockedWrap = document.getElementById("blockedWrap");
const pdfBtn = document.getElementById("pdfBtn");
const openReaderBtn = document.getElementById("openReaderBtn");
const metaInfo = document.getElementById("metaInfo");
const offSiteBtn = document.getElementById("offSiteBtn");
const settingsLink = document.getElementById("settingsLink");

let currentTab = null;
let currentHostname = null;
let safetyReady = null; // Promise<{allowed, reason}>

// BUG FIX (29 Oct 2026): popup "ek click me nahi khulta / respond nahi karta".
// Wajah (Chrome docs): executeScript by default page ke "document_idle" tak
// rukta hai. Heavy page abhi load ho raha ho to password-check wahin atak
// jaata tha, aur tab tak buttons pe click handler lagte hi nahi the. Ab
// buttons turant zinda hain, scripts injectImmediately se chalti hain, aur
// safety check click ke waqt bhi await hota hai (gate kamzor nahi hua).
const PASSWORD_CHECK_TIMEOUT_MS = 1500;

toggleBtn.addEventListener("click", onToggle);
restoreBtn.addEventListener("click", onRestore);
offSiteBtn.addEventListener("click", onAddOffSite);

init();

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tab;
  updatePdfButton(tab);
  renderMeta();

  if (!tab?.url || !/^https?:/.test(tab.url)) {
    disableAll("Hinglish Reader can't run on this page.");
    return;
  }

  currentHostname = new URL(tab.url).hostname;
  refreshStatus();
  safetyReady = computeSafety(tab);
  const safety = await safetyReady;
  if (!safety.allowed) disableAll(blockedMessage(safety.reason));
}

async function computeSafety(tab) {
  const { perSiteOff } = await chrome.storage.local.get("perSiteOff");
  let hasPasswordField = false;
  try {
    const check = chrome.scripting.executeScript({
      target: { tabId: tab.id },
      injectImmediately: true,
      func: () => !!document.querySelector('input[type="password"]'),
    });
    // Timeout = "password field ho sakta hai" maano (fail closed). checkSafety
    // ko auth-jaisa URL bhi chahiye, isliye sirf login-jaise pages pe asar.
    const timeout = new Promise((resolve) => setTimeout(() => resolve("timeout"), PASSWORD_CHECK_TIMEOUT_MS));
    const res = await Promise.race([check, timeout]);
    hasPasswordField = res === "timeout" ? true : !!res?.[0]?.result;
  } catch {
    // Kuch pages pe script inject nahi ho sakti (jaise PDF viewer) — safe default false rahega.
  }
  return checkSafety({
    url: tab.url,
    hostname: currentHostname,
    hasPasswordField,
    perSiteOff: perSiteOff || [],
  });
}

function blockedMessage(reason) {
  const messages = {
    "banking-site": "Disabled for safety. Hinglish Reader never runs on banking or payment sites.",
    "login-page": "Disabled for safety. This page contains a login form.",
    "restricted-page": "Chrome does not allow extensions to run on this type of page.",
    "user-disabled": "You disabled this site. You can re-enable it from Settings.",
  };
  return messages[reason] || "Hinglish Reader can't run on this page.";
}

function disableAll(message) {
  blockedNotice.textContent = message;
  blockedWrap.style.display = "block";
  statusRow.style.display = "none";
  toggleBtn.disabled = true;
  restoreBtn.disabled = true;
  offSiteBtn.disabled = true;
}

// Ek hi jagah se status text + dot set hota hai, warna dono alag ho jaate hain.
function setStatus(text, on) {
  statusText.textContent = text;
  statusDot.classList.toggle("on", !!on);
}

async function onToggle() {
  if (!safetyReady || !currentHostname) return; // tab abhi pata hi nahi (bas kuch milliseconds)
  // Click ke waqt DOBARA check: popup page ke load hote waqt khula ho to tab
  // password box shayad bana hi nahi tha.
  const safety = await computeSafety(currentTab);
  if (!safety.allowed) {
    disableAll(blockedMessage(safety.reason));
    return;
  }
  try {
    await chrome.scripting.insertCSS({ target: { tabId: currentTab.id }, files: ["content.css"] });
    await chrome.scripting.executeScript({
      target: { tabId: currentTab.id },
      files: ["content.js"],
      injectImmediately: true,
    });
    await refreshStatus();
  } catch (err) {
    setStatus(`Error: ${err.message || err}`, false);
  }
}

async function onRestore() {
  try {
    await chrome.tabs.sendMessage(currentTab.id, { type: "HINGLISH_RESTORE" });
    await refreshStatus();
  } catch {
    setStatus("Not active on this page", false);
  }
}

async function onAddOffSite() {
  if (!currentHostname || offSiteBtn.disabled) return;
  const { perSiteOff } = await chrome.storage.local.get("perSiteOff");
  const list = perSiteOff || [];
  if (!list.includes(currentHostname)) list.push(currentHostname);
  await chrome.storage.local.set({ perSiteOff: list });
  disableAll(`Disabled on ${currentHostname}. You can re-enable it from Settings.`);
}

async function refreshStatus() {
  try {
    const res = await chrome.tabs.sendMessage(currentTab.id, { type: "HINGLISH_STATUS" });
    if (res?.enabled) {
      setStatus(
        res.totalQueued > 0 && res.totalDone < res.totalQueued
          ? `Converting · ${res.totalDone}/${res.totalQueued}`
          : "Active · keep scrolling",
        true
      );
      toggleBtn.textContent = "Turn off";
    } else {
      setStatus("Off", false);
      toggleBtn.textContent = "Convert to Hinglish";
    }
  } catch {
    setStatus("Off", false);
    toggleBtn.textContent = "Convert to Hinglish";
  }
}

function updatePdfButton(tab) {
  if (tab?.url && /\.pdf(\?|#|$)/i.test(tab.url)) {
    pdfBtn.style.display = "block";
    pdfBtn.addEventListener("click", () => {
      chrome.tabs.create({
        url: chrome.runtime.getURL("reader.html") + "?src=" + encodeURIComponent(tab.url),
      });
    });
  }
}

openReaderBtn.addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("reader.html") });
});

settingsLink.addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

async function renderMeta() {
  const { geminiApiKey, geminiUsage } = await chrome.storage.local.get(["geminiApiKey", "geminiUsage"]);
  const today = new Date().toISOString().slice(0, 10);
  const count = geminiUsage?.date === today ? geminiUsage.count : 0;

  // Footer mein ek hi line — poora card popup ko bahut lamba bana raha tha.
  // Detail Settings page pe hai, yahan sirf yaad dilaane bhar ka.
  if (geminiApiKey) {
    metaInfo.innerHTML = `<b>Gemini</b> · ${count} today`;
    metaInfo.title = "Using Gemini for natural, conversational Hinglish.";
  } else {
    metaInfo.innerHTML = `<b>Basic</b> · no key`;
    metaInfo.title = "Using Google Translate. Add a free Gemini key in Settings for much better quality.";
  }
}
