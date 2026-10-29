# Hinglish Reader

English web pages aur PDF books ko Gen-Z WhatsApp-style Hinglish me padho. Bilkul free, koi
credit card nahi, purane laptop pe bhi chalta hai (kaam cloud me hota hai, aapke laptop pe nahi).

## Install kaise karo (2 minute)

1. Chrome kholo, address bar me type karo: `chrome://extensions`
2. Top-right corner me **"Developer mode"** ka toggle ON karo
3. **"Load unpacked"** button click karo
4. Yeh poora folder chuno (jahan `manifest.json` hai)
5. Ho gaya — toolbar me ek "H" icon dikhega

## Use kaise karo

**Kisi bhi English page pe:**
- Toolbar icon click karo → "Hinglish mein badlein" button dabao
- Jo hissa screen pe dikh raha hai wo convert hoga; scroll karo, aage bhi hota jayega
- Wapas dekhna ho to "Original dikhao" dabao

**PDF books ke liye:**
- Toolbar icon click karo → "Koi bhi PDF kholo (drag-drop)" dabao
- Apni PDF file ko us page pe drag karo, ya "Choose file" se select karo
- Page-by-page padhoge, jo page khologe wahi convert hoga (poori book ek saath nahi)
- Sirf woh PDFs chalengi jinme text select ho sakta hai — scan ki hui/photo wali PDFs nahi chalengi

## Behtar Hinglish chahiye? (Gemini free key — 2 minute, credit card NAHI chahiye)

Bina key ke bhi extension chalta hai (Google Translate mode — theek-thaak Hinglish). Key
daalne se **asli Gen-Z-style Hinglish** milegi ("Yeh feature bohot accha hai yaar" jaisi).

1. Toolbar icon → "Settings" link click karo (ya extension icon pe right-click → Options)
2. [aistudio.google.com/apikey](https://aistudio.google.com/apikey) waala link kholo
3. Apne Google account se login karo
4. **"Create API key"** button dabao, key copy karo
5. Settings page me paste karke **"Save key"** dabao

**Paise ka sawaal hi nahi:** key lene me card nahi maangta, free tier pe billing enable hoti hi
nahi. Agar kabhi daily limit khatam ho jaye, extension chup-chaap Google Translate mode pe switch
ho jayega — page kabhi khaali nahi rahega.

## Kahan nahi chalega (aur kyun)

- **Bank/payment sites** (Paytm, PhonePe, netbanking, etc.) — safety ke liye hamesha OFF
- **Login/checkout pages jahan password field ho** — safety ke liye OFF
- **`chrome://` pages aur Chrome Web Store** — Chrome khud allow nahi karta
- **Scanned/photo PDFs** — text hi nahi hota inme, OCR chahiye jo yeh extension nahi karta
- **Gmail chalega** — newsletters padhne ke liye specially allow kiya hai. Jo mail aap likhte ho
  wo kabhi nahi bheja jaata, sirf jo padh rahe ho wahi.

Kisi specific site pe kabhi na chalayein ho to popup me "Is site pe kabhi mat chalao" dabao, ya
Settings me jaake site add/remove karo.

## Ek honest baat

- Har sentence perfect Hinglish nahi hogi, khaas kar technical/lambe sentences me. Jitna use
  karoge, utna feedback dena — glossary aur prompt tune ho sakte hain.
- Google Translate ka free endpoint undocumented hai (Google ki official documented API nahi) —
  isliye Gemini primary hai aur yeh sirf backup ke roop me hai.
- Links kabhi-kabhi plain text ban jayenge translated paragraphs ke andar (yeh ek jaana-bujha
  trade-off hai — batao agar yeh problem create kare, isse behtar banaya ja sakta hai).

## Developer notes (agar kabhi khud code dekhna/badalna ho)

Extension **koi build step nahi maangta** — jo files yahan hain wahi Chrome load karta hai.

```
manifest.json      Extension config
background.js      Saari network calls (Google Translate + Gemini), cache, context menu
gemini.js           Gemini prompt + response parsing (pure functions)
glossary.js         Hinglish word list — yahan naye words add/remove kar sakte ho
hinglishify.js       glossary rules apply karta hai
cache.js             Translated text cache (chrome.storage.local)
safety.js             Kahan extension band rehna chahiye — yeh decide karta hai
content.js/css        Web page ke andar chalta hai — extraction, viewport, DOM update
popup.html/js          Toolbar popup
options.html/js         Settings page (Gemini key, per-site off list)
reader.html/js           PDF reading mode
pdf-text.js               PDF text ko readable paragraphs me todta hai
vendor/                    Mozilla PDF.js (prebuilt, untouched)
```

### Automated tests chalana

```bash
npm install   # sirf ek baar, testing ke liye jsdom chahiye (extension ko khud nahi chahiye)
npm test
```

Sab tests Node me chalte hain, koi Chrome nahi chahiye. Ek hi test file chalani ho to
seedha `node test/safety.test.mjs` chala do. Tests — pure logic (hinglishify rules, Google/Gemini
response parsers, safety gating, PDF text-reflow) aur ek jsdom-based DOM round-trip test
(extraction + restore) cover karte hain.
