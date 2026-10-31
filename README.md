<p align="center">
  <img src="docs/images/banner.svg" alt="Hinglish Reader: English web pages and PDFs in easy Hinglish" width="100%">
</p>

<p align="center">
  <b>English web pages aur PDF books ko aasaan, roz-marra wali Hinglish mein padhiye.</b><br>
  Free Chrome extension. Koi account nahi, koi credit card nahi.
</p>

<p align="center">
  <a href="#install-kaise-karein-5-minute">Install</a> ·
  <a href="#use-kaise-karein">Use</a> ·
  <a href="#behtar-hinglish-ke-liye-free-gemini-key-optional">Gemini key</a> ·
  <a href="#privacy-aapka-data-kahan-jaata-hai">Privacy</a> ·
  <a href="#kuch-gadbad-ho-to">Help</a>
</p>

---

## Yeh kya karta hai

- **Web pages:** kisi bhi English article, blog ya news page par ek click, aur text Hinglish mein badal jaata hai. Links, bold aur images apni jagah rehte hain.
- **PDF books:** apni PDF drag-drop kijiye, page-by-page Hinglish mein padhiye. Contents, dark mode, aur last page yaad rehta hai.
- **Right-click:** koi bhi line select kijiye, right-click → **Read in Hinglish**.
- **Ek click mein wapas:** "Restore original" dabaate hi page bilkul pehle jaisa.

<p align="center">
  <img src="docs/images/popup.png" alt="Hinglish Reader popup" width="300">
</p>

---

## Install kaise karein (5 minute)

Yeh extension abhi Chrome Web Store par nahi hai, isliye isse ek baar haath se install karna padta hai. Neeche ke 6 steps follow kijiye, kisi coding ki zarurat nahi.

**Step 1: File download kijiye**

1. Is page ke upar hare (green) rang ka **`<> Code`** button dabaiye.
2. **Download ZIP** par click kijiye. Ek `.zip` file aapke Downloads folder mein aa jaayegi.

**Step 2: ZIP kholiye (unzip)**

1. Windows: ZIP file par right-click → **Extract All…** → **Extract**.
2. Mac: ZIP file par double-click kijiye.
3. Jo folder bana, usse kisi pakki jagah rakh dijiye, jaise **Documents** mein.

> ⚠️ **Is folder ko baad mein delete ya move mat kijiye.** Chrome extension ko isi folder se chalata hai. Folder hata to extension bhi band.

**Step 3: Chrome ka extensions page kholiye**

Chrome ke address bar mein yeh type kijiye aur Enter dabaiye:

```
chrome://extensions
```

**Step 4: Developer mode ON kijiye**

Page ke **top-right corner** mein **Developer mode** ka toggle ON kijiye. (Yeh sirf "khud ka folder load karne" ki permission hai, isse aapke Chrome mein kuch aur nahi badalta.)

**Step 5: Folder load kijiye**

1. Upar-left mein **Load unpacked** button dabaiye.
2. Step 2 wala folder chuniye. **Sahi folder wahi hai jiske andar `manifest.json` file dikhe.**
3. **Select Folder** dabaiye.

> 💡 Windows mein aksar folder ke andar same naam ka ek aur folder hota hai (`hinglish-extension-main` → `hinglish-extension-main`). Andar wala chuniye, jisme `manifest.json` hai.

**Step 6: Toolbar mein pin kijiye**

1. Chrome ke upar-right mein **puzzle (🧩) icon** dabaiye.
2. **Hinglish Reader** ke saamne **pin 📌** dabaiye.

Ho gaya. Ab toolbar mein ek purple **H** icon dikhega. ✅

---

## Use kaise karein

**Kisi bhi English web page par**

1. Toolbar mein **H** icon dabaiye.
2. **Convert to Hinglish** dabaiye.
3. Jo screen par hai woh pehle badlega. Neeche scroll karte jaiye, aage ka text bhi badalta jaayega.
4. Page ke neeche-right corner mein ek chhota button dikhega jo batata hai kya chal raha hai. Usse dabaane par original wapas aa jaata hai.

**PDF book ke liye**

1. **H** icon → **Open PDF reader**.
2. Apni PDF file us page par drag kijiye, ya **Choose file** se chuniye.
3. Jo page kholenge, wahi Hinglish mein badlega (poori book ek saath nahi, taaki free limit bachi rahe).

**Sirf ek line ke liye**

Text select kijiye → right-click → **Read in Hinglish**.

---

## Behtar Hinglish ke liye: free Gemini key (optional)

Bina key ke bhi extension chalta hai (**Basic mode**, Google Translate se). Par Basic mode thodi kitaabi Hindi deta hai, jaise "prishth", "margdarshika". **Asli, bol-chaal wali Hinglish** ke liye Google ki free Gemini key lagaiye. 2 minute lagte hain, card nahi maangta.

1. **H** icon → upar-right mein **Settings**.
2. [aistudio.google.com/apikey](https://aistudio.google.com/apikey) kholiye aur apne Google account se login kijiye.
3. **Create API key** dabaiye, key copy kijiye.
4. Settings page mein paste kijiye → **Save key** → **Test key**.

"Everything works" dikhe to aap ready hain.

<p align="center">
  <img src="docs/images/settings.png" alt="Settings page jahan Gemini key daalte hain" width="560">
</p>

**Paise ka sawaal nahi:** free key par billing hoti hi nahi. Roz ki free limit khatam ho jaaye to extension apne aap Basic mode par chala jaata hai, page kabhi khaali nahi rehta. Limit roz **midnight Pacific time** par reset hoti hai (India mein dopahar lagbhag 12:30 ya 1:30 baje).

> 🔒 **Apni key kisi ko mat dijiye** aur kahin post mat kijiye. Key sirf aapke laptop ke Chrome mein save hoti hai.

---

## Privacy: aapka data kahan jaata hai

| Kya | Kahan jaata hai |
|---|---|
| Aapki settings aur Gemini key | Sirf aapke laptop par (Chrome ke andar). Kahin sync nahi hoti. |
| Jo text aap convert karte hain | Translate hone ke liye Google ke paas (Google Translate, ya key ho to Gemini). |
| Aapki browsing, history, passwords | Kahin nahi. Extension sirf usi page ko padhta hai jahan aap khud button dabaate hain. |

Is extension ka apna koi server nahi hai, koi tracking ya analytics nahi.

> ⚠️ **Zaroori:** free Gemini key par Google bheja gaya text apne products sudhaarne ke liye use kar sakta hai, aur insaan reviewers use padh sakte hain ([Google ki terms](https://ai.google.dev/gemini-api/terms)). Isliye **private emails, bank statements ya personal documents free key se convert mat kijiye.**

---

## Kahan nahi chalega (aur kyun)

- **Bank aur payment sites** (netbanking, Paytm, PhonePe, PayPal waghera): safety ke liye hamesha band.
- **Login ya checkout pages** jahan password box ho: safety ke liye band.
- **`chrome://` pages aur Chrome Web Store:** Chrome khud allow nahi karta.
- **Scan ki hui ya photo wali PDFs:** inme text hota hi nahi, sirf tasveer. Jis PDF mein aap text select kar paate hain, wahi chalegi.

Kisi site par kabhi na chalana ho: **H** icon → **Disable on this site**. Wapas on karna ho to Settings → Disabled sites.

---

## Kuch gadbad ho to

| Problem | Hal |
|---|---|
| "Manifest file is missing or unreadable" | Galat folder chuna. Woh folder chuniye jiske andar `manifest.json` hai (Step 5 ka tip). |
| Extension achanak gayab ho gaya | Folder delete ya move ho gaya. Step 2 se dobara kijiye. |
| Button dabaya, kuch nahi badla | Page ek baar reload kijiye, phir dobara **Convert to Hinglish**. |
| Corner mein "Basic mode" ya "Limit reached" | Key nahi hai ya aaj ki free limit khatam. Kal tak Basic mode chalega. |

---

## Naya version kaise lein

1. Upar wale **Step 1 aur 2** dobara kijiye (nayi ZIP).
2. Purane folder ki files nayi files se **replace** kar dijiye (folder ki jagah wahi rakhiye).
3. `chrome://extensions` kholiye → Hinglish Reader par **reload ↻** icon dabaiye.

Aapki key aur settings bachi rehti hain.

## Hataana ho to

`chrome://extensions` → Hinglish Reader → **Remove**. Phir folder bhi delete kar sakte hain. Isse aapki key aur saari settings bhi mit jaati hain.

---

## Ek imaandaar baat

- Har sentence perfect nahi hoga, khaas kar bahut technical ya lambe sentences mein.
- Basic mode (bina key) hamesha thoda kitaabi rahega. Achhi Hinglish sirf Gemini key se milti hai.
- Abhi sirf laptop/desktop wale Google Chrome par test hua hai.

---

<details>
<summary><b>Developers ke liye</b> (code dekhna ya badalna ho)</summary>

<br>

Koi build step nahi. Is folder ki files hi Chrome load karta hai. `package.json` sirf tests ke liye `jsdom` deta hai, extension ki koi runtime dependency nahi.

```
manifest.json     Extension config (Manifest V3)
background.js     Saari network calls (Google Translate + Gemini), model choice, context menu
gemini.js         Gemini prompt + response parsing (pure)
glossary.js       Basic mode ki word list
hinglishify.js    Glossary rules apply karta hai (pure)
cache.js          Translation cache (memory + chrome.storage.local)
safety.js         Kahan extension band rahe (pure)
content.js/css    Page ke andar: text nikaalna, viewport queue, DOM update, restore
popup.html/js     Toolbar popup
options.html/js   Settings page
reader.html/js    PDF reader
pdf-text.js       PDF text ko headings/paragraphs mein jodta hai (pure)
markers.js        Formatting markers ka parser (pure)
vendor/           Mozilla PDF.js (prebuilt, Apache-2.0, unmodified)
```

Tests (sab Node mein chalte hain, Chrome nahi chahiye):

```bash
npm install
```

```bash
npm test
```

Architecture ki poori detail [CLAUDE.md](CLAUDE.md) mein hai.

</details>
