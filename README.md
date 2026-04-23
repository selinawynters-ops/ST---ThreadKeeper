# ⌬ Threadkeeper

**LLM-powered memory for long roleplays.**

Threadkeeper extracts key facts from your chat messages using an LLM and quietly injects them into every prompt — so your model never forgets what matters, no matter how long the conversation gets.

Built for [DreamTavern](https://github.com/selinawynters-ops/ST---ThreadKeeper) · SillyTavern Extension · v1.0.0

---

## ✨ What It Does

When you roleplay for hundreds of messages, your LLM eventually loses track of earlier details — character traits, relationship dynamics, plot points, important items. Threadkeeper fixes this by:

1. **Scanning** your chat messages in batches
2. **Extracting** key facts using a fast, cheap LLM call
3. **Injecting** those facts into every prompt automatically

The result: your model "remembers" things from 200 messages ago as if they just happened.

### How much does it cost?

Almost nothing. A typical scan of 100 messages uses a fast model (like gpt-4o-mini or claude-3-haiku) and costs less than $0.01. The extracted facts take up ~400 tokens in your prompt — far less than the 2,000+ tokens the raw messages would have used.

---

## 📦 Installation

### Option A: From GitHub (Recommended)

1. Open SillyTavern
2. Go to **Extensions** → **Install Extension**
3. Paste this repo URL: `https://github.com/selinawynters-ops/ST---ThreadKeeper/`
4. Click **Install**
5. Enable the extension
6. **Threadkeeper** appears in your Push Modal menu ✨

### Option B: Manual Install

1. Download or clone this repo
2. Copy the `Threadkeeper` folder into:
   ```
   SillyTavern/public/scripts/extensions/third-party/Threadkeeper/
   ```
3. Restart SillyTavern
4. Enable the extension in **Extensions** → **Manage Extensions**

---

## 🎮 How to Use

### Opening Threadkeeper

- Click **Threadkeeper** in the Push Modal section of the left sidebar menu
- Or type `/threadkeeper open` in the chat

### The Terminal

Threadkeeper opens as a terminal-style popup with a familiar feel:

```
┌─────────────────────────────────────────┐
│ ● ● ●   🔮  threadkeeper · dreamtavern │
│─────────────────────────────────────────│
│ ▶ extract  ⟲ re-extract  ◉ preview  ⚙  │
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

### Toolbar Commands

| Button | What it does |
|--------|-------------|
| **▶ extract** | Scan new messages since last extraction (incremental) |
| **⟲ re-extract** | Re-scan ALL messages from the beginning (keeps pinned facts) |
| **◉ preview** | Show exactly what gets injected into your prompt |
| **⚙ settings** | Open the settings panel |

### Fact Categories

Each extracted fact is tagged with a category:

| Tag | Category | Color | What it captures |
|-----|----------|-------|-----------------|
| `chr` | Character | Purple | Traits, appearance, abilities, personality |
| `rel` | Relationship | Pink | Bonds, trust, conflict, romantic dynamics |
| `evt` | Event | Cyan | Key plot events, turning points |
| `itm` | Item | Amber | Important objects, weapons, artifacts |
| `loc` | Location | Green | Places, settings, geography |
| `plt` | Plot | Orange | Story arcs, mysteries, goals |

Use the filter buttons in the toolbar to show only certain categories.

### Fact Actions

Hover over any fact to see action buttons:

- **📌 Pin** — Pinned facts are *always* remembered, even during re-extraction. They get priority prompt space.
- **↗ Source** — Scrolls to and highlights the original chat message where the fact was found.
- **✕ Delete** — Remove a fact you don't need.

### Slash Commands

Type these in the SillyTavern chat input:

```
/threadkeeper open       — Open the terminal
/threadkeeper extract    — Run incremental extraction
/threadkeeper reextract  — Run full re-extraction
/threadkeeper facts      — List all current facts
/threadkeeper clear      — Clear all non-pinned facts
```

---

## ⚙ Settings

Click **⚙ settings** in the toolbar to configure Threadkeeper. Everything is in plain language — no coding knowledge needed.

### 🔗 Connection

| Setting | What it means |
|---------|--------------|
| **Use connection from** | Pick one of your saved connection profiles. The API key is read automatically — you never need to re-enter it. |
| **Model for scanning** | Choose which model extracts facts. A fast, cheap model is best (like gpt-4o-mini). Type to search the list. |
| **Accuracy** | Slider from "Precise" to "Creative". Lower = facts are more literal and exact. Higher = the model interprets more freely. Recommended: keep it toward Precise. |

### 🧠 Memory

| Setting | What it means |
|---------|--------------|
| **Max remembered facts** | The most facts Threadkeeper will keep. When the limit is reached, the oldest non-pinned facts are replaced. Default: 100. |
| **How much prompt space to use** | How many tokens the facts take up in your prompt. Small (~250), Medium (~500), or Large (~800). |
| **Keep pinned facts across chats** | When enabled, pinned facts carry over when you start a new chat with the same character. |

### 🔍 Scanning

| Setting | What it means |
|---------|--------------|
| **Auto-scan every __ messages** | Automatically extract new facts after this many messages. Set to 0 for manual-only. Default: 10. |
| **Include hidden messages** | Also scan messages that are hidden from the chat view (system messages, etc). |

### ⚙ Advanced

| Setting | What it means |
|---------|--------------|
| **Injection position** | Where facts appear in the prompt. "In-chat at depth" (default) or "After story string". |
| **Injection depth** | How many messages from the bottom the facts are inserted. Default: 4. |

Don't forget to click **💾 Save** after changing settings!

---

## 🧪 Demo



Open `demo.html` in any browser to see a fully interactive preview of Threadkeeper's UI — no SillyTavern installation required. The demo simulates:

- The terminal popup with sample facts
- Extract and re-extract animations
- Fact filtering, pinning, and deletion
- Settings panel with all controls
- Injection preview

---

## 🔧 Technical Details

For the curious or the tinkerers:

- **Extraction:** Uses SillyTavern's `generateRaw()` API — the same system that Memory, Vectors, and Expressions use. Model-agnostic; works with any provider.
- **Injection:** Uses `setExtensionPrompt()` — the same system as Author's Note and World Info. Facts are physically in the prompt text, so they work with every model.
- **Storage:** Facts are saved in `chat_metadata.threadkeeper` — per-chat, per-character. They persist across sessions.
- **Batching:** Messages are processed ~25 at a time to stay within token limits. Each batch extracts up to 15 facts.
- **Deduplication:** The extraction prompt includes existing facts so the LLM knows not to repeat them.
- **Budget management:** Pinned facts always get priority. When the token budget is tight, oldest non-pinned facts are trimmed first.

---

## 📁 File Structure

```
Threadkeeper/
├── manifest.json    — Extension metadata for SillyTavern
├── index.js         — All extension logic (~700 lines)
├── style.css        — Terminal UI styling (~600 lines)
├── demo.html        — Interactive standalone demo
└── README.md        — This file
```

---

## 🐛 Troubleshooting

**Threadkeeper doesn't appear in the menu**
- Make sure the extension is enabled in Extensions → Manage Extensions
- Try refreshing SillyTavern (Ctrl+Shift+R)
- If the Push Modal section loads dynamically, Threadkeeper retries injection automatically (at 0s, 2s, and 5s)

**Extraction returns empty results**
- Check that your connection profile has a valid API key
- Try a different model — some models struggle with JSON output
- Check the browser console (F12) for error messages

**Facts aren't being injected**
- Click **◉ preview** to check if injection text is being generated
- Make sure the extension is enabled in settings
- Check that injection position and depth are reasonable values

---

## ❤️ Credits

- Built by **Dreamweaver** for the DreamTavern community
- Powered by [SillyTavern](https://github.com/SillyTavern/SillyTavern)
- Memory Orb icon designed with love 🔮

---

*"The thread remembers what the model forgets."*
