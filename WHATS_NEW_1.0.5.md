# 🧬 ThreadKeeper v1.0.5 — The Group Chat Update

ThreadKeeper now fully supports **group chats**: pinned facts carry across group chats, and a new **Group Continuation** system lets a new chat pick up a group's story — facts, archive, and day numbering — right where the last chat left off.

This release also **overhauls Heal Gaps** (it now finds real gaps instead of re-reporting your archive forever) and adds an **injection guard** that stops the facts block from being silently truncated out of the prompt in long chats.

---

## ✨ New Features

| Feature | Description |
|---------|-------------|
| 🧬 **Group Continuation** | New settings section (visible only in group chats) that carries **facts + archive** from a previous chat of the same group into a new one, so a "part 2" chat starts with the full memory of part 1 instead of a blank slate |
| 🎚️ **Enabled / Disabled pill** | One tap per group turns continuation on or off. Turning it on inside an empty chat seeds it immediately — no chat switch needed |
| 🔍 **Continuation chats picker** | A searchable multi-select (select2) listing every chat in the group. Pick which chats form the continuation lineage — or leave it **empty to treat every chat in the group** as part of it |
| 📅 **Day numbering continues** | Seeding stores a `calendarEpoch` — the earliest ⏳ dashboard date of the *original* chat in the lineage (chained across multi-hop continuations). The new chat's timeline facts keep counting from Day N instead of restarting at Day 1 |
| ⚓ **Timeline anchor carries over** | The newest carried "Day N" fact becomes the *continue from here* anchor for the new chat's very first scan, so the extraction model never resets the story clock |
| 🔗 **Self-extending lineage** | After a chat is seeded, it's automatically added to the continuation list — future chats in the group chain from it without you touching settings |
| 🔔 **Continuation feedback** | A toast confirms how many facts + archived entries were carried and from which chat; the terminal header shows `↳ continuation of "<chat name>"` |
| 🏷️ **Provenance on carried facts** | Carried facts keep their pin state and are tagged with `carriedFrom` (source chat) and `origSourceIndex` (original message number) in chat metadata |

---

## 🔧 Bugs Fixed

| Bug | What Happens Now |
|-----|-----------------|
| 💉 **Facts silently vanished from the prompt in long chats** | In-chat injection placements ("Top of chat history", "At message depth", "After Author's Note" when the Note is in-chat) ride inside the chat history, and history is filled newest-to-oldest until the token budget runs out — so in any context-full chat, a facts block anchored deep in the history (especially "Top of chat history") was **quietly dropped from the prompt entirely**, exactly in the long chats where memory matters most. A new guard now inspects the final assembled prompt right before it's sent: if the facts block didn't survive truncation, it's re-inserted at the top of the remaining history (leading system prompts stay above). Logs a console warning whenever it has to step in |
| 🩹 **Heal Gaps reported giant gaps that weren't real** | Gap detection only looked at *active* facts — but the "Max remembered facts" cap moves older facts to the archive, so every long chat's early range looked like one huge gap. Healing it re-scanned hundreds of already-extracted messages (wasted tokens), the results churned straight back into the archive, and the same "gap" came back on the next click. Gap detection now counts archived facts too — a fact in the archive proves its message was extracted |
| 🩹 **The same gap came back after every heal** | Messages that extraction can never scan — empty ones, and hidden (`is_system`) ones while "Include hidden messages" is off — counted as gap members, creating permanent pseudo-gaps that no amount of healing could fill. They're now neutral: they can't form a gap, but fact-less scannable messages on both sides of a hidden stretch still merge into one gap |
| 📅 **Healed messages got the wrong Day numbers** | Extraction always anchored to the chat's *newest* timeline fact with the instruction "never restart numbering at a lower day" — so healing an early range that happened around Day 12 stamped its facts Day ≥ 47. The anchor is now chosen per batch: the latest timeline fact from *before* the batch's first message. Normal scans are unchanged |
| 🩹 **Healed facts dangled at the bottom of the terminal** | After a heal run the terminal now rebuilds its fact list so refilled facts slot into chronological order |
| 📌 **Cross-chat pinned facts never worked in group chats** | The global pinned store was keyed on the character id, which is undefined in group chats — so "Keep pinned facts across chats" silently did nothing there: pins were never saved globally and new group chats were never seeded. Now keyed on **group id for groups, character id for solo chats** (`groupId ?? characterId`), so pinned facts carry across chats of the same group exactly like they do for a single character |
| ↗ **Dead source button on seeded facts** | Facts seeded from another chat (cross-chat pins, continuation carries) used to render a `↗0` source button that did nothing when tapped — their message numbers belong to a different chat. The button is now hidden whenever a fact has no valid source message in the current chat, in both the active list and the archive |

---

## ⚙️ Settings Location

The new section appears **only while a group chat is open**:

```
⚙ Settings
  ├─ 🔗 Connection
  ├─ 🧠 Memory
  ├─ 🧬 Group continuation   ← NEW (group chats only)
  │    ├─ Continue this group's story across chats   [Enabled | Disabled]
  │    └─ Continuation chats                          [searchable multi-select]
  ├─ 🔍 Scanning
  └─ ⚙ Advanced
```

---

## 🚀 How To Use

1. Open a **group chat** that already has ThreadKeeper facts
2. Open ThreadKeeper → **⚙ settings** → **🧬 Group continuation**
3. Tap **Enabled**
4. *(Optional)* Pick specific chats in **Continuation chats** — leave empty to include the whole group
5. Start a **new chat** in that group
6. ThreadKeeper detects the empty chat, carries facts + archive over from the most recently active continuation chat, and shows a confirmation toast

The new chat scans its own messages from scratch (`lastScannedIndex` resets), while the carried memory keeps the model grounded in everything that already happened.

---

## ❓ FAQ

**Q: Will this touch my existing chats?**
A: No. Seeding only ever targets a chat that has **zero** ThreadKeeper facts and **zero** archived facts. Chats with any existing data are never modified.

**Q: Which chat does it carry from?**
A: The most recently active chat in the continuation pool that actually has ThreadKeeper data (by last message date; ties resolve to the newest chat).

**Q: What does leaving the picker empty mean?**
A: Every chat in the group counts as part of the continuation. Selecting chats restricts the lineage to just those.

**Q: Does this bloat my settings file?**
A: No. Only the toggle and chat *names* are stored in settings. All fact content lives in each chat's own metadata, exactly like before.

**Q: What about the ↗ source buttons on carried facts?**
A: Hidden — those facts point at another chat's messages, so there's nothing to jump to here. Facts extracted in the new chat get normal source buttons.

**Q: I renamed or deleted a chat that was in my continuation list.**
A: Stale entries are pruned automatically the next time the picker loads; seeding skips them harmlessly.

**Q: Does this work in solo (1-on-1) chats?**
A: The continuation section is group-only. Solo chats keep the existing "Keep pinned facts across chats" behavior — which, as of this version, also works properly for groups.

**Q: What if I switch chats while seeding is in flight?**
A: Seeding aborts before writing anything — same chat-switch guard the extraction engine uses, so nothing bleeds into the wrong chat.

---

## 🔧 Technical Details

- **Settings key**: `groupContinuity: { [groupId]: { enabled, chats: [chatFileName] } }` — names only, no fact content
- **Seed trigger**: on chat change, at extension init, and immediately when the pill flips to Enabled; only fires for group chats with continuation enabled and no existing TK data
- **Carried fact shape**: original fact + `sourceIndex: 0`, `origSourceIndex`, `carriedFrom`; pin state preserved
- **Chat metadata additions**: `calendarEpoch` (lineage's Day-1 ⏳ date) and `continuation: { fromChat, seededAt }`
- **Calendar epoch**: `buildCalendarDayMapping` adds the epoch to its date pool, so ⏳ dashboard dates in the new chat map to their true Day N in the lineage
- **Anchor tie-break**: the latest-timeline-anchor pick now resolves equal source indexes to the newest fact, so carried anchors (all `sourceIndex: 0`) hand the correct "continue from Day N" instruction to the first scan
- **Fetching**: previous chats are read via `POST /api/chats/group/get`; the write is guarded against mid-fetch chat switches
- **Cross-chat pin key**: `getCrossChatKey()` returns `groupId ?? characterId` — group uuids and numeric character ids can't collide
- **Injection guard**: listens on `CHAT_COMPLETION_PROMPT_READY` (skipping dry runs); detects the block by its first line (`INJECTION_HEADER` constant, shared by the builder and the guard so they can never drift apart); only acts when an in-chat placement is active and the block is absent; respects the configured injection role. Chat Completion APIs only — Text Completion keeps plain depth injection
- **Heal Gaps detection**: gap = 5+ *scannable* messages (non-empty; hidden only counts when "scan hidden" is on) whose source index has no fact in **active memory or the archive**, within the scanned range
- **Per-batch timeline anchor**: the "continue from here" anchor is the latest timeline fact with `sourceIndex < batch's first message` — continuation-carried facts (`sourceIndex: 0`) qualify for every batch

---

*For more information, see the main [README.md](README.md)*
