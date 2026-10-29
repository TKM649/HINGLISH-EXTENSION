// safety.js — pure functions jo decide karte hain kahan extension band rehna
// chahiye. Popup.js inject karne se PEHLE yeh check karta hai (content.js
// manifest se auto-inject nahi hoti, isliye popup hi asli gate hai).

// Banking/payment sites — yahan extension KABHI nahi chalega, chahe user
// popup se on karne ki koshish bhi kare.
const BANK_HOST_PATTERNS = [
  /bank/i,
  /netbanking/i,
  /paytm/i,
  /phonepe/i,
  /gpay/i,
  /pay\.google/i,
  /razorpay/i,
  /stripe/i,
  /paypal/i,
  /\bupi\b/i,
  /billdesk/i,
  /ccavenue/i,
  /sbi\./i,
  /hdfcbank/i,
  /icicibank/i,
  /axisbank/i,
];

// Login/checkout jaisi URLs — yahan sirf TABHI band karte hain jab page pe
// password field bhi mile (dono condition, warna aadhi normal sites block
// ho jaati — jaise koi article jiske URL me "login" word ho par actually
// content page ho).
const AUTH_URL_PATTERN = /\b(login|signin|sign-in|checkout|payment|billing)\b/i;

/** @param {string} hostname */
export function isBankingHost(hostname) {
  return BANK_HOST_PATTERNS.some((pattern) => pattern.test(hostname));
}

/** @param {string} url */
export function looksLikeAuthUrl(url) {
  return AUTH_URL_PATTERN.test(url);
}

/** @param {string} url */
export function isRestrictedUrl(url) {
  return /^(chrome|chrome-extension|edge|about|devtools):/i.test(url) || /chromewebstore\.google\.com/i.test(url);
}

/**
 * Full gate — extension inject karne se pehle yeh call hota hai.
 * @param {{url: string, hostname: string, hasPasswordField: boolean, perSiteOff: string[]}} ctx
 * @returns {{allowed: boolean, reason?: string}}
 */
export function checkSafety({ url, hostname, hasPasswordField, perSiteOff }) {
  if (isRestrictedUrl(url)) {
    return { allowed: false, reason: "restricted-page" };
  }
  if (isBankingHost(hostname)) {
    return { allowed: false, reason: "banking-site" };
  }
  if (hasPasswordField && looksLikeAuthUrl(url)) {
    return { allowed: false, reason: "login-page" };
  }
  if (perSiteOff?.some((site) => hostname === site || hostname.endsWith(`.${site}`))) {
    return { allowed: false, reason: "user-disabled" };
  }
  return { allowed: true };
}
