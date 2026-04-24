[demo.html](https://github.com/user-attachments/files/27061027/demo.html)# ⌬ Threadkeeper

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

[Uploading d<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Threadkeeper · DreamTavern Demo</title>
<link href="https://fonts.googleapis.com/css2?family=Cinzel+Decorative:wght@400;700&family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;1,300;1,400&family=Raleway:wght@300;400;500;600&family=JetBrains+Mono:wght@300;400;500&display=swap" rel="stylesheet">
<style>
  :root {
    --midnight: #0b0a16;
    --deep: #100f22;
    --surface: #161430;
    --card: #1c1a3a;
    --card-hover: #242248;
    --border: rgba(100,160,220,0.14);
    --border-bright: rgba(124,77,255,0.35);
    --teal: #26c6da;
    --indigo: #5c6bc0;
    --violet: #7c4dff;
    --lavender: #b39ddb;
    --sky: #80deea;
    --pink: #ce93d8;
    --gold: #ffd54f;
    --amber: #ffab40;
    --text-primary: #dff0f8;
    --text-secondary: #8eb8cc;
    --text-muted: #476070;
    --green: #66bb9a;
    --red: #ef5350;
    --radius: 12px;
    --radius-sm: 8px;
    --term-bg: #0a0e17;
    --term-header: #111827;
    --term-green: #4ade80;
    --term-cyan: #22d3ee;
    --term-amber: #fbbf24;
    --term-red: #f87171;
    --term-purple: #a78bfa;
    --term-text: #c9d6e3;
    --term-dim: #4b5e6f;
  }

  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    background: var(--midnight);
    color: var(--text-primary);
    font-family: 'Raleway', sans-serif;
    height: 100vh;
    overflow: hidden;
  }

  /* ═══════════════════════════════════════════
     SIMULATED SILLYTAVERN BACKGROUND
     ═══════════════════════════════════════════ */
  .st-background {
    position: fixed; inset: 0; display: flex; z-index: 0;
  }

  /* ── Left Sidebar ── */
  .sidebar {
    width: 280px;
    background: linear-gradient(180deg, #0d0c1e 0%, #0b0a18 100%);
    border-right: 1px solid var(--border);
    display: flex; flex-direction: column;
    overflow-y: auto; flex-shrink: 0;
    scrollbar-width: thin; scrollbar-color: var(--surface) transparent;
  }
  .sidebar::-webkit-scrollbar { width: 4px; }
  .sidebar::-webkit-scrollbar-thumb { background: var(--surface); border-radius: 2px; }
  .sidebar-section { padding: 8px 12px; border-bottom: 1px solid var(--border); }
  .sidebar-item {
    display: flex; align-items: center; gap: 10px;
    padding: 9px 12px; border-radius: var(--radius-sm);
    color: var(--text-secondary); font-size: 0.82rem;
    cursor: pointer; transition: all 0.15s; user-select: none;
  }
  .sidebar-item:hover { background: rgba(124,77,255,0.08); color: var(--text-primary); }
  .sidebar-item .icon { font-size: 1rem; width: 22px; text-align: center; flex-shrink: 0; }
  .sidebar-item.active { background: rgba(124,77,255,0.14); color: var(--lavender); border: 1px solid rgba(124,77,255,0.2); }
  .sidebar-label {
    padding: 10px 14px 4px; font-size: 0.65rem; text-transform: uppercase;
    letter-spacing: 1.5px; color: var(--text-muted); font-weight: 600;
    display: flex; align-items: center; gap: 8px;
  }
  .sidebar-label::after { content: ''; flex: 1; height: 1px; background: var(--border); }
  .sidebar-badge {
    margin-left: auto; font-size: 0.6rem; padding: 1px 7px;
    border-radius: 10px; background: var(--red); color: white; font-weight: 600;
  }
  .sidebar-item.key-facts-btn { color: var(--term-green); position: relative; }
  .sidebar-item.key-facts-btn::after {
    content: 'NEW'; font-size: 0.5rem; padding: 1px 5px; border-radius: 6px;
    background: rgba(74,222,128,0.15); color: var(--term-green);
    font-weight: 700; letter-spacing: 0.5px; margin-left: auto;
  }

  /* ── Chat Area ── */
  .chat-area { flex: 1; display: flex; flex-direction: column; background: var(--midnight); position: relative; }
  .chat-topbar {
    padding: 12px 20px; border-bottom: 1px solid var(--border);
    display: flex; align-items: center; gap: 12px; background: rgba(16,15,34,0.9);
  }
  .char-avatar-lg {
    width: 42px; height: 42px; border-radius: 50%;
    background: linear-gradient(135deg, var(--violet), var(--pink));
    display: flex; align-items: center; justify-content: center; font-size: 1.1rem;
  }
  .char-info h2 { font-family: 'Cormorant Garamond', serif; font-size: 1.05rem; font-weight: 500; }
  .char-info .subtitle { font-size: 0.7rem; color: var(--text-muted); }
  .chat-messages-bg {
    flex: 1; overflow-y: auto; padding: 20px 24px;
    display: flex; flex-direction: column; gap: 16px;
  }
  .bg-message {
    display: flex; gap: 12px; padding: 14px 16px; border-radius: var(--radius);
    background: rgba(22,20,48,0.7); border: 1px solid var(--border); max-width: 85%;
  }
  .bg-message.user-msg { margin-left: auto; }
  .bg-message .bg-avatar {
    width: 32px; height: 32px; border-radius: 50%; flex-shrink: 0;
    display: flex; align-items: center; justify-content: center; font-size: 0.75rem;
  }
  .bg-message .bg-avatar.user { background: linear-gradient(135deg, var(--teal), var(--indigo)); }
  .bg-message .bg-avatar.char { background: linear-gradient(135deg, var(--violet), var(--pink)); }
  .bg-message .bg-sender { font-size: 0.68rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
  .bg-message .bg-text { font-family: 'Cormorant Garamond', serif; font-size: 0.95rem; line-height: 1.55; }
  .bg-message .bg-text em { color: var(--text-secondary); }
  .bg-message.highlighted-msg {
    border-color: var(--gold) !important; background: rgba(255,213,79,0.06) !important;
    box-shadow: 0 0 20px rgba(255,213,79,0.08);
  }
  .chat-input-bar {
    padding: 12px 20px; border-top: 1px solid var(--border);
    display: flex; align-items: center; gap: 10px; background: var(--deep);
  }
  .chat-input-bar input {
    flex: 1; padding: 10px 16px; border-radius: 20px;
    border: 1px solid var(--border); background: var(--surface);
    color: var(--text-muted); font-family: 'Raleway', sans-serif; font-size: 0.85rem;
  }
  .chat-input-bar button {
    padding: 8px 16px; border-radius: 20px; border: 1px solid var(--violet);
    background: rgba(124,77,255,0.15); color: var(--lavender); font-size: 0.8rem; cursor: default;
  }

  /* ═══════════════════════════════════════════
     TERMINAL POPUP
     ═══════════════════════════════════════════ */
  .terminal-overlay {
    position: fixed; inset: 0; background: rgba(0,0,0,0.5);
    backdrop-filter: blur(3px); z-index: 100;
    display: flex; align-items: center; justify-content: center;
    opacity: 0; pointer-events: none; transition: opacity 0.25s ease;
  }
  .terminal-overlay.open { opacity: 1; pointer-events: all; }

  .terminal {
    width: 580px; max-width: 94vw; max-height: 84vh;
    display: flex; flex-direction: column;
    background: var(--term-bg); border: 1px solid rgba(74,222,128,0.2);
    border-radius: 10px;
    box-shadow: 0 8px 48px rgba(0,0,0,0.6), 0 0 30px rgba(74,222,128,0.06);
    transform: scale(0.95) translateY(10px); transition: transform 0.25s ease;
    overflow: hidden;
  }
  .terminal-overlay.open .terminal { transform: scale(1) translateY(0); }

  .term-header {
    display: flex; align-items: center; padding: 10px 14px;
    background: var(--term-header); border-bottom: 1px solid rgba(74,222,128,0.12);
    gap: 10px; cursor: default; user-select: none;
  }
  .term-dots { display: flex; gap: 6px; }
  .term-dot { width: 11px; height: 11px; border-radius: 50%; cursor: pointer; transition: opacity 0.15s; }
  .term-dot:hover { opacity: 0.7; }
  .term-dot.red { background: #ff5f57; }
  .term-dot.yellow { background: #febc2e; }
  .term-dot.green { background: #28c840; }
  .term-title {
    flex: 1; text-align: center; font-family: 'JetBrains Mono', monospace;
    font-size: 0.72rem; color: var(--term-dim); letter-spacing: 0.5px;
  }
  .term-stats {
    font-family: 'JetBrains Mono', monospace; font-size: 0.62rem;
    color: var(--term-dim); display: flex; gap: 12px;
  }
  .term-stats .stat-val { color: var(--term-cyan); }

  /* Toolbar */
  .term-toolbar {
    display: flex; align-items: center; padding: 8px 14px; gap: 6px;
    border-bottom: 1px solid rgba(74,222,128,0.08); background: rgba(17,24,39,0.6);
    flex-wrap: wrap;
  }
  .term-cmd-btn {
    font-family: 'JetBrains Mono', monospace; font-size: 0.68rem;
    padding: 4px 10px; border-radius: 4px;
    border: 1px solid rgba(74,222,128,0.2); background: rgba(74,222,128,0.06);
    color: var(--term-green); cursor: pointer; transition: all 0.15s; white-space: nowrap;
  }
  .term-cmd-btn:hover { background: rgba(74,222,128,0.14); border-color: rgba(74,222,128,0.4); }
  .term-cmd-btn.running { pointer-events: none; opacity: 0.5; }
  .term-cmd-btn.reextract {
    border-color: rgba(251,191,36,0.2); background: rgba(251,191,36,0.06); color: var(--term-amber);
  }
  .term-cmd-btn.reextract:hover { background: rgba(251,191,36,0.14); border-color: rgba(251,191,36,0.4); }
  .term-cmd-btn.secondary {
    border-color: rgba(34,211,238,0.2); background: rgba(34,211,238,0.06); color: var(--term-cyan);
  }
  .term-cmd-btn.secondary:hover { background: rgba(34,211,238,0.14); border-color: rgba(34,211,238,0.4); }
  .term-toolbar-sep { width: 1px; height: 20px; background: rgba(74,222,128,0.1); margin: 0 2px; }
  .term-filter-group { margin-left: auto; display: flex; gap: 4px; }
  .term-filter {
    font-family: 'JetBrains Mono', monospace; font-size: 0.6rem;
    padding: 3px 7px; border-radius: 3px; border: 1px solid transparent;
    background: transparent; color: var(--term-dim); cursor: pointer; transition: all 0.15s;
    text-transform: uppercase;
  }
  .term-filter:hover { color: var(--term-text); }
  .term-filter.active { border-color: rgba(167,139,250,0.3); background: rgba(167,139,250,0.1); color: var(--term-purple); }

  /* Terminal body */
  .term-body {
    flex: 1; overflow-y: auto; padding: 12px 14px;
    font-family: 'JetBrains Mono', monospace; font-size: 0.75rem; line-height: 1.7;
    min-height: 200px; max-height: 52vh;
    scrollbar-width: thin; scrollbar-color: #1a2332 transparent;
  }
  .term-body::-webkit-scrollbar { width: 5px; }
  .term-body::-webkit-scrollbar-thumb { background: #1a2332; border-radius: 3px; }

  .term-line { animation: termFade 0.3s ease; padding: 2px 0; }
  @keyframes termFade { from { opacity: 0; transform: translateX(-4px); } to { opacity: 1; transform: translateX(0); } }
  .term-prompt { color: var(--term-green); }
  .term-cmd { color: var(--term-text); }
  .term-info { color: var(--term-cyan); }
  .term-warn { color: var(--term-amber); }
  .term-error { color: var(--term-red); }
  .term-dim { color: var(--term-dim); }
  .term-highlight { color: var(--term-purple); }
  .term-success { color: var(--term-green); }

  /* Fact entries */
  .term-fact {
    padding: 6px 10px; margin: 4px 0; border-left: 2px solid var(--term-dim);
    background: rgba(255,255,255,0.02); border-radius: 0 4px 4px 0;
    cursor: default; transition: all 0.15s; position: relative; display: flex; gap: 8px;
  }
  .term-fact:hover { background: rgba(255,255,255,0.04); }
  .term-fact.cat-character { border-left-color: var(--term-purple); }
  .term-fact.cat-relationship { border-left-color: var(--pink); }
  .term-fact.cat-event { border-left-color: var(--term-cyan); }
  .term-fact.cat-item { border-left-color: var(--term-amber); }
  .term-fact.cat-location { border-left-color: var(--term-green); }
  .term-fact.cat-plot { border-left-color: var(--amber); }
  .term-fact .fact-tag { font-size: 0.58rem; text-transform: uppercase; letter-spacing: 0.5px; flex-shrink: 0; min-width: 55px; }
  .term-fact.cat-character .fact-tag { color: var(--term-purple); }
  .term-fact.cat-relationship .fact-tag { color: var(--pink); }
  .term-fact.cat-event .fact-tag { color: var(--term-cyan); }
  .term-fact.cat-item .fact-tag { color: var(--term-amber); }
  .term-fact.cat-location .fact-tag { color: var(--term-green); }
  .term-fact.cat-plot .fact-tag { color: var(--amber); }
  .term-fact .fact-body { flex: 1; color: var(--term-text); font-size: 0.72rem; }
  .term-fact .fact-actions-row { display: flex; gap: 6px; flex-shrink: 0; opacity: 0; transition: opacity 0.15s; }
  .term-fact:hover .fact-actions-row { opacity: 1; }
  .fact-micro-btn {
    font-family: 'JetBrains Mono', monospace; font-size: 0.58rem;
    padding: 2px 5px; border-radius: 3px; border: 1px solid var(--term-dim);
    background: transparent; color: var(--term-dim); cursor: pointer; transition: all 0.15s;
  }
  .fact-micro-btn:hover { border-color: var(--term-text); color: var(--term-text); }
  .fact-micro-btn.pin-btn.pinned { border-color: var(--term-amber); color: var(--term-amber); background: rgba(251,191,36,0.08); }
  .fact-micro-btn.del-btn:hover { border-color: var(--term-red); color: var(--term-red); }
  .fact-micro-btn.src-btn:hover { border-color: var(--term-cyan); color: var(--term-cyan); }

  .term-cursor {
    display: inline-block; width: 7px; height: 14px;
    background: var(--term-green); animation: blink 1s step-end infinite;
    vertical-align: middle; margin-left: 2px;
  }
  @keyframes blink { 50% { opacity: 0; } }

  /* Footer - injection preview */
  .term-footer {
    border-top: 1px solid rgba(74,222,128,0.12); padding: 8px 14px;
    background: rgba(17,24,39,0.8); font-family: 'JetBrains Mono', monospace;
    font-size: 0.62rem; color: var(--term-dim); display: none; max-height: 110px; overflow-y: auto;
  }
  .term-footer.visible { display: block; }
  .term-footer .footer-label { color: var(--term-cyan); margin-bottom: 4px; }
  .term-footer pre { font-size: 0.6rem; line-height: 1.5; white-space: pre-wrap; color: var(--term-dim); }

  /* Scan progress bar */
  .scan-progress { height: 2px; background: rgba(74,222,128,0.1); overflow: hidden; display: none; }
  .scan-progress.active { display: block; }
  .scan-progress-bar {
    height: 100%; width: 0%;
    background: linear-gradient(90deg, var(--term-green), var(--term-cyan));
    transition: width 0.3s ease; box-shadow: 0 0 8px rgba(74,222,128,0.3);
  }

  /* ═══════════════════════════════════════════
     CONFIG PANEL
     ═══════════════════════════════════════════ */
  .config-panel {
    display: none; flex-direction: column; gap: 0;
    padding: 0; overflow-y: auto;
    font-family: 'Raleway', sans-serif; font-size: 0.82rem;
    flex: 1; min-height: 200px; max-height: 52vh;
    scrollbar-width: thin; scrollbar-color: #1a2332 transparent;
  }
  .config-panel::-webkit-scrollbar { width: 5px; }
  .config-panel::-webkit-scrollbar-thumb { background: #1a2332; border-radius: 3px; }
  .config-panel.visible { display: flex; }

  .cfg-section { padding: 14px 18px; border-bottom: 1px solid rgba(74,222,128,0.08); }
  .cfg-section-title {
    font-size: 0.72rem; font-weight: 600; text-transform: uppercase;
    letter-spacing: 1px; margin-bottom: 12px; display: flex; align-items: center; gap: 8px;
  }
  .cfg-section-title .cfg-icon { font-size: 0.9rem; }
  .cfg-section-title.connection { color: var(--term-cyan); }
  .cfg-section-title.memory { color: var(--term-purple); }
  .cfg-section-title.scanning { color: var(--term-green); }
  .cfg-section-title.advanced { color: var(--term-dim); }

  .cfg-row {
    display: flex; align-items: center; justify-content: space-between;
    padding: 8px 0; gap: 12px;
  }
  .cfg-label {
    font-size: 0.78rem; color: var(--term-text); display: flex;
    flex-direction: column; gap: 2px;
  }
  .cfg-label .cfg-hint {
    font-size: 0.62rem; color: var(--term-dim); font-style: italic; max-width: 260px;
  }

  /* Fake select */
  .cfg-select {
    padding: 5px 28px 5px 10px; border-radius: 5px;
    border: 1px solid rgba(74,222,128,0.2); background: rgba(74,222,128,0.06);
    color: var(--term-green); font-family: 'JetBrains Mono', monospace; font-size: 0.7rem;
    cursor: pointer; appearance: none; min-width: 170px;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%234ade80'/%3E%3C/svg%3E");
    background-repeat: no-repeat; background-position: right 10px center;
  }
  .cfg-select:focus { outline: none; border-color: rgba(74,222,128,0.5); }
  .cfg-select option { background: var(--term-bg); color: var(--term-text); }

  /* Toggle switch */
  .cfg-toggle {
    position: relative; width: 40px; height: 22px; cursor: pointer; flex-shrink: 0;
  }
  .cfg-toggle input { opacity: 0; width: 0; height: 0; }
  .cfg-toggle .slider {
    position: absolute; inset: 0; border-radius: 11px;
    background: rgba(75,94,111,0.4); transition: all 0.2s;
  }
  .cfg-toggle .slider::after {
    content: ''; position: absolute; width: 16px; height: 16px; border-radius: 50%;
    left: 3px; top: 3px; background: var(--term-dim); transition: all 0.2s;
  }
  .cfg-toggle input:checked + .slider { background: rgba(74,222,128,0.25); }
  .cfg-toggle input:checked + .slider::after { transform: translateX(18px); background: var(--term-green); }

  /* Slider */
  .cfg-slider-wrap { display: flex; align-items: center; gap: 10px; }
  .cfg-slider {
    -webkit-appearance: none; appearance: none; width: 120px; height: 4px;
    border-radius: 2px; background: rgba(75,94,111,0.4); outline: none;
  }
  .cfg-slider::-webkit-slider-thumb {
    -webkit-appearance: none; width: 14px; height: 14px; border-radius: 50%;
    background: var(--term-green); cursor: pointer; border: 2px solid var(--term-bg);
  }
  .cfg-slider::-moz-range-thumb {
    width: 14px; height: 14px; border-radius: 50%;
    background: var(--term-green); cursor: pointer; border: 2px solid var(--term-bg);
  }
  .cfg-slider-val {
    font-family: 'JetBrains Mono', monospace; font-size: 0.65rem;
    color: var(--term-cyan); min-width: 55px;
  }

  /* Number input */
  .cfg-number {
    width: 60px; padding: 4px 8px; border-radius: 5px;
    border: 1px solid rgba(74,222,128,0.2); background: rgba(74,222,128,0.06);
    color: var(--term-green); font-family: 'JetBrains Mono', monospace;
    font-size: 0.72rem; text-align: center;
  }
  .cfg-number:focus { outline: none; border-color: rgba(74,222,128,0.5); }

  /* Memory size pills */
  .cfg-pills { display: flex; gap: 4px; }
  .cfg-pill {
    padding: 4px 12px; border-radius: 4px; font-size: 0.66rem;
    font-family: 'JetBrains Mono', monospace;
    border: 1px solid rgba(167,139,250,0.15); background: transparent;
    color: var(--term-dim); cursor: pointer; transition: all 0.15s;
  }
  .cfg-pill:hover { color: var(--term-text); border-color: rgba(167,139,250,0.3); }
  .cfg-pill.active { background: rgba(167,139,250,0.12); border-color: rgba(167,139,250,0.4); color: var(--term-purple); }

  /* Advanced section collapsible */
  .cfg-advanced-toggle {
    font-size: 0.65rem; color: var(--term-dim); cursor: pointer;
    padding: 8px 18px; display: flex; align-items: center; gap: 6px;
    transition: color 0.15s; user-select: none;
  }
  .cfg-advanced-toggle:hover { color: var(--term-text); }
  .cfg-advanced-toggle .arrow { transition: transform 0.2s; display: inline-block; }
  .cfg-advanced-toggle.expanded .arrow { transform: rotate(90deg); }
  .cfg-advanced-body { display: none; }
  .cfg-advanced-body.visible { display: block; }

  .cfg-back-btn {
    font-family: 'JetBrains Mono', monospace; font-size: 0.68rem;
    padding: 4px 12px; border-radius: 4px;
    border: 1px solid rgba(74,222,128,0.2); background: rgba(74,222,128,0.06);
    color: var(--term-green); cursor: pointer; transition: all 0.15s;
  }
  .cfg-back-btn:hover { background: rgba(74,222,128,0.14); }

  /* Save button */
  .cfg-save-btn {
    display: flex; align-items: center; gap: 6px;
    font-family: 'JetBrains Mono', monospace; font-size: 0.68rem;
    padding: 5px 14px; border-radius: 4px;
    border: 1px solid rgba(74,222,128,0.3); background: rgba(74,222,128,0.1);
    color: var(--term-green); cursor: pointer; transition: all 0.2s;
  }
  .cfg-save-btn:hover { background: rgba(74,222,128,0.2); border-color: rgba(74,222,128,0.5); }
  .cfg-save-btn.saved {
    border-color: rgba(74,222,128,0.5); background: rgba(74,222,128,0.2);
    color: var(--term-green);
  }
  .cfg-save-btn .save-icon { font-size: 0.85rem; line-height: 1; }

  /* ═══════════════════════════════════════════
     SEARCHABLE MODEL DROPDOWN
     ═══════════════════════════════════════════ */
  .model-picker { position: relative; min-width: 200px; }

  .model-picker-trigger {
    display: flex; align-items: center; gap: 8px;
    padding: 5px 10px; border-radius: 5px;
    border: 1px solid rgba(74,222,128,0.2); background: rgba(74,222,128,0.06);
    color: var(--term-green); font-family: 'JetBrains Mono', monospace; font-size: 0.7rem;
    cursor: pointer; transition: all 0.15s; min-width: 200px; justify-content: space-between;
  }
  .model-picker-trigger:hover { border-color: rgba(74,222,128,0.4); }
  .model-picker-trigger.open { border-color: rgba(74,222,128,0.5); background: rgba(74,222,128,0.1); }
  .model-picker-trigger .mp-arrow { font-size: 0.55rem; color: var(--term-dim); transition: transform 0.2s; }
  .model-picker-trigger.open .mp-arrow { transform: rotate(180deg); }
  .model-picker-trigger .mp-selected-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .model-picker-dropdown {
    position: absolute; top: calc(100% + 4px); left: 0; right: 0;
    min-width: 340px;
    background: #0c1420; border: 1px solid rgba(74,222,128,0.2);
    border-radius: 6px; z-index: 50; display: none;
    box-shadow: 0 8px 32px rgba(0,0,0,0.6), 0 0 12px rgba(74,222,128,0.05);
    max-height: 320px; flex-direction: column; overflow: hidden;
  }
  .model-picker-dropdown.open { display: flex; }

  .mp-search-wrap {
    padding: 8px 10px; border-bottom: 1px solid rgba(74,222,128,0.1);
    position: sticky; top: 0; background: #0c1420; z-index: 1;
  }
  .mp-search {
    width: 100%; padding: 6px 10px; border-radius: 4px;
    border: 1px solid rgba(74,222,128,0.15); background: rgba(0,0,0,0.3);
    color: var(--term-text); font-family: 'JetBrains Mono', monospace; font-size: 0.68rem;
    outline: none;
  }
  .mp-search::placeholder { color: var(--term-dim); }
  .mp-search:focus { border-color: rgba(74,222,128,0.4); }

  .mp-list {
    overflow-y: auto; flex: 1; max-height: 260px;
    scrollbar-width: thin; scrollbar-color: #1a2332 transparent;
  }
  .mp-list::-webkit-scrollbar { width: 4px; }
  .mp-list::-webkit-scrollbar-thumb { background: #1a2332; border-radius: 2px; }

  .mp-item {
    display: flex; align-items: center; gap: 8px;
    padding: 7px 12px; cursor: pointer; transition: background 0.1s;
    border-bottom: 1px solid rgba(255,255,255,0.03);
    font-family: 'JetBrains Mono', monospace; font-size: 0.63rem;
  }
  .mp-item:hover { background: rgba(74,222,128,0.06); }
  .mp-item.selected { background: rgba(74,222,128,0.1); }

  .mp-radio {
    width: 14px; height: 14px; border-radius: 50%; flex-shrink: 0;
    border: 2px solid var(--term-dim); display: flex; align-items: center; justify-content: center;
    transition: all 0.15s;
  }
  .mp-item.selected .mp-radio { border-color: var(--term-green); }
  .mp-item.selected .mp-radio::after {
    content: '✓'; color: var(--term-green); font-size: 0.55rem; font-weight: 700;
  }

  .mp-model-name { color: var(--term-text); font-weight: 500; white-space: nowrap; }
  .mp-model-meta { color: var(--term-dim); font-size: 0.58rem; display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
  .mp-model-meta .mp-sep { color: rgba(75,94,111,0.5); }
  .mp-model-tag {
    font-size: 0.5rem; padding: 1px 5px; border-radius: 3px;
    text-transform: uppercase; letter-spacing: 0.3px; font-weight: 600;
  }
  .mp-model-tag.premium { background: rgba(251,191,36,0.12); color: var(--term-amber); }
  .mp-model-tag.free { background: rgba(74,222,128,0.1); color: var(--term-green); }
  .mp-item-info { display: flex; flex-direction: column; gap: 1px; flex: 1; min-width: 0; }

  .mp-item.hidden { display: none; }

  /* ── Responsive ── */
  @media (max-width: 700px) {
    .sidebar { width: 60px; }
    .sidebar-item span:not(.icon) { display: none; }
    .sidebar-label { display: none; }
    .sidebar-item.key-facts-btn::after { display: none; }
    .sidebar-badge { display: none; }
    .terminal { width: 96vw; max-height: 88vh; }
    .term-filter-group { display: none; }
    .term-stats { display: none; }
    .cfg-row { flex-direction: column; align-items: flex-start; gap: 6px; }
    .model-picker-dropdown { min-width: 280px; }
  }
</style>
</head>
<body>

<!-- ═══════════════════════════════════════════
     SIMULATED SILLYTAVERN LAYOUT
     ═══════════════════════════════════════════ -->
<div class="st-background">
  <div class="sidebar">
    <div class="sidebar-section">
      <div class="sidebar-item"><span class="icon">📝</span> <span>Author's Note</span></div>
      <div class="sidebar-item"><span class="icon">🎚</span> <span>CFG Scale</span></div>
      <div class="sidebar-item"><span class="icon">🎯</span> <span>Token Probabilities</span></div>
    </div>
    <div class="sidebar-section">
      <div class="sidebar-item"><span class="icon">💬</span> <span>Start new chat</span></div>
      <div class="sidebar-item"><span class="icon">✖</span> <span>Close chat</span></div>
      <div class="sidebar-item"><span class="icon">📁</span> <span>Manage chat files</span></div>
    </div>
    <div class="sidebar-section">
      <div class="sidebar-item"><span class="icon">🗑</span> <span>Delete messages</span></div>
      <div class="sidebar-item"><span class="icon">🔄</span> <span>Regenerate</span></div>
      <div class="sidebar-item"><span class="icon">🏛</span> <span>Impersonate</span></div>
      <div class="sidebar-item"><span class="icon">→</span> <span>Continue</span></div>
    </div>
    <div class="sidebar-label">✦ Push Modal</div>
    <div class="sidebar-section">
      <div class="sidebar-item"><span class="icon">📨</span> <span>Push Queue</span></div>
      <div class="sidebar-item"><span class="icon">📥</span> <span>Push Inbox</span> <span class="sidebar-badge">0</span></div>
      <div class="sidebar-item"><span class="icon">🗑</span> <span>Character Deletion Manager</span></div>
      <div class="sidebar-item"><span class="icon">📝</span> <span>Send Note</span></div>
      <div class="sidebar-item"><span class="icon">🔑</span> <span>Co-Author Station</span></div>
      <div class="sidebar-item"><span class="icon">🔔</span> <span>Push Notifications</span> <span class="sidebar-badge">0</span></div>
      <div class="sidebar-item key-facts-btn" id="openTerminal"><span class="icon">🔮</span> <span>Threadkeeper</span></div>
      <div class="sidebar-item"><span class="icon">🩺</span> <span>Run Push Diagnostics</span></div>
    </div>
  </div>
  <div class="chat-area">
    <div class="chat-topbar">
      <div class="char-avatar-lg">🌙</div>
      <div class="char-info">
        <h2>Lyra Shadowmend</h2>
        <div class="subtitle">Chapter 12: The Hollow Throne · 8 messages</div>
      </div>
    </div>
    <div class="chat-messages-bg" id="chatBg"></div>
    <div class="chat-input-bar">
      <input type="text" placeholder="Type a message, or /? for help" disabled>
      <button>Send</button>
    </div>
  </div>
</div>

<!-- ═══════════════════════════════════════════
     TERMINAL POPUP
     ═══════════════════════════════════════════ -->
<div class="terminal-overlay" id="termOverlay">
  <div class="terminal" id="terminalBox">
    <div class="term-header">
      <div class="term-dots">
        <div class="term-dot red" id="closeTerminal" title="Close"></div>
        <div class="term-dot yellow" id="clearTerminal" title="Clear"></div>
        <div class="term-dot green" title="Maximize"></div>
      </div>
      <span style="display:inline-flex;width:18px;height:18px;margin-right:4px;">
          <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
            <defs><linearGradient id="tkO" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#a78bfa"/><stop offset="100%" stop-color="#22d3ee"/></linearGradient></defs>
            <circle cx="32" cy="32" r="20" stroke="url(#tkO)" stroke-width="2.5" fill="rgba(167,139,250,0.08)"/>
            <path d="M32 18 C38 20,42 26,40 32 C38 38,32 40,28 36 C24 32,26 26,30 24 C34 22,36 26,34 30" stroke="#a78bfa" stroke-width="2" fill="none" stroke-linecap="round" opacity="0.9"/>
            <path d="M32 46 C26 44,22 38,24 32 C26 26,32 24,36 28 C40 32,38 38,34 40" stroke="#22d3ee" stroke-width="1.5" fill="none" stroke-linecap="round" opacity="0.8"/>
            <circle cx="40" cy="32" r="3" fill="#a78bfa"/><circle cx="28" cy="36" r="2.5" fill="#f0abfc"/><circle cx="34" cy="30" r="2.5" fill="#22d3ee"/>
          </svg>
        </span>
        <div class="term-title">threadkeeper · dreamtavern</div>
      <div class="term-stats">
        <span>facts: <span class="stat-val" id="statFacts">0</span></span>
        <span>pinned: <span class="stat-val" id="statPinned">0</span></span>
        <span>tokens: <span class="stat-val" id="statTokens">~0</span></span>
      </div>
    </div>
    <div class="scan-progress" id="scanProgress">
      <div class="scan-progress-bar" id="scanBar"></div>
    </div>
    <div class="term-toolbar" id="mainToolbar">
      <button class="term-cmd-btn" id="extractBtn">▶ extract</button>
      <button class="term-cmd-btn reextract" id="reextractBtn">⟲ re-extract</button>
      <div class="term-toolbar-sep"></div>
      <button class="term-cmd-btn secondary" id="previewBtn">◉ preview</button>
      <button class="term-cmd-btn secondary" id="settingsBtn">⚙ settings</button>
      <div class="term-filter-group" id="filterGroup">
        <button class="term-filter active" data-f="all">all</button>
        <button class="term-filter" data-f="character">chr</button>
        <button class="term-filter" data-f="relationship">rel</button>
        <button class="term-filter" data-f="event">evt</button>
        <button class="term-filter" data-f="item">itm</button>
        <button class="term-filter" data-f="location">loc</button>
        <button class="term-filter" data-f="plot">plt</button>
      </div>
    </div>

    <!-- MAIN TERMINAL VIEW -->
    <div class="term-body" id="termBody">
      <div class="term-line"><span class="term-prompt">dreamtavern</span> <span class="term-dim">~</span> <span class="term-cmd">threadkeeper v1.0</span></div>
      <div class="term-line"><span class="term-dim">Loaded chat: Lyra Shadowmend · 8 messages · ~2,140 tokens</span></div>
      <div class="term-line"><span class="term-dim">Type </span><span class="term-info">▶ extract</span><span class="term-dim"> to scan for key facts</span></div>
      <div class="term-line"><br></div>
      <div class="term-line"><span class="term-prompt">$</span> <span class="term-cursor"></span></div>
    </div>

    <!-- CONFIG PANEL (hidden by default) -->
    <div class="config-panel" id="configPanel">

      <!-- Connection -->
      <div class="cfg-section">
        <div class="cfg-section-title connection"><span class="cfg-icon">🔗</span> Connection</div>
        <div class="cfg-row">
          <div class="cfg-label">
            Use connection from
            <span class="cfg-hint">Pick one of your saved connections — the API key is read automatically</span>
          </div>
          <select class="cfg-select" id="cfgConnection">
            <option>🟢 Current active connection</option>
            <option>DreamProvider Alpha</option>
            <option>DreamProvider Beta</option>
            <option>OpenAI</option>
            <option>OpenRouter</option>
          </select>
        </div>
        <div class="cfg-row" style="align-items:flex-start;">
          <div class="cfg-label">
            Model for scanning
            <span class="cfg-hint">A fast, cheap model is best here — type to search and filter</span>
          </div>
          <!-- Searchable Model Picker -->
          <div class="model-picker" id="modelPicker">
            <div class="model-picker-trigger" id="mpTrigger">
              <span class="mp-selected-name" id="mpSelectedName">gpt-4o-mini</span>
              <span class="mp-arrow">▼</span>
            </div>
            <div class="model-picker-dropdown" id="mpDropdown">
              <div class="mp-search-wrap">
                <input class="mp-search" id="mpSearch" type="text" placeholder="Search models..." autocomplete="off" spellcheck="false">
              </div>
              <div class="mp-list" id="mpList">
                <!-- populated by JS -->
              </div>
            </div>
          </div>
        </div>
        <div class="cfg-row">
          <div class="cfg-label">
            Accuracy
            <span class="cfg-hint">Lower = more precise facts. Higher = more creative interpretation</span>
          </div>
          <div class="cfg-slider-wrap">
            <input type="range" class="cfg-slider" id="cfgTemp" min="0" max="10" value="2">
            <span class="cfg-slider-val" id="cfgTempVal">Precise</span>
          </div>
        </div>
      </div>

      <!-- Memory -->
      <div class="cfg-section">
        <div class="cfg-section-title memory"><span class="cfg-icon">🧠</span> Memory</div>
        <div class="cfg-row">
          <div class="cfg-label">
            Max remembered facts
            <span class="cfg-hint">When this limit is reached, oldest non-pinned facts are replaced</span>
          </div>
          <input type="number" class="cfg-number" value="100" min="10" max="500">
        </div>
        <div class="cfg-row">
          <div class="cfg-label">
            How much prompt space to use
            <span class="cfg-hint">How many tokens the facts take up in the prompt sent to your model</span>
          </div>
          <div class="cfg-pills" id="cfgBudget">
            <button class="cfg-pill" data-v="250">Small</button>
            <button class="cfg-pill active" data-v="500">Medium</button>
            <button class="cfg-pill" data-v="800">Large</button>
          </div>
        </div>
        <div class="cfg-row">
          <div class="cfg-label">
            Keep pinned facts across chats
            <span class="cfg-hint">Pinned facts carry over when you start a new chat with the same character</span>
          </div>
          <label class="cfg-toggle"><input type="checkbox" checked><span class="slider"></span></label>
        </div>
      </div>

      <!-- Scanning -->
      <div class="cfg-section">
        <div class="cfg-section-title scanning"><span class="cfg-icon">🔍</span> Scanning</div>
        <div class="cfg-row">
          <div class="cfg-label">
            Auto-scan every
            <span class="cfg-hint">Automatically extract new facts after this many messages (0 = manual only)</span>
          </div>
          <div style="display:flex;align-items:center;gap:6px;">
            <input type="number" class="cfg-number" value="10" min="0" max="50">
            <span style="font-size:0.7rem;color:var(--term-dim);">messages</span>
          </div>
        </div>
        <div class="cfg-row">
          <div class="cfg-label">
            Include hidden messages
            <span class="cfg-hint">Also scan messages you've hidden from the chat — useful if you hid old messages to save space</span>
          </div>
          <label class="cfg-toggle"><input type="checkbox"><span class="slider"></span></label>
        </div>
      </div>

      <!-- Advanced (collapsed) -->
      <div class="cfg-advanced-toggle" id="advancedToggle">
        <span class="arrow">▶</span> Advanced options
      </div>
      <div class="cfg-advanced-body" id="advancedBody">
        <div class="cfg-section">
          <div class="cfg-section-title advanced"><span class="cfg-icon">⚙</span> Advanced</div>
          <div class="cfg-row">
            <div class="cfg-label">
              Injection position
              <span class="cfg-hint">Where facts appear in the prompt — after Author's Note is usually best</span>
            </div>
            <select class="cfg-select" style="min-width:180px;">
              <option>After Author's Note</option>
              <option>Before Author's Note</option>
              <option>Top of chat history</option>
              <option>At message depth: 4</option>
            </select>
          </div>
          <div class="cfg-row">
            <div class="cfg-label">
              Fact categories
              <span class="cfg-hint">Which types of facts to extract</span>
            </div>
            <span style="font-family:'JetBrains Mono',monospace;font-size:0.62rem;color:var(--term-purple);">All 6 enabled</span>
          </div>
        </div>
      </div>

      <!-- Footer: back + save -->
      <div style="padding:12px 18px;border-top:1px solid rgba(74,222,128,0.08);display:flex;justify-content:space-between;align-items:center;">
        <button class="cfg-back-btn" id="cfgBackBtn">← back to terminal</button>
        <button class="cfg-save-btn" id="cfgSaveBtn">
          <span class="save-icon">💾</span>
          <span class="save-label">Save</span>
        </button>
      </div>
    </div>

    <!-- Footer - injection preview -->
    <div class="term-footer" id="termFooter">
      <div class="footer-label">◉ injection preview — what gets sent to your model:</div>
      <pre id="previewText"></pre>
    </div>
  </div>
</div>

<script>
// ══════════════════════════════════════════════════════════════════
// MODEL DATABASE (simulated, matches ST model list style)
// ══════════════════════════════════════════════════════════════════
const MODELS = [
  { id: 'gpt-4o-mini',              name: 'gpt-4o-mini',              ctx: '128k',  price: '$0.15/$0.60 per Mtok', provider: 'openai',     usage: '52x', tier: '' },
  { id: 'gpt-4o',                   name: 'gpt-4o',                   ctx: '128k',  price: '$2.50/$10 per Mtok',   provider: 'openai',     usage: '31x', tier: 'Premium' },
  { id: 'gpt-4.1-mini',             name: 'gpt-4.1-mini',             ctx: '1M',    price: '$0.40/$1.60 per Mtok', provider: 'openai',     usage: '8x',  tier: '' },
  { id: 'gpt-4.1-nano',             name: 'gpt-4.1-nano',             ctx: '1M',    price: '$0.10/$0.40 per Mtok', provider: 'openai',     usage: '3x',  tier: '' },
  { id: 'claude-3-haiku',           name: 'claude-3-haiku',           ctx: '200k',  price: '$0.25/$1.25 per Mtok', provider: 'anthropic',  usage: '44x', tier: '' },
  { id: 'claude-3.5-sonnet',        name: 'claude-3.5-sonnet',        ctx: '200k',  price: '$3/$15 per Mtok',      provider: 'anthropic',  usage: '18x', tier: 'Premium' },
  { id: 'claude-4-sonnet',          name: 'claude-4-sonnet',          ctx: '200k',  price: '$4/$20 per Mtok',      provider: 'anthropic',  usage: '6x',  tier: 'Premium' },
  { id: 'gemini-2.0-flash',         name: 'gemini-2.0-flash',         ctx: '1M',    price: '$0.10/$0.40 per Mtok', provider: 'google',     usage: '38x', tier: '' },
  { id: 'gemini-3-pro-preview',     name: 'gemini-3-pro-preview',     ctx: 'n/a',   price: 'price n/a',            provider: 'google',     usage: '8x',  tier: 'Premium' },
  { id: 'gemini-3.1-flash-preview', name: 'gemini-3.1-flash-preview', ctx: '65k',   price: '$0.05/$0.03 per Mtok', provider: 'google',     usage: '38x', tier: '' },
  { id: 'llama-3.3-70b',            name: 'llama-3.3-70b',            ctx: '128k',  price: '$0.18/$0.18 per Mtok', provider: 'groq',       usage: '12x', tier: '' },
  { id: 'llama-3.1-8b',             name: 'llama-3.1-8b',             ctx: '128k',  price: '$0.05/$0.08 per Mtok', provider: 'groq',       usage: '8x',  tier: '' },
  { id: 'mistral-small',            name: 'mistral-small',            ctx: '32k',   price: '$0.10/$0.30 per Mtok', provider: 'mistral',    usage: '5x',  tier: '' },
  { id: 'qwen-2.5-72b',             name: 'qwen-2.5-72b',             ctx: '128k',  price: '$0.20/$0.20 per Mtok', provider: 'openrouter', usage: '3x',  tier: '' },
  { id: 'deepseek-v3',              name: 'deepseek-v3',              ctx: '64k',   price: '$0.14/$0.28 per Mtok', provider: 'deepseek',   usage: '7x',  tier: '' },
  { id: 'gemma-3-27b-it',           name: 'gemma-3-27b-it',           ctx: '128k',  price: '$0.08/$0.16 per Mtok', provider: 'google',     usage: '1x',  tier: '' },
];

let selectedModel = 'gpt-4o-mini';

// ══════════════════════════════════════════════════════════════════
// DEMO DATA
// ══════════════════════════════════════════════════════════════════
const MESSAGES = [
  { id: 1, role: 'user', sender: 'Dreamweaver', text: `*Steps through the crumbling archway, the Hollow Throne looming ahead.* "Lyra... I can feel something watching us. The wards here are different — older than anything in the Athenaeum."` },
  { id: 2, role: 'char', sender: 'Lyra Shadowmend', text: `*Her mismatched eyes — the left one amber, the right a pale silver — flicker with unease as she tightens her grip on the staff of woven shadows.* "The wards aren't just old, they're alive. Someone bound a piece of themselves into the stonework." *She traces a glyph on the nearest pillar.* "This is Thalric's work. He was my mentor before the Schism."` },
  { id: 3, role: 'user', sender: 'Dreamweaver', text: `*Hand moves to the enchanted short sword.* "Thalric? I thought he died at the Siege of Duskhollow. If he survived... does that mean the Covenant of Echoes is still intact?"` },
  { id: 4, role: 'char', sender: 'Lyra Shadowmend', text: `"The Covenant doesn't die with its members. It's woven into the ley lines beneath the Athenaeum." *She turns, expression grave.* "If Thalric is alive, he'll know we have the shard. The Moonveil Blade was the one weapon the Covenant feared — it can sever a binding without destroying the bound."` },
  { id: 5, role: 'user', sender: 'Dreamweaver', text: `"Then we need the other two shards." *Pulls out Seraphine's journal from the Whispering Vault.* "The second shard is hidden in the Drowned Library beneath Lake Meren. And the third..." *Flips to a bloodstained page.* "The third is embedded in someone. A living vessel."` },
  { id: 6, role: 'char', sender: 'Lyra Shadowmend', text: `*Her silver eye widens.* "A living vessel... that's a Soul Anchor. Extremely forbidden magic." *She studies the bloodstained page.* "This symbol — it's the mark of the Dreaming Court. They shattered the Blade during the War of Whispered Names. Removing the third shard without the complete Blade would kill the vessel."` },
  { id: 7, role: 'user', sender: 'Dreamweaver', text: `*Notices something glinting on the Hollow Throne — a small silver ring on the armrest.* "Lyra... was that ring there when we came in?"` },
  { id: 8, role: 'char', sender: 'Lyra Shadowmend', text: `*Throws up a barrier of shadow and starlight.* "Don't touch it! That's a Watcher's Lure — Thalric used them as traps. It sends your location to whoever placed it." *Scans with her silver eye.* "He's been here within three days — the binding fades after seventy-two hours. We need to move. Eastern passage to the old aqueducts — I know a safehouse near the Duskmarket."` },
];

const FACTS = [
  { cat: 'character', text: "Lyra Shadowmend: mismatched eyes — left amber, right pale silver. Silver eye sees magical threads invisible to others.", src: 2 },
  { cat: 'character', text: "Lyra wields a staff of woven shadows. Shadows respond to her emotions, curling protectively around her.", src: 2 },
  { cat: 'character', text: "Thalric: Lyra's former mentor. Believed dead at the Siege of Duskhollow — evidence suggests he survived.", src: 2 },
  { cat: 'relationship', text: "Lyra ↔ Thalric: former mentor/student, now adversarial. She recognizes his binding signatures.", src: 2 },
  { cat: 'item', text: "Moonveil Blade (shattered, 3 shards): severs magical bindings without destroying the bound. Feared by Covenant of Echoes.", src: 4 },
  { cat: 'item', text: "Shard #1: in Dreamweaver's satchel, hums near active magic.", src: 1 },
  { cat: 'item', text: "Enchanted short sword: truth-revealing charm, enchanted by Lyra in Chapter 7.", src: 3 },
  { cat: 'item', text: "Seraphine's Journal: coded maps, equations. From the Whispering Vault. Contains all 3 shard locations.", src: 5 },
  { cat: 'item', text: "Watcher's Lure: silver ring trap on the Hollow Throne. Reveals toucher's location. Binding fades after 72hrs.", src: 8 },
  { cat: 'location', text: "Shard #2: Drowned Library beneath Lake Meren.", src: 5 },
  { cat: 'location', text: "Current: Hollow Throne room — ancient living wards with Thalric's binding signatures.", src: 2 },
  { cat: 'location', text: "Safehouse near Duskmarket, via eastern passage → old aqueducts.", src: 8 },
  { cat: 'event', text: "Thalric visited the Hollow Throne within last 72 hours (Watcher's Lure evidence).", src: 8 },
  { cat: 'plot', text: "Shard #3 is a Soul Anchor embedded in a living person. Removal without complete Blade = death.", src: 6 },
  { cat: 'plot', text: "Covenant of Echoes: persists in ley lines beneath the Athenaeum even if members die.", src: 4 },
  { cat: 'plot', text: "Dreaming Court shattered the Moonveil Blade during the War of Whispered Names.", src: 6 },
  { cat: 'plot', text: "Immediate plan: flee east to Duskmarket safehouse → pursue Shard #2 at Drowned Library.", src: 8 },
];

// ══════════════════════════════════════════════════════════════════
// STATE
// ══════════════════════════════════════════════════════════════════
let facts = [];
let activeFilter = 'all';
let isExtracting = false;
let lastScannedIndex = 0;
let showingConfig = false;

// ══════════════════════════════════════════════════════════════════
// RENDER BACKGROUND CHAT
// ══════════════════════════════════════════════════════════════════
function renderBgChat() {
  document.getElementById('chatBg').innerHTML = MESSAGES.map(m => `
    <div class="bg-message ${m.role === 'user' ? 'user-msg' : ''}" id="bgmsg-${m.id}">
      <div class="bg-avatar ${m.role === 'user' ? 'user' : 'char'}">${m.role === 'user' ? '🎭' : '🌙'}</div>
      <div>
        <div class="bg-sender">${m.sender}</div>
        <div class="bg-text">${m.text.replace(/\*([^*]+)\*/g, '<em>$1</em>')}</div>
      </div>
    </div>
  `).join('');
}

// ══════════════════════════════════════════════════════════════════
// TERMINAL OPEN / CLOSE (tap-away → return to chat)
// ══════════════════════════════════════════════════════════════════
const overlay = document.getElementById('termOverlay');

document.getElementById('openTerminal').addEventListener('click', () => {
  overlay.classList.add('open');
  document.getElementById('openTerminal').classList.add('active');
  closeModelDropdown(); // ensure model dropdown is closed
});

document.getElementById('closeTerminal').addEventListener('click', closeTerminal);

// Tap-away: clicking the overlay backdrop closes the terminal → returns to chat
overlay.addEventListener('click', (e) => {
  if (e.target === overlay) closeTerminal();
});

function closeTerminal() {
  overlay.classList.remove('open');
  document.getElementById('openTerminal').classList.remove('active');
  closeModelDropdown();
  if (showingConfig) toggleConfig();
}

// ══════════════════════════════════════════════════════════════════
// SEARCHABLE MODEL PICKER
// ══════════════════════════════════════════════════════════════════
const mpTrigger  = document.getElementById('mpTrigger');
const mpDropdown = document.getElementById('mpDropdown');
const mpSearch   = document.getElementById('mpSearch');
const mpList     = document.getElementById('mpList');
const mpSelectedName = document.getElementById('mpSelectedName');

function renderModelList(filter = '') {
  const q = filter.toLowerCase();
  mpList.innerHTML = MODELS.map(m => {
    const match = !q || m.name.toLowerCase().includes(q) || m.provider.toLowerCase().includes(q);
    const sel = m.id === selectedModel;
    return `
      <div class="mp-item ${sel ? 'selected' : ''} ${match ? '' : 'hidden'}" data-id="${m.id}">
        <div class="mp-radio"></div>
        <div class="mp-item-info">
          <span class="mp-model-name">${m.name}</span>
          <span class="mp-model-meta">
            ${m.ctx} ctx <span class="mp-sep">|</span>
            ${m.price} <span class="mp-sep">|</span>
            ${m.provider} <span class="mp-sep">|</span>
            ${m.usage} usage
            ${m.tier ? `<span class="mp-model-tag premium">${m.tier}</span>` : ''}
          </span>
        </div>
      </div>
    `;
  }).join('');
}

function openModelDropdown() {
  mpDropdown.classList.add('open');
  mpTrigger.classList.add('open');
  mpSearch.value = '';
  renderModelList();
  setTimeout(() => mpSearch.focus(), 50);
}

function closeModelDropdown() {
  mpDropdown.classList.remove('open');
  mpTrigger.classList.remove('open');
}

mpTrigger.addEventListener('click', (e) => {
  e.stopPropagation();
  if (mpDropdown.classList.contains('open')) {
    closeModelDropdown();
  } else {
    openModelDropdown();
  }
});

mpSearch.addEventListener('input', () => {
  renderModelList(mpSearch.value);
});

// Prevent search input clicks from closing the dropdown
mpSearch.addEventListener('click', (e) => e.stopPropagation());

mpList.addEventListener('click', (e) => {
  const item = e.target.closest('.mp-item');
  if (!item) return;
  selectedModel = item.dataset.id;
  mpSelectedName.textContent = selectedModel;
  renderModelList(mpSearch.value);
  setTimeout(closeModelDropdown, 150);
});

// Close model dropdown when clicking outside it
document.addEventListener('click', (e) => {
  if (!e.target.closest('.model-picker')) {
    closeModelDropdown();
  }
});

// Stop clicks inside the dropdown from propagating to terminal/overlay
mpDropdown.addEventListener('click', (e) => e.stopPropagation());

// ══════════════════════════════════════════════════════════════════
// TERMINAL OUTPUT HELPERS
// ══════════════════════════════════════════════════════════════════
const body = document.getElementById('termBody');

function removeCursor() {
  const c = body.querySelector('.term-cursor');
  if (c) c.parentElement.remove();
}

function addLine(html) {
  removeCursor();
  const div = document.createElement('div');
  div.className = 'term-line';
  div.innerHTML = html;
  body.appendChild(div);
  body.scrollTop = body.scrollHeight;
}

function addCursor() {
  addLine(`<span class="term-prompt">$</span> <span class="term-cursor"></span>`);
}

function addFact(fact, index) {
  removeCursor();
  const div = document.createElement('div');
  div.className = `term-fact cat-${fact.cat}`;
  div.dataset.id = index;
  div.innerHTML = `
    <span class="fact-tag">${fact.cat}</span>
    <span class="fact-body">${fact.text}</span>
    <span class="fact-actions-row">
      <button class="fact-micro-btn pin-btn" onclick="togglePin(${index})" title="Pin this fact — pinned facts are always remembered">📌</button>
      <button class="fact-micro-btn src-btn" onclick="showSource(${fact.src})" title="Jump to the message this came from">↗${fact.src}</button>
      <button class="fact-micro-btn del-btn" onclick="deleteFact(${index})" title="Remove this fact">✕</button>
    </span>
  `;
  body.appendChild(div);
  body.scrollTop = body.scrollHeight;
}

// ══════════════════════════════════════════════════════════════════
// EXTRACT (incremental)
// ══════════════════════════════════════════════════════════════════
document.getElementById('extractBtn').addEventListener('click', () => runExtraction(false));
document.getElementById('reextractBtn').addEventListener('click', () => runExtraction(true));

async function runExtraction(fullRescan) {
  if (isExtracting) return;
  isExtracting = true;

  const extractBtn = document.getElementById('extractBtn');
  const reextractBtn = document.getElementById('reextractBtn');
  extractBtn.classList.add('running');
  reextractBtn.classList.add('running');

  const progress = document.getElementById('scanProgress');
  const bar = document.getElementById('scanBar');
  progress.classList.add('active');
  bar.style.width = '0%';

  if (fullRescan) {
    addLine(`<span class="term-prompt">$</span> <span class="term-cmd">re-extract --chat "Lyra Shadowmend" --full</span>`);
    await delay(200);
    const pinnedFacts = facts.filter(f => f && f.pinned);
    const pinnedCount = pinnedFacts.length;
    if (pinnedCount > 0) {
      addLine(`<span class="term-warn">Keeping ${pinnedCount} pinned fact${pinnedCount > 1 ? 's' : ''} · replacing everything else</span>`);
    }
    body.querySelectorAll('.term-fact').forEach(el => {
      const id = parseInt(el.dataset.id);
      if (facts[id] && !facts[id].pinned) {
        el.style.opacity = '0'; el.style.height = '0'; el.style.overflow = 'hidden';
        el.style.margin = '0'; el.style.padding = '0'; el.style.transition = 'all 0.2s ease';
      }
    });
    facts = facts.map(f => f && f.pinned ? f : null);
    lastScannedIndex = 0;
    await delay(300);
    addLine(`<span class="term-dim">Rescanning all ${MESSAGES.length} messages...</span>`);
  } else {
    if (lastScannedIndex >= MESSAGES.length) {
      addLine(`<span class="term-prompt">$</span> <span class="term-cmd">extract</span>`);
      addLine(`<span class="term-dim">No new messages since last scan (${lastScannedIndex}/${MESSAGES.length})</span>`);
      addCursor();
      progress.classList.remove('active');
      extractBtn.classList.remove('running');
      reextractBtn.classList.remove('running');
      isExtracting = false;
      return;
    }
    addLine(`<span class="term-prompt">$</span> <span class="term-cmd">extract --chat "Lyra Shadowmend" --from ${lastScannedIndex + 1}</span>`);
    await delay(200);
    addLine(`<span class="term-dim">Scanning ${MESSAGES.length - lastScannedIndex} new messages...</span>`);
  }

  await delay(300);

  const factsToExtract = FACTS.filter(f => {
    if (!fullRescan && f.src <= lastScannedIndex) return false;
    return !facts.some(ef => ef && ef.text === f.text);
  });

  let msgScanned = new Set();
  for (let i = 0; i < factsToExtract.length; i++) {
    const fact = factsToExtract[i];
    const pct = Math.round(((i + 1) / factsToExtract.length) * 100);
    bar.style.width = pct + '%';

    if (!msgScanned.has(fact.src)) {
      msgScanned.add(fact.src);
      addLine(`<span class="term-dim">├─ scanning msg #${fact.src}:</span> <span class="term-info">${MESSAGES[fact.src - 1].sender}</span>`);
      highlightBgMsg(fact.src);
      await delay(220);
    }

    const newIndex = facts.length;
    facts.push({ ...fact, pinned: false, id: newIndex });
    addFact(facts[newIndex], newIndex);
    updateStats();
    await delay(120 + Math.random() * 160);
  }

  lastScannedIndex = MESSAGES.length;
  await delay(200);
  clearBgHighlights();
  addLine(`<br>`);
  const totalActive = facts.filter(f => f !== null).length;
  addLine(`<span class="term-success">✓ ${fullRescan ? 'Re-extracted' : 'Extracted'} ${factsToExtract.length} facts · ${totalActive} total in memory</span>`);
  addLine(`<span class="term-dim">Prompt space used: ~${estimateTokens()} tokens</span>`);
  addCursor();

  progress.classList.remove('active');
  extractBtn.classList.remove('running');
  reextractBtn.classList.remove('running');
  isExtracting = false;
  updatePreview();
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// ══════════════════════════════════════════════════════════════════
// FACT ACTIONS
// ══════════════════════════════════════════════════════════════════
window.togglePin = function(id) {
  const fact = facts[id];
  if (!fact) return;
  fact.pinned = !fact.pinned;
  const card = body.querySelector(`.term-fact[data-id="${id}"] .pin-btn`);
  if (card) card.classList.toggle('pinned', fact.pinned);
  updateStats();
  updatePreview();
};

window.deleteFact = function(id) {
  facts[id] = null;
  const card = body.querySelector(`.term-fact[data-id="${id}"]`);
  if (card) {
    card.style.opacity = '0'; card.style.height = '0';
    card.style.overflow = 'hidden'; card.style.margin = '0';
    card.style.padding = '0'; card.style.transition = 'all 0.2s ease';
  }
  updateStats();
  updatePreview();
};

window.showSource = function(msgId) {
  highlightBgMsg(msgId);
  setTimeout(clearBgHighlights, 3000);
};

function highlightBgMsg(msgId) {
  clearBgHighlights();
  const el = document.getElementById(`bgmsg-${msgId}`);
  if (el) { el.classList.add('highlighted-msg'); el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
}
function clearBgHighlights() {
  document.querySelectorAll('.highlighted-msg').forEach(e => e.classList.remove('highlighted-msg'));
}

// ══════════════════════════════════════════════════════════════════
// FILTERS
// ══════════════════════════════════════════════════════════════════
document.getElementById('filterGroup').addEventListener('click', (e) => {
  const btn = e.target.closest('.term-filter');
  if (!btn) return;
  document.querySelectorAll('.term-filter').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  activeFilter = btn.dataset.f;
  applyFilter();
});

function applyFilter() {
  body.querySelectorAll('.term-fact').forEach(card => {
    const id = parseInt(card.dataset.id);
    const fact = facts[id];
    if (!fact) return;
    card.style.display = (activeFilter === 'all' || fact.cat === activeFilter) ? 'flex' : 'none';
  });
}

// ══════════════════════════════════════════════════════════════════
// PREVIEW
// ══════════════════════════════════════════════════════════════════
document.getElementById('previewBtn').addEventListener('click', () => {
  const footer = document.getElementById('termFooter');
  footer.classList.toggle('visible');
  updatePreview();
});

function updatePreview() {
  const active = facts.filter(f => f !== null);
  const pinned = active.filter(f => f.pinned);
  const regular = active.filter(f => !f.pinned);
  let out = '[Threadkeeper — Key Facts for Story Continuity]\n';
  if (pinned.length) {
    out += '\n📌 PINNED:\n';
    pinned.forEach(f => out += `• [${f.cat.toUpperCase()}] ${f.text}\n`);
  }
  if (regular.length) {
    out += '\nEXTRACTED:\n';
    regular.forEach(f => out += `• [${f.cat.toUpperCase()}] ${f.text}\n`);
  }
  document.getElementById('previewText').textContent = out;
}

// ══════════════════════════════════════════════════════════════════
// SETTINGS / CONFIG PANEL
// ══════════════════════════════════════════════════════════════════
document.getElementById('settingsBtn').addEventListener('click', toggleConfig);
document.getElementById('cfgBackBtn').addEventListener('click', toggleConfig);

function toggleConfig() {
  showingConfig = !showingConfig;
  document.getElementById('termBody').style.display = showingConfig ? 'none' : 'block';
  document.getElementById('configPanel').classList.toggle('visible', showingConfig);
  document.getElementById('mainToolbar').style.display = showingConfig ? 'none' : 'flex';
  closeModelDropdown();
  // Reset save button when switching views
  const saveBtn = document.getElementById('cfgSaveBtn');
  saveBtn.classList.remove('saved');
  saveBtn.querySelector('.save-label').textContent = 'Save';
}

// Advanced toggle
document.getElementById('advancedToggle').addEventListener('click', function() {
  this.classList.toggle('expanded');
  document.getElementById('advancedBody').classList.toggle('visible');
});

// Temperature slider label
document.getElementById('cfgTemp').addEventListener('input', function() {
  const labels = ['Exact', 'Precise', 'Precise', 'Balanced', 'Balanced', 'Balanced', 'Creative', 'Creative', 'Creative', 'Wild', 'Wild'];
  document.getElementById('cfgTempVal').textContent = labels[parseInt(this.value)];
});

// Budget pills
document.getElementById('cfgBudget').addEventListener('click', (e) => {
  const pill = e.target.closest('.cfg-pill');
  if (!pill) return;
  document.querySelectorAll('#cfgBudget .cfg-pill').forEach(p => p.classList.remove('active'));
  pill.classList.add('active');
});

// ══════════════════════════════════════════════════════════════════
// SAVE BUTTON (floppy disk)
// ══════════════════════════════════════════════════════════════════
document.getElementById('cfgSaveBtn').addEventListener('click', function() {
  const btn = this;
  btn.classList.add('saved');
  btn.querySelector('.save-label').textContent = 'Saved ✓';
  setTimeout(() => {
    btn.classList.remove('saved');
    btn.querySelector('.save-label').textContent = 'Save';
  }, 2000);
});

// ══════════════════════════════════════════════════════════════════
// CLEAR TERMINAL
// ══════════════════════════════════════════════════════════════════
document.getElementById('clearTerminal').addEventListener('click', () => {
  body.innerHTML = '';
  addLine(`<span class="term-prompt">dreamtavern</span> <span class="term-dim">~</span> <span class="term-cmd">threadkeeper v1.0</span>`);
  const active = facts.filter(f => f !== null);
  addLine(`<span class="term-dim">Terminal cleared. ${active.length} facts in memory.</span>`);
  addCursor();
});

// ══════════════════════════════════════════════════════════════════
// STATS
// ══════════════════════════════════════════════════════════════════
function updateStats() {
  const active = facts.filter(f => f !== null);
  document.getElementById('statFacts').textContent = active.length;
  document.getElementById('statPinned').textContent = active.filter(f => f.pinned).length;
  document.getElementById('statTokens').textContent = '~' + estimateTokens();
}

function estimateTokens() {
  const active = facts.filter(f => f !== null);
  return Math.ceil(active.map(f => f.text).join(' ').length / 4);
}

// ══════════════════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════════════════
renderBgChat();
renderModelList();
setTimeout(() => overlay.classList.add('open'), 600);
</script>
</body>
</html>
emo.html…]()


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
├── index.js         — All extension logic (~2300 lines)
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
