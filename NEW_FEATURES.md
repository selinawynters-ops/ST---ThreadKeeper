# 🆕 ThreadKeeper — New Features Guide

Quick guide to the new extraction tone and facts-per-batch controls added in the latest update.

---

## 🎯 Extraction Tone

Control **how facts are worded** when extracted from your roleplay. Two modes:

### Polite (SFW) — Default
Clean, neutral prose without explicit content or sanitization.

**Example facts:**
- "Lyra has mismatched eyes — left amber, right pale silver"
- "Marcus trusts Luna deeply"
- "The crystal shattered during the ritual"

**Use when:**
- General/fantasy roleplays
- PG content
- You want neutral, objective facts

---

### Dog Me Out (NSFW) — Explicit & Unfiltered
Raw, explicit language without softening, sanitizing, or euphemisms. **Profanity is allowed and encouraged** when it authentically captures the content.

**Example facts:**
- "Lyra is a shameless fucking exhibitionist with a massive size kink"
- "Marcus dominates and fucks Luna hard — she begs to be called his slut"
- "The crystal got absolutely shattered during the chaotic ritual"

**Use when:**
- Adult/mature roleplays
- Explicit content matters to the story
- You want raw, unfiltered fact extraction
- Characters are crude, aggressive, or explicitly sexual

**Visual indicator:** The "Dog Me Out" button appears in **red** to clearly signal NSFW mode.

---

## 📊 Facts Per Batch

Adjust **how many facts** are extracted in each LLM call.

### Settings

| Control | Range | Default | What it does |
|---------|-------|---------|--------------|
| **Min facts** | 1–100 | 1 | Minimum facts to extract per batch |
| **Max facts** | 1–100 | 15 | Maximum facts to extract per batch |

### How to Use

1. Open ThreadKeeper → click **⚙ settings**
2. Scroll to **Scanning** section
3. Adjust **Facts per batch** min/max values
4. Click **Save**
5. Next extraction uses the new limits

### Tips

- **Lower max** (e.g., 5–8): Faster extractions, fewer facts per call, more LLM calls total
- **Higher max** (e.g., 20–30): Fewer LLM calls, gathers more facts at once, uses more tokens
- **Min = 1**: Ensures at least something is extracted even if there's minimal content
- Balance token usage vs. extraction quality based on your preference

---

## 🎬 Demo

Open `demo.html` in any browser to **interactively test** both features:

1. Open the demo in your browser
2. Click **⚙ settings** in the terminal
3. Toggle **Extraction tone** between Polite and Dog Me Out
4. Watch the facts in the terminal **change in real-time** to show the difference
5. Adjust **Facts per batch** min/max and see the UI respond

The demo simulates extraction with both tones so you can see exactly what changes.

---

## ⚙️ Settings Location

Both new settings are in the **Scanning** section:

```
⚙ Settings
  ├─ 🔌 Connection
  ├─ 🧠 Memory
  └─ 🔍 Scanning ← HERE
     ├─ Auto-scan every __ messages
     ├─ Include hidden messages
     ├─ Extraction tone        ← NEW
     └─ Facts per batch        ← NEW
```

---

## 📋 Quick Reference

| Feature | Setting | Options | Default |
|---------|---------|---------|---------|
| **Tone** | Extraction tone | Polite, Dog Me Out | Polite |
| **Min batch** | Facts per batch (min) | 1–100 | 1 |
| **Max batch** | Facts per batch (max) | 1–100 | 15 |

---

## ❓ FAQ

**Q: Will changing the tone affect already-extracted facts?**  
A: No. Only new extractions use the selected tone. Existing facts stay as-is.

**Q: Can I mix Polite and Dog Me Out facts?**  
A: No. Each extraction uses the currently selected tone. To get both, you'd need to extract once in Polite, pin facts you want to keep, then extract in Dog Me Out mode.

**Q: What happens if I set min > max?**  
A: The system will use the max value as a floor. Set realistic ranges (e.g., min 1, max 15).

**Q: Does tone affect cost?**  
A: No. Both tones use the same LLM call. The tone only changes the system prompt, not token usage.

**Q: Can I use Dog Me Out for non-explicit content?**  
A: Yes! It's useful anywhere you want raw, blunt descriptions without euphemisms — action sequences, conflicts, dark themes, etc.

---

## 🔧 Technical Details

- **Tone prompts**: Different system prompts guide the LLM to extract facts with the chosen style
- **Batch limits**: Dynamically set the "Max X facts per batch" instruction in the extraction prompt
- **Persistence**: Both settings are saved in your ThreadKeeper config and persist across chats
- **Profanity in Dog Me Out**: Enabled by explicit instruction in the system prompt — LLM uses it when appropriate

---

*For more information, see the main [README.md](README.md)*
