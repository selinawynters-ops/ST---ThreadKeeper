# ⌬ Threadkeeper

<img width="1062" height="804" alt="brave_gNB9NbtpTU" src="https://github.com/user-attachments/assets/e76bdb2b-8d31-412a-89e8-a48ee9f813d3" />


**LLM-powered memory for long roleplays.**

Threadkeeper extracts key facts from your chat messages using an LLM and quietly injects them into every prompt — so your model never forgets what matters, no matter how long the conversation gets.

Built for [DreamTavern](https://github.com/selinawynters-ops/ST---ThreadKeeper) · SillyTavern Extension · v1.0.2

---


<img width="1181" height="1080" alt="brave_b6WmIKtBg9" src="https://github.com/user-attachments/assets/56d6e2cd-8a39-4411-9c39-e82fdc4dc7fd" />
<img width="313" height="392" alt="brave_kQYwqu52il" src="https://github.com/user-attachments/assets/d86c7ae0-8d43-4ec2-8697-817b23a532c9" />
<img width="1118" height="1080" alt="brave_Vj5CSoqSfa" src="https://github.com/user-attachments/assets/4747073f-b6fe-4058-a1e6-4d245e8da968" />


## ✨ What It Does

When you roleplay for hundreds of messages, your LLM eventually loses track of earlier details like character traits 🎭, relationship dynamics 💞, plot points 📖, important items 🗝️, and locations 🗺️. ThreadKeeper fixes this by:

1. **Scanning** your chat messages in batches 🔍
2. **Extracting** key facts using a fast, cheap LLM call 🧠
3. **Injecting** those facts into every prompt automatically 💉

The result: your model "remembers" things from 200 messages ago as if they just happened.

### How much does it cost? 💸

Almost nothing. A typical scan of 100 messages uses a fast model like `gpt-4o-mini` or `claude-3-haiku` and costs less than $0.01. The extracted facts usually take up around 400 tokens in your prompt, far less than the raw chat would have used.

---

## 📦 Installation

### Option A: From GitHub (Recommended) 🌐

1. Open SillyTavern or DreamTavern
2. Go to **Extensions** → **Install Extension**
3. Paste this repo URL: `https://github.com/selinawynters-ops/ST---ThreadKeeper/`
4. Click **Install**
5. Enable the extension
6. **ThreadKeeper** appears in your Push Modal menu ✨

### Option B: Manual Install 🛠️

1. Download or clone this repo
2. Copy the `ST---ThreadKeeper` folder into:

```text
SillyTavern/data/default-user/extensions/ST---ThreadKeeper/
```

3. Restart SillyTavern
4. Enable the extension in **Extensions** → **Manage Extensions**

---

## 🎮 How to Use

### Opening ThreadKeeper

- Click **ThreadKeeper** in the Push Modal section of the left sidebar menu
- Or type `/threadkeeper open` in the chat

### The Terminal

ThreadKeeper opens as a terminal-style popup with a familiar feel:

```text
┌─────────────────────────────────────────┐
│ ● ● ●   🔮  threadkeeper · dreamtavern │
│─────────────────────────────────────────│
│ ▶ extract  ⟳ re-extract  ◉ preview  ⚙  │
│─────────────────────────────────────────│
│ $ threadkeeper v1.0                     │
│ Loaded chat: Luna · 142 messages        │
│ 12 facts in memory (3 pinned)           │
│                                         │
│ ▎character  Luna has silver eyes        │
│ ▎relation   Luna trusts Marcus deeply   │
│ ▎event      The crystal shattered       │
│ ▎location   The tavern is in Westmarch  │
│ $ █                                     │
└─────────────────────────────────────────┘
```




https://github.com/user-attachments/assets/76c77bd5-4716-4f71-ac44-d65eb712ff52





### Toolbar Commands

| Button | What it does |
|--------|--------------|
| **▶ extract** | Scan new messages since last extraction (incremental) ⚡ |
| **⟳ re-extract** | Re-scan all messages from the beginning while keeping pinned facts 🔄 |
| **◉ preview** | Show exactly what gets injected into your prompt 👀 |
| **⚙ settings** | Open the settings panel |

### Fact Categories

Each extracted fact is tagged with a category:

| Tag | Category | Color | What it captures |
|-----|----------|-------|------------------|
| `chr` | Character | Purple | Traits, appearance, abilities, personality |
| `rel` | Relationship | Pink | Bonds, trust, conflict, romantic dynamics |
| `evt` | Event | Cyan | Key plot events, turning points |
| `itm` | Item | Amber | Important objects, weapons, artifacts |
| `loc` | Location | Green | Places, settings, geography |
| `plt` | Plot | Orange | Story arcs, mysteries, goals |

Use the filter buttons in the toolbar to show only certain categories.

### Fact Actions

Hover over any fact to see action buttons:

- **📌 Pin** — Pinned facts are always remembered, even during re-extraction. They get priority prompt space.
- **↗ Source** — Scrolls to and highlights the original chat message where the fact was found.
- **✕ Delete** — Remove a fact you do not need.

### Slash Commands

Type these in the SillyTavern chat input:

```text
/threadkeeper open       — Open the terminal
/threadkeeper extract    — Run incremental extraction
/threadkeeper reextract  — Run full re-extraction
/threadkeeper facts      — List all current facts
/threadkeeper clear      — Clear all non-pinned facts
/threadkeeper wipe       — Wipe ThreadKeeper data from settings and saved chats
```

---

## ⚙ Settings

Click **⚙ settings** in the toolbar to configure ThreadKeeper. Everything is written in plain language.

### 🔌 Connection

| Setting | What it means |
|---------|----------------|
| **Use connection from** | Pick one of your saved connection profiles. The API key is read automatically, so you do not need to re-enter it. |
| **Model for scanning** | Choose which model extracts facts. A fast, cheap model is usually best, like `gpt-4o-mini`. |
| **Accuracy** | Slider from "Precise" to "Creative". Lower means facts are more literal and exact. Higher means the model interprets more freely. |

### 🧠 Memory

| Setting | What it means |
|---------|----------------|
| **Max remembered facts** | The most facts ThreadKeeper will keep. When the limit is reached, the oldest non-pinned facts are replaced. Default: 100. |
| **How much prompt space to use** | How many tokens the facts take up in your prompt. Small (~250), Medium (~500), or Large (~800). |
| **Keep pinned facts across chats** | When enabled, pinned facts carry over when you start a new chat with the same character. |

### 🔍 Scanning

| Setting | What it means |
|---------|----------------|
| **Auto-scan every __ messages** | Automatically extract new facts after this many messages. Set to `0` for manual-only mode. |
| **Include hidden messages** | Also scan messages hidden from the chat view, including some system messages. |
| **Extraction tone** | Choose how facts are worded: `Polite` (clean, neutral prose) or `Dog Me Out` (raw, explicit, unfiltered language with profanity allowed). |
| **Facts per batch** | Set the minimum and maximum number of facts to extract in each LLM call. Min: 1, Max: adjustable (default: 15). |

### ⚙ Advanced

| Setting | What it means |
|---------|----------------|
| **Injection position** | Where facts appear in the prompt. |
| **Injection depth** | How many messages from the bottom the facts are inserted. Default: 4. |

### 🎯 Extraction Tone — Polite vs Dog Me Out

ThreadKeeper offers two extraction modes to suit your roleplay style:

**Polite (SFW)** — Default mode
- Extracts facts in clean, neutral prose
- Sanitized language without explicit content descriptions
- Perfect for general roleplays and PG content
- Example: "Luna trusts Marcus" or "The tavern is located in Westmarch"

**Dog Me Out (NSFW)** — Explicit/unfiltered mode
- Extracts facts raw and explicit, without softening or euphemisms
- Profanity is allowed and encouraged when it authentically captures the content
- Perfect for adult/mature roleplays where explicit details matter
- Includes: physical traits, kinks/preferences, power dynamics, explicit acts
- Example: "Luna is a shameless fucking exhibitionist with a size kink" or "Marcus dominates and fucks Luna — she begs to be called his slut"
- **Visual indicator:** The "Dog Me Out" button appears in red to clearly signal NSFW mode

### 📊 Facts Per Batch

Control how many facts are extracted in each LLM call:
- **Min facts**: Minimum number of facts to extract (default: 1)
- **Max facts**: Maximum number of facts to extract per batch (default: 15)

Adjust these to balance extraction quality and token usage. Higher max values gather more facts per call but use more tokens.

Do not forget to click **Save** after changing settings. 💾

---

## 🎬 Demo

Open `demo.html` in any browser to see a fully interactive preview of ThreadKeeper's UI without launching SillyTavern.

The demo simulates:
- the terminal popup with sample facts
- extract and re-extract animations
- fact filtering, pinning, and deletion
- settings panel with all controls
- injection preview

---

## 🔧 Technical Details

For the curious or the tinkerers:

- **Extraction:** Uses SillyTavern's `generateRaw()` API, the same system Memory, Vectors, and Expressions use.
- **Injection:** Uses `setExtensionPrompt()`, the same family of prompt injection used by features like Author's Note and World Info.
- **Storage:** Facts are saved in `chat_metadata.threadkeeper` on chats, and related settings live in `extension_settings.threadkeeper`.
- **Batching:** Messages are processed in chunks to stay within token limits.
- **Deduplication:** Existing facts are included in extraction context so the model avoids repeating them.
- **Budget management:** Pinned facts always get priority. When the token budget is tight, the oldest non-pinned facts are trimmed first.

### 🧼 Uninstall / Cleanup

| Situation | What happens |
|-----------|--------------|
| **Normal in-app uninstall** | `uninstall.js` contains extension-local cleanup helpers. |
| **Manual cleanup command** | `/threadkeeper wipe` removes ThreadKeeper data from settings and saved chats. |
| **Extension removed while files still exist** | ThreadKeeper can clean itself up. |
| **Folder manually deleted from disk** | Cleanup after that requires the optional ST-side patch bundle in `patches/`. |

---

## 📁 File Structure

```text
ST---ThreadKeeper/
├── manifest.json
├── index.js
├── uninstall.js
├── style.css
├── mobile-style.css
├── demo.html
├── LICENSE
├── README.md
└── patches/
    ├── manual-delete-cleanup.patch
    └── README.md
```

| File | Purpose |
|------|---------|
| `manifest.json` | Extension metadata 🪪 |
| `index.js` | Main extension logic and UI 🧠 |
| `uninstall.js` | Uninstall and wipe helpers 🧹 |
| `style.css` | Main styling 🎨 |
| `mobile-style.css` | Mobile-specific styling 📱 |
| `demo.html` | Standalone UI preview 🖥️ |
| `patches/manual-delete-cleanup.patch` | Optional ST-side patch for manual folder deletion cleanup 🩹 |
| `patches/README.md` | Patch install notes 📝 |

---

## 🐞 Troubleshooting

**ThreadKeeper does not appear 👻**
- Make sure the extension is enabled in **Extensions** → **Manage Extensions**
- Try refreshing SillyTavern
- Restart the app if needed

**Extraction returns empty results 🫥**
- Check that your connection profile has a valid API key
- Try a different model
- Check the browser console for JSON or provider errors

**Facts are not being injected 📭**
- Use preview inside ThreadKeeper to inspect the injected text
- Make sure the extension is enabled
- Check that injection position and depth are set sensibly

**You want manual folder deletion cleanup 🗑️**
- Apply the optional patch bundle in `patches/`

---

## ❤️ Credits

- Built by **Dreamweaver** for the DreamTavern community
- Powered by [SillyTavern](https://github.com/SillyTavern/SillyTavern)

---

*"The thread remembers what the model forgets."* 🧵

