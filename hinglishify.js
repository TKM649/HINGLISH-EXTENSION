// hinglishify.js — Google Translate ke raw romanized Hindi output ko
// Gen-Z WhatsApp-style Hinglish me badalta hai. Pure string function, koi DOM
// ya network nahi — isliye Node me bhi test ho sakta hai bina Chrome ke.

import { ALL_PASSES } from "./glossary.js";

/**
 * @param {string} text - Google Translate ka romanized output (dt=rm se)
 * @returns {string}
 */
export function hinglishify(text) {
  if (!text) return text;
  let result = text;

  for (const { table, phraseLevel } of ALL_PASSES) {
    result = phraseLevel ? applyPhraseTable(result, table) : applyWordTable(result, table);
  }

  return result;
}

// Phrase-level: multi-word keys, case-insensitive, word-boundary safe.
// Lambe (zyada specific) phrases pehle try karte hain — warna ek chhota phrase
// (jaise "kiya jata hai") ek lambe, zyada specific phrase (jaise "upyog kiya
// jata hai") ke andar se hi text kha jata hai, aur lamba phrase kabhi match
// nahi hota. Object insertion order pe bharosa nahi kar sakte.
function applyPhraseTable(text, table) {
  let result = text;
  const phrases = Object.keys(table).sort((a, b) => b.length - a.length);
  for (const phrase of phrases) {
    const pattern = new RegExp(`\\b${escapeRegex(phrase)}\\b`, "gi");
    result = result.replace(pattern, (match) => matchCase(match, table[phrase]));
  }
  return result;
}

// Word-level: single-word keys, case-insensitive, word-boundary safe.
// Ek hi regex me combine karte hain performance ke liye (bade glossary ke saath
// bhi ek single pass — 100+ alag regex.replace() calls se behtar).
function applyWordTable(text, table) {
  const keys = Object.keys(table);
  if (keys.length === 0) return text;

  const pattern = new RegExp(`\\b(${keys.map(escapeRegex).join("|")})\\b`, "gi");
  return text.replace(pattern, (match) => {
    const replacement = table[match.toLowerCase()];
    return replacement !== undefined ? matchCase(match, replacement) : match;
  });
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Original match ka capitalization replacement pe copy karo — taaki sentence
// ke shuru me capital letter bana rahe.
function matchCase(original, replacement) {
  if (original[0] === original[0].toUpperCase() && /[a-zA-Z]/.test(original[0])) {
    return replacement[0].toUpperCase() + replacement.slice(1);
  }
  return replacement;
}
