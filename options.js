// options.js — settings page. Sab chrome.storage.local me save hota hai
// (sirf aapke laptop pe, kahin sync nahi hota).

const apiKeyInput = document.getElementById("apiKey");
const keyStatus = document.getElementById("keyStatus");
const newOffSiteInput = document.getElementById("newOffSite");
const offListEl = document.getElementById("offList");
const modelOverrideInput = document.getElementById("modelOverride");

init();

async function init() {
  const data = await chrome.storage.local.get(["geminiApiKey", "perSiteOff", "geminiModelOverride"]);
  if (data.geminiApiKey) apiKeyInput.value = data.geminiApiKey;
  if (data.geminiModelOverride) modelOverrideInput.value = data.geminiModelOverride;
  renderOffList(data.perSiteOff || []);
  await renderUsage();
}

async function renderUsage() {
  const el = document.getElementById("usageLine");
  if (!el) return;
  const { geminiUsage, geminiModelCache } = await chrome.storage.local.get(["geminiUsage", "geminiModelCache"]);
  const today = new Date().toISOString().slice(0, 10);
  const count = geminiUsage?.date === today ? geminiUsage.count : 0;
  const model = geminiModelCache?.model || "not selected yet";
  // innerHTML nahi: model ka naam Google ke API/storage se aata hai — privileged
  // page pe bahar ka text kabhi HTML ki tarah parse nahi hona chahiye.
  const b = document.createElement("b");
  b.textContent = `${count} ${count === 1 ? "request" : "requests"}`;
  const code = document.createElement("code");
  code.textContent = model;
  el.replaceChildren(b, " used today · Model: ", code);
}

document.getElementById("saveKey").addEventListener("click", async () => {
  const key = apiKeyInput.value.trim();
  await chrome.storage.local.set({ geminiApiKey: key || null });
  flash(keyStatus, key ? "Saved" : "Key field is empty");
});

document.getElementById("checkKey").addEventListener("click", async () => {
  const diagBox = document.getElementById("diagBox");
  diagBox.style.display = "block";
  diagBox.textContent = "Testing your key…";

  // Pehle jo bhi box me hai wo save kar do, taaki abhi-abhi paste ki hui key test ho.
  const key = apiKeyInput.value.trim();
  await chrome.storage.local.set({ geminiApiKey: key || null });
  await chrome.storage.local.remove("geminiModelCache"); // fresh model discovery

  const report = await chrome.runtime.sendMessage({ type: "DIAGNOSE_KEY" });

  if (report?.ok) {
    diagBox.textContent =
      `Everything works.\n\n` +
      `Model selected: ${report.chosen}\n\n` +
      `Test translation:\n"Most people use this app every day."\n  ->  "${report.sample}"\n\n` +
      `You're all set. Open any page and hit Convert.`;
    return;
  }

  const stepNames = {
    key: "Key could not be saved",
    models: "Could not fetch the model list from Google",
    call: "Translation request failed",
    parse: "Response could not be parsed",
  };

  let text = `Problem: ${stepNames[report?.step] || "Unknown error"}\n\n`;
  text += `Message from Google:\n${report?.error || "(no details returned)"}\n`;
  if (report?.chosen) text += `\nModel attempted: ${report.chosen}\n`;
  if (report?.usableNames?.length) {
    text += `\nModels available on your key:\n${report.usableNames.join("\n")}\n`;
    text += `\nYou can put one of these in the "Model override" field and test again.`;
  }
  diagBox.textContent = text;
});

document.getElementById("clearKey").addEventListener("click", async () => {
  apiKeyInput.value = "";
  await chrome.storage.local.set({ geminiApiKey: null });
  flash(keyStatus, "Key removed");
});

document.getElementById("saveModel").addEventListener("click", async () => {
  const value = modelOverrideInput.value.trim();
  await chrome.storage.local.set({ geminiModelOverride: value || null });
  flash(keyStatus, "Model override saved");
});

document.getElementById("addOffSite").addEventListener("click", async () => {
  const site = normalizeSite(newOffSiteInput.value);
  if (!site) return;
  const { perSiteOff } = await chrome.storage.local.get("perSiteOff");
  const list = perSiteOff || [];
  if (!list.includes(site)) list.push(site);
  await chrome.storage.local.set({ perSiteOff: list });
  newOffSiteInput.value = "";
  renderOffList(list);
});

function renderOffList(list) {
  offListEl.innerHTML = "";
  if (list.length === 0) {
    offListEl.innerHTML = '<li class="empty">No custom sites added</li>';
    return;
  }
  for (const site of list) {
    const li = document.createElement("li");
    const span = document.createElement("span");
    span.textContent = site;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "Remove";
    btn.className = "btn btn-ghost";
    btn.addEventListener("click", async () => {
      const { perSiteOff } = await chrome.storage.local.get("perSiteOff");
      const updated = (perSiteOff || []).filter((s) => s !== site);
      await chrome.storage.local.set({ perSiteOff: updated });
      renderOffList(updated);
    });
    li.appendChild(span);
    li.appendChild(btn);
    offListEl.appendChild(li);
  }
}

function normalizeSite(raw) {
  let s = raw.trim().toLowerCase();
  if (!s) return "";
  s = s.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  return s;
}

function flash(el, text) {
  el.textContent = text;
  setTimeout(() => {
    if (el.textContent === text) el.textContent = "";
  }, 2500);
}
