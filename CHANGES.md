# 📋 ThreadKeeper — What's New & Fixed

---

## ✨ New Features

| Feature | Description |
|---------|-------------|
| ⚡ **Instant open** | The terminal now opens immediately when tapped or clicked — no more fade delay |
| 📊 **Stats on mobile** | The `facts / pinned / tokens` counter in the terminal header is now visible on mobile devices |
| 🏷️ **Filter buttons on mobile** | The `ALL / CHR / REL / EVT / ITM / LOC / PLT` category filter row is now visible and usable on phones |
| 🔢 **Min facts actually works** | The "Min facts per batch" setting now sends a real instruction to the LLM: *"Extract between N and M facts"* — previously it was saved but ignored |
| 🤬 **Dog Me Out prompt upgraded** | The NSFW extraction prompt now includes explicit examples of what qualifies as profanity so the LLM doesn't self-censor. Word list is spelled out directly — no asterisks, no euphemisms |
| 🕐 **Facts listed in order** | Facts in the terminal are now sorted by the message they came from, oldest first, so they read chronologically |
| 🏷️ **Edit to `timeline` category** | You can now change any fact's category to `timeline` in the edit dialog — previously it was missing from the options |
| 📌 **Unpin All button** | New button in Settings → Memory that removes the pin from every pinned fact in one tap — shows a confirmation count when done |
| 🔔 **Fact extraction notifications** | New toastr notifications now signal when auto-scanning starts, when fact extraction is running, and when extraction finishes so users can tell ThreadKeeper is actively processing messages. Initializing stays up for 5s, scanning for 6s, and extraction complete for 8.5s |
| 🩹 **Heal Gaps button** | New "🩹 Heal Gaps" button in Settings → Memory finds runs of 5+ scanned messages with zero active facts (the fingerprint of skipped extraction batches from earlier runs) and scans only those gap messages. The global scan checkpoint stays unchanged, and messages with active or pinned facts are never re-LLM-called. Alerts you if all gap messages are hidden + scan-hidden is off |
| 🗂️ **Manila folder archive view** | When the archive holds 100+ facts, it now groups them into clickable manila-folder cards (user picks 100 / 200 / 300 facts per folder via pills in Advanced settings). Each folder is labeled by its source-message range and shows its fact count. Click a folder to view its contents, ← folders to go back |
| 📦 **Strict cap with pin-as-label** | Pin is now a curation label, not an archive veto. Auto-archive picks the oldest fact by sourceIndex when the cap is hit, regardless of pin status. Archived facts keep `pinned: true` so restoring them brings the pin back. Pin still protects from `re-extract --full` |
| 🔁 **Per-batch retry on failure** | Each extraction batch now gets one auto-retry on API error / empty response / parse error before pausing. Transient model hiccups no longer stop a multi-batch run. When all attempts fail, the pause is clean and identifies which kind of error caused it |
| 📐 **Dynamic response + max-facts budget** | Both the LLM response token cap (up to 8000) and the per-batch max-facts ceiling (`max(15, batch.length × 3)`) now scale with batch size so big batches no longer truncate mid-JSON or hit an artificial 15-fact cap that conflicts with the "1 timeline per message" rule |
| 💰 **Wider extraction budget + 25-msg batch cap** | Default `batchTokenBudget` bumped 3500 → 5000. New 25-message-per-batch hard cap closes a batch on whichever limit (tokens or message count) hits first |
| 🪟 **Single-scroll whole-interface layout** | The entire ThreadKeeper interface now scrolls as one unit — the overlay handles all scrolling, the terminal and inner panels grow naturally with content. Generous padding around the terminal prevents accidental tap-away dismissal from scroll overshoot |

---

## 🔧 Bugs Fixed

| Bug | What Happens Now |
|-----|-----------------|
| 🗺️ **Source button did nothing** | Tapping ↗ on a fact now closes the terminal and jumps directly to the source message in the chat, centered and highlighted in yellow |
| 💰 **Budget pills didn't apply** | Clicking Small / Medium / Large now re-injects facts immediately — no need to hit Save first |
| 🔄 **Auto-scan didn't trigger** | Enabling auto-scan now immediately scans any messages that have been waiting — you don't have to wait for the next new message |
| 📍 **Injection position changes did nothing** | Changing where facts are injected (After Author's Note, Top of chat, etc.) now takes effect right away without needing to Save |
| 📱 **Mobile fact text & buttons were unstyled** | Fact text sizing and action button tap targets on mobile now correctly apply — they were targeting the wrong CSS classes before |
| 📱 **Too much empty space on mobile** | The blank space above and below the terminal on phones has been reduced by half |
| 📱 **Terminal was edge-to-edge on mobile** | The terminal now has visible side margins so it floats away from the screen edges instead of stretching wall-to-wall |
| 📱 **Terminal was offset to the right on mobile** | The "tap to close" hint was sitting beside the terminal as an invisible flex column, pushing it off-center — it now stacks below the terminal where it belongs |
| 📱 **Buffer zone around terminal** | Increased top and bottom padding around the terminal so users are less likely to accidentally tap browser controls above or navigation below |
| 🔀 **Cross-chat fact bleed** | Extraction running on chat A would keep writing into chat B if you switched mid-run — the async loop captured the chat array but kept reading the live `chat_metadata` binding on every write. Now captures the chat ID when extraction starts, aborts cleanly the moment you switch chats, and `onChatChanged` halts any in-flight extraction immediately |
| 📦 **Stale archive panel on chat switch** | Switching chats while the archive panel was open kept showing the previous chat's archive entries and count. Now re-renders on every chat change, and closing the terminal resets `showingArchive` so reopening starts fresh |
| 📌 **Auto-archive evicted recent facts instead of oldest** | With `autoPin: true`, every extracted fact got pinned. When the cap hit, the algorithm skipped pinned facts as protected and ended up archiving the only unpinned candidates — your newest extractions. Now pin doesn't block archive; the oldest sourceIndex always wins |
| 🕳️ **Silent batch skip created extraction gaps** | When the LLM returned empty or malformed JSON, the batch was skipped with `continue` and the next batch advanced `lastScannedIndex` past the failed range — those messages' facts were permanently lost with no warning. Now any per-batch failure (after one retry) pauses cleanly, preserving the checkpoint exactly at the last good batch |
| 👁️ **`Scan hidden messages` toggle was ignored** | The setting was saved by the UI pill but the extraction loop never consulted it — only the empty-pause recovery flow respected it. Normal extractions always scanned hidden (`is_system: true`) messages regardless. Now correctly skips hidden messages when the toggle is off |
| 📐 **Message depth changes didn't re-inject** | Typing a new depth value into the input saved `messageDepth` but didn't trigger re-injection until the next chat-changed or new-message event. Now re-injects immediately when the active placement uses message-depth |
| 🚫 **`Extract Only` had no live handler** | Toggling "Extract only" only took effect after clicking the Save button — there was no `change` listener on the checkbox. Now toggles immediately re-inject (clearing the prompt when enabled, restoring when disabled) |
| 📜 **Archive scroll position lost on restore/delete** | Clicking ↩ restore or ✕ delete on an archived fact re-rendered the whole list and bounced you back to the top. Now preserves the overlay scroll position so you stay right where you were |
| 🕐 **Archive sorted by archive date instead of source order** | Confusing reading order — facts from msg 200 appeared above facts from msg 1 just because they were archived more recently. Now sorted by source message order (matching active facts) so msg-1 facts are always at the top |
| 📜 **Nested scroll containers froze the config panel** | Terminal had `overflow-y: auto`, inner `.tk-body` and `.tk-config-panel` also had `overflow-y: auto` — they fought each other and the config panel often refused to scroll, hiding settings below the fold. Now the overlay is the single scroll container and the terminal grows naturally |
| 💥 **Big batches truncated mid-JSON** | `responseLength: 1024` was too tight when a 25-message batch needed 30+ facts worth of JSON output. The LLM would cut off mid-fact, parse would fail, and the run would pause. Now scales with batch size up to 8000 tokens |
| 🎯 **Contradictory "15 facts max" vs "1 timeline per message"** | The system prompt told the LLM both "extract 1–15 facts per batch" and "always include a timeline fact for every message in the batch" — for a 25-msg batch these are impossible to satisfy together. LLMs would confuse, hallucinate, or return malformed output. Max now scales to `batch.length × 3` so both rules can be honored |
| 📊 **Terminal log didn't scroll into view after layout change** | After the switch to whole-interface scrolling, `addTerminalLine` was still scrolling the inner `tk-body` (which no longer overflows) instead of the overlay. New log lines could land below the fold and appear to "vanish." Now correctly scrolls the overlay to the bottom on every line append |
