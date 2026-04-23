/**
 * Threadkeeper — LLM Memory for Long Roleplays
 * DreamTavern Extension · v1.0.0
 *
 * Extracts key facts from chat messages using an LLM and injects them
 * into the prompt so the model never forgets what matters.
 */

import { debounce, waitUntilCondition } from '../../../utils.js';
import { getContext, extension_settings, saveMetadataDebounced } from '../../../extensions.js';
import {
    eventSource,
    event_types,
    extension_prompt_types,
    extension_prompt_roles,
    generateRaw,
    setExtensionPrompt,
    saveSettingsDebounced,
} from '../../../../script.js';
import { getTokenCountAsync } from '../../../tokenizers.js';
import { debounce_timeout } from '../../../constants.js';
import { SlashCommandParser } from '../../../slash-commands/SlashCommandParser.js';
import { SlashCommand } from '../../../slash-commands/SlashCommand.js';

// ═══════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════

const MODULE_NAME = 'threadkeeper';
const EXTENSION_PROMPT_KEY = 'threadkeeper_facts';

const CATEGORIES = ['character', 'relationship', 'event', 'item', 'location', 'plot'];
const CATEGORY_LABELS = { character: 'chr', relationship: 'rel', event: 'evt', item: 'itm', location: 'loc', plot: 'plt' };

const ACCURACY_LABELS = ['Exact', 'Precise', 'Precise', 'Balanced', 'Balanced', 'Balanced', 'Creative', 'Creative', 'Creative', 'Wild', 'Wild'];
const BUDGET_MAP = { small: 250, medium: 500, large: 800 };

const DEFAULT_SETTINGS = {
    enabled: true,
    // Connection
    connectionProfile: '__current__',
    model: '',
    temperature: 0.2,
    // Memory
    maxFacts: 100,
    injectBudget: 'medium',
    crossChatPinned: true,
    // Scanning
    autoScanInterval: 10,
    scanHidden: false,
    // Advanced
    injectPosition: extension_prompt_types.IN_CHAT,
    injectDepth: 4,
    injectRole: extension_prompt_roles.SYSTEM,
};

// ═══════════════════════════════════════════════════════════════════
// EXTRACTION PROMPT
// ═══════════════════════════════════════════════════════════════════

const EXTRACTION_SYSTEM_PROMPT = `You are a precise fact extractor for a roleplay conversation. Extract key facts that a language model would need to maintain story consistency.

RULES:
- Output ONLY valid JSON array — no markdown, no commentary
- Each fact: {"category": "<one of: character, relationship, event, item, location, plot>", "text": "<concise fact>", "source_index": <message_number>}
- Be concise: each fact should be one clear sentence
- Focus on facts that would be LOST if the model forgot earlier messages
- Include: character traits, relationships, important items, locations, plot developments, key events
- Do NOT include: dialogue quotes, writing style notes, or obvious real-time actions
- Max 15 facts per batch
- Do not duplicate facts that already exist in the provided existing facts list`;

function buildExtractionPrompt(messages, existingFacts) {
    let prompt = 'Extract key facts from these roleplay messages:\n\n';

    messages.forEach((msg, i) => {
        const sender = msg.is_user ? (msg.name || 'User') : (msg.name || 'Character');
        prompt += `[Message ${msg._tkIndex}] ${sender}: ${msg.mes}\n\n`;
    });

    if (existingFacts.length > 0) {
        prompt += '\n--- EXISTING FACTS (do not duplicate these) ---\n';
        existingFacts.forEach(f => {
            prompt += `• [${f.category}] ${f.text}\n`;
        });
    }

    prompt += '\n--- Extract new facts as JSON array ---';
    return prompt;
}

// ═══════════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════════

let isExtracting = false;
let isTerminalOpen = false;
let showingConfig = false;
let activeFilter = 'all';
let messagesSinceLastScan = 0;

// ═══════════════════════════════════════════════════════════════════
// SETTINGS
// ═══════════════════════════════════════════════════════════════════

function loadSettings() {
    if (!extension_settings[MODULE_NAME]) {
        extension_settings[MODULE_NAME] = {};
    }
    // Fill defaults
    for (const [key, val] of Object.entries(DEFAULT_SETTINGS)) {
        if (extension_settings[MODULE_NAME][key] === undefined) {
            extension_settings[MODULE_NAME][key] = val;
        }
    }
    return extension_settings[MODULE_NAME];
}

function getSettings() {
    return extension_settings[MODULE_NAME] || DEFAULT_SETTINGS;
}

function saveSetting(key, value) {
    extension_settings[MODULE_NAME][key] = value;
    saveSettingsDebounced();
}

// ═══════════════════════════════════════════════════════════════════
// FACT STORAGE (per-chat via chat_metadata)
// ═══════════════════════════════════════════════════════════════════

/**
 * Get the Threadkeeper data from the current chat's metadata.
 * Structure: { facts: [...], lastScannedIndex: number }
 */
function getTkData() {
    const context = getContext();
    if (!context.chat_metadata) return { facts: [], lastScannedIndex: 0 };
    if (!context.chat_metadata.threadkeeper) {
        context.chat_metadata.threadkeeper = { facts: [], lastScannedIndex: 0 };
    }
    return context.chat_metadata.threadkeeper;
}

function setTkData(data) {
    const context = getContext();
    if (!context.chat_metadata) return;
    context.chat_metadata.threadkeeper = data;
    saveMetadataDebounced();
}

function getFacts() {
    return getTkData().facts.filter(f => f !== null);
}

function getPinnedFacts() {
    return getFacts().filter(f => f.pinned);
}

function getLastScannedIndex() {
    return getTkData().lastScannedIndex;
}

function setLastScannedIndex(idx) {
    const data = getTkData();
    data.lastScannedIndex = idx;
    setTkData(data);
}

function addFacts(newFacts) {
    const data = getTkData();
    const settings = getSettings();

    for (const fact of newFacts) {
        // Dedup: skip if very similar fact already exists
        const isDupe = data.facts.some(f => f && f.text === fact.text);
        if (isDupe) continue;

        data.facts.push({
            category: fact.category,
            text: fact.text,
            sourceIndex: fact.source_index || 0,
            pinned: false,
            id: Date.now() + Math.random(),
        });
    }

    // Enforce max facts limit — rotate out oldest non-pinned
    while (data.facts.filter(f => f !== null).length > settings.maxFacts) {
        const oldestNonPinnedIdx = data.facts.findIndex(f => f !== null && !f.pinned);
        if (oldestNonPinnedIdx === -1) break;
        data.facts.splice(oldestNonPinnedIdx, 1);
    }

    setTkData(data);
}

function toggleFactPin(factId) {
    const data = getTkData();
    const fact = data.facts.find(f => f && f.id === factId);
    if (fact) {
        fact.pinned = !fact.pinned;
        setTkData(data);
    }
}

function deleteFact(factId) {
    const data = getTkData();
    const idx = data.facts.findIndex(f => f && f.id === factId);
    if (idx !== -1) {
        data.facts.splice(idx, 1);
        setTkData(data);
    }
}

function clearNonPinnedFacts() {
    const data = getTkData();
    data.facts = data.facts.filter(f => f && f.pinned);
    data.lastScannedIndex = 0;
    setTkData(data);
}

// ═══════════════════════════════════════════════════════════════════
// PROMPT INJECTION
// ═══════════════════════════════════════════════════════════════════

async function injectFacts() {
    const settings = getSettings();
    if (!settings.enabled) {
        setExtensionPrompt(EXTENSION_PROMPT_KEY, '', extension_prompt_types.IN_CHAT, 0);
        return;
    }

    const facts = getFacts();
    if (facts.length === 0) {
        setExtensionPrompt(EXTENSION_PROMPT_KEY, '', extension_prompt_types.IN_CHAT, 0);
        return;
    }

    const budgetTokens = BUDGET_MAP[settings.injectBudget] || 500;
    const pinned = facts.filter(f => f.pinned);
    const regular = facts.filter(f => !f.pinned);

    // Build injection text, prioritizing pinned facts
    let lines = ['[Threadkeeper — Key Facts for Story Continuity]', ''];

    if (pinned.length > 0) {
        lines.push('PINNED (always remember):');
        for (const f of pinned) {
            lines.push(`• [${f.category.toUpperCase()}] ${f.text}`);
        }
        lines.push('');
    }

    if (regular.length > 0) {
        lines.push('EXTRACTED:');
        // Add most recent facts first (more likely relevant)
        for (const f of [...regular].reverse()) {
            lines.push(`• [${f.category.toUpperCase()}] ${f.text}`);
        }
    }

    let injectionText = lines.join('\n');

    // Trim to budget
    const tokenCount = await getTokenCountAsync(injectionText);
    if (tokenCount > budgetTokens) {
        // Remove regular facts from the end (oldest) until we fit
        while (regular.length > 0) {
            regular.pop();
            lines = ['[Threadkeeper — Key Facts for Story Continuity]', ''];
            if (pinned.length > 0) {
                lines.push('PINNED (always remember):');
                for (const f of pinned) lines.push(`• [${f.category.toUpperCase()}] ${f.text}`);
                lines.push('');
            }
            if (regular.length > 0) {
                lines.push('EXTRACTED:');
                for (const f of [...regular].reverse()) lines.push(`• [${f.category.toUpperCase()}] ${f.text}`);
            }
            injectionText = lines.join('\n');
            const newCount = await getTokenCountAsync(injectionText);
            if (newCount <= budgetTokens) break;
        }
    }

    setExtensionPrompt(
        EXTENSION_PROMPT_KEY,
        injectionText,
        settings.injectPosition,
        settings.injectDepth,
        false,
        settings.injectRole,
    );

    return injectionText;
}

// ═══════════════════════════════════════════════════════════════════
// EXTRACTION ENGINE
// ═══════════════════════════════════════════════════════════════════

/**
 * Run fact extraction on chat messages.
 * @param {boolean} fullRescan If true, re-extract all (keeping pinned). If false, incremental.
 * @param {function} logFn Callback for terminal log output: logFn(html)
 * @param {function} progressFn Callback for progress: progressFn(pct)
 * @param {function} factFn Callback when a fact is extracted: factFn(fact)
 */
async function runExtraction(fullRescan = false, logFn = null, progressFn = null, factFn = null) {
    if (isExtracting) return;
    isExtracting = true;

    const log = logFn || (() => {});
    const progress = progressFn || (() => {});
    const onFact = factFn || (() => {});

    try {
        const context = getContext();
        const chat = context.chat;

        if (!chat || chat.length === 0) {
            log('<span class="tk-warn">No chat loaded.</span>');
            return;
        }

        const settings = getSettings();
        let lastScanned = getLastScannedIndex();

        if (fullRescan) {
            log(`<span class="tk-prompt">$</span> <span class="tk-cmd">re-extract --full</span>`);
            const pinnedCount = getPinnedFacts().length;
            if (pinnedCount > 0) {
                log(`<span class="tk-warn">Keeping ${pinnedCount} pinned fact${pinnedCount > 1 ? 's' : ''} · replacing everything else</span>`);
            }
            clearNonPinnedFacts();
            lastScanned = 0;
        } else {
            log(`<span class="tk-prompt">$</span> <span class="tk-cmd">extract --from ${lastScanned + 1}</span>`);
        }

        // Gather messages to scan
        const messagesToScan = [];
        for (let i = lastScanned; i < chat.length; i++) {
            const msg = chat[i];
            // Skip system messages unless scanHidden is enabled
            if (msg.is_system && !settings.scanHidden) continue;
            if (!msg.mes || msg.mes.trim().length === 0) continue;
            messagesToScan.push({ ...msg, _tkIndex: i + 1 });
        }

        if (messagesToScan.length === 0) {
            log(`<span class="tk-dim">No new messages to scan (${lastScanned}/${chat.length})</span>`);
            return;
        }

        log(`<span class="tk-dim">Scanning ${messagesToScan.length} messages...</span>`);

        // Batch messages (~3000 tokens per batch ≈ ~25 messages)
        const BATCH_SIZE = 25;
        const batches = [];
        for (let i = 0; i < messagesToScan.length; i += BATCH_SIZE) {
            batches.push(messagesToScan.slice(i, i + BATCH_SIZE));
        }

        let totalExtracted = 0;
        const existingFacts = getFacts();

        for (let b = 0; b < batches.length; b++) {
            const batch = batches[b];
            const pct = Math.round(((b + 1) / batches.length) * 100);
            progress(pct);

            const firstMsg = batch[0];
            const lastMsg = batch[batch.length - 1];
            log(`<span class="tk-dim">├─ batch ${b + 1}/${batches.length}: messages ${firstMsg._tkIndex}–${lastMsg._tkIndex}</span>`);

            const prompt = buildExtractionPrompt(batch, existingFacts);

            let response;
            try {
                // Temperature mapping: slider 0-10 → actual 0.0-1.0
                const actualTemp = settings.temperature;

                response = await generateRaw({
                    prompt: prompt,
                    systemPrompt: EXTRACTION_SYSTEM_PROMPT,
                    responseLength: 1024,
                });
            } catch (err) {
                log(`<span class="tk-error">API error: ${err.message || 'Unknown error'}</span>`);
                continue;
            }

            if (!response) {
                log(`<span class="tk-warn">Empty response for batch ${b + 1}</span>`);
                continue;
            }

            // Parse JSON from response
            let newFacts = [];
            try {
                // Try to find JSON array in the response
                const jsonMatch = response.match(/\[[\s\S]*?\]/);
                if (jsonMatch) {
                    newFacts = JSON.parse(jsonMatch[0]);
                } else {
                    throw new Error('No JSON array found in response');
                }
            } catch (parseErr) {
                log(`<span class="tk-warn">Parse error in batch ${b + 1}: ${parseErr.message}</span>`);
                console.warn('Threadkeeper: Failed to parse extraction response:', response);
                continue;
            }

            // Validate and add facts
            const validFacts = newFacts.filter(f =>
                f && typeof f.text === 'string' && f.text.length > 0 &&
                CATEGORIES.includes(f.category),
            );

            if (validFacts.length > 0) {
                addFacts(validFacts);
                totalExtracted += validFacts.length;

                for (const fact of validFacts) {
                    existingFacts.push(fact); // Update running list for dedup
                    onFact(fact);
                }
            }
        }

        // Update last scanned index
        setLastScannedIndex(chat.length);
        messagesSinceLastScan = 0;

        // Update injection
        await injectFacts();

        const allFacts = getFacts();
        log(`<br>`);
        log(`<span class="tk-success">✓ ${fullRescan ? 'Re-extracted' : 'Extracted'} ${totalExtracted} facts · ${allFacts.length} total in memory</span>`);

        const tokenEstimate = Math.ceil(allFacts.map(f => f.text).join(' ').length / 4);
        log(`<span class="tk-dim">Prompt space used: ~${tokenEstimate} tokens</span>`);

    } finally {
        isExtracting = false;
    }
}

// ═══════════════════════════════════════════════════════════════════
// MEMORY ORB SVG ICON (bright variant)
// ═══════════════════════════════════════════════════════════════════

const MEMORY_ORB_SVG = `<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="tkOrb" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#a78bfa"/>
      <stop offset="100%" stop-color="#22d3ee"/>
    </linearGradient>
    <radialGradient id="tkGlow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#a78bfa" stop-opacity="0.3"/>
      <stop offset="100%" stop-color="#22d3ee" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <circle cx="32" cy="32" r="22" fill="url(#tkGlow)"/>
  <circle cx="32" cy="32" r="20" stroke="url(#tkOrb)" stroke-width="1.8" fill="rgba(167,139,250,0.06)"/>
  <path d="M32 18 C38 20, 42 26, 40 32 C38 38, 32 40, 28 36 C24 32, 26 26, 30 24 C34 22, 36 26, 34 30 C32 34, 30 34, 30 32" stroke="#a78bfa" stroke-width="1.8" fill="none" stroke-linecap="round" opacity="0.9"/>
  <path d="M32 46 C26 44, 22 38, 24 32 C26 26, 32 24, 36 28 C40 32, 38 38, 34 40 C30 42, 28 38, 30 34" stroke="#22d3ee" stroke-width="1.2" fill="none" stroke-linecap="round" opacity="0.8"/>
  <circle cx="40" cy="32" r="2.5" fill="#a78bfa" opacity="0.9"/>
  <circle cx="28" cy="36" r="2" fill="#f0abfc" opacity="0.9"/>
  <circle cx="34" cy="30" r="2" fill="#22d3ee" opacity="0.9"/>
  <circle cx="30" cy="24" r="1.5" fill="#fbbf24" opacity="0.7"/>
  <circle cx="20" cy="20" r="1.2" fill="#dff0f8" opacity="0.5"/>
  <circle cx="44" cy="22" r="1" fill="#dff0f8" opacity="0.4"/>
  <circle cx="42" cy="44" r="1" fill="#dff0f8" opacity="0.4"/>
  <path d="M24 50 Q32 54 40 50" stroke="#b39ddb" stroke-width="1" fill="none" opacity="0.4"/>
</svg>`;

const MEMORY_ORB_SVG_SMALL = `<svg viewBox="0 0 64 64" width="18" height="18" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="tkOrbS" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#a78bfa"/>
      <stop offset="100%" stop-color="#22d3ee"/>
    </linearGradient>
  </defs>
  <circle cx="32" cy="32" r="20" stroke="url(#tkOrbS)" stroke-width="2.5" fill="rgba(167,139,250,0.08)"/>
  <path d="M32 18 C38 20, 42 26, 40 32 C38 38, 32 40, 28 36 C24 32, 26 26, 30 24 C34 22, 36 26, 34 30" stroke="#a78bfa" stroke-width="2" fill="none" stroke-linecap="round" opacity="0.9"/>
  <path d="M32 46 C26 44, 22 38, 24 32 C26 26, 32 24, 36 28 C40 32, 38 38, 34 40" stroke="#22d3ee" stroke-width="1.5" fill="none" stroke-linecap="round" opacity="0.8"/>
  <circle cx="40" cy="32" r="3" fill="#a78bfa"/>
  <circle cx="28" cy="36" r="2.5" fill="#f0abfc"/>
  <circle cx="34" cy="30" r="2.5" fill="#22d3ee"/>
</svg>`;

// ═══════════════════════════════════════════════════════════════════
// UI — BUILD TERMINAL HTML
// ═══════════════════════════════════════════════════════════════════

function buildTerminalHTML() {
    return `
    <div id="threadkeeper-overlay">
        <div id="threadkeeper-terminal">
            <!-- Header -->
            <div class="tk-header">
                <div class="tk-dots">
                    <div class="tk-dot red" id="tk-close" title="Close"></div>
                    <div class="tk-dot yellow" id="tk-clear" title="Clear terminal"></div>
                    <div class="tk-dot green" title="Threadkeeper"></div>
                </div>
                <span class="tk-header-icon">${MEMORY_ORB_SVG_SMALL}</span>
                <div class="tk-title">threadkeeper · dreamtavern</div>
                <div class="tk-stats">
                    <span>facts: <span class="stat-val" id="tk-stat-facts">0</span></span>
                    <span>pinned: <span class="stat-val" id="tk-stat-pinned">0</span></span>
                    <span>tokens: <span class="stat-val" id="tk-stat-tokens">~0</span></span>
                </div>
            </div>

            <!-- Progress bar -->
            <div class="tk-progress" id="tk-progress">
                <div class="tk-progress-bar" id="tk-progress-bar"></div>
            </div>

            <!-- Toolbar -->
            <div class="tk-toolbar" id="tk-toolbar">
                <button class="tk-cmd-btn" id="tk-extract-btn">▶ extract</button>
                <button class="tk-cmd-btn reextract" id="tk-reextract-btn">⟲ re-extract</button>
                <div class="tk-toolbar-sep"></div>
                <button class="tk-cmd-btn secondary" id="tk-preview-btn">◉ preview</button>
                <button class="tk-cmd-btn secondary" id="tk-settings-btn">⚙ settings</button>
                <div class="tk-filter-group" id="tk-filter-group">
                    <button class="tk-filter active" data-f="all">all</button>
                    <button class="tk-filter" data-f="character">chr</button>
                    <button class="tk-filter" data-f="relationship">rel</button>
                    <button class="tk-filter" data-f="event">evt</button>
                    <button class="tk-filter" data-f="item">itm</button>
                    <button class="tk-filter" data-f="location">loc</button>
                    <button class="tk-filter" data-f="plot">plt</button>
                </div>
            </div>

            <!-- Terminal Body -->
            <div class="tk-body" id="tk-body"></div>

            <!-- Config Panel (hidden by default) -->
            <div class="tk-config-panel" id="tk-config"></div>

            <!-- Injection Preview Footer -->
            <div class="tk-footer" id="tk-footer">
                <div class="footer-label">◉ injection preview — what gets sent to your model:</div>
                <pre id="tk-preview-text"></pre>
            </div>
        </div>
    </div>`;
}

function buildConfigHTML() {
    const settings = getSettings();
    const profiles = getConnectionProfiles();
    const tempIdx = Math.round(settings.temperature * 10);
    const tempLabel = ACCURACY_LABELS[tempIdx] || 'Balanced';

    let profileOptions = '<option value="__current__">🟢 Current active connection</option>';
    for (const p of profiles) {
        const selected = settings.connectionProfile === p.id ? ' selected' : '';
        profileOptions += `<option value="${p.id}"${selected}>${p.name}</option>`;
    }

    return `
    <!-- Connection -->
    <div class="tk-cfg-section">
        <div class="tk-cfg-title connection"><span>🔗</span> Connection</div>
        <div class="tk-cfg-row">
            <div class="tk-cfg-label">
                Use connection from
                <span class="tk-cfg-hint">Pick one of your saved connections — the API key is read automatically</span>
            </div>
            <select class="tk-cfg-select" id="tk-cfg-connection">${profileOptions}</select>
        </div>
        <div class="tk-cfg-row" style="align-items:flex-start;">
            <div class="tk-cfg-label">
                Model for scanning
                <span class="tk-cfg-hint">A fast, cheap model is best — type to search</span>
            </div>
            <div class="tk-model-picker" id="tk-model-picker">
                <div class="tk-mp-trigger" id="tk-mp-trigger">
                    <span class="mp-selected-name" id="tk-mp-selected">${settings.model || 'Use default model'}</span>
                    <span class="mp-arrow">▼</span>
                </div>
                <div class="tk-mp-dropdown" id="tk-mp-dropdown">
                    <div class="tk-mp-search-wrap">
                        <input class="tk-mp-search" id="tk-mp-search" type="text" placeholder="Search models..." autocomplete="off" spellcheck="false">
                    </div>
                    <div class="tk-mp-list" id="tk-mp-list"></div>
                </div>
            </div>
        </div>
        <div class="tk-cfg-row">
            <div class="tk-cfg-label">
                Accuracy
                <span class="tk-cfg-hint">Lower = more precise facts. Higher = more creative interpretation</span>
            </div>
            <div class="tk-slider-wrap">
                <input type="range" class="tk-slider" id="tk-cfg-temp" min="0" max="10" value="${tempIdx}">
                <span class="tk-slider-val" id="tk-cfg-temp-val">${tempLabel}</span>
            </div>
        </div>
    </div>

    <!-- Memory -->
    <div class="tk-cfg-section">
        <div class="tk-cfg-title memory"><span>🧠</span> Memory</div>
        <div class="tk-cfg-row">
            <div class="tk-cfg-label">
                Max remembered facts
                <span class="tk-cfg-hint">Oldest non-pinned facts are replaced when this limit is reached</span>
            </div>
            <input type="number" class="tk-number" id="tk-cfg-maxfacts" value="${settings.maxFacts}" min="10" max="500">
        </div>
        <div class="tk-cfg-row">
            <div class="tk-cfg-label">
                How much prompt space to use
                <span class="tk-cfg-hint">How many tokens the facts take up in the prompt</span>
            </div>
            <div class="tk-pills" id="tk-cfg-budget">
                <button class="tk-pill${settings.injectBudget === 'small' ? ' active' : ''}" data-v="small">Small</button>
                <button class="tk-pill${settings.injectBudget === 'medium' ? ' active' : ''}" data-v="medium">Medium</button>
                <button class="tk-pill${settings.injectBudget === 'large' ? ' active' : ''}" data-v="large">Large</button>
            </div>
        </div>
        <div class="tk-cfg-row">
            <div class="tk-cfg-label">
                Keep pinned facts across chats
                <span class="tk-cfg-hint">Pinned facts carry over when you start a new chat with the same character</span>
            </div>
            <label class="tk-toggle"><input type="checkbox" id="tk-cfg-crosschat" ${settings.crossChatPinned ? 'checked' : ''}><span class="slider"></span></label>
        </div>
    </div>

    <!-- Scanning -->
    <div class="tk-cfg-section">
        <div class="tk-cfg-title scanning"><span>🔍</span> Scanning</div>
        <div class="tk-cfg-row">
            <div class="tk-cfg-label">
                Auto-scan every
                <span class="tk-cfg-hint">Automatically extract new facts after this many messages (0 = manual only)</span>
            </div>
            <div style="display:flex;align-items:center;gap:6px;">
                <input type="number" class="tk-number" id="tk-cfg-autoscan" value="${settings.autoScanInterval}" min="0" max="50">
                <span style="font-size:0.7rem;color:var(--tk-dim);">messages</span>
            </div>
        </div>
        <div class="tk-cfg-row">
            <div class="tk-cfg-label">
                Include hidden messages
                <span class="tk-cfg-hint">Also scan messages hidden from the chat</span>
            </div>
            <label class="tk-toggle"><input type="checkbox" id="tk-cfg-hidden" ${settings.scanHidden ? 'checked' : ''}><span class="slider"></span></label>
        </div>
    </div>

    <!-- Advanced (collapsed) -->
    <div class="tk-advanced-toggle" id="tk-advanced-toggle">
        <span class="arrow">▶</span> Advanced options
    </div>
    <div class="tk-advanced-body" id="tk-advanced-body">
        <div class="tk-cfg-section">
            <div class="tk-cfg-title advanced"><span>⚙</span> Advanced</div>
            <div class="tk-cfg-row">
                <div class="tk-cfg-label">
                    Injection position
                    <span class="tk-cfg-hint">Where facts appear in the prompt</span>
                </div>
                <select class="tk-cfg-select" id="tk-cfg-position">
                    <option value="1"${settings.injectPosition === 1 ? ' selected' : ''}>In-chat at depth</option>
                    <option value="0"${settings.injectPosition === 0 ? ' selected' : ''}>After story string</option>
                </select>
            </div>
            <div class="tk-cfg-row">
                <div class="tk-cfg-label">
                    Injection depth
                    <span class="tk-cfg-hint">How many messages from the bottom (0 = last message)</span>
                </div>
                <input type="number" class="tk-number" id="tk-cfg-depth" value="${settings.injectDepth}" min="0" max="100">
            </div>
        </div>
    </div>

    <!-- Footer: back + save -->
    <div class="tk-cfg-footer">
        <button class="tk-back-btn" id="tk-cfg-back">← back to terminal</button>
        <button class="tk-save-btn" id="tk-cfg-save">
            <span>💾</span>
            <span class="tk-save-label">Save</span>
        </button>
    </div>`;
}

// ═══════════════════════════════════════════════════════════════════
// UI — TERMINAL INTERACTION
// ═══════════════════════════════════════════════════════════════════

function openTerminal() {
    const overlay = document.getElementById('threadkeeper-overlay');
    if (!overlay) return;
    overlay.classList.add('open');
    isTerminalOpen = true;
    refreshTerminalContent();
}

function closeTerminal() {
    const overlay = document.getElementById('threadkeeper-overlay');
    if (!overlay) return;
    overlay.classList.remove('open');
    isTerminalOpen = false;
    if (showingConfig) toggleConfig();
}

function refreshTerminalContent() {
    const body = document.getElementById('tk-body');
    if (!body) return;

    body.innerHTML = '';

    const context = getContext();
    const charName = context.name2 || 'Unknown';
    const chatLength = context.chat?.length || 0;

    addTerminalLine(`<span class="tk-prompt">dreamtavern</span> <span class="tk-dim">~</span> <span class="tk-cmd">threadkeeper v1.0</span>`);
    addTerminalLine(`<span class="tk-dim">Loaded chat: ${charName} · ${chatLength} messages</span>`);

    // Show existing facts
    const facts = getFacts();
    if (facts.length > 0) {
        addTerminalLine(`<span class="tk-dim">${facts.length} facts in memory (${getPinnedFacts().length} pinned)</span>`);
        addTerminalLine(`<br>`);
        for (const fact of facts) {
            addFactLine(fact);
        }
        addTerminalLine(`<br>`);

        const lastScanned = getLastScannedIndex();
        if (lastScanned < chatLength) {
            addTerminalLine(`<span class="tk-info">${chatLength - lastScanned} new messages since last scan</span>`);
        }
    } else {
        addTerminalLine(`<span class="tk-dim">Type </span><span class="tk-info">▶ extract</span><span class="tk-dim"> to scan for key facts</span>`);
    }

    addTerminalLine(`<br>`);
    addCursorLine();
    updateStats();
}

function addTerminalLine(html) {
    const body = document.getElementById('tk-body');
    if (!body) return;
    removeCursor();
    const div = document.createElement('div');
    div.className = 'tk-line';
    div.innerHTML = html;
    body.appendChild(div);
    body.scrollTop = body.scrollHeight;
}

function addFactLine(fact) {
    const body = document.getElementById('tk-body');
    if (!body) return;
    removeCursor();
    const div = document.createElement('div');
    div.className = `tk-fact cat-${fact.category}`;
    div.dataset.factId = fact.id;
    div.innerHTML = `
        <span class="fact-tag">${fact.category}</span>
        <span class="fact-body">${escapeHtml(fact.text)}</span>
        <span class="fact-actions-row">
            <button class="tk-micro-btn pin-btn ${fact.pinned ? 'pinned' : ''}" data-action="pin" data-fact-id="${fact.id}" title="Pin — pinned facts are always remembered">📌</button>
            <button class="tk-micro-btn src-btn" data-action="source" data-source="${fact.sourceIndex}" title="Source message">↗${fact.sourceIndex}</button>
            <button class="tk-micro-btn del-btn" data-action="delete" data-fact-id="${fact.id}" title="Remove">✕</button>
        </span>`;
    body.appendChild(div);
    body.scrollTop = body.scrollHeight;
}

function addCursorLine() {
    addTerminalLine(`<span class="tk-prompt">$</span> <span class="tk-cursor"></span>`);
}

function removeCursor() {
    const body = document.getElementById('tk-body');
    if (!body) return;
    const cursor = body.querySelector('.tk-cursor');
    if (cursor && cursor.parentElement) cursor.parentElement.remove();
}

function updateStats() {
    const facts = getFacts();
    const pinned = getPinnedFacts();
    const tokenEstimate = Math.ceil(facts.map(f => f.text).join(' ').length / 4);

    const elFacts = document.getElementById('tk-stat-facts');
    const elPinned = document.getElementById('tk-stat-pinned');
    const elTokens = document.getElementById('tk-stat-tokens');

    if (elFacts) elFacts.textContent = facts.length;
    if (elPinned) elPinned.textContent = pinned.length;
    if (elTokens) elTokens.textContent = '~' + tokenEstimate;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ═══════════════════════════════════════════════════════════════════
// UI — CONFIG PANEL
// ═══════════════════════════════════════════════════════════════════

function toggleConfig() {
    showingConfig = !showingConfig;
    const body = document.getElementById('tk-body');
    const config = document.getElementById('tk-config');
    const toolbar = document.getElementById('tk-toolbar');

    if (showingConfig) {
        config.innerHTML = buildConfigHTML();
        config.classList.add('visible');
        if (body) body.style.display = 'none';
        if (toolbar) toolbar.style.display = 'none';
        attachConfigListeners();
    } else {
        config.classList.remove('visible');
        config.innerHTML = '';
        if (body) body.style.display = '';
        if (toolbar) toolbar.style.display = '';
    }
}

function attachConfigListeners() {
    // Temperature slider
    const tempSlider = document.getElementById('tk-cfg-temp');
    if (tempSlider) {
        tempSlider.addEventListener('input', function () {
            const label = document.getElementById('tk-cfg-temp-val');
            if (label) label.textContent = ACCURACY_LABELS[parseInt(this.value)] || 'Balanced';
        });
    }

    // Budget pills
    const budgetContainer = document.getElementById('tk-cfg-budget');
    if (budgetContainer) {
        budgetContainer.addEventListener('click', (e) => {
            const pill = e.target.closest('.tk-pill');
            if (!pill) return;
            budgetContainer.querySelectorAll('.tk-pill').forEach(p => p.classList.remove('active'));
            pill.classList.add('active');
        });
    }

    // Advanced toggle
    const advToggle = document.getElementById('tk-advanced-toggle');
    if (advToggle) {
        advToggle.addEventListener('click', function () {
            this.classList.toggle('expanded');
            const body = document.getElementById('tk-advanced-body');
            if (body) body.classList.toggle('visible');
        });
    }

    // Back button
    const backBtn = document.getElementById('tk-cfg-back');
    if (backBtn) backBtn.addEventListener('click', toggleConfig);

    // Save button
    const saveBtn = document.getElementById('tk-cfg-save');
    if (saveBtn) {
        saveBtn.addEventListener('click', () => {
            saveConfigFromUI();
            const label = saveBtn.querySelector('.tk-save-label');
            saveBtn.classList.add('saved');
            if (label) label.textContent = 'Saved ✓';
            setTimeout(() => {
                saveBtn.classList.remove('saved');
                if (label) label.textContent = 'Save';
            }, 2000);
        });
    }

    // Model picker
    setupModelPicker();
}

function saveConfigFromUI() {
    const s = getSettings();

    const connection = document.getElementById('tk-cfg-connection');
    if (connection) saveSetting('connectionProfile', connection.value);

    const model = document.getElementById('tk-mp-selected');
    if (model) saveSetting('model', model.textContent);

    const temp = document.getElementById('tk-cfg-temp');
    if (temp) saveSetting('temperature', parseInt(temp.value) / 10);

    const maxFacts = document.getElementById('tk-cfg-maxfacts');
    if (maxFacts) saveSetting('maxFacts', parseInt(maxFacts.value) || 100);

    const activeBudget = document.querySelector('#tk-cfg-budget .tk-pill.active');
    if (activeBudget) saveSetting('injectBudget', activeBudget.dataset.v);

    const crossChat = document.getElementById('tk-cfg-crosschat');
    if (crossChat) saveSetting('crossChatPinned', crossChat.checked);

    const autoScan = document.getElementById('tk-cfg-autoscan');
    if (autoScan) saveSetting('autoScanInterval', parseInt(autoScan.value) || 0);

    const hidden = document.getElementById('tk-cfg-hidden');
    if (hidden) saveSetting('scanHidden', hidden.checked);

    const position = document.getElementById('tk-cfg-position');
    if (position) saveSetting('injectPosition', parseInt(position.value));

    const depth = document.getElementById('tk-cfg-depth');
    if (depth) saveSetting('injectDepth', parseInt(depth.value) || 4);

    // Re-inject with new settings
    injectFacts();
}

// ═══════════════════════════════════════════════════════════════════
// UI — MODEL PICKER (searchable dropdown)
// ═══════════════════════════════════════════════════════════════════

function setupModelPicker() {
    const trigger = document.getElementById('tk-mp-trigger');
    const dropdown = document.getElementById('tk-mp-dropdown');
    const search = document.getElementById('tk-mp-search');
    const list = document.getElementById('tk-mp-list');

    if (!trigger || !dropdown) return;

    // Populate model list from available models
    const models = getAvailableModels();
    const selectedModel = getSettings().model || '';

    function renderList(filter = '') {
        if (!list) return;
        const q = filter.toLowerCase();
        list.innerHTML = models.map(m => {
            const match = !q || m.name.toLowerCase().includes(q) || (m.provider || '').toLowerCase().includes(q);
            const sel = m.id === selectedModel;
            return `
                <div class="tk-mp-item ${sel ? 'selected' : ''} ${match ? '' : 'hidden'}" data-model-id="${escapeHtml(m.id)}">
                    <div class="tk-mp-radio"></div>
                    <div class="tk-mp-item-info">
                        <span class="tk-mp-model-name">${escapeHtml(m.name)}</span>
                        ${m.provider ? `<span class="tk-mp-model-meta">${escapeHtml(m.provider)}</span>` : ''}
                    </div>
                </div>`;
        }).join('');
    }

    trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = dropdown.classList.contains('open');
        if (isOpen) {
            dropdown.classList.remove('open');
            trigger.classList.remove('open');
        } else {
            dropdown.classList.add('open');
            trigger.classList.add('open');
            if (search) { search.value = ''; search.focus(); }
            renderList();
        }
    });

    if (search) {
        search.addEventListener('input', () => renderList(search.value));
        search.addEventListener('click', (e) => e.stopPropagation());
    }

    if (list) {
        list.addEventListener('click', (e) => {
            const item = e.target.closest('.tk-mp-item');
            if (!item) return;
            const modelId = item.dataset.modelId;
            const nameEl = document.getElementById('tk-mp-selected');
            if (nameEl) nameEl.textContent = modelId;
            renderList(search?.value || '');
            setTimeout(() => {
                dropdown.classList.remove('open');
                trigger.classList.remove('open');
            }, 150);
        });
    }

    if (dropdown) dropdown.addEventListener('click', (e) => e.stopPropagation());

    renderList();
}

function getAvailableModels() {
    // Try to read models from ST's model list if available
    try {
        const modelSelect = document.getElementById('model_openai_select') ||
                           document.getElementById('model_togetherai_select') ||
                           document.querySelector('[id*="model"][id*="select"]');
        if (modelSelect) {
            const models = [];
            modelSelect.querySelectorAll('option').forEach(opt => {
                if (opt.value) {
                    models.push({ id: opt.value, name: opt.textContent.trim(), provider: '' });
                }
            });
            if (models.length > 0) return models;
        }
    } catch (e) {
        console.debug('Threadkeeper: Could not read model list from DOM', e);
    }

    // Fallback: common models
    return [
        { id: 'gpt-4o-mini', name: 'gpt-4o-mini', provider: 'OpenAI' },
        { id: 'gpt-4.1-nano', name: 'gpt-4.1-nano', provider: 'OpenAI' },
        { id: 'gpt-4.1-mini', name: 'gpt-4.1-mini', provider: 'OpenAI' },
        { id: 'gpt-4o', name: 'gpt-4o', provider: 'OpenAI' },
        { id: 'claude-3-haiku-20240307', name: 'claude-3-haiku', provider: 'Anthropic' },
        { id: 'claude-3.5-sonnet', name: 'claude-3.5-sonnet', provider: 'Anthropic' },
        { id: 'gemini-2.0-flash', name: 'gemini-2.0-flash', provider: 'Google' },
        { id: 'gemini-3.1-flash-preview', name: 'gemini-3.1-flash-preview', provider: 'Google' },
        { id: 'deepseek-v3', name: 'deepseek-v3', provider: 'DeepSeek' },
        { id: 'llama-3.3-70b', name: 'llama-3.3-70b', provider: 'Meta' },
        { id: 'mistral-small', name: 'mistral-small', provider: 'Mistral' },
        { id: 'qwen-2.5-72b', name: 'qwen-2.5-72b', provider: 'Alibaba' },
    ];
}

function getConnectionProfiles() {
    try {
        if (extension_settings.connectionManager && extension_settings.connectionManager.profiles) {
            return extension_settings.connectionManager.profiles;
        }
    } catch (e) {
        console.debug('Threadkeeper: Could not read connection profiles', e);
    }
    return [];
}

// ═══════════════════════════════════════════════════════════════════
// EVENT HANDLERS
// ═══════════════════════════════════════════════════════════════════

function attachEventListeners() {
    // Overlay tap-away to close
    const overlay = document.getElementById('threadkeeper-overlay');
    if (overlay) {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeTerminal();
        });
    }

    // Close button
    const closeBtn = document.getElementById('tk-close');
    if (closeBtn) closeBtn.addEventListener('click', closeTerminal);

    // Clear button
    const clearBtn = document.getElementById('tk-clear');
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            refreshTerminalContent();
        });
    }

    // Extract button
    const extractBtn = document.getElementById('tk-extract-btn');
    if (extractBtn) {
        extractBtn.addEventListener('click', async () => {
            if (isExtracting) return;
            extractBtn.classList.add('running');
            document.getElementById('tk-reextract-btn')?.classList.add('running');
            const progress = document.getElementById('tk-progress');
            const bar = document.getElementById('tk-progress-bar');
            if (progress) progress.classList.add('active');

            await runExtraction(
                false,
                (html) => addTerminalLine(html),
                (pct) => { if (bar) bar.style.width = pct + '%'; },
                (fact) => { addFactLine(fact); updateStats(); },
            );

            addCursorLine();
            updateStats();
            if (progress) progress.classList.remove('active');
            extractBtn.classList.remove('running');
            document.getElementById('tk-reextract-btn')?.classList.remove('running');
        });
    }

    // Re-extract button
    const reextractBtn = document.getElementById('tk-reextract-btn');
    if (reextractBtn) {
        reextractBtn.addEventListener('click', async () => {
            if (isExtracting) return;
            reextractBtn.classList.add('running');
            document.getElementById('tk-extract-btn')?.classList.add('running');
            const progress = document.getElementById('tk-progress');
            const bar = document.getElementById('tk-progress-bar');
            if (progress) progress.classList.add('active');

            // Clear non-pinned fact lines from terminal
            document.querySelectorAll('.tk-fact').forEach(el => {
                el.style.transition = 'all 0.2s ease';
                el.style.opacity = '0';
                el.style.height = '0';
                el.style.overflow = 'hidden';
                el.style.margin = '0';
                el.style.padding = '0';
            });

            await runExtraction(
                true,
                (html) => addTerminalLine(html),
                (pct) => { if (bar) bar.style.width = pct + '%'; },
                (fact) => { addFactLine(fact); updateStats(); },
            );

            addCursorLine();
            updateStats();
            if (progress) progress.classList.remove('active');
            reextractBtn.classList.remove('running');
            document.getElementById('tk-extract-btn')?.classList.remove('running');
        });
    }

    // Preview button
    const previewBtn = document.getElementById('tk-preview-btn');
    if (previewBtn) {
        previewBtn.addEventListener('click', async () => {
            const footer = document.getElementById('tk-footer');
            if (!footer) return;
            footer.classList.toggle('visible');
            if (footer.classList.contains('visible')) {
                const text = await injectFacts();
                const previewEl = document.getElementById('tk-preview-text');
                if (previewEl) previewEl.textContent = text || '(No facts to inject)';
            }
        });
    }

    // Settings button
    const settingsBtn = document.getElementById('tk-settings-btn');
    if (settingsBtn) settingsBtn.addEventListener('click', toggleConfig);

    // Filter buttons
    const filterGroup = document.getElementById('tk-filter-group');
    if (filterGroup) {
        filterGroup.addEventListener('click', (e) => {
            const btn = e.target.closest('.tk-filter');
            if (!btn) return;
            filterGroup.querySelectorAll('.tk-filter').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            activeFilter = btn.dataset.f;
            applyFilter();
        });
    }

    // Fact action buttons (delegated)
    const body = document.getElementById('tk-body');
    if (body) {
        body.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-action]');
            if (!btn) return;

            const action = btn.dataset.action;
            const factId = parseFloat(btn.dataset.factId);

            if (action === 'pin') {
                toggleFactPin(factId);
                btn.classList.toggle('pinned');
                updateStats();
                injectFacts();
            } else if (action === 'delete') {
                deleteFact(factId);
                const factEl = btn.closest('.tk-fact');
                if (factEl) {
                    factEl.style.transition = 'all 0.2s ease';
                    factEl.style.opacity = '0';
                    factEl.style.height = '0';
                    factEl.style.overflow = 'hidden';
                    factEl.style.margin = '0';
                    factEl.style.padding = '0';
                    setTimeout(() => factEl.remove(), 200);
                }
                updateStats();
                injectFacts();
            } else if (action === 'source') {
                const sourceIdx = parseInt(btn.dataset.source);
                if (sourceIdx > 0) {
                    // Scroll to and highlight the source message in the chat
                    const chatMsg = document.querySelector(`.mes[mesid="${sourceIdx - 1}"]`);
                    if (chatMsg) {
                        chatMsg.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        chatMsg.style.transition = 'box-shadow 0.3s ease';
                        chatMsg.style.boxShadow = '0 0 20px rgba(255,213,79,0.3)';
                        setTimeout(() => { chatMsg.style.boxShadow = ''; }, 3000);
                    }
                }
            }
        });
    }

    // Close model dropdown on outside click
    document.addEventListener('click', () => {
        const dropdown = document.getElementById('tk-mp-dropdown');
        const trigger = document.getElementById('tk-mp-trigger');
        if (dropdown) dropdown.classList.remove('open');
        if (trigger) trigger.classList.remove('open');
    });
}

function applyFilter() {
    document.querySelectorAll('.tk-fact').forEach(card => {
        const category = [...card.classList].find(c => c.startsWith('cat-'))?.replace('cat-', '');
        if (!category) return;
        card.style.display = (activeFilter === 'all' || category === activeFilter) ? 'flex' : 'none';
    });
}

// ═══════════════════════════════════════════════════════════════════
// AUTO-SCAN
// ═══════════════════════════════════════════════════════════════════

function onNewMessage() {
    const settings = getSettings();
    messagesSinceLastScan++;

    if (settings.autoScanInterval > 0 && messagesSinceLastScan >= settings.autoScanInterval) {
        console.log(`Threadkeeper: Auto-scanning (${messagesSinceLastScan} messages since last scan)`);
        runExtraction(false).then(() => {
            if (isTerminalOpen) refreshTerminalContent();
        });
    }
}

// ═══════════════════════════════════════════════════════════════════
// CHAT CHANGE — reload facts + inject
// ═══════════════════════════════════════════════════════════════════

async function onChatChanged() {
    messagesSinceLastScan = 0;
    await injectFacts();
    if (isTerminalOpen) refreshTerminalContent();
}

// ═══════════════════════════════════════════════════════════════════
// PUSH MODAL MENU ITEM INJECTION
// ═══════════════════════════════════════════════════════════════════

function injectMenuButton() {
    // Prevent duplicate entries
    document.querySelectorAll('#threadkeeper-menu-item').forEach(el => el.remove());

    // Try to inject into DreamTavern's Push Modal section
    // Look for the push modal section in the sidebar
    const pushModalSection = findPushModalSection();

    if (pushModalSection) {
        // Inject before "Run Push Diagnostics" if it exists, or at the end
        const diagnosticsItem = [...pushModalSection.querySelectorAll('.menu_button, [id*="diagnostics"], [id*="Diagnostics"]')]
            .find(el => el.textContent.includes('Diagnostics'));

        const menuItem = createMenuButton();

        if (diagnosticsItem) {
            diagnosticsItem.parentNode.insertBefore(menuItem, diagnosticsItem);
        } else {
            pushModalSection.appendChild(menuItem);
        }
    } else {
        // Fallback: add to the extensions menu or create a floating button
        addFloatingButton();
    }
}

function findPushModalSection() {
    // Look for the Push Modal label/section in sidebar
    const allElements = document.querySelectorAll('.menu_button, .fa-solid, [data-i18n]');
    for (const el of allElements) {
        if (el.textContent.includes('Push Queue') || el.textContent.includes('Push Inbox')) {
            return el.closest('.menu_content, .sidebar-section, [class*="section"]') || el.parentElement;
        }
    }
    return null;
}

function createMenuButton() {
    const btn = document.createElement('div');
    btn.id = 'threadkeeper-menu-item';
    btn.className = 'menu_button menu_button_icon interactable';
    btn.innerHTML = `
        <span style="display:inline-flex;align-items:center;width:20px;justify-content:center;">
            ${MEMORY_ORB_SVG_SMALL}
        </span>
        <span>Threadkeeper</span>
        <span class="tk-new-badge">NEW</span>`;
    btn.addEventListener('click', () => {
        if (isTerminalOpen) {
            closeTerminal();
        } else {
            openTerminal();
        }
    });
    return btn;
}

function addFloatingButton() {
    // Fallback: add a menu button that opens the terminal
    const extensionMenu = document.getElementById('extensionsMenu') ||
                          document.querySelector('.drawer-content');

    if (extensionMenu) {
        const btn = createMenuButton();
        extensionMenu.appendChild(btn);
    } else {
        // Last resort: create the button in a known location
        const btn = createMenuButton();
        btn.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:9999;background:var(--tk-bg);border:1px solid rgba(167,139,250,0.3);border-radius:8px;padding:8px 12px;cursor:pointer;';
        document.body.appendChild(btn);
    }
}

// ═══════════════════════════════════════════════════════════════════
// SLASH COMMANDS
// ═══════════════════════════════════════════════════════════════════

function registerSlashCommands() {
    try {
        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'threadkeeper',
            callback: async (args) => {
                const subcommand = args?.unnamed?.[0] || 'open';
                switch (subcommand) {
                    case 'open':
                        openTerminal();
                        return 'Threadkeeper opened.';
                    case 'extract':
                        await runExtraction(false);
                        return `Extracted facts. Total: ${getFacts().length}`;
                    case 'reextract':
                        await runExtraction(true);
                        return `Re-extracted facts. Total: ${getFacts().length}`;
                    case 'facts':
                        return getFacts().map(f => `[${f.category}] ${f.text}${f.pinned ? ' 📌' : ''}`).join('\n');
                    case 'clear':
                        clearNonPinnedFacts();
                        await injectFacts();
                        return 'Cleared non-pinned facts.';
                    default:
                        return 'Usage: /threadkeeper [open|extract|reextract|facts|clear]';
                }
            },
            helpString: 'Threadkeeper memory management. Subcommands: open, extract, reextract, facts, clear',
        }));
    } catch (e) {
        console.debug('Threadkeeper: Could not register slash commands', e);
    }
}

// ═══════════════════════════════════════════════════════════════════
// INITIALIZATION
// ═══════════════════════════════════════════════════════════════════

jQuery(async function () {
    // Load settings
    loadSettings();

    // Inject terminal HTML into the page
    const terminalHtml = buildTerminalHTML();
    document.body.insertAdjacentHTML('beforeend', terminalHtml);

    // Attach all event listeners
    attachEventListeners();

    // Inject menu button into Push Modal (with retry for dynamic loading)
    const tryInject = () => {
        try { injectMenuButton(); } catch (e) {
            console.debug('Threadkeeper: Menu injection will retry', e);
        }
    };

    // Try immediately, then retry after DOM settles
    tryInject();
    setTimeout(tryInject, 2000);
    setTimeout(tryInject, 5000);

    // Register event hooks
    eventSource.on(event_types.CHAT_CHANGED, onChatChanged);
    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, onNewMessage);
    eventSource.on(event_types.USER_MESSAGE_RENDERED, onNewMessage);

    // Register slash commands
    registerSlashCommands();

    // Initial injection if chat already loaded
    await injectFacts();

    console.log('⌬ Threadkeeper v1.0 loaded');
});
