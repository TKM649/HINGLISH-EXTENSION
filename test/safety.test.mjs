// test/safety.test.mjs — safety gating logic test karta hai. Yeh sabse
// zaroori test hai (Gmail chalna chahiye, bank band hona chahiye).
//   node test/safety.test.mjs

import { checkSafety, isBankingHost, looksLikeAuthUrl, isRestrictedUrl } from "../safety.js";

let pass = 0;
let fail = 0;

function check(name, actual, expected) {
  if (actual === expected) {
    pass++;
  } else {
    fail++;
    console.log(`FAIL (${name}): expected ${expected}, got ${actual}`);
  }
}

// --- Gmail explicitly allowed (user ne khaas taur pe maanga) ---
check(
  "Gmail chalna chahiye",
  checkSafety({ url: "https://mail.google.com/mail/u/0/#inbox", hostname: "mail.google.com", hasPasswordField: false, perSiteOff: [] }).allowed,
  true
);
check("Gmail with a search bar (no password field) allowed", isBankingHost("mail.google.com"), false);

// --- Banking sites blocked, no matter what ---
for (const host of ["netbanking.hdfcbank.com", "www.paytm.com", "phonepe.com", "checkout.razorpay.com", "sbi.co.in"]) {
  check(`Banking host blocked: ${host}`, isBankingHost(host), true);
}
check(
  "Bank site blocked even without password field",
  checkSafety({ url: "https://sbi.co.in/home", hostname: "sbi.co.in", hasPasswordField: false, perSiteOff: [] }).allowed,
  false
);

// --- Normal sites allowed ---
for (const host of ["en.wikipedia.org", "bbc.com", "reddit.com", "medium.com", "github.com"]) {
  check(`Normal host allowed: ${host}`, isBankingHost(host), false);
}

// --- Login page + password field = blocked; login-word URL alone = allowed ---
check(
  "Login URL + password field blocked",
  checkSafety({ url: "https://example.com/login", hostname: "example.com", hasPasswordField: true, perSiteOff: [] }).allowed,
  false
);
check(
  "Login-word in URL but no password field = allowed (avoid over-blocking articles)",
  checkSafety({ url: "https://blog.example.com/how-to-login-safely", hostname: "blog.example.com", hasPasswordField: false, perSiteOff: [] }).allowed,
  true
);
check(
  "Password field present but URL has no login keyword = allowed",
  checkSafety({ url: "https://example.com/comments", hostname: "example.com", hasPasswordField: true, perSiteOff: [] }).allowed,
  true
);

// --- Restricted pages ---
check("chrome:// blocked", isRestrictedUrl("chrome://extensions"), true);
check("Chrome Web Store blocked", isRestrictedUrl("https://chromewebstore.google.com/detail/xyz"), true);
check("Normal https allowed by isRestrictedUrl", isRestrictedUrl("https://example.com"), false);

// --- Per-site off list ---
check(
  "User-added off site blocked",
  checkSafety({ url: "https://news.example.com/", hostname: "news.example.com", hasPasswordField: false, perSiteOff: ["news.example.com"] }).allowed,
  false
);
check(
  "Subdomain of off-listed site also blocked",
  checkSafety({ url: "https://m.news.example.com/", hostname: "m.news.example.com", hasPasswordField: false, perSiteOff: ["news.example.com"] }).allowed,
  false
);

console.log(`\n${pass}/${pass + fail} passed.`);
if (fail > 0) process.exit(1);
