// reader-theme.js — <head> me module se PEHLE (blocking) chalta hai, taaki
// page galat rang me flash na ho. Extension pages pe inline <script> CSP ki
// wajah se mana hai, isliye yeh alag file hai.
// Do theme: "dark" aur "solarized" (Solarized light). Pehli baar system ke
// hisaab se, uske baad jo user ne toggle se chuna wahi (localStorage).
(function () {
  var theme = null;
  try {
    theme = localStorage.getItem("hl-reader-theme");
  } catch (e) {
    theme = null;
  }
  if (theme !== "dark" && theme !== "solarized") {
    theme = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "solarized";
  }
  document.documentElement.setAttribute("data-theme", theme);
})();
