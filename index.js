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
    MAX_INJECTION_DEPTH,
    generateRaw,
    setExtensionPrompt,
    saveSettingsDebounced,
    saveSettings,
    getRequestHeaders,
} from '../../../../script.js';
import { getTokenCountAsync } from '../../../tokenizers.js';
import { debounce_timeout } from '../../../constants.js';
import { SlashCommandParser } from '../../../slash-commands/SlashCommandParser.js';
import { SlashCommand } from '../../../slash-commands/SlashCommand.js';
import { CONNECT_API_MAP } from '../../../slash-commands.js';
import { SECRET_KEYS, findSecret } from '../../../secrets.js';
import { oai_settings } from '../../../openai.js';

// ═══════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════

const MODULE_NAME = 'threadkeeper';
const EXTENSION_PROMPT_KEY = 'threadkeeper_facts';

const CATEGORIES = ['character', 'relationship', 'event', 'item', 'location', 'plot'];
const CATEGORY_LABELS = { character: 'chr', relationship: 'rel', event: 'evt', item: 'itm', location: 'loc', plot: 'plt' };

const ACCURACY_LABELS = ['Exact', 'Precise', 'Precise', 'Balanced', 'Balanced', 'Balanced', 'Creative', 'Creative', 'Creative', 'Wild', 'Wild'];
const BUDGET_MAP = { small: 250, medium: 500, large: 800 };

// Maps chat_completion_source → the oai_settings field that holds the selected model for that source.
// Mirrors getChatCompletionModel() in openai.js so we can temporarily override the model during extraction.
const TK_SOURCE_MODEL_FIELD = {
    openai: 'openai_model',
    claude: 'claude_model',
    openrouter: 'openrouter_model',
    makersuite: 'google_model',
    vertexai: 'vertexai_model',
    ai21: 'ai21_model',
    mistralai: 'mistralai_model',
    custom: 'custom_model',
    cohere: 'cohere_model',
    perplexity: 'perplexity_model',
    groq: 'groq_model',
    siliconflow: 'siliconflow_model',
    electronhub: 'electronhub_model',
    chutes: 'chutes_model',
    navy: 'navy_model',
    routeway: 'routeway_model',
    nanogpt: 'nanogpt_model',
    deepseek: 'deepseek_model',
    aimlapi: 'aimlapi_model',
    xai: 'xai_model',
    pollinations: 'pollinations_model',
    cometapi: 'cometapi_model',
    moonshot: 'moonshot_model',
    fireworks: 'fireworks_model',
    azure_openai: 'azure_openai_model',
    zai: 'zai_model',
};

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
    autoPin: false,
    // Scanning
    autoScanInterval: 10,
    scanHidden: false,
    // Advanced
    injectPlacement: 'message_depth',
    injectPosition: extension_prompt_types.IN_CHAT,
    injectDepth: 4,
    messageDepth: 4,
    injectRole: extension_prompt_roles.SYSTEM,
};

const INJECTION_PLACEMENTS = {
    after_author: {
        id: 'after_author',
        label: "After Author's Note",
        position: extension_prompt_types.IN_PROMPT,
        useMessageDepth: false,
    },
    before_author: {
        id: 'before_author',
        label: "Before Author's Note",
        position: extension_prompt_types.BEFORE_PROMPT,
        useMessageDepth: false,
    },
    top_chat: {
        id: 'top_chat',
        label: 'Top of chat history',
        position: extension_prompt_types.IN_CHAT,
        depth: MAX_INJECTION_DEPTH,
        useMessageDepth: false,
    },
    message_depth: {
        id: 'message_depth',
        label: 'At message depth',
        position: extension_prompt_types.IN_CHAT,
        useMessageDepth: true,
    },
};

// ═══════════════════════════════════════════════════════════════════
// EXTRACTION PROMPT
// ═══════════════════════════════════════════════════════════════════

const EXTRACTION_SYSTEM_PROMPT = `You are a precise fact extractor for a roleplay conversation. Extract key facts that a language model would need to maintain story consistency.

RULES:
- Output ONLY a valid JSON array — no markdown, no commentary, no explanation
- Each fact: {"category": "<one of: character, relationship, event, item, location, plot>", "text": "<concise fact>", "source_index": <message_number>}
- Be concise: each fact should be one clear sentence
- Focus on facts that would be LOST if the model forgot earlier messages
- Include: character traits, relationships, important items, locations, plot developments, key events
- Do NOT include: dialogue quotes, writing style notes, or obvious real-time actions
- Max 15 facts per batch
- Do not duplicate facts that already exist in the provided existing facts list
- If there are no new facts to extract, output exactly: []

EXAMPLE OUTPUT:
[{"category":"character","text":"Luna has silver eyes and white hair","source_index":3},{"category":"location","text":"The story takes place in the city of Westmarch","source_index":7}]`;

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

function extractAllBalancedSlices(text, openChar, closeChar) {
    const results = [];
    let searchFrom = 0;

    while (searchFrom < text.length) {
        const start = text.indexOf(openChar, searchFrom);
        if (start === -1) break;

        let depth = 0;
        let inString = false;
        let escaped = false;
        let end = -1;

        for (let i = start; i < text.length; i++) {
            const ch = text[i];
            if (inString) {
                if (escaped) { escaped = false; continue; }
                if (ch === '\\') { escaped = true; continue; }
                if (ch === '"') inString = false;
                continue;
            }
            if (ch === '"') { inString = true; continue; }
            if (ch === openChar) depth++;
            if (ch === closeChar) {
                depth--;
                if (depth === 0) { end = i; break; }
            }
        }

        if (end !== -1) results.push(text.slice(start, end + 1));
        searchFrom = start + 1;
    }

    return results;
}

function parseExtractionResponse(response) {
    const text = String(response || '').trim();
    if (!text) return [];

    const candidates = [
        text,
        ...[...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map(m => m[1].trim()),
        ...extractAllBalancedSlices(text, '[', ']'),
        ...extractAllBalancedSlices(text, '{', '}'),
    ];

    for (const candidate of candidates) {
        if (!candidate) continue;
        try {
            const parsed = JSON.parse(candidate);
            if (Array.isArray(parsed)) return parsed;
            if (parsed && typeof parsed === 'object') {
                const nested = parsed.facts || parsed.data || parsed.results || parsed.memories || parsed.items;
                if (Array.isArray(nested)) return nested;
            }
        } catch {
            // Try next candidate.
        }
    }

    return [];
}

// ═══════════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════════

let isExtracting = false;
let isTerminalOpen = false;
let showingConfig = false;
let activeFilter = 'all';
let messagesSinceLastScan = 0;
let mobileStyleLink = null;
const modelCatalogCache = new Map();

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
    const settings = extension_settings[MODULE_NAME];
    if (!settings.injectPlacement) {
        settings.injectPlacement = inferInjectionPlacement(settings);
    }
    if (!Number.isFinite(settings.messageDepth) || settings.messageDepth < 0) {
        settings.messageDepth = Number.isFinite(settings.injectDepth) ? settings.injectDepth : DEFAULT_SETTINGS.messageDepth;
    }
    return extension_settings[MODULE_NAME];
}

function getSettings() {
    return extension_settings[MODULE_NAME] || DEFAULT_SETTINGS;
}

function saveSetting(key, value) {
    const oldValue = extension_settings[MODULE_NAME][key];
    extension_settings[MODULE_NAME][key] = value;
    saveSettingsDebounced();
}


function inferInjectionPlacement(settings) {
    if (settings.injectPosition === extension_prompt_types.IN_PROMPT) return 'after_author';
    if (settings.injectPosition === extension_prompt_types.BEFORE_PROMPT) return 'before_author';
    if (settings.injectPosition === extension_prompt_types.IN_CHAT && Number(settings.injectDepth) >= MAX_INJECTION_DEPTH) return 'top_chat';
    return 'message_depth';
}

function getInjectionPlacementState(settings = getSettings()) {
    const placementId = INJECTION_PLACEMENTS[settings.injectPlacement] ? settings.injectPlacement : inferInjectionPlacement(settings);
    const placement = INJECTION_PLACEMENTS[placementId];
    const messageDepth = Number.isFinite(settings.messageDepth) ? settings.messageDepth : DEFAULT_SETTINGS.messageDepth;
    const resolvedDepth = placement.useMessageDepth ? messageDepth : placement.depth ?? settings.injectDepth;
    const label = placement.useMessageDepth ? `${placement.label}: ${messageDepth}` : placement.label;

    return {
        placementId,
        label,
        position: placement.position,
        depth: resolvedDepth,
        messageDepth,
        useMessageDepth: placement.useMessageDepth,
    };
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
    if (!context.chatMetadata) return { facts: [], lastScannedIndex: 0 };
    if (!context.chatMetadata.threadkeeper) {
        context.chatMetadata.threadkeeper = { facts: [], lastScannedIndex: 0 };
    }
    return context.chatMetadata.threadkeeper;
}

function setTkData(data) {
    const context = getContext();
    if (!context.chatMetadata) return;
    context.chatMetadata.threadkeeper = data;
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
    const addedFacts = [];

    for (const fact of newFacts) {
        // Dedup: skip if very similar fact already exists
        const isDupe = data.facts.some(f => f && f.text === fact.text);
        if (isDupe) continue;

        const storedFact = {
            category: fact.category,
            text: fact.text,
            sourceIndex: fact.source_index || 0,
            pinned: false,
            id: Date.now() + Math.random(),
        };

        data.facts.push(storedFact);
        addedFacts.push(storedFact);
    }

    // Enforce max facts limit — rotate out oldest non-pinned
    while (data.facts.filter(f => f !== null).length > settings.maxFacts) {
        const oldestNonPinnedIdx = data.facts.findIndex(f => f !== null && !f.pinned);
        if (oldestNonPinnedIdx === -1) break;
        data.facts.splice(oldestNonPinnedIdx, 1);
    }

    setTkData(data);
    return addedFacts;
}

function toggleFactPin(factId) {
    const data = getTkData();
    const fact = data.facts.find(f => f && f.id === factId);
    if (fact) {
        fact.pinned = !fact.pinned;
        setTkData(data);
        // Flush debounced save immediately
        saveMetadataDebounced.flush?.();
        syncPinnedToGlobal();
    }
}

function deleteFact(factId) {
    const data = getTkData();
    const idx = data.facts.findIndex(f => f && f.id === factId);
    if (idx !== -1) {
        data.facts.splice(idx, 1);
        setTkData(data);
        syncPinnedToGlobal();
    }
}

function clearNonPinnedFacts() {
    const data = getTkData();
    data.facts = data.facts.filter(f => f && f.pinned);
    data.lastScannedIndex = 0;
    setTkData(data);
    syncPinnedToGlobal();
}

// ═══════════════════════════════════════════════════════════════════
// CROSS-CHAT PINNED FACTS
// ═══════════════════════════════════════════════════════════════════

function syncPinnedToGlobal() {
    const settings = getSettings();
    if (!settings.crossChatPinned) return;

    const context = getContext();
    const charKey = String(context.characterId ?? '');
    if (!charKey) return;

    if (!extension_settings[MODULE_NAME].globalPinnedFacts) {
        extension_settings[MODULE_NAME].globalPinnedFacts = {};
    }

    const pinned = getPinnedFacts();
    if (pinned.length > 0) {
        extension_settings[MODULE_NAME].globalPinnedFacts[charKey] = pinned.map(f => ({
            category: f.category,
            text: f.text,
        }));
    } else {
        delete extension_settings[MODULE_NAME].globalPinnedFacts[charKey];
    }

    saveSettingsDebounced();
}

function restorePinnedFromGlobal() {
    const settings = getSettings();
    if (!settings.crossChatPinned) return;

    const context = getContext();
    const charKey = String(context.characterId ?? '');
    if (!charKey) return;

    const globalPinned = extension_settings[MODULE_NAME].globalPinnedFacts?.[charKey];
    if (!globalPinned || globalPinned.length === 0) return;

    const data = getTkData();
    for (const gf of globalPinned) {
        const existing = data.facts.find(f => f && f.text === gf.text);
        if (existing) {
            existing.pinned = true;
        } else {
            data.facts.push({
                category: gf.category,
                text: gf.text,
                sourceIndex: 0,
                pinned: true,
                id: Date.now() + Math.random(),
            });
        }
    }
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

    // Trim to budget — one server call to measure, then char-ratio estimation for trimming.
    // The old approach called getTokenCountAsync once per fact popped, creating N serial AJAX
    // requests for large fact lists and freezing the UI.
    const tokenCount = await getTokenCountAsync(injectionText);
    if (tokenCount > budgetTokens && regular.length > 0) {
        // Proportional trim: use chars/token ratio from the initial measurement
        // to estimate how many regular facts to keep in one shot.
        const overRatio = tokenCount / budgetTokens;
        const factsToKeep = Math.max(0, Math.floor(regular.length / overRatio));
        regular.splice(factsToKeep);

        // Rebuild once with the trimmed set
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
    }

    const injectionPlacement = getInjectionPlacementState(settings);

    setExtensionPrompt(
        EXTENSION_PROMPT_KEY,
        injectionText,
        injectionPlacement.position,
        injectionPlacement.depth,
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

        // Resolve which API backend and model to use for extraction (null = use ST's current active API/model)
        let extractionApi = null;
        let extractionSource = null;
        let extractionModelField = null;
        if (settings.connectionProfile && settings.connectionProfile !== '__current__') {
            const profile = getSelectedConnectionProfile(settings.connectionProfile);
            if (profile?.api) {
                const apiConfig = CONNECT_API_MAP[String(profile.api).toLowerCase()];
                extractionApi = apiConfig?.selected || profile.api;
                extractionSource = apiConfig?.source || profile.api;
                extractionModelField = TK_SOURCE_MODEL_FIELD[extractionSource] || null;
            }
        }

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
        const factCountBefore = existingFacts.length;

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
                // Temporarily point oai_settings at the selected model so generateRaw uses it.
                // generateRaw has no model parameter — it reads oai_settings.chat_completion_source
                // and the matching model field at call time.
                const shouldOverrideModel = settings.model &&
                    extractionApi === 'openai' &&
                    extractionSource &&
                    extractionModelField;
                let savedSource, savedModel;
                if (shouldOverrideModel) {
                    savedSource = oai_settings.chat_completion_source;
                    savedModel = oai_settings[extractionModelField];
                    oai_settings.chat_completion_source = extractionSource;
                    oai_settings[extractionModelField] = settings.model;
                }
                try {
                    response = await generateRaw({
                        prompt: prompt,
                        systemPrompt: EXTRACTION_SYSTEM_PROMPT,
                        responseLength: 1024,
                        ...(extractionApi ? { api: extractionApi } : {}),
                    });
                } finally {
                    if (shouldOverrideModel) {
                        oai_settings.chat_completion_source = savedSource;
                        oai_settings[extractionModelField] = savedModel;
                    }
                }
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
                newFacts = parseExtractionResponse(response);
            } catch (parseErr) {
                log(`<span class="tk-dim">Batch ${b + 1}: skipped (${parseErr.message})</span>`);
                continue;
            }

            // Validate and add facts
            const validFacts = newFacts.filter(f =>
                f && typeof f.text === 'string' && f.text.length > 0 &&
                CATEGORIES.includes(f.category),
            );

            if (validFacts.length > 0) {
                const addedFacts = addFacts(validFacts);
                totalExtracted += addedFacts.length;

                for (const fact of addedFacts) {
                    existingFacts.push(fact); // Update running list for dedup
                    onFact(fact);
                }
            }
        }

        // Update last scanned index
        setLastScannedIndex(chat.length);
        messagesSinceLastScan = 0;

        // Auto-pin newly extracted facts if enabled
        if (settings.autoPin) {
            const factCountAfter = getFacts().length;
            const actuallyAdded = factCountAfter - factCountBefore;

            if (actuallyAdded > 0) {
                const data = getTkData();
                let pinCount = 0;
                // Pin facts from the end backwards (newly added ones)
                for (let i = data.facts.length - 1; i >= 0 && pinCount < actuallyAdded; i--) {
                    if (data.facts[i] && !data.facts[i].pinned) {
                        data.facts[i].pinned = true;
                        pinCount++;
                    }
                }
                if (pinCount > 0) {
                    setTkData(data);
                }
            }
        }

        // Force immediate metadata save to ensure facts persist
        await new Promise(resolve => {
            const context = getContext();
            if (context.chatMetadata) {
                saveMetadataDebounced.flush?.();
            }
            setTimeout(resolve, 100);
        });

        // Update injection — returns the final trimmed injection text
        const injectedText = await injectFacts();

        const allFacts = getFacts();
        log(`<br>`);
        log(`<span class="tk-success">✓ ${fullRescan ? 'Re-extracted' : 'Extracted'} ${totalExtracted} facts · ${allFacts.length} total in memory</span>`);

        if (injectedText) {
            const tokenCount = await getTokenCountAsync(injectedText);
            log(`<span class="tk-dim">Prompt space used: ${tokenCount} tokens</span>`);
        }

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

const MEMORY_ORB_SVG_SMALL = `<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
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
    <div class="tk-close-hint">tap to close</div>
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
                <button class="tk-cmd-btn danger" id="tk-clear-facts-btn">✕ clear unpinned</button>
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
    const injectionPlacement = getInjectionPlacementState(settings);
    const tempIdx = Math.round(settings.temperature * 10);
    const tempLabel = ACCURACY_LABELS[tempIdx] || 'Balanced';
    const tempDisplay = `${tempLabel} (${settings.temperature.toFixed(1)})`;

    let profileOptions = '<option value="__current__">🟢 Current active connection</option>';
    for (const p of profiles) {
        const selected = settings.connectionProfile === p.id ? ' selected' : '';
        profileOptions += `<option value="${p.id}"${selected}>${p.name}</option>`;
    }

    const placementOptions = Object.values(INJECTION_PLACEMENTS).map((placement) => {
        const isSelected = placement.id === injectionPlacement.placementId;
        const label = placement.useMessageDepth ? `${placement.label}: ${injectionPlacement.messageDepth}` : placement.label;
        return `
            <button class="tk-placement-item ${isSelected ? 'selected' : ''}" type="button" data-placement-id="${placement.id}">
                <span class="tk-placement-label">${label}</span>
                <span class="tk-placement-radio"></span>
            </button>`;
    }).join('');

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
        <div class="tk-cfg-row tk-cfg-row-model" style="align-items:flex-start;">
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
        <div class="tk-cfg-row tk-cfg-row-accuracy">
            <div class="tk-cfg-label">
                Accuracy
                <span class="tk-cfg-hint">Lower = more precise facts. Higher = more creative interpretation</span>
            </div>
            <div class="tk-slider-wrap">
                <input type="range" class="tk-slider" id="tk-cfg-temp" min="0" max="10" value="${tempIdx}">
                <span class="tk-slider-val" id="tk-cfg-temp-val">${tempDisplay}</span>
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
        <div class="tk-cfg-row">
            <div class="tk-cfg-label">
                Auto-pin when extracting
                <span class="tk-cfg-hint">Automatically pin newly extracted facts so they persist longer</span>
            </div>
            <label class="tk-toggle"><input type="checkbox" id="tk-cfg-autopin" ${settings.autoPin ? 'checked' : ''}><span class="slider"></span></label>
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
                    <span class="tk-cfg-hint">Where facts appear in the prompt — after Author's Note is usually best</span>
                </div>
                <div class="tk-placement-picker" id="tk-placement-picker">
                    <button class="tk-placement-trigger" id="tk-placement-trigger" type="button" aria-expanded="false">
                        <span class="tk-placement-trigger-label" id="tk-placement-selected">${injectionPlacement.label}</span>
                        <span class="tk-placement-arrow">▼</span>
                    </button>
                    <div class="tk-placement-dropdown" id="tk-placement-dropdown">
                        ${placementOptions}
                    </div>
                </div>
            </div>
            <div class="tk-cfg-row ${injectionPlacement.useMessageDepth ? '' : 'tk-cfg-row-hidden'}" id="tk-cfg-depth-row">
                <div class="tk-cfg-label">
                    Message depth
                    <span class="tk-cfg-hint">How many messages from the bottom (0 = last message)</span>
                </div>
                <input type="number" class="tk-number" id="tk-cfg-depth" value="${injectionPlacement.messageDepth}" min="0" max="100">
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
        addTerminalLine(`<span id="tk-memory-summary" class="tk-dim">${facts.length} facts in memory (${getPinnedFacts().length} pinned)</span>`);
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

    // Estimate token usage from the actual injection format (headers + labels included).
    // Using char/4 heuristic here — no server call — so this is safe to call frequently.
    let tokenEstimate = 0;
    if (facts.length > 0) {
        const pinnedFacts = facts.filter(f => f.pinned);
        const regularFacts = facts.filter(f => !f.pinned);
        const lines = ['[Threadkeeper — Key Facts for Story Continuity]', ''];
        if (pinnedFacts.length > 0) {
            lines.push('PINNED (always remember):');
            for (const f of pinnedFacts) lines.push(`• [${f.category.toUpperCase()}] ${f.text}`);
            lines.push('');
        }
        if (regularFacts.length > 0) {
            lines.push('EXTRACTED:');
            for (const f of [...regularFacts].reverse()) lines.push(`• [${f.category.toUpperCase()}] ${f.text}`);
        }
        tokenEstimate = Math.ceil(lines.join('\n').length / 4);
    }

    const elFacts = document.getElementById('tk-stat-facts');
    const elPinned = document.getElementById('tk-stat-pinned');
    const elTokens = document.getElementById('tk-stat-tokens');
    const elSummary = document.getElementById('tk-memory-summary');

    if (elFacts) elFacts.textContent = facts.length;
    if (elPinned) elPinned.textContent = pinned.length;
    if (elTokens) elTokens.textContent = '~' + tokenEstimate;
    if (elSummary) elSummary.textContent = `${facts.length} facts in memory (${pinned.length} pinned)`;
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
    // Sync settings from storage
    syncUIFromSettings();

    // Temperature slider
    const tempSlider = document.getElementById('tk-cfg-temp');
    if (tempSlider) {
        tempSlider.addEventListener('input', function () {
            const label = document.getElementById('tk-cfg-temp-val');
            if (label) {
                const value = parseInt(this.value) / 10;
                const text = ACCURACY_LABELS[parseInt(this.value)] || 'Balanced';
                label.textContent = `${text} (${value.toFixed(1)})`;
            }
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
        saveBtn.addEventListener('click', async () => {
            saveConfigFromUI();

            let serverResult = null;
            try {
                serverResult = await saveSettings();
            } catch (err) {
                // saveSettings failure is non-fatal; button label will reflect it
            }

            const label = saveBtn.querySelector('.tk-save-label');
            saveBtn.classList.add('saved');
            if (label) label.textContent = serverResult !== null ? 'Saved ✓' : 'Save Failed!';
            setTimeout(() => {
                saveBtn.classList.remove('saved');
                if (label) label.textContent = 'Save';
            }, 2000);
        });
    }

    // Live-save listeners — write to memory immediately, persist via debounce
    const connection = document.getElementById('tk-cfg-connection');
    if (connection) {
        connection.addEventListener('change', (e) => {
            saveSetting('connectionProfile', e.target.value);
        });
    }

    const temp = document.getElementById('tk-cfg-temp');
    if (temp) {
        temp.addEventListener('change', (e) => {
            saveSetting('temperature', parseInt(e.target.value) / 10);
        });
    }

    const maxFacts = document.getElementById('tk-cfg-maxfacts');
    if (maxFacts) {
        maxFacts.addEventListener('change', (e) => {
            const val = parseInt(e.target.value);
            if (Number.isFinite(val) && val >= 1) saveSetting('maxFacts', val);
        });
    }

    if (budgetContainer) {
        budgetContainer.querySelectorAll('.tk-pill').forEach(pill => {
            pill.addEventListener('click', () => {
                saveSetting('injectBudget', pill.dataset.v);
            });
        });
    }

    const crossChat = document.getElementById('tk-cfg-crosschat');
    if (crossChat) {
        crossChat.addEventListener('change', (e) => {
            saveSetting('crossChatPinned', e.target.checked);
        });
    }

    const autoPin = document.getElementById('tk-cfg-autopin');
    if (autoPin) {
        autoPin.addEventListener('change', (e) => {
            saveSetting('autoPin', e.target.checked);
        });
    }

    const autoScan = document.getElementById('tk-cfg-autoscan');
    if (autoScan) {
        autoScan.addEventListener('change', (e) => {
            const val = parseInt(e.target.value);
            if (Number.isFinite(val) && val >= 0) saveSetting('autoScanInterval', val);
        });
    }

    const scanHidden = document.getElementById('tk-cfg-hidden');
    if (scanHidden) {
        scanHidden.addEventListener('change', (e) => {
            saveSetting('scanHidden', e.target.checked);
        });
    }

    const depthInput = document.getElementById('tk-cfg-depth');
    if (depthInput) {
        depthInput.addEventListener('change', (e) => {
            const val = Math.max(0, parseInt(e.target.value) || DEFAULT_SETTINGS.messageDepth);
            saveSetting('messageDepth', val);
        });
    }

    // Model picker
    setupModelPicker();
    setupPlacementPicker();
}

function saveConfigFromUI() {
    const connection = document.getElementById('tk-cfg-connection');
    if (connection) saveSetting('connectionProfile', connection.value);

    const model = document.getElementById('tk-mp-selected');
    if (model) {
        const selectedModel = String(model.dataset.modelId || model.textContent || '').trim();
        saveSetting('model', selectedModel && selectedModel !== 'Use default model' ? selectedModel : '');
    }

    const temp = document.getElementById('tk-cfg-temp');
    if (temp) saveSetting('temperature', parseInt(temp.value) / 10);

    const maxFacts = document.getElementById('tk-cfg-maxfacts');
    if (maxFacts) saveSetting('maxFacts', parseInt(maxFacts.value) || 100);

    const activeBudget = document.querySelector('#tk-cfg-budget .tk-pill.active');
    if (activeBudget) saveSetting('injectBudget', activeBudget.dataset.v);

    const crossChat = document.getElementById('tk-cfg-crosschat');
    if (crossChat) saveSetting('crossChatPinned', crossChat.checked);

    const autoPin = document.getElementById('tk-cfg-autopin');
    if (autoPin) saveSetting('autoPin', autoPin.checked);

    const autoScan = document.getElementById('tk-cfg-autoscan');
    if (autoScan) saveSetting('autoScanInterval', parseInt(autoScan.value) || 0);

    const hidden = document.getElementById('tk-cfg-hidden');
    if (hidden) saveSetting('scanHidden', hidden.checked);

    const depth = document.getElementById('tk-cfg-depth');
    const messageDepth = Math.max(0, parseInt(depth?.value) || DEFAULT_SETTINGS.messageDepth);
    saveSetting('messageDepth', messageDepth);

    const selectedPlacementEl = document.querySelector('.tk-placement-item.selected');
    const selectedPlacement = selectedPlacementEl?.dataset.placementId || getInjectionPlacementState().placementId;
    const placementState = getInjectionPlacementState({ ...getSettings(), injectPlacement: selectedPlacement, messageDepth });
    saveSetting('injectPlacement', placementState.placementId);
    saveSetting('injectPosition', placementState.position);
    saveSetting('injectDepth', placementState.depth);

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
    const connectionSelect = document.getElementById('tk-cfg-connection');

    if (!trigger || !dropdown) return;

    let models = [];
    let refreshRequestId = 0;

    function renderList(filter = '') {
        if (!list) return;
        const selectedModel = document.getElementById('tk-mp-selected')?.dataset?.modelId ||
            document.getElementById('tk-mp-selected')?.textContent?.trim() ||
            getSettings().model || '';
        const q = filter.toLowerCase();
        const visibleModels = models.filter(m => !q || m.name.toLowerCase().includes(q) || (m.provider || '').toLowerCase().includes(q));

        if (visibleModels.length === 0) {
            list.innerHTML = `<div class="tk-mp-empty">${models.length === 0 ? 'No models found for this profile' : 'No models match your search'}</div>`;
            return;
        }

        list.innerHTML = visibleModels.map(m => {
            const sel = m.id === selectedModel;
            return `
                <div class="tk-mp-item ${sel ? 'selected' : ''}" data-model-id="${escapeHtml(m.id)}">
                    <div class="tk-mp-radio"></div>
                    <div class="tk-mp-item-info">
                        <span class="tk-mp-model-name">${escapeHtml(m.name)}</span>
                        ${m.provider ? `<span class="tk-mp-model-meta">${escapeHtml(m.provider)}</span>` : ''}
                    </div>
                </div>`;
        }).join('');
    }

    function updateSelectedModelLabel(modelId) {
        const nameEl = document.getElementById('tk-mp-selected');
        if (nameEl) {
            nameEl.textContent = modelId || 'Use default model';
            nameEl.dataset.modelId = modelId || '';
        }
    }

    async function refreshModels(filter = '') {
        const requestId = ++refreshRequestId;
        if (list) {
            list.innerHTML = '<div class="tk-mp-empty">Loading models...</div>';
        }
        const nextModels = await getAvailableModels(connectionSelect?.value);
        if (requestId !== refreshRequestId) {
            return;
        }
        models = nextModels;
        renderList(filter);
    }

    const configPanel = document.querySelector('.tk-config-panel');

    function openDropdown() {
        // Disable config panel scroll clipping so dropdown can overflow
        if (configPanel) configPanel.classList.add('dropdown-open');
        dropdown.classList.add('open');
        trigger.classList.add('open');
        if (search) { search.value = ''; search.focus(); }
        void refreshModels();
    }

    function closeDropdown() {
        dropdown.classList.remove('open');
        trigger.classList.remove('open');
        if (configPanel) configPanel.classList.remove('dropdown-open');
    }

    trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        if (dropdown.classList.contains('open')) {
            closeDropdown();
        } else {
            openDropdown();
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
            updateSelectedModelLabel(modelId);
            renderList(search?.value || '');
            saveSetting('model', modelId);
            closeDropdown();
        });
    }

    if (dropdown) dropdown.addEventListener('click', (e) => e.stopPropagation());

    if (connectionSelect) {
        connectionSelect.addEventListener('change', () => {
            updateSelectedModelLabel(getDefaultModelForSelection(connectionSelect.value));
            void refreshModels(search?.value || '');
        });
    }

    // Initialize with saved model, or default if not set
    const savedModel = getSettings().model;
    updateSelectedModelLabel(savedModel || getDefaultModelForSelection(connectionSelect?.value));
    void refreshModels();
}

function setupPlacementPicker() {
    const trigger = document.getElementById('tk-placement-trigger');
    const dropdown = document.getElementById('tk-placement-dropdown');
    const depthRow = document.getElementById('tk-cfg-depth-row');
    const depthInput = document.getElementById('tk-cfg-depth');

    if (!trigger || !dropdown) return;

    const syncPlacementUI = (placementId) => {
        const selectedLabel = document.getElementById('tk-placement-selected');
        const placement = INJECTION_PLACEMENTS[placementId] || INJECTION_PLACEMENTS.message_depth;
        const messageDepth = Math.max(0, parseInt(depthInput?.value) || DEFAULT_SETTINGS.messageDepth);
        const label = placement.useMessageDepth ? `${placement.label}: ${messageDepth}` : placement.label;

        dropdown.querySelectorAll('.tk-placement-item').forEach((item) => {
            item.classList.toggle('selected', item.dataset.placementId === placementId);
            const labelEl = item.querySelector('.tk-placement-label');
            if (labelEl && item.dataset.placementId === 'message_depth') {
                labelEl.textContent = `${INJECTION_PLACEMENTS.message_depth.label}: ${messageDepth}`;
            }
        });

        if (selectedLabel) selectedLabel.textContent = label;
        if (depthRow) depthRow.classList.toggle('tk-cfg-row-hidden', !placement.useMessageDepth);
    };

    // Initialize with saved placement setting
    const savedPlacement = getSettings().injectPlacement || 'message_depth';
    syncPlacementUI(savedPlacement);

    const configPanel = document.querySelector('.tk-config-panel');

    const repositionDropdown = () => {
        if (!dropdown.classList.contains('open')) return;

        const triggerRect = trigger.getBoundingClientRect();
        const dropdownRect = dropdown.getBoundingClientRect();
        const configPanelRect = configPanel?.getBoundingClientRect();

        // Check if dropdown extends below viewport
        if (dropdownRect.bottom > window.innerHeight - 20) {
            dropdown.style.top = 'auto';
            dropdown.style.bottom = 'calc(100% + 6px)';
        } else {
            dropdown.style.top = 'calc(100% + 6px)';
            dropdown.style.bottom = 'auto';
        }
    };

    trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = dropdown.classList.contains('open');
        if (!isOpen && configPanel) configPanel.classList.add('dropdown-open');
        if (isOpen && configPanel) configPanel.classList.remove('dropdown-open');
        dropdown.classList.toggle('open', !isOpen);
        trigger.classList.toggle('open', !isOpen);
        trigger.setAttribute('aria-expanded', String(!isOpen));

        if (!isOpen) {
            requestAnimationFrame(repositionDropdown);
        }
    });

    dropdown.addEventListener('click', async (e) => {
        e.stopPropagation();
        const item = e.target.closest('.tk-placement-item');
        if (!item) return;
        const selectedPlacementId = item.dataset.placementId;
        syncPlacementUI(selectedPlacementId);
        dropdown.classList.remove('open');
        trigger.classList.remove('open');
        trigger.setAttribute('aria-expanded', 'false');
        if (configPanel) configPanel.classList.remove('dropdown-open');

        const placementState = getInjectionPlacementState({ ...getSettings(), injectPlacement: selectedPlacementId });
        saveSetting('injectPlacement', placementState.placementId);
        saveSetting('injectPosition', placementState.position);
        saveSetting('injectDepth', placementState.depth);
    });

    if (depthInput) {
        depthInput.addEventListener('input', () => {
            const selectedPlacement = document.querySelector('.tk-placement-item.selected')?.dataset.placementId || 'message_depth';
            syncPlacementUI(selectedPlacement);
        });
    }
}

function getSelectedConnectionProfile(profileId = getSettings().connectionProfile) {
    if (!profileId || profileId === '__current__') return null;
    return getConnectionProfiles().find(profile => profile.id === profileId) || null;
}

function getModelSelectElementForProfile(profile) {
    const modelSelectMap = [
        { id: 'generic_model_textgenerationwebui', api: 'textgenerationwebui', type: 'generic' },
        { id: 'custom_model_textgenerationwebui', api: 'textgenerationwebui', type: 'ooba' },
        { id: 'model_togetherai_select', api: 'textgenerationwebui', type: 'togetherai' },
        { id: 'openrouter_model', api: 'textgenerationwebui', type: 'openrouter' },
        { id: 'model_infermaticai_select', api: 'textgenerationwebui', type: 'infermaticai' },
        { id: 'model_dreamgen_select', api: 'textgenerationwebui', type: 'dreamgen' },
        { id: 'mancer_model', api: 'textgenerationwebui', type: 'mancer' },
        { id: 'vllm_model', api: 'textgenerationwebui', type: 'vllm' },
        { id: 'aphrodite_model', api: 'textgenerationwebui', type: 'aphrodite' },
        { id: 'ollama_model', api: 'textgenerationwebui', type: 'ollama' },
        { id: 'tabby_model', api: 'textgenerationwebui', type: 'tabby' },
        { id: 'llamacpp_model', api: 'textgenerationwebui', type: 'llamacpp' },
        { id: 'featherless_model', api: 'textgenerationwebui', type: 'featherless' },
        { id: 'model_openai_select', api: 'openai', source: 'openai' },
        { id: 'model_claude_select', api: 'openai', source: 'claude' },
        { id: 'model_openrouter_select', api: 'openai', source: 'openrouter' },
        { id: 'model_ai21_select', api: 'openai', source: 'ai21' },
        { id: 'model_google_select', api: 'openai', source: 'makersuite' },
        { id: 'model_vertexai_select', api: 'openai', source: 'vertexai' },
        { id: 'model_mistralai_select', api: 'openai', source: 'mistralai' },
        { id: 'custom_model_id', api: 'openai', source: 'custom' },
        { id: 'model_cohere_select', api: 'openai', source: 'cohere' },
        { id: 'model_perplexity_select', api: 'openai', source: 'perplexity' },
        { id: 'model_groq_select', api: 'openai', source: 'groq' },
        { id: 'model_chutes_select', api: 'openai', source: 'chutes' },
        { id: 'model_siliconflow_select', api: 'openai', source: 'siliconflow' },
        { id: 'model_electronhub_select', api: 'openai', source: 'electronhub' },
        { id: 'model_nanogpt_select', api: 'openai', source: 'nanogpt' },
        { id: 'model_deepseek_select', api: 'openai', source: 'deepseek' },
        { id: 'model_aimlapi_select', api: 'openai', source: 'aimlapi' },
        { id: 'model_xai_select', api: 'openai', source: 'xai' },
        { id: 'model_pollinations_select', api: 'openai', source: 'pollinations' },
        { id: 'model_moonshot_select', api: 'openai', source: 'moonshot' },
        { id: 'model_fireworks_select', api: 'openai', source: 'fireworks' },
        { id: 'model_cometapi_select', api: 'openai', source: 'cometapi' },
        { id: 'model_navy_select', api: 'openai', source: 'navy' },
        { id: 'model_routeway_select', api: 'openai', source: 'routeway' },
        { id: 'model_zai_select', api: 'openai', source: 'zai' },
        { id: 'model_novel_select', api: 'novel' },
        { id: 'horde_model', api: 'koboldhorde' },
    ];

    if (!profile?.api) return null;

    const apiConfig = CONNECT_API_MAP[String(profile.api).toLowerCase()];
    const selectedApi = apiConfig?.selected || profile.api;
    const selectedSource = apiConfig?.source || null;
    const selectedType = apiConfig?.type || null;

    const mapping = modelSelectMap.find(entry =>
        entry.api === selectedApi &&
        (entry.source ? entry.source === selectedSource : true) &&
        (entry.type ? entry.type === selectedType : true),
    );

    return mapping ? document.getElementById(mapping.id) : null;
}

function readModelsFromControl(control, profile = null) {
    if (!control) return [];

    const providerLabel = profile?.name || profile?.api || '';
    if (control.tagName === 'SELECT') {
        const models = [];
        control.querySelectorAll('option').forEach(opt => {
            const value = String(opt.value || '').trim();
            const name = String(opt.textContent || '').trim();
            if (!value || !name) return;
            models.push({ id: value, name, provider: providerLabel });
        });
        return models;
    }

    const value = String(control.value || '').trim();
    return value ? [{ id: value, name: value, provider: providerLabel }] : [];
}

function getCurrentModelFromDom() {
    const activeProfile = getSelectedConnectionProfile(getCurrentConnectionProfileId());
    const activeControl = getModelSelectElementForProfile(activeProfile);
    const activeValue = String(activeControl?.value || '').trim();
    if (activeValue) {
        return activeValue;
    }

    const fallbackControl = document.getElementById('model_openai_select') ||
        document.getElementById('model_togetherai_select') ||
        document.querySelector('[id*="model"][id*="select"]');

    return String(fallbackControl?.value || '').trim();
}

function getCurrentConnectionProfileId() {
    return extension_settings.connectionManager?.selectedProfile || null;
}

function getDefaultModelForSelection(profileId = getSettings().connectionProfile) {
    if (!profileId || profileId === '__current__') {
        return getSettings().model || getCurrentModelFromDom() || '';
    }

    const profile = getSelectedConnectionProfile(profileId);
    if (!profile) {
        return '';
    }

    if (profile.id === getCurrentConnectionProfileId()) {
        return String(profile.model || getCurrentModelFromDom() || '').trim();
    }

    return String(profile.model || '').trim();
}

function getSecretKeyForProfile(profile) {
    const api = String(profile?.api || '').toLowerCase();
    const secretKeyMap = {
        openai: SECRET_KEYS.OPENAI,
        claude: SECRET_KEYS.CLAUDE,
        openrouter: SECRET_KEYS.OPENROUTER,
        ai21: SECRET_KEYS.AI21,
        makersuite: SECRET_KEYS.MAKERSUITE,
        vertexai: SECRET_KEYS.VERTEXAI,
        mistralai: SECRET_KEYS.MISTRALAI,
        custom: SECRET_KEYS.CUSTOM,
        cohere: SECRET_KEYS.COHERE,
        perplexity: SECRET_KEYS.PERPLEXITY,
        groq: SECRET_KEYS.GROQ,
        chutes: SECRET_KEYS.CHUTES,
        electronhub: SECRET_KEYS.ELECTRONHUB,
        navy: SECRET_KEYS.NAVY,
        nanogpt: SECRET_KEYS.NANOGPT,
        deepseek: SECRET_KEYS.DEEPSEEK,
        aimlapi: SECRET_KEYS.AIMLAPI,
        xai: SECRET_KEYS.XAI,
        pollinations: null,
        moonshot: SECRET_KEYS.MOONSHOT,
        fireworks: SECRET_KEYS.FIREWORKS,
        siliconflow: SECRET_KEYS.SILICONFLOW,
        routeway: SECRET_KEYS.ROUTEWAY,
        zai: SECRET_KEYS.ZAI,
    };

    return secretKeyMap[api] ?? null;
}

function getModelsEndpointForProfile(profile) {
    const api = String(profile?.api || '').toLowerCase();
    const endpointMap = {
        openai: 'https://api.openai.com/v1/models',
        claude: 'https://api.anthropic.com/v1/models',
        openrouter: 'https://openrouter.ai/api/v1/models',
        ai21: 'https://api.ai21.com/studio/v1/models',
        makersuite: 'https://generativelanguage.googleapis.com/v1beta/models',
        mistralai: 'https://api.mistral.ai/v1/models',
        custom: profile?.['api-url'] ? `${String(profile['api-url']).replace(/\/$/, '')}/models` : '',
        cohere: 'https://api.cohere.ai/v1/models',
        perplexity: 'https://api.perplexity.ai/models',
        groq: 'https://api.groq.com/openai/v1/models',
        chutes: 'https://llm.chutes.ai/v1/models',
        electronhub: 'https://api.electronhub.ai/v1/models',
        navy: 'https://api.navy/v1/models',
        nanogpt: 'https://nano-gpt.com/api/v1/models?detailed=true',
        deepseek: 'https://api.deepseek.com/models',
        aimlapi: 'https://api.aimlapi.com/v1/models',
        xai: 'https://api.x.ai/v1/models',
        pollinations: 'https://text.pollinations.ai/models',
        moonshot: 'https://api.moonshot.ai/v1/models',
        fireworks: 'https://api.fireworks.ai/inference/v1/models',
        siliconflow: 'https://api.siliconflow.com/v1/models',
        routeway: 'https://api.routeway.ai/v1/models',
        zai: 'https://api.z.ai/api/paas/v4/models',
    };

    return endpointMap[api] || '';
}

function normalizeFetchedModels(profile, payload) {
    const api = String(profile?.api || '').toLowerCase();
    const provider = profile?.name || profile?.api || '';
    const sourceList = Array.isArray(payload?.data)
        ? payload.data
        : Array.isArray(payload?.models)
            ? payload.models
            : Array.isArray(payload)
                ? payload
                : [];

    let models = sourceList.map(model => {
        const id = model?.id || model?.name || model?.model || model?.slug;
        if (!id) return null;
        return {
            id: String(id),
            name: String(model?.name || id),
            provider,
        };
    }).filter(Boolean);

    if (api === 'fireworks') {
        models = models.filter((model, index) => sourceList[index]?.supports_chat !== false);
    }

    if (api === 'aimlapi') {
        models = models.filter((model, index) => {
            const type = sourceList[index]?.type;
            return !type || type === 'chat-completion';
        });
    }

    if (api === 'electronhub') {
        models = models.filter((model, index) => {
            const endpoints = sourceList[index]?.endpoints;
            return !Array.isArray(endpoints) || endpoints.includes('/v1/chat/completions');
        });
    }

    if (api === 'navy') {
        models = models.filter((model, index) => {
            const endpoint = sourceList[index]?.endpoint;
            return !endpoint || endpoint === '/v1/chat/completions';
        });
    }

    return models;
}

async function fetchModelsForProfile(profile) {
    const cacheKey = `${profile.id}:${profile['secret-id'] || ''}:${profile.model || ''}`;
    if (modelCatalogCache.has(cacheKey)) {
        return modelCatalogCache.get(cacheKey);
    }

    // Route through ST backend to avoid CORS — same endpoint ST uses for its own model lists
    try {
        const apiConfig = CONNECT_API_MAP[String(profile.api || '').toLowerCase()];
        const chatCompletionSource = apiConfig?.source || profile.api;

        const body = {
            chat_completion_source: chatCompletionSource,
        };
        // Pass custom URL if profile has one
        if (profile['api-url']) {
            body.custom_url = profile['api-url'];
        }
        if (oai_settings?.reverse_proxy) {
            body.reverse_proxy = oai_settings.reverse_proxy;
            body.proxy_password = oai_settings.proxy_password;
        }

        const response = await fetch('/api/backends/chat-completions/status', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(10000),
        });

        if (!response.ok) {
            return [];
        }

        const responseData = await response.json();
        const provider = profile.name || profile.api || '';

        if (responseData.data && Array.isArray(responseData.data)) {
            const models = responseData.data.map(m => ({
                id: String(m.id || m.name || ''),
                name: String(m.name || m.id || ''),
                provider,
            })).filter(m => m.id);
            if (models.length > 0) {
                modelCatalogCache.set(cacheKey, models);
            }
            return models;
        }
    } catch (error) {
    }

    // Fallback: try direct fetch (works for CORS-friendly APIs like OpenRouter)
    const endpoint = getModelsEndpointForProfile(profile);
    if (endpoint) {
        try {
            const secretKey = getSecretKeyForProfile(profile);
            const secretValue = secretKey && profile['secret-id'] ? await findSecret(secretKey, profile['secret-id']) : null;

            const headers = {};
            if (secretValue) {
                headers.Authorization = `Bearer ${secretValue}`;
            }

            const response = await fetch(endpoint, {
                method: 'GET',
                headers,
                signal: AbortSignal.timeout(8000),
            });

            if (response.ok) {
                const payload = await response.json();
                const models = normalizeFetchedModels(profile, payload);
                if (models.length > 0) {
                    modelCatalogCache.set(cacheKey, models);
                    return models;
                }
            }
        } catch (e) {
        }
    }

    return [];
}

async function getAvailableModels(profileId = getSettings().connectionProfile) {
    const profile = getSelectedConnectionProfile(profileId);

    if (profile) {
        const currentProfileId = getCurrentConnectionProfileId();
        const isCurrentConnectionProfile = profile.id === currentProfileId;

        // Strategy 1: Read from the DOM model <select> for this profile's provider
        const profileControl = getModelSelectElementForProfile(profile);

        if (profileControl) {
            const profileModels = readModelsFromControl(profileControl, profile);
            if (profileModels.length > 0) {
                if (profile.model && !profileModels.some(model => model.id === profile.model)) {
                    profileModels.unshift({ id: profile.model, name: profile.model, provider: profile.name || profile.api || '' });
                }
                return profileModels;
            }
        }

        // Strategy 2: Fetch through ST backend proxy (avoids CORS)
        const fetchedModels = await fetchModelsForProfile(profile);
        if (fetchedModels.length > 0) {
            if (profile.model && !fetchedModels.some(model => model.id === profile.model)) {
                fetchedModels.unshift({ id: profile.model, name: profile.model, provider: profile.name || profile.api || '' });
            }
            return fetchedModels;
        }

        // Strategy 3: Use profile's saved model
        if (profile.model) {
            return [{ id: profile.model, name: profile.model, provider: profile.name || profile.api || '' }];
        }

        // Strategy 4: Read from whichever model select is currently populated
        const domModels = readModelsFromAnySelect();
        if (domModels.length > 0) return domModels;

        return [];
    }

    // No specific profile — read from the currently active model select
    const domModels = readModelsFromAnySelect();
    if (domModels.length > 0) return domModels;

    // Hardcoded fallback
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

/** Scan all model select elements on the page and return models from whichever has entries */
function readModelsFromAnySelect() {
    const selectIds = [
        'model_navy_select', 'model_openai_select', 'model_openrouter_select',
        'model_claude_select', 'model_google_select', 'model_mistralai_select',
        'model_deepseek_select', 'model_groq_select', 'model_chutes_select',
        'model_electronhub_select', 'model_togetherai_select', 'model_perplexity_select',
        'model_ai21_select', 'model_cohere_select', 'model_nanogpt_select',
        'model_xai_select', 'model_fireworks_select', 'model_siliconflow_select',
        'model_aimlapi_select', 'model_moonshot_select', 'model_routeway_select',
        'model_zai_select', 'model_novel_select', 'custom_model_id',
        'openrouter_model', 'mancer_model', 'vllm_model', 'ollama_model',
    ];
    for (const id of selectIds) {
        const el = document.getElementById(id);
        if (!el) continue;
        const models = readModelsFromControl(el);
        if (models.length > 0) {
            return models;
        }
    }
    return [];
}

function getConnectionProfiles() {
    try {
        if (extension_settings.connectionManager && extension_settings.connectionManager.profiles) {
            const profiles = extension_settings.connectionManager.profiles;
            return profiles;
        }
    } catch (e) {
        // Connection manager not available
    }
    return [];
}

// ═══════════════════════════════════════════════════════════════════
// EVENT HANDLERS
// ═══════════════════════════════════════════════════════════════════

function handleOverlayDismiss(event) {
    const overlay = document.getElementById('threadkeeper-overlay');
    const terminal = document.getElementById('threadkeeper-terminal');

    if (!overlay || !terminal || !isTerminalOpen) return;

    // Only close when the interaction lands on the backdrop itself,
    // not on any element inside the terminal UI.
    if (event.target === overlay) {
        closeTerminal();
    }
}

function syncUIFromSettings() {
    const settings = getSettings();

    // Sync all UI elements from settings
    const connection = document.getElementById('tk-cfg-connection');
    if (connection) connection.value = settings.connectionProfile || '__current__';

    const temp = document.getElementById('tk-cfg-temp');
    if (temp) temp.value = String((settings.temperature || 0.2) * 10);

    const maxFacts = document.getElementById('tk-cfg-maxfacts');
    if (maxFacts) maxFacts.value = String(settings.maxFacts || 100);

    const autoScan = document.getElementById('tk-cfg-autoscan');
    if (autoScan) autoScan.value = String(settings.autoScanInterval || 10);

    const crossChat = document.getElementById('tk-cfg-crosschat');
    if (crossChat) crossChat.checked = settings.crossChatPinned !== false;

    const autoPin = document.getElementById('tk-cfg-autopin');
    if (autoPin) autoPin.checked = settings.autoPin === true;

    const hidden = document.getElementById('tk-cfg-hidden');
    if (hidden) hidden.checked = settings.scanHidden === true;

    const depth = document.getElementById('tk-cfg-depth');
    if (depth) depth.value = String(settings.messageDepth || 4);

    // Sync model display
    const modelDisplay = document.getElementById('tk-mp-selected');
    if (modelDisplay) {
        modelDisplay.textContent = settings.model || 'Use default model';
        modelDisplay.dataset.modelId = settings.model || '';
    }

    // Sync budget pills
    const budgetPills = document.querySelectorAll('#tk-cfg-budget .tk-pill');
    budgetPills.forEach(pill => {
        pill.classList.toggle('active', pill.dataset.v === (settings.injectBudget || 'medium'));
    });

}

function attachEventListeners() {
    const overlay = document.getElementById('threadkeeper-overlay');
    const terminal = document.getElementById('threadkeeper-terminal');

    if (overlay) {
        // Handle both pointer and click paths so taps reliably dismiss the
        // terminal across mouse and touch input.
        overlay.addEventListener('pointerdown', handleOverlayDismiss);
        overlay.addEventListener('click', handleOverlayDismiss);
    }

    // Prevent terminal interactions from bubbling into the backdrop handler.
    if (terminal) {
        terminal.addEventListener('pointerdown', (e) => e.stopPropagation());
        terminal.addEventListener('click', (e) => e.stopPropagation());
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

            // Collapse non-pinned fact lines from terminal.
            // Pinned elements stay visible — they remain in memory and won't
            // be re-added via addFactLine (deduped from extraction prompt).
            const pinnedIds = new Set(getPinnedFacts().map(f => String(f.id)));
            document.querySelectorAll('.tk-fact').forEach(el => {
                if (pinnedIds.has(el.dataset.factId)) return;
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

    // Clear unpinned facts button
    const clearFactsBtn = document.getElementById('tk-clear-facts-btn');
    if (clearFactsBtn) {
        clearFactsBtn.addEventListener('click', async () => {
            const regularFacts = getFacts().filter(f => !f.pinned);
            if (regularFacts.length === 0) {
                addTerminalLine('<span class="tk-dim">No unpinned facts to clear.</span>');
                addCursorLine();
                return;
            }

            clearNonPinnedFacts();
            await injectFacts();
            refreshTerminalContent();
            addTerminalLine(`<span class="tk-success">✓ Cleared ${regularFacts.length} unpinned fact${regularFacts.length === 1 ? '' : 's'}</span>`);
            addCursorLine();
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
    document.addEventListener('click', handleGlobalClick);
}

function handleGlobalClick(e) {
    const cpanel = document.querySelector('.tk-config-panel');
    const dropdown = document.getElementById('tk-mp-dropdown');
    const trigger = document.getElementById('tk-mp-trigger');
    if (dropdown && trigger && !dropdown.contains(e.target) && !trigger.contains(e.target)) {
        dropdown.classList.remove('open');
        trigger.classList.remove('open');
        if (cpanel) cpanel.classList.remove('dropdown-open');
    }

    const placementDropdown = document.getElementById('tk-placement-dropdown');
    const placementTrigger = document.getElementById('tk-placement-trigger');
    if (placementDropdown && placementTrigger && !placementDropdown.contains(e.target) && !placementTrigger.contains(e.target)) {
        placementDropdown.classList.remove('open');
        placementTrigger.classList.remove('open');
        placementTrigger.setAttribute('aria-expanded', 'false');
        if (cpanel) cpanel.classList.remove('dropdown-open');
    }
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
    restorePinnedFromGlobal();
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
    btn.style.display = 'flex';
    btn.style.alignItems = 'center';
    btn.style.gap = '10px';
    btn.style.background = 'transparent';
    btn.style.border = '0';
    btn.style.boxShadow = 'none';
    btn.innerHTML = `
        <span class="tk-menu-icon">
            ${MEMORY_ORB_SVG_SMALL}
        </span>
        <span class="tk-menu-label">ThreadKeeper</span>`;
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
            callback: async (namedArgs, value) => {
                const subcommand = (typeof value === 'string' ? value.trim() : '') || 'open';
                switch (subcommand) {
                    case 'open':
                        openTerminal();
                        return 'ThreadKeeper opened.';
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
            helpString: 'ThreadKeeper memory management. Subcommands: open, extract, reextract, facts, clear',
        }));
    } catch (e) {
    }
}

// ═══════════════════════════════════════════════════════════════════
// CLEANUP / UNLOAD
// ═══════════════════════════════════════════════════════════════════

function cleanup() {
    eventSource.off(event_types.CHAT_CHANGED, onChatChanged);
    eventSource.off(event_types.CHARACTER_MESSAGE_RENDERED, onNewMessage);
    eventSource.off(event_types.USER_MESSAGE_RENDERED, onNewMessage);
    document.removeEventListener('click', handleGlobalClick);
    mobileStyleLink?.remove();
    mobileStyleLink = null;
    document.getElementById('threadkeeper-overlay')?.remove();
    document.querySelectorAll('#threadkeeper-menu-item').forEach(el => el.remove());
    setExtensionPrompt(EXTENSION_PROMPT_KEY, '', extension_prompt_types.IN_CHAT, 0);
}

// ═══════════════════════════════════════════════════════════════════
// INITIALIZATION
// ═══════════════════════════════════════════════════════════════════

jQuery(async function () {
    // Load settings and persist to ensure they're saved on first load
    loadSettings();
    await saveSettings();

    // Load mobile stylesheet — detect extension path from our main CSS link
    try {
        const mainCssLink = document.querySelector('link[href*="ThreadKeeper"][rel="stylesheet"]');
        const basePath = mainCssLink ? mainCssLink.href.replace(/\/[^/]*$/, '') : `/scripts/extensions/third-party/${MODULE_NAME}`;
        mobileStyleLink = document.createElement('link');
        mobileStyleLink.rel = 'stylesheet';
        mobileStyleLink.type = 'text/css';
        mobileStyleLink.href = `${basePath}/mobile-style.css`;
        document.head.appendChild(mobileStyleLink);
    } catch (e) {
    }

    // Inject terminal HTML into the page
    const terminalHtml = buildTerminalHTML();
    document.body.insertAdjacentHTML('beforeend', terminalHtml);

    // Attach all event listeners
    attachEventListeners();

    // Inject menu button into Push Modal (with retry for dynamic loading)
    const tryInject = () => {
        try { injectMenuButton(); } catch (e) {
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

    // Clean up when the page unloads (extension disabled without reload, or page close)
    window.addEventListener('beforeunload', cleanup, { once: true });

    // Register slash commands
    registerSlashCommands();

    // Initial injection if chat already loaded
    await injectFacts();

});
