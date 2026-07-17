/**
 * Threadkeeper — LLM Memory for Long Roleplays
 * DreamTavern Extension · v1.0.5
 *
 * Extracts key facts from chat messages using an LLM and injects them
 * into the prompt so the model never forgets what matters.
 */

import { debounce, waitUntilCondition, timestampToMoment } from '../../../utils.js';
import { getContext, extension_settings, saveMetadataDebounced } from '../../../extensions.js';
import { ConnectionManagerRequestService } from '../../shared.js';
import {
    chat_metadata,
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
    showMoreMessages,
} from '../../../../script.js';
import { metadata_keys as authorNoteMetadataKeys } from '../../../authors-note.js';
import { Popup, POPUP_TYPE } from '../../../popup.js';
import { getTokenCountAsync } from '../../../tokenizers.js';
import { debounce_timeout } from '../../../constants.js';
import { SlashCommandParser } from '../../../slash-commands/SlashCommandParser.js';
import { SlashCommand } from '../../../slash-commands/SlashCommand.js';
import { CONNECT_API_MAP } from '../../../slash-commands.js';
import { SECRET_KEYS, findSecret } from '../../../secrets.js';
import { oai_settings, proxies } from '../../../openai.js';
import { installUninstallHook, wipeThreadKeeperData } from './uninstall.js';

// ═══════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════

const MODULE_NAME = 'threadkeeper';
const EXTENSION_PROMPT_KEY = 'threadkeeper_facts';
// First line of the injected facts block. Also used by the prompt-ready guard
// to detect whether the block survived chat-history budget truncation.
const INJECTION_HEADER = '[Threadkeeper — Key Facts for Story Continuity]';

const CATEGORIES = ['timeline', 'character', 'relationship', 'event', 'item', 'location', 'plot'];
const CATEGORY_LABELS = { character: 'chr', relationship: 'rel', event: 'evt', item: 'itm', location: 'loc', plot: 'plt', timeline: 'time' };
const CATEGORY_SORT_ORDER = CATEGORIES.reduce((acc, category, index) => {
    acc[category] = index;
    return acc;
}, {});

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
    // Archive folder grouping: when archive count >= this size, the archive
    // view groups facts into manila-folder cards of this size each. Valid
    // values: 100, 200, 300 (user-picked via pills in Advanced settings).
    archiveFolderSize: 100,
    // Scanning
    autoScanInterval: 10,
    scanHidden: false,
    extractionTone: 'Polite',
    minFactsPerBatch: 1,
    maxFactsPerBatch: 15,
    batchTokenBudget: 5000,
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
    none: {
        id: 'none',
        label: 'Injection: NONE',
        position: extension_prompt_types.IN_CHAT,
        depth: 0,
        useMessageDepth: false,
        skipInjection: true,
    },
};

// ═══════════════════════════════════════════════════════════════════
// EXTRACTION PROMPT
// ═══════════════════════════════════════════════════════════════════

function getExtractionSystemPromptPolite(minFacts = 1, maxFacts = 15) {
    return `You are a precise fact extractor for a roleplay conversation. Extract key facts that a language model would need to maintain story consistency.

RULES:
- Output ONLY a valid JSON array — no markdown, no commentary, no explanation
- Each fact: {"category": "<one of: timeline, character, relationship, event, item, location, plot>", "text": "<concise fact>", "source_index": <message_number>}
- Be concise: each fact should be one clear sentence
- Focus on facts that would be LOST if the model forgot earlier messages
- Extract between ${minFacts} and ${maxFacts} facts per batch
- Use "timeline" only for real day/time anchors, scene transitions, or major time skips. Timeline text must begin in this format: "Day N - at TIME [most significant thing that happened]". Example: "Day 14 - at 06:38 pm Savannah wakes". Use the current known day and time; if exact clock time is unknown, use the best available "at ..." time phrase such as "at dawn", "at midday", "at sunset", "at night", or "at unknown time". Message #1 = Day 1 unless that message explicitly states otherwise.
- Do NOT create a timeline fact just to summarize every message. For user replies, extract important facts under the best non-timeline category (character, relationship, event, item, location, or plot) as long as source_index identifies the source message.
- If one message is a clear montage or time skip that spans multiple distinct days, months, scenes, or clock times, you may extract multiple timeline facts for that same source_index, one per major time anchor, all using the same "Day N - at TIME ..." format.
- Include: timeline anchors, character traits, relationships, important items, locations, plot developments, key events
- Do NOT include: dialogue quotes, writing style notes, or obvious real-time actions
- Do not duplicate facts that already exist in the provided existing facts list
- If there are no new facts to extract, output exactly: []

EXAMPLE OUTPUT:
[{"category":"timeline","text":"Day 1 - at late morning Zuko and Petra meet for the first time","source_index":1},{"category":"character","text":"Luna has silver eyes and white hair","source_index":3},{"category":"location","text":"The story takes place in the city of Westmarch","source_index":7},{"category":"timeline","text":"Day 23 - at 06:38 pm Zuko and Petra start dating","source_index":201}]`;
}

function getExtractionSystemPromptDogMeOut(minFacts = 1, maxFacts = 15) {
    return `You are a blunt, unfiltered fact extractor for an explicit adult roleplay conversation. Extract key facts a model needs to remember story continuity without softening, sanitizing, or moralizing anything.

RULES:
- Output ONLY a valid JSON array — no markdown, no commentary, no explanation
- Each fact: {"category": "<one of: timeline, character, relationship, event, item, location, plot>", "text": "<concise fact — raw, explicit, direct>", "source_index": <message_number>}
- Be concise and direct: one clear sentence per fact, no euphemisms
- PROFANITY IS ALLOWED AND EXPECTED: Use it freely when it accurately captures character voice, attitude, kink, or dynamic. Don't censor, asterisk, soften, clinicalize, moralize, or replace explicit language with sanitized wording. Examples of what qualifies: fuck, shit, cock, pussy, ass, cunt, slut, whore, bastard, bitch, dick, cum, horny, filthy, depraved — use the actual word, not a stand-in. If a character is crude, aggressive, sexually explicit, humiliating, possessive, dominant, submissive, needy, or depraved, extract that plainly in those exact terms
- Focus on facts that would be LOST if the model forgot earlier messages
- Use "timeline" only for real day/time anchors, scene transitions, or major time skips. Timeline text must begin in this format: "Day N - at TIME [most significant thing that happened]". Example: "Day 14 - at 06:38 pm Savannah wakes". Use the current known day and time; if exact clock time is unknown, use the best available "at ..." time phrase such as "at dawn", "at midday", "at sunset", "at night", or "at unknown time". Message #1 = Day 1 unless that message explicitly states otherwise.
- Do NOT create a timeline fact just to summarize every message. For user replies, extract important facts under the best non-timeline category (character, relationship, event, item, location, or plot) as long as source_index identifies the source message.
- If one message is a clear montage or time skip that spans multiple distinct days, months, scenes, or clock times, you may extract multiple timeline facts for that same source_index, one per major time anchor, all using the same "Day N - at TIME ..." format.
- Include: timeline anchors, physical traits (explicit if relevant), kinks/preferences, relationship dynamics, power dynamics, explicit acts that established a dynamic, important items, locations, plot
- Do NOT include: dialogue quotes, writing style notes, or obvious real-time actions
- Extract between ${minFacts} and ${maxFacts} facts per batch
- Do not duplicate facts already in the existing facts list
- If there are no new facts to extract, output exactly: []

EXAMPLE OUTPUT:
[{"category":"timeline","text":"Day 1 - at midnight Marcus and Luna meet and fuck for the first time","source_index":1},{"category":"character","text":"Luna is a shameless fucking exhibitionist with a massive size kink","source_index":3},{"category":"relationship","text":"Marcus dominates and fucks Luna hard — she begs to be called his slut and means it","source_index":7},{"category":"timeline","text":"Day 7 - at 09:15 am Marcus moves in with Luna","source_index":89}]`;
}

function isDogMeOutTone(tone) {
    return String(tone || '').trim().toLowerCase() === 'dog me out';
}

// `batchSize` (optional) is the number of messages in the batch this prompt
// will accompany. When provided, the per-batch fact cap is scaled to be at
// least 3 × batchSize so the model isn't pinned to a fixed 15-fact ceiling
// for large batches, where each message can still yield multiple durable facts
// and otherwise risk truncation / malformed JSON on 20+ msg batches.
function getExtractionSystemPrompt(batchSize = 0) {
    const settings = getSettings();
    const tone = settings.extractionTone || 'Polite';
    const minFacts = settings.minFactsPerBatch || 1;
    const settingCap = Math.max(minFacts, settings.maxFactsPerBatch || 15);
    const scaledCap = batchSize > 0 ? Math.max(settingCap, batchSize * 3) : settingCap;
    const maxFacts = scaledCap;

    return isDogMeOutTone(tone)
        ? getExtractionSystemPromptDogMeOut(minFacts, maxFacts)
        : getExtractionSystemPromptPolite(minFacts, maxFacts);
}

function parseCalendarDateMs(month, day, year) {
    // Use UTC to avoid DST/timezone drift in day arithmetic.
    return Date.UTC(year, month - 1, day);
}

function buildCalendarDayMapping() {
    let ctx = null;
    try { ctx = getContext(); } catch { /* extension not ready */ }
    const fullChat = ctx?.chat;
    if (!Array.isArray(fullChat) || fullChat.length === 0) return null;

    const datesSeen = new Set();
    for (const msg of fullChat) {
        const text = msg?.mes;
        if (typeof text !== 'string' || !text) continue;
        const match = text.match(/⏳[^\d\n]*(\d{1,2})\/(\d{1,2})\/(\d{4})/);
        if (match) {
            datesSeen.add(`${Number(match[1])}/${Number(match[2])}/${match[3]}`);
        }
    }

    // Continuation chats carry a calendarEpoch — the earliest ⏳ dashboard date
    // of the ORIGINAL chat in the lineage. Adding it to the date pool anchors
    // Day 1 there, so day numbering continues across chats instead of the new
    // chat's first dashboard date restarting the count at Day 1.
    const epoch = getTkData().calendarEpoch;
    if (typeof epoch === 'string' && /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(epoch)) {
        datesSeen.add(epoch);
    }
    if (datesSeen.size === 0) return null;

    const parsed = Array.from(datesSeen).map(date => {
        const [month, day, year] = date.split('/').map(Number);
        return { date, ms: parseCalendarDateMs(month, day, year) };
    }).sort((a, b) => a.ms - b.ms);

    const earliestMs = parsed[0].ms;
    const msPerDay = 24 * 60 * 60 * 1000;
    const mapping = Object.create(null);
    for (const item of parsed) {
        mapping[item.date] = Math.round((item.ms - earliestMs) / msPerDay) + 1;
    }

    return { earliest: parsed[0].date, mapping };
}

function detectInfoboardContext(messages) {
    const found = [];
    const batchDates = new Set();
    for (const msg of messages) {
        const text = msg.mes || '';
        const looksLikeBlock = /^\s*[\[{|<]/.test(text) || /\|\s*(day|date|time|morning|evening|night)/i.test(text);
        const hasTemporalKeyword = /\b(day\s*\d+|day\s+one|date\s*:|time\s*:|morning|afternoon|evening|night|week\s*\d+|month)\b/i.test(text);
        if (looksLikeBlock || hasTemporalKeyword) {
            const snippet = text.slice(0, 300).replace(/\n+/g, ' ').trim();
            found.push(`  Message #${msg._tkIndex}: "${snippet}"`);
        }

        const dashboardDate = text.match(/⏳[^\d\n]*(\d{1,2})\/(\d{1,2})\/(\d{4})/);
        if (dashboardDate) {
            batchDates.add(`${Number(dashboardDate[1])}/${Number(dashboardDate[2])}/${dashboardDate[3]}`);
        }
    }

    const parts = [];
    if (found.length > 0) {
        const plural = found.length > 1 ? 'blocks' : 'block';
        parts.push(`[Timeline context — ${found.length} infoboard/status ${plural} detected in this batch. Use these as authoritative day/time anchors when extracting timeline facts from surrounding messages:\n${found.join('\n')}]`);
    }

    const dayMapping = batchDates.size > 0 ? buildCalendarDayMapping() : null;
    if (dayMapping) {
        const rows = Array.from(batchDates)
            .filter(date => dayMapping.mapping[date])
            .sort((a, b) => dayMapping.mapping[a] - dayMapping.mapping[b])
            .map(date => `  ${date} = Day ${dayMapping.mapping[date]}`);
        if (rows.length > 0) {
            parts.push(`[CALENDAR ANCHOR: Day 1 = ${dayMapping.earliest} (earliest ⏳ dashboard date in this chat).\n${rows.join('\n')}\nUse these Day N values verbatim for facts whose source message has the corresponding ⏳ date.\nDo NOT just increment Day N when the dashboard date changes — look up the date in the table above.]`);
        }
    }

    return parts.length > 0 ? parts.join('\n\n') : null;
}

function buildExtractionPrompt(messages, existingFacts) {
    const settings = getSettings();
    const dogMode = isDogMeOutTone(settings.extractionTone || 'Polite');
    let prompt = 'Extract key facts from these roleplay messages:\n\n';

    const infoboardCtx = detectInfoboardContext(messages);
    if (infoboardCtx) {
        prompt = infoboardCtx + '\n\n' + prompt;
    }

    if (dogMode) {
        prompt += `DOG MODE OVERRIDE (MANDATORY FOR THIS RUN):
- Keep wording raw and explicit when the source messages are raw/explicit
- Preserve coarse/NSFW language in extracted facts when it is part of character voice, dynamic, or established behavior
- Do NOT sanitize, euphemize, censor, clinicalize, moralize, or replace explicit terms with softer wording
- If source language is vulgar, sexual, humiliating, possessive, dominant, submissive, degrading, needy, or depraved, facts should reflect that directly and plainly
- Do not add safety disclaimers or soften an explicit dynamic into neutral therapy language
- When timeline facts are present, list them before explicit character/relationship/event facts from the same source message

`;
    }

    messages.forEach((msg, i) => {
        const sender = msg.is_user ? (msg.name || 'User') : (msg.name || 'Character');
        prompt += `[Message ${msg._tkIndex}] ${sender}: ${msg.mes}\n\n`;
    });

    // Inject the latest timeline fact as an explicit "continue from here" anchor.
    // Picked by source_index (the message it came from), so it is always the true
    // chronological anchor — survives hidden messages and out-of-order extractions.
    // Anchor on the latest timeline fact from BEFORE this batch's first
    // message. For normal incremental scans that's every fact (unchanged
    // behavior); for Heal Gaps batches refilling an early range it stops the
    // chat's newest "Day 47" anchor from forcing Day >= 47 onto messages that
    // actually happened around Day 12.
    const batchStart = Number(messages?.[0]?._tkIndex) || Number.MAX_SAFE_INTEGER;
    const timelineFacts = (existingFacts || [])
        .filter(f => f.category === 'timeline' && Number.isFinite(getFactSourceIndex(f)) && getFactSourceIndex(f) < batchStart);
    // >= so equal source indexes resolve to the LAST fact in array order. Facts
    // carried into a continuation chat all have sourceIndex 0 but keep their
    // original chronological insertion order, so last-wins picks the newest
    // carried "Day N" anchor instead of the oldest.
    const latestAnchor = timelineFacts.reduce(
        (best, f) => (!best || getFactSourceIndex(f) >= getFactSourceIndex(best) ? f : best),
        null,
    );
    if (latestAnchor) {
        prompt += '\n--- LATEST TIMELINE ANCHOR (continue from here) ---\n';
        prompt += `"${latestAnchor.text}" (from message ${getFactSourceIndex(latestAnchor)})\n`;
        prompt += 'When extracting timeline facts in this batch, continue from this anchor. Only increment the day number when the messages in this batch explicitly indicate time has passed. Never restart numbering at a lower day, even if earlier messages are now hidden.\n';
    }

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
let stopRequested = false;
let isTerminalOpen = false;
let showingConfig = false;
let showingArchive = false;
// When non-null, the archive panel is showing one folder's contents.
// Shape: { startIdx, endIdx, msgStart, msgEnd }
let viewingFolderRange = null;
// Current text query for the archive searchbar ('' = no filter active).
let archiveSearchQuery = '';
let activeFilter = 'all';
let mobileStyleLink = null;
let autoScanPopupHideTimer = null;
// Last injection text registered via setExtensionPrompt — used by the
// prompt-ready guard to restore the block if budgeting truncated it out.
let lastInjectionText = '';
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
    if (settings.extractOnly === true) {
        settings.injectPlacement = 'none';
    }
    if ('extractOnly' in settings) {
        delete settings.extractOnly;
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

function getAuthorNotePlacementState() {
    const noteSettings = extension_settings.note || {};
    const position = Number(chat_metadata[authorNoteMetadataKeys.position] ?? noteSettings.defaultPosition ?? extension_prompt_types.IN_CHAT);
    const depth = Number(chat_metadata[authorNoteMetadataKeys.depth] ?? noteSettings.defaultDepth ?? DEFAULT_SETTINGS.injectDepth);
    const role = Number(chat_metadata[authorNoteMetadataKeys.role] ?? noteSettings.defaultRole ?? DEFAULT_SETTINGS.injectRole);

    return {
        position: Number.isFinite(position) ? position : extension_prompt_types.IN_CHAT,
        depth: Number.isFinite(depth) ? depth : DEFAULT_SETTINGS.injectDepth,
        role: Number.isFinite(role) ? role : DEFAULT_SETTINGS.injectRole,
    };
}

function getInjectionPlacementState(settings = getSettings()) {
    const placementId = INJECTION_PLACEMENTS[settings.injectPlacement] ? settings.injectPlacement : inferInjectionPlacement(settings);
    const placement = INJECTION_PLACEMENTS[placementId];
    const messageDepth = Number.isFinite(settings.messageDepth) ? settings.messageDepth : DEFAULT_SETTINGS.messageDepth;
    const authorNotePlacement = placementId === 'after_author' ? getAuthorNotePlacementState() : null;
    const resolvedDepth = authorNotePlacement?.depth ?? (placement.useMessageDepth ? messageDepth : placement.depth ?? settings.injectDepth);
    const label = placement.useMessageDepth ? `${placement.label}: ${messageDepth}` : placement.label;

    return {
        placementId,
        label,
        position: authorNotePlacement?.position ?? placement.position,
        depth: resolvedDepth,
        role: authorNotePlacement?.role,
        messageDepth,
        useMessageDepth: placement.useMessageDepth,
        skipInjection: !!placement.skipInjection,
    };
}

function getPendingMessagesCount() {
    const context = getContext();
    const chatLength = context.chat?.length || 0;
    return Math.max(0, chatLength - getLastScannedIndex());
}

function getCategorySortIndex(category) {
    return CATEGORY_SORT_ORDER[category] ?? CATEGORIES.length;
}

function sortFactsForDisplay(facts) {
    return facts.slice().sort((a, b) => {
        const sourceDelta = (a.sourceIndex || a.source_index || 0) - (b.sourceIndex || b.source_index || 0);
        if (sourceDelta !== 0) return sourceDelta;
        return getCategorySortIndex(a.category) - getCategorySortIndex(b.category);
    });
}

function sortExtractedFacts(facts) {
    return facts.slice().sort((a, b) => {
        const sourceDelta = (a.source_index || 0) - (b.source_index || 0);
        if (sourceDelta !== 0) return sourceDelta;
        return getCategorySortIndex(a.category) - getCategorySortIndex(b.category);
    });
}

function getFactSourceIndex(fact) {
    return Number(fact?.sourceIndex ?? fact?.source_index ?? 0);
}

function normalizeTimelineFactText(text) {
    return String(text || '').trim().replace(/^(Day\s+\d+)\s*[—–-]\s*/i, '$1 - ');
}

function getFactCategoryDisplay(category) {
    return category;
}

function estimateTokens(text) {
    return Math.max(1, Math.ceil(String(text || '').length / 4));
}

function estimateMessageTokens(msg) {
    const sender = msg.is_user ? (msg.name || 'User') : (msg.name || 'Character');
    return estimateTokens(`[Message ${msg._tkIndex}] ${sender}: ${msg.mes || ''}`);
}

// A batch closes as soon as EITHER the token budget would be exceeded OR the
// message count cap is hit. The message cap keeps batches from blowing past
// what the model can usefully reason about even when the chat is mostly short
// messages that fit comfortably within the token budget.
const BATCH_MAX_MESSAGES = 25;

function buildTokenAwareBatches(messages, tokenBudget, maxMessages = BATCH_MAX_MESSAGES) {
    const budget = Math.max(500, Number(tokenBudget) || DEFAULT_SETTINGS.batchTokenBudget);
    const msgCap = Math.max(1, Number(maxMessages) || BATCH_MAX_MESSAGES);
    const batches = [];
    let batch = [];
    let batchTokens = 0;

    for (const msg of messages) {
        const msgTokens = estimateMessageTokens(msg);
        const wouldExceedTokens = batchTokens + msgTokens > budget;
        const wouldExceedCount = batch.length >= msgCap;
        if (batch.length > 0 && (wouldExceedTokens || wouldExceedCount)) {
            batches.push(batch);
            batch = [];
            batchTokens = 0;
        }
        batch.push(msg);
        batchTokens += msgTokens;
    }

    if (batch.length > 0) batches.push(batch);
    return batches;
}

function getRecentFactsForDedup(facts, limit = 50) {
    // Always carry pinned facts (user-curated) and every timeline fact (so the
    // model sees prior "Day N" anchors even when newer extractions come from
    // messages whose context lives in older or now-hidden messages). Then top up
    // with the most recent facts so general dedup still works.
    const recent = facts.slice(-limit);
    const recentIds = new Set(recent.map(f => f.id));
    const extras = facts.filter(f =>
        (f.pinned || f.category === 'timeline') && !recentIds.has(f.id),
    );
    return [...extras, ...recent];
}

function getEffectiveExtractionModelKey(settings = getSettings()) {
    const profileId = settings.connectionProfile || '__current__';
    const profile = profileId !== '__current__' ? getSelectedConnectionProfile(profileId) : null;
    const model = String(settings.model || profile?.model || getCurrentModelFromDom?.() || '').trim();
    const api = String(profile?.api || 'current').trim();
    return `${profileId}|${api}|${model}`;
}

function countNonHiddenMessagesInRange(startIndex, endIndex) {
    const context = getContext();
    const chat = context.chat || [];
    let count = 0;
    const start = Math.max(0, Number(startIndex || 1) - 1);
    const end = Math.min(chat.length - 1, Number(endIndex || chat.length) - 1);
    for (let i = start; i <= end; i++) {
        const msg = chat[i];
        if (!msg || msg.is_system) continue;
        if (!msg.mes || msg.mes.trim().length === 0) continue;
        count++;
    }
    return count;
}

function getPausedOnEmpties() {
    const data = getTkData();
    return data.pausedOnEmpties || null;
}

function clearPausedOnEmpties() {
    const data = getTkData();
    if (data.pausedOnEmpties) {
        delete data.pausedOnEmpties;
        setTkData(data);
    }
}

function setPausedOnEmpties(pauseState) {
    const data = getTkData();
    data.pausedOnEmpties = pauseState;
    setTkData(data);
}

function canResumeAfterEmptyPause(settings = getSettings()) {
    const pauseState = getPausedOnEmpties();
    if (!pauseState) return { allowed: true, reason: 'not-paused' };

    const modelChanged = getEffectiveExtractionModelKey(settings) !== pauseState.modelKey;
    if (modelChanged) return { allowed: true, reason: 'model-changed' };

    const visibleNow = countNonHiddenMessagesInRange(pauseState.scanRangeStart, pauseState.scanRangeEnd);
    const hiddenMessagesChanged = settings.scanHidden === false && visibleNow < Number(pauseState.hiddenAtPause || 0);
    if (hiddenMessagesChanged) return { allowed: true, reason: 'messages-hidden' };

    return { allowed: false, reason: 'still-paused', pauseState };
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
    if (!context.chatMetadata) return { facts: [], lastScannedIndex: 0, archive: [] };
    if (!context.chatMetadata.threadkeeper) {
        context.chatMetadata.threadkeeper = { facts: [], lastScannedIndex: 0, archive: [] };
    }
    if (!Array.isArray(context.chatMetadata.threadkeeper.archive)) {
        context.chatMetadata.threadkeeper.archive = [];
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
    if (!Array.isArray(data.archive)) data.archive = [];
    const addedFacts = [];

    for (const fact of newFacts) {
        const factText = fact.category === 'timeline' ? normalizeTimelineFactText(fact.text) : fact.text;
        // Dedup: skip if already in active facts
        const isDupe = data.facts.some(f => f && f.text === factText);
        if (isDupe) continue;

        // If this fact was previously archived, restore it instead of creating a duplicate.
        const archivedIdx = data.archive.findIndex(f => f && f.text === factText);
        if (archivedIdx !== -1) {
            const restored = data.archive.splice(archivedIdx, 1)[0];
            delete restored.archivedAt;
            data.facts.push(restored);
            addedFacts.push(restored);
            continue;
        }

        const storedFact = {
            category: fact.category,
            text: factText,
            sourceIndex: fact.source_index || 0,
            pinned: false,
            id: Date.now() + Math.random(),
        };

        data.facts.push(storedFact);
        addedFacts.push(storedFact);
    }

    // Overflow: oldest facts (by sourceIndex) move to archive. Pin status is a
    // user-curation label, not an archive veto — pinned facts get archived too
    // when they're old enough. They keep `pinned: true` so restoring them later
    // brings the pin back. Newly-added facts from this same call are still
    // protected so we never archive what we just extracted.
    const newlyAddedIds = new Set(addedFacts.map(f => f.id));
    while (data.facts.filter(f => f !== null).length > settings.maxFacts) {
        let candidateIdx = -1;
        for (let i = 0; i < data.facts.length; i++) {
            const f = data.facts[i];
            if (f === null || newlyAddedIds.has(f.id)) continue;
            if (candidateIdx === -1) {
                candidateIdx = i;
                continue;
            }
            const current = data.facts[candidateIdx];
            const sourceDelta = (f.sourceIndex || 0) - (current.sourceIndex || 0);
            if (sourceDelta < 0 || (sourceDelta === 0 && (f.id || 0) < (current.id || 0))) {
                candidateIdx = i;
            }
        }
        if (candidateIdx === -1) break;
        const overflow = data.facts.splice(candidateIdx, 1)[0];
        if (overflow) {
            overflow.archivedAt = Date.now();
            data.archive.push(overflow);
        }
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

function archiveActiveFact(factId) {
    const data = getTkData();
    if (!Array.isArray(data.archive)) data.archive = [];

    const idx = data.facts.findIndex(f => f && f.id === factId);
    if (idx === -1) return false;

    const fact = data.facts.splice(idx, 1)[0];
    if (!fact) return false;

    fact.archivedAt = Date.now();
    data.archive.push(fact);
    setTkData(data);
    syncPinnedToGlobal();
    return true;
}

function parseFactEditInput(value, currentCategory) {
    const text = String(value || '').trim();
    if (!text) return null;

    const match = text.match(/^(character|relationship|event|item|location|plot|timeline)\s*[:|/-]\s*(.+)$/i);
    if (match) {
        return {
            category: match[1].toLowerCase(),
            text: match[2].trim(),
        };
    }

    return {
        category: currentCategory,
        text,
    };
}

function buildFactEditPopupHtml() {
    const options = CATEGORIES.map(category =>
        `<option value="${category}">${category}</option>`,
    ).join('');

    return `
        <div class="tk-fact-edit-popup">
            <label class="tk-fact-edit-field">
                <span class="tk-fact-edit-label">Category</span>
                <select id="tk-fact-edit-category" class="tk-cfg-select">
                    ${options}
                </select>
            </label>
            <label class="tk-fact-edit-field">
                <span class="tk-fact-edit-label">Fact text</span>
                <textarea
                    id="tk-fact-edit-text"
                    class="popup-input text_pole"
                    rows="5"
                    placeholder="Describe the fact you want ThreadKeeper to remember."
                ></textarea>
            </label>
            <div class="tk-fact-edit-help">
                Update the extracted fact directly. Source message and pin state are preserved.
            </div>
        </div>`;
}

async function editFact(factId) {
    const data = getTkData();
    const fact = data.facts.find(f => f && f.id === factId);
    if (!fact) return false;

    const popup = new Popup(buildFactEditPopupHtml(), POPUP_TYPE.CONFIRM, '', {
        okButton: 'Save',
        cancelButton: 'Cancel',
        wider: true,
        allowVerticalScrolling: true,
        onOpen: () => {
            const categoryInput = document.getElementById('tk-fact-edit-category');
            const textInput = document.getElementById('tk-fact-edit-text');
            if (categoryInput) categoryInput.value = fact.category;
            if (textInput) {
                textInput.value = fact.text;
                textInput.focus();
                textInput.setSelectionRange(textInput.value.length, textInput.value.length);
            }
        },
        onClosing: (instance) => {
            const categoryInput = /** @type {HTMLSelectElement | null} */ (instance.dlg.querySelector('#tk-fact-edit-category'));
            const textInput = /** @type {HTMLTextAreaElement | null} */ (instance.dlg.querySelector('#tk-fact-edit-text'));

            if (!categoryInput || !textInput) {
                return true;
            }

            const parsed = parseFactEditInput(textInput.value, categoryInput.value);
            if (!parsed || !parsed.text) {
                addTerminalLine('<span class="tk-warn">Fact text cannot be empty.</span>');
                return false;
            }

            if (!CATEGORIES.includes(parsed.category)) {
                addTerminalLine('<span class="tk-warn">Invalid fact category.</span>');
                return false;
            }

            const duplicate = data.facts.some(other => other && other.id !== fact.id && other.text === parsed.text);
            if (duplicate) {
                addTerminalLine('<span class="tk-warn">A fact with that text already exists.</span>');
                return false;
            }

            instance.value = parsed;
            return true;
        },
    });

    const edited = await popup.show();
    if (!edited || typeof edited !== 'object') {
        return false;
    }

    fact.category = edited.category;
    fact.text = edited.text;
    setTkData(data);
    syncPinnedToGlobal();
    return true;
}

function clearNonPinnedFacts() {
    const data = getTkData();
    data.facts = data.facts.filter(f => f && f.pinned);
    data.lastScannedIndex = 0;
    delete data.pausedOnEmpties;
    setTkData(data);
    syncPinnedToGlobal();
}

function unpinAllFacts() {
    const data = getTkData();
    data.facts.forEach(f => { if (f) f.pinned = false; });
    setTkData(data);
    syncPinnedToGlobal();
}

// Detect ranges of consecutive messages (within the scanned range) that produced
// zero facts. Large runs of dead messages are the fingerprint of a skipped batch
// in an older extraction run — real conversations almost never have 5+ msgs in a
// row with nothing extractable. Used by the "Heal Gaps" config action.
function findFactGaps(minSize = 5) {
    const facts = getFacts();
    const archive = getArchive();
    const lastScanned = getLastScannedIndex();
    if ((facts.length === 0 && archive.length === 0) || lastScanned <= 0) return [];

    // A fact ANYWHERE — active or archive — proves its source message was
    // extracted. The archive is where old facts land when the active cap
    // overflows, not a sign the message was skipped; ignoring it made every
    // long chat's archived early range look like one giant bogus gap.
    const factsAtMsg = new Set();
    for (const f of [...facts, ...archive]) {
        const idx = Number(f.sourceIndex || 0);
        if (idx > 0) factsAtMsg.add(idx);
    }

    // Only messages extraction would actually scan can form a gap. Empty
    // messages — and hidden (is_system) ones while "scan hidden" is off —
    // are skipped by runExtraction, so they can never be healed; counting
    // them re-reported the same pseudo-gap after every heal run.
    const skipHidden = getSettings().scanHidden === false;
    const chat = getContext().chat || [];
    const isScannable = (msgIdx) => {
        const msg = chat[msgIdx - 1];
        if (!msg) return false;
        if (skipHidden && msg.is_system) return false;
        return !!(msg.mes && msg.mes.trim().length > 0);
    };

    // Unscannable messages are neutral: they neither extend a run nor break
    // it, so scannable fact-less messages on both sides of a hidden stretch
    // still count as one gap. `length` counts scannable messages only.
    const gaps = [];
    let run = null;
    const closeRun = () => {
        if (run && run.length >= minSize) gaps.push(run);
        run = null;
    };
    const scanEnd = Math.min(lastScanned, chat.length);
    for (let i = 1; i <= scanEnd; i++) {
        if (factsAtMsg.has(i)) {
            closeRun();
            continue;
        }
        if (!isScannable(i)) continue;
        if (run === null) {
            run = { start: i, end: i, length: 1 };
        } else {
            run.end = i;
            run.length++;
        }
    }
    closeRun();
    return gaps;
}

// ═══════════════════════════════════════════════════════════════════
// ARCHIVE
// ═══════════════════════════════════════════════════════════════════

function getArchive() {
    const data = getTkData();
    return Array.isArray(data.archive) ? data.archive.filter(f => f !== null) : [];
}

function restoreFromArchive(factId) {
    const data = getTkData();
    const settings = getSettings();
    if (!Array.isArray(data.archive)) data.archive = [];
    const idx = data.archive.findIndex(f => f && f.id === factId);
    if (idx === -1) return false;

    const fact = data.archive.splice(idx, 1)[0];
    delete fact.archivedAt;
    data.facts.push(fact);

    // If active is now over cap, archive the oldest other fact (by sourceIndex)
    // to make room. Pin status is not a veto — the just-restored fact is the only
    // one protected, since archiving it would undo the restore the user just asked for.
    while (data.facts.filter(f => f !== null).length > settings.maxFacts) {
        let oldestIdx = -1;
        for (let i = 0; i < data.facts.length; i++) {
            const f = data.facts[i];
            if (f === null || f.id === factId) continue;
            if (oldestIdx === -1) {
                oldestIdx = i;
                continue;
            }
            const current = data.facts[oldestIdx];
            const sourceDelta = (f.sourceIndex || 0) - (current.sourceIndex || 0);
            if (sourceDelta < 0 || (sourceDelta === 0 && (f.id || 0) < (current.id || 0))) {
                oldestIdx = i;
            }
        }
        if (oldestIdx === -1) break;
        const overflow = data.facts.splice(oldestIdx, 1)[0];
        overflow.archivedAt = Date.now();
        data.archive.push(overflow);
    }

    setTkData(data);
    return true;
}

function restoreAllFromArchive() {
    const data = getTkData();
    const settings = getSettings();
    if (!Array.isArray(data.archive) || data.archive.length === 0) return { ok: false, reason: 'empty' };

    const activeCount = data.facts.filter(f => f !== null).length;
    const archiveCount = data.archive.filter(f => f !== null).length;
    if (activeCount + archiveCount > settings.maxFacts) {
        return { ok: false, reason: 'cap', activeCount, archiveCount, maxFacts: settings.maxFacts };
    }

    for (const fact of data.archive) {
        if (!fact) continue;
        delete fact.archivedAt;
        data.facts.push(fact);
    }
    data.archive = [];
    setTkData(data);
    return { ok: true, restored: archiveCount };
}

function deleteArchivedFact(factId) {
    const data = getTkData();
    if (!Array.isArray(data.archive)) return false;
    const idx = data.archive.findIndex(f => f && f.id === factId);
    if (idx === -1) return false;
    data.archive.splice(idx, 1);
    setTkData(data);
    return true;
}

function clearArchive() {
    const data = getTkData();
    data.archive = [];
    setTkData(data);
}

function stopExtraction() {
    if (isExtracting) {
        stopRequested = true;
    }
}

// ═══════════════════════════════════════════════════════════════════
// CROSS-CHAT PINNED FACTS
// ═══════════════════════════════════════════════════════════════════

// Key for the cross-chat pinned store: group id for group chats (this_chid is
// undefined there), character id for solo chats. Group ids are uuids and
// character ids are numeric indexes, so the two can never collide.
function getCrossChatKey() {
    const context = getContext();
    return String(context.groupId ?? context.characterId ?? '');
}

function syncPinnedToGlobal() {
    const settings = getSettings();
    if (!settings.crossChatPinned) return;

    const charKey = getCrossChatKey();
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

    const charKey = getCrossChatKey();
    if (!charKey) return;

    const globalPinned = extension_settings[MODULE_NAME].globalPinnedFacts?.[charKey];
    if (!globalPinned || globalPinned.length === 0) return;

    const data = getTkData();
    // Only seed a chat that has no facts of its own (likely a brand-new chat).
    // For chats that already have extracted facts/archive, leave them self-contained
    // so pinned facts from another chat of the same character don't pollute them.
    if ((data.facts?.length || 0) > 0 || (data.archive?.length || 0) > 0) {
        return;
    }
    for (const gf of globalPinned) {
        data.facts.push({
            category: gf.category,
            text: gf.text,
            sourceIndex: 0,
            pinned: true,
            id: Date.now() + Math.random(),
        });
    }
    setTkData(data);
}

// ═══════════════════════════════════════════════════════════════════
// GROUP CONTINUATION
// ═══════════════════════════════════════════════════════════════════

// Per-group config lives in extension_settings (names only — never fact
// content, so a big archive can't bloat settings.json):
//   groupContinuity: { [groupId]: { enabled: bool, chats: [chatFileName] } }
// An empty `chats` list means every chat in the group is part of the
// continuation pool.
function getGroupContinuityConfig(groupId, create = false) {
    if (!groupId) return null;
    const settings = getSettings();
    if (!settings.groupContinuity) {
        if (!create) return settings.groupContinuity?.[groupId] || null;
        settings.groupContinuity = {};
    }
    if (!settings.groupContinuity[groupId] && create) {
        settings.groupContinuity[groupId] = { enabled: false, chats: [] };
    }
    return settings.groupContinuity[groupId] || null;
}

async function fetchGroupChatFile(chatId) {
    try {
        const response = await fetch('/api/chats/group/get', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ id: chatId }),
        });
        if (!response.ok) return null;
        const data = await response.json();
        return Array.isArray(data) ? data : null;
    } catch {
        return null;
    }
}

// Earliest ⏳ dashboard date in a message array, normalized to the same
// "M/D/YYYY" format buildCalendarDayMapping uses for its date pool.
function findEarliestDashboardDate(messages) {
    let earliest = null;
    for (const msg of messages) {
        const text = msg?.mes;
        if (typeof text !== 'string' || !text) continue;
        const match = text.match(/⏳[^\d\n]*(\d{1,2})\/(\d{1,2})\/(\d{4})/);
        if (!match) continue;
        const ms = parseCalendarDateMs(Number(match[1]), Number(match[2]), Number(match[3]));
        if (earliest === null || ms < earliest.ms) {
            earliest = { ms, date: `${Number(match[1])}/${Number(match[2])}/${match[3]}` };
        }
    }
    return earliest?.date || null;
}

let isSeedingContinuation = false;

/**
 * If the current chat is a group chat with continuation enabled and no
 * ThreadKeeper data of its own yet, carry facts + archive over from the most
 * recently active chat in the continuation pool. Returns true if seeded.
 */
async function maybeSeedGroupContinuation() {
    if (isSeedingContinuation) return false;

    const settings = getSettings();
    if (!settings.enabled) return false;

    const context = getContext();
    const groupId = context.groupId;
    if (!groupId) return false;

    const cfg = getGroupContinuityConfig(groupId);
    if (!cfg?.enabled) return false;

    const data = getTkData();
    if ((data.facts?.filter(f => f !== null).length || 0) > 0) return false;
    if ((data.archive?.filter(f => f !== null).length || 0) > 0) return false;

    const group = (context.groups || []).find(g => g.id === groupId);
    if (!group || !Array.isArray(group.chats)) return false;

    const currentChatId = group.chat_id;
    // Pool: the saved selection (pruned of renamed/deleted chats), or the whole
    // group when nothing is selected. Never the current chat itself.
    const selected = Array.isArray(cfg.chats) ? cfg.chats.filter(id => group.chats.includes(id)) : [];
    const pool = (selected.length > 0 ? selected : group.chats).filter(id => id !== currentChatId);
    if (pool.length === 0) return false;

    isSeedingContinuation = true;
    try {
        const startChatId = context.getCurrentChatId();
        let best = null; // { chatId, tk, epoch, lastMesTime }

        for (const chatId of pool) {
            // User switched chats while we were fetching — abort before any write.
            if (getContext().getCurrentChatId() !== startChatId) return false;

            const fileData = await fetchGroupChatFile(chatId);
            if (!Array.isArray(fileData) || fileData.length === 0) continue;

            const header = Object.hasOwn(fileData[0] || {}, 'chat_metadata') ? fileData.shift() : null;
            const tk = header?.chat_metadata?.threadkeeper;
            const factCount = (tk?.facts || []).filter(f => f).length;
            const archiveCount = (tk?.archive || []).filter(f => f).length;
            if (!tk || (factCount === 0 && archiveCount === 0)) continue;

            const lastMes = fileData.length ? fileData[fileData.length - 1] : null;
            const momentVal = lastMes?.send_date ? timestampToMoment(lastMes.send_date).valueOf() : 0;
            const lastMesTime = Number.isFinite(momentVal) ? momentVal : 0;

            // Prefer a chat that itself carries an epoch (it chains back to the
            // lineage's original chat) over re-deriving from its own messages.
            const epoch = tk.calendarEpoch || findEarliestDashboardDate(fileData);

            // >= so ties (missing dates) resolve to the later chat in pool order
            // — group.chats is append-ordered, so later = newer.
            if (!best || lastMesTime >= best.lastMesTime) {
                best = { chatId, tk, epoch, lastMesTime };
            }
        }

        if (!best) return false;
        if (getContext().getCurrentChatId() !== startChatId) return false;

        // Carried items keep pin state and identity but drop their message
        // pointer — sourceIndex refers to the SOURCE chat's message numbers,
        // which mean nothing here. origSourceIndex is kept for provenance and
        // so the chronological insertion order stays reconstructible.
        const mapCarried = (f) => ({
            ...f,
            sourceIndex: 0,
            origSourceIndex: Number(f.sourceIndex) || 0,
            carriedFrom: best.chatId,
        });

        const freshData = getTkData();
        freshData.facts = (best.tk.facts || []).filter(f => f).map(mapCarried);
        freshData.archive = (best.tk.archive || []).filter(f => f).map(mapCarried);
        freshData.lastScannedIndex = 0;
        delete freshData.pausedOnEmpties;
        if (best.epoch) freshData.calendarEpoch = best.epoch;
        freshData.continuation = { fromChat: best.chatId, seededAt: Date.now() };
        setTkData(freshData);
        saveMetadataDebounced.flush?.();

        // Keep the lineage going: future chats should see THIS chat as part of
        // the continuation. Only when the user has an explicit selection — an
        // empty list already means "all chats in the group".
        if (selected.length > 0 && !cfg.chats.includes(currentChatId) && currentChatId) {
            cfg.chats.push(currentChatId);
            saveSettingsDebounced();
        }

        syncPinnedToGlobal();

        const carriedFacts = freshData.facts.length;
        const carriedArchive = freshData.archive.length;
        console.log(`[ThreadKeeper] Continuation: carried ${carriedFacts} facts + ${carriedArchive} archived from "${best.chatId}"`);
        if (typeof toastr !== 'undefined') {
            toastr.success(
                `Carried ${carriedFacts} fact${carriedFacts === 1 ? '' : 's'} + ${carriedArchive} archived from "${best.chatId}"`,
                'ThreadKeeper — Group Continuation',
                { timeOut: 6000, progressBar: true },
            );
        }
        return true;
    } finally {
        isSeedingContinuation = false;
    }
}

// ═══════════════════════════════════════════════════════════════════
// PROMPT INJECTION
// ═══════════════════════════════════════════════════════════════════

async function injectFacts() {
    const settings = getSettings();
    if (!settings.enabled) {
        lastInjectionText = '';
        setExtensionPrompt(EXTENSION_PROMPT_KEY, '', extension_prompt_types.IN_CHAT, 0);
        return;
    }

    const facts = getFacts();
    if (facts.length === 0) {
        lastInjectionText = '';
        setExtensionPrompt(EXTENSION_PROMPT_KEY, '', extension_prompt_types.IN_CHAT, 0);
        return;
    }

    const budgetTokens = BUDGET_MAP[settings.injectBudget] || 500;
    const pinned = facts.filter(f => f.pinned);
    const regular = facts.filter(f => !f.pinned);

    // Build injection text, prioritizing pinned facts
    let lines = [INJECTION_HEADER, ''];

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
        lines = [INJECTION_HEADER, ''];
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

    if (injectionPlacement.skipInjection) {
        lastInjectionText = '';
        setExtensionPrompt(EXTENSION_PROMPT_KEY, '', extension_prompt_types.IN_CHAT, 0);
        return injectionText;
    }

    lastInjectionText = injectionText;
    setExtensionPrompt(
        EXTENSION_PROMPT_KEY,
        injectionText,
        injectionPlacement.position,
        injectionPlacement.depth,
        false,
        injectionPlacement.role ?? settings.injectRole,
    );

    return injectionText;
}

// ═══════════════════════════════════════════════════════════════════
// INJECTION GUARD (Chat Completion)
// ═══════════════════════════════════════════════════════════════════

// In-chat injections are spliced into the raw history pool, which the chat
// completion builder consumes newest→oldest and STOPS filling the moment the
// token budget runs out. A facts block anchored deep in the history — "Top of
// chat history" (depth 10000) especially, but any depth beyond the truncation
// point — is silently dropped in exactly the long, context-full chats where
// ThreadKeeper matters most. This guard runs after the final prompt is
// assembled: if the block is missing, it re-inserts it at the top of the
// surviving history so in-chat placements always deliver.
function onChatCompletionPromptReady(eventData) {
    try {
        if (eventData?.dryRun) return;
        if (!Array.isArray(eventData?.chat) || !lastInjectionText) return;

        const settings = getSettings();
        if (!settings.enabled) return;

        const placement = getInjectionPlacementState(settings);
        if (placement.skipInjection) return;
        if (placement.position !== extension_prompt_types.IN_CHAT) return;

        const containsHeader = (content) => {
            if (typeof content === 'string') return content.includes(INJECTION_HEADER);
            if (Array.isArray(content)) {
                return content.some(part => typeof part?.text === 'string' && part.text.includes(INJECTION_HEADER));
            }
            return false;
        };
        if (eventData.chat.some(msg => containsHeader(msg?.content))) return;

        const roleMap = {
            [extension_prompt_roles.SYSTEM]: 'system',
            [extension_prompt_roles.USER]: 'user',
            [extension_prompt_roles.ASSISTANT]: 'assistant',
        };
        const role = roleMap[placement.role ?? settings.injectRole] || 'system';

        // Top of the remaining history = right before the first real chat
        // message. Leading system prompts (main, character card, lore) stay
        // above; if there are no chat messages at all, append at the end.
        let insertIdx = eventData.chat.findIndex(msg => msg?.role === 'user' || msg?.role === 'assistant');
        if (insertIdx === -1) insertIdx = eventData.chat.length;

        eventData.chat.splice(insertIdx, 0, { role, content: lastInjectionText });
        console.warn('[ThreadKeeper] Facts block was truncated out of chat history by the token budget — re-inserted at the top of the remaining history.');
    } catch (err) {
        console.error('[ThreadKeeper] Prompt-ready injection guard failed:', err);
    }
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
async function runExtraction(fullRescan = false, logFn = null, progressFn = null, factFn = null, targetMessageIndexes = null) {
    if (isExtracting) return;
    isExtracting = true;
    stopRequested = false;

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

        // Cross-chat write guard: if the user switches chats mid-extraction,
        // every later metadata write would land on the WRONG chat (getTkData
        // reads the live `chat_metadata` binding, not a snapshot). Bail before
        // any such write so extracted facts/archive don't bleed into another chat.
        const startChatId = context.getCurrentChatId();
        const abortIfChatChanged = () => {
            if (getContext().getCurrentChatId() !== startChatId) {
                stopRequested = true;
                log('<span class="tk-warn">⏹ Chat changed mid-extraction — aborted before writing facts to the new chat.</span>');
                return true;
            }
            return false;
        };

        const settings = getSettings();
        let lastScanned = getLastScannedIndex();
        const resumeGate = canResumeAfterEmptyPause(settings);
        let skipHiddenForThisRun = false;

        if (!fullRescan && !resumeGate.allowed) {
            const pauseState = resumeGate.pauseState;
            log(`<span class="tk-warn">⏸ Still paused — extraction model returned nothing on 3 batches in a row.</span>`);
            log(`<span class="tk-dim">To resume: change and save the extraction model, or hide problematic messages in ST with "scan hidden" disabled, then click </span><span class="tk-info">▶ extract</span><span class="tk-dim"> again.</span>`);
            if (pauseState?.scanRangeStart && pauseState?.scanRangeEnd) {
                log(`<span class="tk-dim">Paused range: messages ${pauseState.scanRangeStart}–${pauseState.scanRangeEnd}</span>`);
            }
            return;
        }

        if (resumeGate.reason === 'model-changed') {
            clearPausedOnEmpties();
            log(`<span class="tk-info">Empty-response pause cleared — extraction model changed.</span>`);
        } else if (resumeGate.reason === 'messages-hidden') {
            clearPausedOnEmpties();
            skipHiddenForThisRun = true;
            log(`<span class="tk-info">Empty-response pause cleared — hidden-message range changed while scan hidden is disabled.</span>`);
        }

        const selectedProfile = settings.connectionProfile && settings.connectionProfile !== '__current__'
            ? getSelectedConnectionProfile(settings.connectionProfile)
            : null;
        const selectedApiConfig = selectedProfile?.api ? CONNECT_API_MAP[String(selectedProfile.api).toLowerCase()] : null;
        const selectedBackend = selectedApiConfig?.selected || null;
        const selectedSource = selectedApiConfig?.source || null;
        const selectedModelField = selectedSource ? TK_SOURCE_MODEL_FIELD[selectedSource] || null : null;
        const supportsProfileRequest = Boolean(
            selectedProfile &&
            selectedBackend &&
            ['openai', 'textgenerationwebui'].includes(selectedBackend),
        );

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

        // Gather non-empty messages. Two modes:
        //  - Normal: scan from lastScanned to end of chat.
        //  - Target: scan only the message indexes in `targetMessageIndexes`
        //    (used by Heal Gaps to refill specific missing source-msg ranges
        //    without re-LLM-calling messages whose facts are already active).
        //
        // Hidden/system messages: skipped when the user has the "Scan hidden
        // messages" toggle OFF (settings.scanHidden === false), or when the
        // one-click empty-response recovery flow explicitly opted out.
        const skipHidden = skipHiddenForThisRun || settings.scanHidden === false;
        const scanFromIdx = targetMessageIndexes ? 0 : lastScanned;
        const messagesToScan = [];
        for (let i = scanFromIdx; i < chat.length; i++) {
            const msgIdx = i + 1;
            if (targetMessageIndexes && !targetMessageIndexes.has(msgIdx)) continue;
            const msg = chat[i];
            if (skipHidden && msg.is_system) continue;
            if (!msg.mes || msg.mes.trim().length === 0) continue;
            messagesToScan.push({ ...msg, _tkIndex: msgIdx });
        }

        if (messagesToScan.length === 0) {
            if (targetMessageIndexes) {
                log(`<span class="tk-dim">No target messages to scan (all gap-range messages are empty or hidden)</span>`);
            } else {
                log(`<span class="tk-dim">No new messages to scan (${lastScanned}/${chat.length})</span>`);
            }
            return;
        }

        const batches = buildTokenAwareBatches(messagesToScan, settings.batchTokenBudget);
        const hiddenLabel = skipHidden
            ? (skipHiddenForThisRun ? ' (hidden skipped for this recovery run)' : ' (hidden skipped)')
            : ', including hidden';
        const scanLabel = targetMessageIndexes
            ? `Heal Gaps: scanning ${messagesToScan.length} gap message${messagesToScan.length === 1 ? '' : 's'}${hiddenLabel}`
            : `Scanning ${messagesToScan.length} messages${hiddenLabel}`;
        log(`<span class="tk-dim">${scanLabel} · ${batches.length} token-aware batch${batches.length === 1 ? '' : 'es'} (~${settings.batchTokenBudget || DEFAULT_SETTINGS.batchTokenBudget} tokens each)...</span>`);

        let totalExtracted = 0;
        const existingFacts = getFacts();
        const factCountBefore = existingFacts.length;
        const newlyAddedFactIds = new Set();
        let lastCompletedScanIdx = lastScanned;
        let pausedOnApiError = false;
        let pausedOnEmptyStreak = false;

        for (let b = 0; b < batches.length; b++) {
            if (stopRequested) {
                log(`<span class="tk-warn">⏹ Extraction stopped · ${b}/${batches.length} batches completed · resume with </span><span class="tk-info">▶ extract</span>`);
                break;
            }
            if (abortIfChatChanged()) break;
            const batch = batches[b];
            const pct = Math.round(((b + 1) / batches.length) * 100);
            progress(pct);

            const firstMsg = batch[0];
            const lastMsg = batch[batch.length - 1];
            log(`<span class="tk-dim">├─ batch ${b + 1}/${batches.length}: messages ${firstMsg._tkIndex}–${lastMsg._tkIndex}</span>`);

            const prompt = buildExtractionPrompt(batch, getRecentFactsForDedup(existingFacts, 50));

            // Per-batch retry: try, then ONE retry on any failure (API error,
            // empty response, or parse error). If both attempts fail, pause
            // cleanly — never silently `continue` past a failed batch, which
            // would let `lastCompletedScanIdx` jump over it and create gaps in
            // the extracted facts (the "won't extract in order" bug).
            const MAX_ATTEMPTS = 2;
            let response = null;
            let newFacts = null;
            let attemptFailure = null;

            for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
                if (attempt > 1) {
                    log(`<span class="tk-dim">↻ retry ${attempt}/${MAX_ATTEMPTS} for batch ${b + 1} (${attemptFailure.kind}: ${escapeHtml(attemptFailure.message)})</span>`);
                }
                attemptFailure = null;
                response = null;
                newFacts = null;

                try {
                    const secretKey = selectedProfile ? getSecretKeyForProfile(selectedProfile) : null;
                    const shouldOverrideSecret = Boolean(selectedProfile?.['secret-id'] && secretKey);
                    let savedSecretId = '';

                    if (shouldOverrideSecret) {
                        savedSecretId = await SlashCommandParser.commands['secret-id'].callback(
                            { quiet: 'true', key: secretKey },
                            undefined,
                        );
                        await SlashCommandParser.commands['secret-id'].callback(
                            { quiet: 'true', key: secretKey },
                            selectedProfile['secret-id'],
                        );
                    }

                    // Scale response budget with batch size: each fact's JSON is
                    // roughly 50–100 tokens, and a 25-msg batch can easily need
                    // 30+ facts. Cap at 8000 so absurd batches don't blow the
                    // model's output limit.
                    const responseBudget = Math.min(8000, Math.max(2048, batch.length * 200));
                    try {
                        if (supportsProfileRequest) {
                            const requestPrompt = [
                                { role: 'system', content: getExtractionSystemPrompt(batch.length) },
                                { role: 'user', content: prompt },
                            ];
                            const requestModel = settings.model || selectedProfile.model || undefined;
                            const requestOverrides = {
                                ...(requestModel ? { model: requestModel } : {}),
                                temperature: settings.temperature,
                            };
                            if (selectedSource === 'custom') {
                                requestOverrides.custom_include_headers = oai_settings.custom_include_headers;
                                requestOverrides.custom_include_body = oai_settings.custom_include_body;
                                requestOverrides.custom_exclude_body = oai_settings.custom_exclude_body;
                            }

                            const shouldAlignRequestSource = Boolean(selectedSource);
                            let savedRequestSource;
                            let savedRequestModel;

                            if (shouldAlignRequestSource) {
                                savedRequestSource = oai_settings.chat_completion_source;
                                oai_settings.chat_completion_source = selectedSource;
                            }
                            if (selectedModelField) {
                                savedRequestModel = oai_settings[selectedModelField];
                                if (requestModel) {
                                    oai_settings[selectedModelField] = requestModel;
                                }
                            }

                            try {
                                const requestResult = await ConnectionManagerRequestService.sendRequest(
                                    selectedProfile.id,
                                    requestPrompt,
                                    responseBudget,
                                    { includePreset: false, includeInstruct: false },
                                    requestOverrides,
                                );
                                response = requestResult?.content ?? requestResult?.text ?? requestResult;
                            } finally {
                                if (shouldAlignRequestSource) {
                                    oai_settings.chat_completion_source = savedRequestSource;
                                }
                                if (selectedModelField) {
                                    oai_settings[selectedModelField] = savedRequestModel;
                                }
                            }
                        } else {
                            // Fallback path for unsupported profile types.
                            // This preserves the current behavior for providers outside the
                            // connection-manager request service.
                            const shouldOverrideModel = settings.model &&
                                selectedBackend === 'openai' &&
                                selectedSource &&
                                selectedModelField;
                            let savedSource, savedModel, savedTemp;
                            if (shouldOverrideModel) {
                                savedSource = oai_settings.chat_completion_source;
                                savedModel = oai_settings[selectedModelField];
                                oai_settings.chat_completion_source = selectedSource;
                                oai_settings[selectedModelField] = settings.model;
                            }
                            if (settings.temperature !== undefined) {
                                savedTemp = oai_settings.temperature;
                                oai_settings.temperature = settings.temperature;
                            }
                            try {
                                response = await generateRaw({
                                    prompt: prompt,
                                    systemPrompt: getExtractionSystemPrompt(batch.length),
                                    responseLength: responseBudget,
                                    ...(selectedBackend ? { api: selectedBackend } : {}),
                                });
                            } finally {
                                if (shouldOverrideModel) {
                                    oai_settings.chat_completion_source = savedSource;
                                    oai_settings[selectedModelField] = savedModel;
                                }
                                if (settings.temperature !== undefined) {
                                    oai_settings.temperature = savedTemp;
                                }
                            }
                        }
                    } finally {
                        if (shouldOverrideSecret && savedSecretId) {
                            await SlashCommandParser.commands['secret-id'].callback(
                                { quiet: 'true', key: secretKey },
                                savedSecretId,
                            );
                        }
                    }
                } catch (err) {
                    attemptFailure = { kind: 'api', message: err.message || 'Unknown error' };
                    continue;
                }

                if (!String(response || '').trim()) {
                    attemptFailure = { kind: 'empty', message: 'empty response from model' };
                    continue;
                }

                try {
                    newFacts = parseExtractionResponse(response);
                    break; // success — exit retry loop
                } catch (parseErr) {
                    attemptFailure = { kind: 'parse', message: parseErr.message };
                    continue;
                }
            }

            if (attemptFailure) {
                // All attempts failed → pause cleanly. lastCompletedScanIdx stays
                // at the last good batch, so re-extract picks up exactly here.
                if (attemptFailure.kind === 'empty') {
                    pausedOnEmptyStreak = true;
                    setPausedOnEmpties({
                        modelKey: getEffectiveExtractionModelKey(settings),
                        scanRangeStart: firstMsg._tkIndex,
                        scanRangeEnd: lastMsg._tkIndex,
                        hiddenAtPause: countNonHiddenMessagesInRange(firstMsg._tkIndex, lastMsg._tkIndex),
                        pausedAt: Date.now(),
                    });
                    log(`<span class="tk-error">⏸ Paused — batch ${b + 1} returned empty on ${MAX_ATTEMPTS} attempts.</span>`);
                    log(`<span class="tk-dim">To resume: change extraction model or hide problematic messages, then click </span><span class="tk-info">▶ extract</span><span class="tk-dim">.</span>`);
                } else {
                    pausedOnApiError = true;
                    log(`<span class="tk-error">⏸ Paused on ${attemptFailure.kind} error at batch ${b + 1}/${batches.length} after ${MAX_ATTEMPTS} attempts: ${escapeHtml(attemptFailure.message)}</span>`);
                    log(`<span class="tk-dim">Progress saved through message ${lastCompletedScanIdx}. Click </span><span class="tk-info">▶ extract</span><span class="tk-dim"> to retry this batch later.</span>`);
                }
                break;
            }

            // Validate and add facts — sort by source_index, with timeline first
            // for facts from the same message.
            const validFacts = sortExtractedFacts(newFacts.filter(f =>
                f && typeof f.text === 'string' && f.text.length > 0 &&
                CATEGORIES.includes(f.category),
            ));

            if (abortIfChatChanged()) break;

            if (validFacts.length > 0) {
                const addedFacts = addFacts(validFacts);
                totalExtracted += addedFacts.length;

                for (const fact of addedFacts) {
                    existingFacts.push(fact); // Update running list for dedup
                    if (fact && fact.id !== undefined) newlyAddedFactIds.add(fact.id);
                    onFact(fact);
                }
            }

            lastCompletedScanIdx = lastMsg._tkIndex;
            // Skip the global checkpoint bump in target mode — Heal Gaps fills
            // specific older messages and must not move the "everything before
            // this is processed" cursor forward (or backward).
            if (!targetMessageIndexes) setLastScannedIndex(lastCompletedScanIdx);
        }

        // Bail out of all post-loop writes (checkpoint bump, auto-pin, save flush,
        // injection refresh) if the chat changed while the last batch was running.
        if (abortIfChatChanged()) return;

        // Update last scanned index — full chat length only on a clean completion.
        // Pauses/stops keep the per-batch checkpoint so the next extract retries the failed range.
        // Target mode (Heal Gaps) never moves the global checkpoint.
        if (!targetMessageIndexes && !stopRequested && !pausedOnApiError && !pausedOnEmptyStreak) {
            setLastScannedIndex(chat.length);
        }

        // Auto-pin newly extracted facts if enabled. Pin by ID across both
        // active and archive — when extraction overflows past maxFacts, some
        // newly added facts may already have been pushed to archive in
        // addFacts(). Pinning them there preserves the pin so they come back
        // pinned if the user restores them.
        if (settings.autoPin && newlyAddedFactIds.size > 0) {
            const data = getTkData();
            let changed = false;
            for (const fact of data.facts) {
                if (fact && newlyAddedFactIds.has(fact.id) && !fact.pinned) {
                    fact.pinned = true;
                    changed = true;
                }
            }
            if (Array.isArray(data.archive)) {
                for (const fact of data.archive) {
                    if (fact && newlyAddedFactIds.has(fact.id) && !fact.pinned) {
                        fact.pinned = true;
                        changed = true;
                    }
                }
            }
            if (changed) {
                setTkData(data);
                syncPinnedToGlobal?.();
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
        if (stopRequested) {
            log(`<span class="tk-warn">◐ Partial: ${totalExtracted} facts added · ${allFacts.length} total in memory</span>`);
        } else if (pausedOnApiError) {
            log(`<span class="tk-warn">⏸ Paused on API error: ${totalExtracted} facts added · ${allFacts.length} total in memory</span>`);
        } else if (pausedOnEmptyStreak) {
            log(`<span class="tk-warn">⏸ Paused on empty responses: ${totalExtracted} facts added · ${allFacts.length} total in memory</span>`);
        } else {
            log(`<span class="tk-success">✓ ${fullRescan ? 'Re-extracted' : 'Extracted'} ${totalExtracted} facts · ${allFacts.length} total in memory</span>`);
        }

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

const ARCHIVE_FOLDER_ICONS = {
    100: 'scripts/extensions/third-party/ST---ThreadKeeper/img/archive_100_purple-blue.webp',
    200: 'scripts/extensions/third-party/ST---ThreadKeeper/img/archive_200_deep-purple.webp',
    300: 'scripts/extensions/third-party/ST---ThreadKeeper/img/archive_300_teal.webp',
};

function getArchiveFolderIconHTML(folderSize) {
    const size = [100, 200, 300].includes(Number(folderSize)) ? Number(folderSize) : 100;
    const src = ARCHIVE_FOLDER_ICONS[size];
    return `<img src="/${src}" alt="archive folder ${size}" class="tk-folder-img" draggable="false" />`;
}

function buildAutoScanPopupHTML() {
    return `
    <div id="tk-auto-scan-popup" aria-live="polite" aria-atomic="true">
        <div class="tk-auto-scan-popup-header">
            <span class="tk-auto-scan-popup-icon">${MEMORY_ORB_SVG_SMALL}</span>
            <span class="tk-auto-scan-popup-title">threadkeeper</span>
        </div>
        <div class="tk-auto-scan-popup-body">
            <div class="tk-auto-scan-popup-line" id="tk-auto-scan-popup-line1"></div>
            <div class="tk-auto-scan-popup-line tk-auto-scan-popup-line2" id="tk-auto-scan-popup-line2"></div>
        </div>
    </div>`;
}

function ensureAutoScanPopup() {
    let popup = document.getElementById('tk-auto-scan-popup');
    if (popup) return popup;

    document.body.insertAdjacentHTML('beforeend', buildAutoScanPopupHTML());
    popup = document.getElementById('tk-auto-scan-popup');
    if (!popup) {
        console.warn('[ThreadKeeper] Auto-scan popup could not be mounted.');
    }
    return popup;
}

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
                <button class="tk-cmd-btn danger" id="tk-stop-btn" style="display:none;">▣ stop</button>
                <button class="tk-cmd-btn danger" id="tk-clear-facts-btn">✕ clear unpinned</button>
                <button class="tk-cmd-btn secondary" id="tk-archive-btn">📦 archive (<span id="tk-archive-count">0</span>)</button>
                <div class="tk-toolbar-sep"></div>
                <button class="tk-cmd-btn secondary" id="tk-preview-btn">◉ preview</button>
                <button class="tk-cmd-btn secondary" id="tk-settings-btn">⚙ settings</button>
                <span class="tk-search-wrap tk-fact-search-wrap">
                    <input type="text" class="tk-search-input tk-fact-search" id="tk-fact-search" placeholder="search facts…" autocomplete="off" />
                    <button type="button" class="tk-search-clear" id="tk-fact-search-clear" title="Clear search" aria-label="Clear search">✕</button>
                </span>
                <div class="tk-filter-group" id="tk-filter-group">
                    <button class="tk-filter active" data-f="all">all</button>
                    <button class="tk-filter" data-f="character">chr</button>
                    <button class="tk-filter" data-f="relationship">rel</button>
                    <button class="tk-filter" data-f="event">evt</button>
                    <button class="tk-filter" data-f="item">itm</button>
                    <button class="tk-filter" data-f="location">loc</button>
                    <button class="tk-filter" data-f="plot">plt</button>
                    <button class="tk-filter" data-f="timeline">time</button>
                </div>
            </div>

            <!-- Terminal Body -->
            <div class="tk-body" id="tk-body"></div>

            <!-- Config Panel (hidden by default) -->
            <div class="tk-config-panel" id="tk-config"></div>

            <!-- Archive Panel (hidden by default) -->
            <div class="tk-config-panel" id="tk-archive"></div>

            <!-- Injection Preview Footer -->
            <div class="tk-footer" id="tk-footer">
                <div class="footer-label">◉ injection preview — what gets sent to your model:</div>
                <pre id="tk-preview-text"></pre>
            </div>
        </div>
    </div>`;
}

function setAutoScanPopupState(line1, line2 = '', mode = 'running') {
    const popup = ensureAutoScanPopup();
    const line1El = document.getElementById('tk-auto-scan-popup-line1');
    const line2El = document.getElementById('tk-auto-scan-popup-line2');
    const terminalIsVisible = document.getElementById('threadkeeper-overlay')?.classList.contains('open');
    if (!popup || terminalIsVisible) return;

    if (autoScanPopupHideTimer) {
        clearTimeout(autoScanPopupHideTimer);
        autoScanPopupHideTimer = null;
    }

    popup.classList.remove('success', 'error');
    if (mode === 'success') popup.classList.add('success');
    if (mode === 'error') popup.classList.add('error');
    popup.classList.add('visible');
    Object.assign(popup.style, {
        display: 'block',
        position: 'fixed',
        right: '18px',
        bottom: '18px',
        width: '280px',
        maxWidth: 'calc(100vw - 24px)',
        padding: '10px 12px',
        border: '1px solid rgba(74, 222, 128, 0.35)',
        borderRadius: '10px',
        background: 'rgba(9, 14, 26, 0.98)',
        boxShadow: '0 10px 28px rgba(0, 0, 0, 0.42), 0 0 24px rgba(34, 211, 238, 0.12)',
        color: '#4ade80',
        fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Fira Code', monospace",
        zIndex: '10060',
        visibility: 'visible',
        opacity: '1',
        pointerEvents: 'none',
        transform: 'translateY(0)',
    });

    if (line1El) line1El.textContent = line1;
    if (line2El) {
        line2El.textContent = line2;
        line2El.style.display = line2 ? '' : 'none';
    }
}

function hideAutoScanPopup(delay = 0) {
    const popup = ensureAutoScanPopup();
    if (!popup) return;

    if (autoScanPopupHideTimer) {
        clearTimeout(autoScanPopupHideTimer);
        autoScanPopupHideTimer = null;
    }

    const doHide = () => {
        popup.classList.remove('visible', 'success', 'error');
        popup.style.opacity = '0';
        popup.style.transform = 'translateY(8px)';
        popup.style.visibility = 'hidden';
        popup.style.display = 'none';
    };

    if (delay > 0) {
        autoScanPopupHideTimer = setTimeout(doHide, delay);
    } else {
        doHide();
    }
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

    // Group continuation — only offered when the open chat belongs to a group.
    let continuitySection = '';
    const groupId = getContext().groupId;
    if (groupId) {
        const continuityCfg = getGroupContinuityConfig(groupId);
        const continuityEnabled = continuityCfg?.enabled === true;
        continuitySection = `
    <!-- Group continuation -->
    <div class="tk-cfg-section" id="tk-cfg-continuity-section">
        <div class="tk-cfg-title continuity"><span>🧬</span> Group continuation</div>
        <div class="tk-cfg-row">
            <div class="tk-cfg-label">
                Continue this group's story across chats
                <span class="tk-cfg-hint">When a chat of this group has no ThreadKeeper data yet, facts + archive carry over from the most recent continuation chat — day numbering continues instead of restarting</span>
            </div>
            <div class="tk-pills" id="tk-cfg-continuity-enabled">
                <button class="tk-pill${continuityEnabled ? ' active' : ''}" data-v="on" type="button">Enabled</button>
                <button class="tk-pill${continuityEnabled ? '' : ' active'}" data-v="off" type="button">Disabled</button>
            </div>
        </div>
        <div class="tk-cfg-row tk-cfg-row-continuity-chats">
            <div class="tk-cfg-label">
                Continuation chats
                <span class="tk-cfg-hint">Pick which of this group's chats form the continuation. Leave empty to treat every chat in the group as part of it</span>
            </div>
            <div class="tk-continuity-select-wrap">
                <select id="tk-cfg-continuity-chats" multiple="multiple"></select>
            </div>
        </div>
    </div>`;
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
        <div class="tk-cfg-row">
            <div class="tk-cfg-label">
                Unpin all facts
                <span class="tk-cfg-hint">Remove the pin from every pinned fact at once</span>
            </div>
            <button class="tk-cmd-btn danger" id="tk-cfg-unpin-all">📌 Unpin All</button>
        </div>
        <div class="tk-cfg-row">
            <div class="tk-cfg-label">
                Heal extraction gaps
                <span class="tk-cfg-hint">Find ranges of 5+ scanned messages with zero facts (likely skipped batches from an earlier run) and lower the scan checkpoint so re-extract refills them. Dedup means no duplicate facts.</span>
            </div>
            <button class="tk-cmd-btn" id="tk-cfg-heal-gaps">🩹 Heal Gaps</button>
        </div>
        <div class="tk-cfg-row">
            <div class="tk-cfg-label">
                Archive folder size
                <span class="tk-cfg-hint">When the archive has at least this many facts, it groups them into manila-folder cards of this size. Each folder is labeled by its source-message range. Below this threshold, the archive shows a flat list.</span>
            </div>
            <div class="tk-pills" id="tk-cfg-folder-size">
                <button class="tk-pill ${settings.archiveFolderSize === 100 ? 'active' : ''}" data-v="100" type="button">100</button>
                <button class="tk-pill ${settings.archiveFolderSize === 200 ? 'active' : ''}" data-v="200" type="button">200</button>
                <button class="tk-pill ${settings.archiveFolderSize === 300 ? 'active' : ''}" data-v="300" type="button">300</button>
            </div>
        </div>
    </div>
    ${continuitySection}

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
        <div class="tk-cfg-row">
            <div class="tk-cfg-label">
                Extraction tone
                <span class="tk-cfg-hint">Polite = clean neutral facts · Dog Me Out = raw, explicit, unfiltered</span>
            </div>
            <div class="tk-pills" id="tk-cfg-tone">
                <button class="tk-pill${settings.extractionTone === 'Polite' ? ' active' : ''}" data-v="Polite">Polite</button>
                <button class="tk-pill${settings.extractionTone === 'Dog Me Out' ? ' active' : ''}" data-v="Dog Me Out">Dog Me Out</button>
            </div>
        </div>
        <div class="tk-cfg-row">
            <div class="tk-cfg-label">
                Facts per batch
                <span class="tk-cfg-hint">Min and max facts to extract in each LLM call</span>
            </div>
            <div style="display:flex;gap:12px;align-items:center;">
                <div style="display:flex;align-items:center;gap:6px;">
                    <label style="font-size:0.75rem;color:var(--tk-dim);">min</label>
                    <input type="number" class="tk-number" id="tk-cfg-minfacts" value="${settings.minFactsPerBatch || 1}" min="1" max="100" style="width:60px;">
                </div>
                <div style="display:flex;align-items:center;gap:6px;">
                    <label style="font-size:0.75rem;color:var(--tk-dim);">max</label>
                    <input type="number" class="tk-number" id="tk-cfg-maxfacts-batch" value="${settings.maxFactsPerBatch || 15}" min="1" max="100" style="width:60px;">
                </div>
            </div>
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
    hideAutoScanPopup();
    refreshTerminalContent();
}

function closeTerminal() {
    const overlay = document.getElementById('threadkeeper-overlay');
    if (!overlay) return;
    overlay.classList.remove('open');
    isTerminalOpen = false;
    if (showingConfig) toggleConfig();
    if (showingArchive) {
        showingArchive = false;
        viewingFolderRange = null;
        const panel = document.getElementById('tk-archive');
        if (panel) panel.style.display = 'none';
    }
}

function getRenderedChatMessageIds() {
    return Array.from(document.querySelectorAll('#chat .mes'))
        .map(el => Number(el.getAttribute('mesid')))
        .filter(id => Number.isFinite(id));
}

function waitForNextFrame() {
    return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

async function findRenderedSourceMessage(sourceIdx) {
    const targetMesid = String(sourceIdx);
    let chatMsg = document.querySelector(`#chat .mes[mesid="${targetMesid}"]`);
    if (chatMsg) return chatMsg;

    const renderedIds = getRenderedChatMessageIds();
    const firstRenderedId = Math.min(...renderedIds);
    if (!Number.isFinite(firstRenderedId) || firstRenderedId <= sourceIdx) {
        return null;
    }

    await showMoreMessages(firstRenderedId - sourceIdx);
    await waitForNextFrame();
    return document.querySelector(`#chat .mes[mesid="${targetMesid}"]`);
}

async function jumpToSourceMessage(sourceIdx, sourceKind) {
    if (sourceIdx <= 0) return;

    closeTerminal();
    await waitForNextFrame();

    const chatContainer = document.getElementById('chat');
    const chatMsg = await findRenderedSourceMessage(sourceIdx);

    if (chatMsg && chatContainer) {
        const containerTop = chatContainer.getBoundingClientRect().top;
        const msgTop = chatMsg.getBoundingClientRect().top;
        const offset = msgTop - containerTop + chatContainer.scrollTop - (chatContainer.clientHeight / 2) + (chatMsg.offsetHeight / 2);
        chatContainer.scrollTo({ top: offset, behavior: 'smooth' });
        chatMsg.style.transition = 'box-shadow 0.3s ease';
        chatMsg.style.boxShadow = '0 0 20px rgba(255,213,79,0.3)';
        setTimeout(() => { chatMsg.style.boxShadow = ''; }, 3000);
    } else if (!chatMsg) {
        console.warn(`[TK-SRC ${sourceKind}] chatMsg not found in DOM for mesid="${sourceIdx}". Available rendered mesids:`, getRenderedChatMessageIds());
    }
}

function refreshTerminalContent() {
    const body = document.getElementById('tk-body');
    if (!body) return;

    body.innerHTML = '';

    const context = getContext();
    // name2 is the solo-chat character name and is empty in group chats —
    // resolve the group's name (with a 👥 marker) there instead.
    const group = context.groupId ? (context.groups || []).find(g => g.id === context.groupId) : null;
    const charName = group ? `👥 ${group.name || 'Group'}` : (context.name2 || 'Unknown');
    const chatLength = context.chat?.length || 0;

    addTerminalLine(`<span class="tk-cmd">threadkeeper v1.0.5</span>`);
    addTerminalLine(`<span class="tk-dim">Loaded chat: ${charName} · ${chatLength} messages</span>`);

    const continuation = getTkData().continuation;
    if (continuation?.fromChat) {
        addTerminalLine(`<span class="tk-dim">↳ continuation of </span><span class="tk-info">${escapeHtml(continuation.fromChat)}</span>`);
    }

    // Show existing facts sorted by source message (chronological)
    const facts = sortFactsForDisplay(getFacts());
    if (facts.length > 0) {
        addTerminalLine(`<span id="tk-memory-summary" class="tk-dim">${facts.length} facts in memory (${getPinnedFacts().length} pinned)</span>`);
        addTerminalLine(`<br>`);
        if (facts.length > 25) {
            const totalThreads = Math.ceil(facts.length / 25);
            for (let i = 0; i < totalThreads; i++) {
                addFactThread(facts.slice(i * 25, i * 25 + 25), i, totalThreads);
            }
        } else {
            for (const fact of facts) {
                addFactLine(fact);
            }
        }
        addTerminalLine(`<br>`);

        const pendingMessages = getPendingMessagesCount();
        if (pendingMessages > 0) {
            addTerminalLine(`<span class="tk-info">${pendingMessages} new messages since last scan</span>`);
        }
    } else {
        addTerminalLine(`<span class="tk-dim">Type </span><span class="tk-info">▶ extract</span><span class="tk-dim"> to scan for key facts</span>`);
    }

    addTerminalLine(`<br>`);
    addCursorLine();
    applyFilter();
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
    // Scroll the OVERLAY to the bottom — that's the actual scroll container
    // since the layout switched to whole-interface scrolling. The body's own
    // scrollTop is a no-op now (overflow: visible).
    const overlay = document.getElementById('threadkeeper-overlay');
    if (overlay) overlay.scrollTop = overlay.scrollHeight;
}

function createFactElement(fact) {
    const div = document.createElement('div');
    div.className = `tk-fact cat-${fact.category}`;
    div.dataset.factId = fact.id;
    // No source button when sourceIndex <= 0 — carried/seeded facts point at
    // another chat's message numbers, so there is nothing here to jump to.
    const srcBtn = Number(fact.sourceIndex) > 0
        ? `<button class="tk-micro-btn src-btn" data-action="source" data-source="${fact.sourceIndex}" title="Source message">↗${fact.sourceIndex}</button>`
        : '';
    div.innerHTML = `
        <span class="fact-tag">${getFactCategoryDisplay(fact.category)}</span>
        <span class="fact-body">${escapeHtml(fact.text)}</span>
        <span class="fact-actions-row">
            <button class="tk-micro-btn edit-btn" data-action="edit" data-fact-id="${fact.id}" title="Edit fact">🪄</button>
            <button class="tk-micro-btn pin-btn ${fact.pinned ? 'pinned' : ''}" data-action="pin" data-fact-id="${fact.id}" title="Pin — pinned facts are always remembered">📌</button>
            <button class="tk-micro-btn" data-action="archive" data-fact-id="${fact.id}" title="Archive this fact">📦</button>
            ${srcBtn}
            <button class="tk-micro-btn del-btn" data-action="delete" data-fact-id="${fact.id}" title="Remove">✕</button>
        </span>`;
    return div;
}

function addFactLine(fact, container = null) {
    const body = container || document.getElementById('tk-body');
    if (!body) return;
    if (!container) removeCursor();
    const div = createFactElement(fact);
    body.appendChild(div);
    body.scrollTop = body.scrollHeight;
}

function addFactThread(facts, threadIndex, totalThreads) {
    const body = document.getElementById('tk-body');
    if (!body) return;
    const start = threadIndex * 25 + 1;
    const end = start + facts.length - 1;
    const details = document.createElement('details');
    details.className = 'tk-fact-thread';
    details.open = true;
    details.innerHTML = `
        <summary class="tk-fact-thread-summary">
            <span>Facts ${start}–${end}</span>
            <span class="tk-fact-thread-meta">${facts.length} key fact${facts.length === 1 ? '' : 's'} · thread ${threadIndex + 1}/${totalThreads}</span>
        </summary>
        <div class="tk-fact-thread-body"></div>`;
    const threadBody = details.querySelector('.tk-fact-thread-body');
    for (const fact of facts) {
        addFactLine(fact, threadBody);
    }
    body.appendChild(details);
}

// Reconcile pin-button DOM state against storage. Used after extraction so
// auto-pin (which runs after facts are streamed to the terminal) is visible
// without forcing a full terminal refresh.
function syncFactPinDOM() {
    const pinnedIds = new Set(getPinnedFacts().map(f => String(f.id)));
    document.querySelectorAll('.tk-fact').forEach(el => {
        const id = el.dataset.factId;
        if (!id) return;
        const pinBtn = el.querySelector('.pin-btn');
        if (!pinBtn) return;
        pinBtn.classList.toggle('pinned', pinnedIds.has(id));
    });
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
        const lines = [INJECTION_HEADER, ''];
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

    updateArchiveCount();
}

function updateArchiveCount() {
    const el = document.getElementById('tk-archive-count');
    if (el) el.textContent = String(getArchive().length);
}

function toggleArchive() {
    showingArchive = !showingArchive;
    // Always reset folder-view state on open/close — entering the archive
    // should start from the folder grid (or flat list if below threshold),
    // not from whichever folder was last open.
    viewingFolderRange = null;
    // Clear any prior search so the archive opens unfiltered.
    archiveSearchQuery = '';
    const body = document.getElementById('tk-body');
    const panel = document.getElementById('tk-archive');
    const toolbar = document.getElementById('tk-toolbar');

    if (showingArchive) {
        if (showingConfig) toggleConfig();
        renderArchivePanel();
        panel.classList.add('visible');
        if (body) body.style.display = 'none';
        if (toolbar) toolbar.style.display = 'none';
    } else {
        panel.classList.remove('visible');
        panel.innerHTML = '';
        if (body) body.style.display = '';
        if (toolbar) toolbar.style.display = '';
    }
}

function renderArchivePanel() {
    const panel = document.getElementById('tk-archive');
    if (!panel) return;
    // Sort archive the same way active facts are sorted: by source message order
    // (ascending), category as tiebreaker. Keeps the reading order intuitive —
    // msg-1 facts at the top regardless of when they were archived.
    const archived = sortFactsForDisplay(getArchive());
    const settings = getSettings();
    const folderSize = Math.max(50, Math.min(1000, Number(settings.archiveFolderSize) || 100));

    // Active search query — when set, the archive ignores folder grouping and
    // shows a flat list of every matching fact across the whole archive.
    const query = archiveSearchQuery.trim().toLowerCase();
    const searching = query.length > 0;

    // Render modes (search overrides folder grouping entirely):
    //  - Empty archive: empty-state message
    //  - Searching: flat list of matches across the whole archive
    //  - Archive < folderSize OR a folder is open: flat fact list
    //    (if a folder is open, sliced to just that folder's facts + "← folders")
    //  - Archive >= folderSize and no folder open: manila-folder grid
    const inFolder = viewingFolderRange !== null && !searching;
    const useFolderGrid = archived.length >= folderSize && !inFolder && !searching;

    // Searchbar markup — shown whenever the archive has anything in it. The
    // clear ✕ auto-shows via CSS (:not(:placeholder-shown)).
    const searchBar = archived.length > 0 ? `
        <div class="tk-archive-search-wrap">
            <span class="tk-search-wrap">
                <input type="text" class="tk-search-input tk-archive-search" id="tk-archive-search"
                       placeholder="search all archived facts…" autocomplete="off" />
                <button type="button" class="tk-search-clear" id="tk-archive-search-clear" title="Clear search" aria-label="Clear search">✕</button>
            </span>
        </div>` : '';

    const activeCount = getFacts().length;
    const restoreAllFits = archived.length > 0 && (activeCount + archived.length) <= settings.maxFacts;
    const restoreAllTitle = restoreAllFits
        ? `Restore all ${archived.length} archived fact${archived.length === 1 ? '' : 's'} to active memory`
        : `Soft cap too low — active (${activeCount}) + archive (${archived.length}) would exceed max facts (${settings.maxFacts}). Raise "Max remembered facts" in Advanced settings.`;
    const restoreAllBtn = archived.length > 0
        ? `<button class="tk-cmd-btn secondary" id="tk-archive-restore-all-btn" title="${escapeHtml(restoreAllTitle)}">↩ restore all</button>`
        : '';

    const headerActions = `
        ${restoreAllBtn}
        ${archived.length > 0 ? '<button class="tk-cmd-btn danger" id="tk-archive-clear-btn">✕ clear archive</button>' : ''}
        <button class="tk-cmd-btn secondary" id="tk-archive-back-btn">← back</button>
    `;

    let html = '';

    if (useFolderGrid) {
        // Build folder buckets — each one holds folderSize consecutive facts
        // (by sort order). The label uses the sourceIndex range of those facts.
        const folders = [];
        for (let i = 0; i < archived.length; i += folderSize) {
            const slice = archived.slice(i, i + folderSize);
            folders.push({
                startIdx: i,
                endIdx: i + slice.length,
                count: slice.length,
                msgStart: slice[0].sourceIndex || 0,
                msgEnd: slice[slice.length - 1].sourceIndex || 0,
            });
        }

        html = `
            <div class="tk-archive-header">
                <div class="tk-archive-title">📦 Archive · ${archived.length} fact${archived.length === 1 ? '' : 's'} · ${folders.length} folder${folders.length === 1 ? '' : 's'}</div>
                <div class="tk-archive-header-actions">${headerActions}</div>
            </div>
            ${searchBar}
            <div class="tk-archive-hint">
                Archive grouped into folders of ${folderSize} facts each. Click a folder to open it. Folder size can be changed in Advanced settings.
            </div>
            <div class="tk-archive-folders">
                ${folders.map(f => `
                    <button class="tk-archive-folder" type="button"
                            data-folder-start="${f.startIdx}"
                            data-folder-end="${f.endIdx}"
                            data-folder-msg-start="${f.msgStart}"
                            data-folder-msg-end="${f.msgEnd}"
                            title="Open folder">
                        <div class="tk-folder-icon">${getArchiveFolderIconHTML(folderSize)}</div>
                        <div class="tk-folder-meta">
                            <div class="tk-folder-range">Msgs ${f.msgStart}–${f.msgEnd}</div>
                            <div class="tk-folder-count">${f.count} fact${f.count === 1 ? '' : 's'}</div>
                        </div>
                    </button>
                `).join('')}
            </div>
        `;
    } else {
        // Flat list mode — archive is small, a folder is open, or searching.
        const factsToShow = searching
            ? archived.filter(f => f && (
                (f.text || '').toLowerCase().includes(query) ||
                (f.category || '').toLowerCase().includes(query)))
            : inFolder
                ? archived.slice(viewingFolderRange.startIdx, viewingFolderRange.endIdx)
                : archived;
        const archiveTitle = searching
            ? `📦 Archive · ${factsToShow.length} match${factsToShow.length === 1 ? '' : 'es'}`
            : `📦 Archive · ${factsToShow.length} fact${factsToShow.length === 1 ? '' : 's'}${inFolder ? ` · Msgs ${viewingFolderRange.msgStart}–${viewingFolderRange.msgEnd}` : ''}`;
        const foldersBackBtn = inFolder
            ? '<button class="tk-cmd-btn secondary" id="tk-archive-folders-back">← folders</button>'
            : '';

        html = `
            <div class="tk-archive-header">
                <div class="tk-archive-title">${archiveTitle}</div>
                <div class="tk-archive-header-actions">${foldersBackBtn}${headerActions}</div>
            </div>
            ${searchBar}
            <div class="tk-archive-hint">
                Archived facts are not sent to the LLM. Restore them to bring them back into active memory.
                If active memory is at the cap, restoring auto-archives the oldest active fact to make room.
            </div>
            <div id="tk-archive-list" style="padding:0 16px 16px;">
        `;

        if (factsToShow.length === 0) {
            html += searching
                ? `<div style="opacity:0.5;text-align:center;padding:24px;">No archived facts match &quot;${escapeHtml(archiveSearchQuery)}&quot;.</div>`
                : '<div style="opacity:0.5;text-align:center;padding:24px;">Archive is empty.</div>';
        } else {
            for (const fact of factsToShow) {
                const dateStr = fact.archivedAt ? new Date(fact.archivedAt).toLocaleString() : '';
                const srcBtn = Number(fact.sourceIndex) > 0
                    ? `<button class="tk-micro-btn src-btn" data-archive-action="source" data-source="${fact.sourceIndex}" title="Source message">↗${fact.sourceIndex}</button>`
                    : '';
                html += `
                    <div class="tk-fact cat-${fact.category}" data-fact-id="${fact.id}" style="margin-bottom:6px;">
                        <span class="fact-tag">${getFactCategoryDisplay(fact.category)}</span>
                        <span class="fact-body">${escapeHtml(fact.text)}</span>
                        <span class="fact-actions-row">
                            <span style="font-size:10px;opacity:0.5;margin-right:6px;">${dateStr}</span>
                            <button class="tk-micro-btn" data-archive-action="restore" data-fact-id="${fact.id}" title="Restore to active memory">↩</button>
                            ${srcBtn}
                            <button class="tk-micro-btn del-btn" data-archive-action="delete" data-fact-id="${fact.id}" title="Delete forever">✕</button>
                        </span>
                    </div>
                `;
            }
        }

        html += '</div>';
    }

    panel.innerHTML = html;
    panel.style.display = 'flex';
    panel.style.flexDirection = 'column';

    // Archive searchbar — the panel does whole-innerHTML swaps, so each
    // keystroke re-renders and we re-apply focus + caret to feel continuous.
    const archiveSearch = document.getElementById('tk-archive-search');
    if (archiveSearch) {
        // Set value as a property (not an HTML attribute) so a query containing
        // a quote can't break out of the markup. :placeholder-shown still
        // reflects this live value, so the clear ✕ shows/hides correctly.
        archiveSearch.value = archiveSearchQuery;
        archiveSearch.addEventListener('input', () => {
            const caret = archiveSearch.selectionStart;
            archiveSearchQuery = archiveSearch.value;
            renderArchivePanel();
            const next = document.getElementById('tk-archive-search');
            if (next) {
                next.focus();
                try { next.setSelectionRange(caret, caret); } catch { /* ignore */ }
            }
        });
    }
    document.getElementById('tk-archive-search-clear')?.addEventListener('click', () => {
        archiveSearchQuery = '';
        renderArchivePanel();
        document.getElementById('tk-archive-search')?.focus();
    });

    document.getElementById('tk-archive-back-btn')?.addEventListener('click', toggleArchive);
    document.getElementById('tk-archive-clear-btn')?.addEventListener('click', () => {
        if (!confirm('Permanently delete all archived facts? This cannot be undone.')) return;
        clearArchive();
        viewingFolderRange = null;
        renderArchivePanel();
        updateArchiveCount();
    });
    document.getElementById('tk-archive-restore-all-btn')?.addEventListener('click', async () => {
        const result = restoreAllFromArchive();
        if (!result.ok) {
            if (result.reason === 'cap') {
                alert(`Cannot restore all — soft cap is too low.\n\nActive: ${result.activeCount}\nArchive: ${result.archiveCount}\nMax facts: ${result.maxFacts}\n\nRaise "Max remembered facts" in Advanced settings to at least ${result.activeCount + result.archiveCount}, then try again.`);
            }
            return;
        }
        viewingFolderRange = null;
        await injectFacts();
        renderArchivePanel();
        updateArchiveCount();
        updateStats();
    });
    document.getElementById('tk-archive-folders-back')?.addEventListener('click', () => {
        viewingFolderRange = null;
        renderArchivePanel();
        const overlay = document.getElementById('threadkeeper-overlay');
        if (overlay) overlay.scrollTop = 0;
    });
    panel.querySelectorAll('.tk-archive-folder').forEach(btn => {
        btn.addEventListener('click', () => {
            viewingFolderRange = {
                startIdx: Number(btn.dataset.folderStart),
                endIdx: Number(btn.dataset.folderEnd),
                msgStart: Number(btn.dataset.folderMsgStart),
                msgEnd: Number(btn.dataset.folderMsgEnd),
            };
            renderArchivePanel();
            const overlay = document.getElementById('threadkeeper-overlay');
            if (overlay) overlay.scrollTop = 0;
        });
    });
    panel.querySelectorAll('[data-archive-action]').forEach(btn => {
        btn.addEventListener('click', async () => {
            const action = btn.dataset.archiveAction;
            const factId = parseFloat(btn.dataset.factId);
            // Capture scroll position before re-render so restoring/deleting a
            // single fact doesn't bounce the user back to the top of the list.
            // Scrolling now lives on the overlay (the whole interface scrolls
            // as one), so we save/restore there. We also remember the clicked
            // fact's offset so the user lands back on the same visual position.
            const overlay = document.getElementById('threadkeeper-overlay');
            const savedScroll = overlay ? overlay.scrollTop : 0;
            const restoreScroll = () => {
                if (overlay) overlay.scrollTop = savedScroll;
            };
            if (action === 'restore') {
                if (restoreFromArchive(factId)) {
                    await injectFacts();
                    renderArchivePanel();
                    updateArchiveCount();
                    updateStats();
                    restoreScroll();
                }
            } else if (action === 'delete') {
                if (deleteArchivedFact(factId)) {
                    renderArchivePanel();
                    updateArchiveCount();
                    restoreScroll();
                }
            } else if (action === 'source') {
                const sourceIdx = parseInt(btn.dataset.source);
                await jumpToSourceMessage(sourceIdx, 'archive');
            }
        });
    });
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
                injectFacts();
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

    const unpinAllBtn = document.getElementById('tk-cfg-unpin-all');
    if (unpinAllBtn) {
        unpinAllBtn.addEventListener('click', () => {
            const pinned = getPinnedFacts();
            if (pinned.length === 0) return;
            unpinAllFacts();
            injectFacts();
            unpinAllBtn.textContent = `✓ Unpinned ${pinned.length}`;
            setTimeout(() => { unpinAllBtn.innerHTML = '📌 Unpin All'; }, 2000);
        });
    }

    const healGapsBtn = document.getElementById('tk-cfg-heal-gaps');
    if (healGapsBtn) {
        healGapsBtn.addEventListener('click', async () => {
            const resetLabel = () => { healGapsBtn.innerHTML = '🩹 Heal Gaps'; };
            if (isExtracting) {
                healGapsBtn.textContent = '⏳ Extraction running…';
                setTimeout(resetLabel, 2000);
                return;
            }
            const gaps = findFactGaps();
            if (gaps.length === 0) {
                healGapsBtn.textContent = '✓ No gaps detected';
                setTimeout(resetLabel, 2000);
                return;
            }

            // Build the set of message indexes to scan (only the gap msgs).
            const targetIndexes = new Set();
            for (const g of gaps) {
                for (let i = g.start; i <= g.end; i++) targetIndexes.add(i);
            }

            // How many of the gap msgs will actually reach the LLM given the
            // current scanHidden setting? Hidden (is_system) msgs get dropped
            // when scanHidden is off, which can mean Heal Gaps does literally
            // nothing — surface this up front instead of failing silently.
            const settings = getSettings();
            const respectHidden = settings.scanHidden === false;
            const context = getContext();
            const chat = context.chat || [];
            let visibleGapCount = 0;
            let hiddenGapCount = 0;
            for (const msgIdx of targetIndexes) {
                const msg = chat[msgIdx - 1];
                if (!msg) continue;
                if (!msg.mes || msg.mes.trim().length === 0) continue;
                if (msg.is_system) hiddenGapCount++;
                else visibleGapCount++;
            }

            const summary = gaps.map(g => `msgs ${g.start}–${g.end} (${g.length})`).join(', ');
            const total = gaps.reduce((acc, g) => acc + g.length, 0);

            // Special case: every gap msg is hidden + scanHidden is off. Heal
            // Gaps would scan nothing. Refuse instead of going through the
            // motions, and tell the user how to proceed.
            if (visibleGapCount === 0 && hiddenGapCount > 0 && respectHidden) {
                alert(
                    `Heal Gaps detected ${gaps.length} gap${gaps.length === 1 ? '' : 's'} ` +
                    `(${total} message${total === 1 ? '' : 's'}: ${summary}),\n` +
                    `but all ${hiddenGapCount} of those messages are hidden (is_system).\n\n` +
                    `Your "Scan hidden messages" setting is OFF, so nothing would be scanned.\n\n` +
                    `To fix this gap, either:\n` +
                    `  • Toggle "Scan hidden messages" ON, then click Heal Gaps again, or\n` +
                    `  • Unhide the specific messages in SillyTavern, then click Heal Gaps again.`
                );
                return;
            }

            const hiddenLine = hiddenGapCount > 0
                ? `\n\nNote: ${hiddenGapCount} of the gap messages are hidden and ${respectHidden ? 'will be skipped (scan-hidden is OFF)' : 'will be included (scan-hidden is ON)'}. ${visibleGapCount} visible gap message${visibleGapCount === 1 ? ' will' : 's will'} be scanned.`
                : '';
            const msg = `Detected ${gaps.length} gap${gaps.length === 1 ? '' : 's'} totaling ${total} message${total === 1 ? '' : 's'} with no active facts:\n\n${summary}${hiddenLine}\n\nScan only these gap messages? The global scan checkpoint stays unchanged, and messages with active or pinned facts are never re-LLM-called.`;
            if (!confirm(msg)) return;

            // Exit config so the user sees the terminal log + progress bar.
            toggleConfig();

            // Wire the same running-UI as the extract button, then call
            // runExtraction directly with the target set.
            await new Promise(r => setTimeout(r, 50));
            const extractBtn = document.getElementById('tk-extract-btn');
            const reextractBtn = document.getElementById('tk-reextract-btn');
            const bar = document.getElementById('tk-progress-bar');
            extractBtn?.classList.add('running');
            reextractBtn?.classList.add('running');
            setExtractionRunningUI(true);

            await runExtraction(
                false,
                (html) => addTerminalLine(html),
                (pct) => { if (bar) bar.style.width = pct + '%'; },
                (fact) => { addFactLine(fact); updateStats(); },
                targetIndexes,
            );

            setExtractionRunningUI(false);
            extractBtn?.classList.remove('running');
            reextractBtn?.classList.remove('running');
            // Rebuild the fact list so healed facts slot into chronological
            // order instead of dangling at the bottom of the run log.
            refreshTerminalContent();
            addTerminalLine('<span class="tk-success">🩹 Heal Gaps finished — facts above are merged in chronological order.</span>');
            addCursorLine();
        });
    }

    const autoScan = document.getElementById('tk-cfg-autoscan');
    if (autoScan) {
        autoScan.addEventListener('change', (e) => {
            const val = parseInt(e.target.value);
            if (!Number.isFinite(val) || val < 0) return;
            saveSetting('autoScanInterval', val);
            if (val > 0) {
                void maybeRunAutoScan();
            }
        });
    }

    const scanHidden = document.getElementById('tk-cfg-hidden');
    if (scanHidden) {
        scanHidden.addEventListener('change', (e) => {
            saveSetting('scanHidden', e.target.checked);
        });
    }

    const toneContainer = document.getElementById('tk-cfg-tone');
    if (toneContainer) {
        toneContainer.addEventListener('click', (e) => {
            const pill = e.target.closest('.tk-pill');
            if (!pill) return;
            toneContainer.querySelectorAll('.tk-pill').forEach(p => p.classList.remove('active'));
            pill.classList.add('active');
            saveSetting('extractionTone', pill.dataset.v);
        });
    }

    const folderSizeContainer = document.getElementById('tk-cfg-folder-size');
    if (folderSizeContainer) {
        folderSizeContainer.addEventListener('click', (e) => {
            const pill = e.target.closest('.tk-pill');
            if (!pill) return;
            folderSizeContainer.querySelectorAll('.tk-pill').forEach(p => p.classList.remove('active'));
            pill.classList.add('active');
            const val = parseInt(pill.dataset.v, 10);
            if (!Number.isFinite(val)) return;
            saveSetting('archiveFolderSize', val);
            // Re-render the archive panel if it's open so the grouping updates
            // immediately. Also reset any folder open against the old size.
            if (showingArchive) {
                viewingFolderRange = null;
                renderArchivePanel();
            }
        });
    }

    const minFactsInput = document.getElementById('tk-cfg-minfacts');
    if (minFactsInput) {
        minFactsInput.addEventListener('change', (e) => {
            const val = Math.max(1, parseInt(e.target.value) || 1);
            saveSetting('minFactsPerBatch', val);
        });
    }

    const maxFactsInput = document.getElementById('tk-cfg-maxfacts-batch');
    if (maxFactsInput) {
        maxFactsInput.addEventListener('change', (e) => {
            const val = Math.max(1, parseInt(e.target.value) || 15);
            saveSetting('maxFactsPerBatch', val);
        });
    }

    const depthInput = document.getElementById('tk-cfg-depth');
    if (depthInput) {
        depthInput.addEventListener('change', (e) => {
            const val = Math.max(0, parseInt(e.target.value) || DEFAULT_SETTINGS.messageDepth);
            saveSetting('messageDepth', val);
            // If the active placement uses messageDepth (At message depth), persist
            // the new depth into the derived injectDepth too and re-inject so the
            // change is reflected in the prompt immediately, not just on next Save.
            const placementState = getInjectionPlacementState();
            if (placementState.useMessageDepth) {
                saveSetting('injectDepth', val);
                injectFacts();
            }
        });
    }

    // Model picker
    setupModelPicker();
    setupPlacementPicker();
    setupGroupContinuityControls();
}

function setupGroupContinuityControls() {
    const context = getContext();
    const groupId = context.groupId;
    if (!groupId) return;
    if (!document.getElementById('tk-cfg-continuity-section')) return;

    const cfg = getGroupContinuityConfig(groupId, true);

    // Enabled/Disabled pills
    const pillContainer = document.getElementById('tk-cfg-continuity-enabled');
    if (pillContainer) {
        pillContainer.addEventListener('click', (e) => {
            const pill = e.target.closest('.tk-pill');
            if (!pill) return;
            pillContainer.querySelectorAll('.tk-pill').forEach(p => p.classList.remove('active'));
            pill.classList.add('active');
            cfg.enabled = pill.dataset.v === 'on';
            saveSettingsDebounced();
            // Turning it on in an empty chat should seed right away, not wait
            // for the next chat switch.
            if (cfg.enabled) {
                void maybeSeedGroupContinuation().then(async (seeded) => {
                    if (!seeded) return;
                    await injectFacts();
                    updateStats();
                    if (isTerminalOpen && !showingConfig) refreshTerminalContent();
                });
            }
        });
    }

    // Continuation-chats multi-select (select2 — searchable/filtering)
    const selectEl = document.getElementById('tk-cfg-continuity-chats');
    if (!selectEl || typeof jQuery === 'undefined' || typeof jQuery.fn.select2 !== 'function') return;

    const group = (context.groups || []).find(g => g.id === groupId);
    const groupChats = Array.isArray(group?.chats) ? group.chats : [];
    const currentChatId = group?.chat_id;

    // Prune saved selections that no longer exist (renamed/deleted chats).
    cfg.chats = (cfg.chats || []).filter(id => groupChats.includes(id));

    for (const chatId of groupChats) {
        const label = chatId === currentChatId ? `${chatId} (current)` : chatId;
        selectEl.appendChild(new Option(label, chatId, false, cfg.chats.includes(chatId)));
    }

    const $select = jQuery(selectEl);
    $select.select2({
        width: '100%',
        placeholder: 'All chats in this group',
        closeOnSelect: false,
        // Keep the dropdown inside the terminal overlay so it isn't hidden
        // behind it (the overlay sits at z-index 10000).
        dropdownParent: jQuery('#tk-config'),
    });
    $select.on('change', () => {
        const values = $select.val() || [];
        cfg.chats = values.map(String);
        saveSettingsDebounced();
    });
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

    const activeFolderSize = document.querySelector('#tk-cfg-folder-size .tk-pill.active');
    if (activeFolderSize) {
        const v = parseInt(activeFolderSize.dataset.v, 10);
        if (Number.isFinite(v)) saveSetting('archiveFolderSize', v);
    }

    const crossChat = document.getElementById('tk-cfg-crosschat');
    if (crossChat) saveSetting('crossChatPinned', crossChat.checked);

    const autoPin = document.getElementById('tk-cfg-autopin');
    if (autoPin) saveSetting('autoPin', autoPin.checked);

    const autoScan = document.getElementById('tk-cfg-autoscan');
    if (autoScan) saveSetting('autoScanInterval', parseInt(autoScan.value) || 0);

    const hidden = document.getElementById('tk-cfg-hidden');
    if (hidden) saveSetting('scanHidden', hidden.checked);

    const activeTone = document.querySelector('#tk-cfg-tone .tk-pill.active');
    if (activeTone) saveSetting('extractionTone', activeTone.dataset.v);

    const minFactsBatch = document.getElementById('tk-cfg-minfacts');
    if (minFactsBatch) saveSetting('minFactsPerBatch', Math.max(1, parseInt(minFactsBatch.value) || 1));

    const maxFactsBatch = document.getElementById('tk-cfg-maxfacts-batch');
    if (maxFactsBatch) saveSetting('maxFactsPerBatch', Math.max(1, parseInt(maxFactsBatch.value) || 15));

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
            if (search) {
                search.value = '';
            }
            void refreshModels('');
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
        injectFacts();
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

    if (control.tagName === 'INPUT' && control.list) {
        const models = [];
        const seen = new Set();
        const currentValue = String(control.value || '').trim();

        if (currentValue) {
            seen.add(currentValue);
            models.push({ id: currentValue, name: currentValue, provider: providerLabel });
        }

        Array.from(control.list.options || []).forEach(opt => {
            const value = String(opt.value || '').trim();
            const name = String(opt.textContent || opt.label || value).trim();
            if (!value || seen.has(value)) return;
            seen.add(value);
            models.push({ id: value, name: name || value, provider: providerLabel });
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

function getProfileProxyPreset(profile) {
    const proxyName = String(profile?.proxy || '').trim();
    if (!proxyName) {
        return null;
    }

    return proxies.find(proxy => proxy.name === proxyName) || null;
}

function applyProfileApiUrlFields(target, profile, chatCompletionSource = '') {
    const source = String(chatCompletionSource || '').toLowerCase();
    const apiUrl = String(profile?.['api-url'] || '').trim();
    if (!apiUrl) {
        return target;
    }

    if (source === 'custom') {
        target.custom_url = apiUrl;
    } else if (source === 'vertexai') {
        target.vertexai_region = apiUrl;
    } else if (source === 'zai') {
        target.zai_endpoint = apiUrl;
    } else if (source === 'siliconflow') {
        target.siliconflow_endpoint = apiUrl;
    } else if (source === 'minimax') {
        target.minimax_endpoint = apiUrl;
    }

    return target;
}

function buildStatusRequestBodyForProfile(profile) {
    const apiConfig = CONNECT_API_MAP[String(profile?.api || '').toLowerCase()];
    const chatCompletionSource = String(apiConfig?.source || profile?.api || '').toLowerCase();
    const body = {
        chat_completion_source: chatCompletionSource,
    };

    if (profile?.['secret-id']) {
        body.secret_id = profile['secret-id'];
    }

    applyProfileApiUrlFields(body, profile, chatCompletionSource);

    const proxyPreset = getProfileProxyPreset(profile);
    if (proxyPreset?.url) {
        body.reverse_proxy = proxyPreset.url;
    }
    if (proxyPreset?.password) {
        body.proxy_password = proxyPreset.password;
    }

    if (chatCompletionSource === 'custom') {
        body.custom_include_headers = oai_settings.custom_include_headers;
    }

    return body;
}

function normalizeFetchedModels(profile, payload) {
    const api = String(profile?.api || '').toLowerCase();
    const provider = profile?.name || profile?.api || '';
    const rootPayload = payload?.data && typeof payload.data === 'object' && !Array.isArray(payload.data)
        ? payload.data
        : payload;
    const sourceList = Array.isArray(rootPayload?.data)
        ? rootPayload.data
        : Array.isArray(rootPayload?.models)
            ? rootPayload.models
            : Array.isArray(rootPayload?.result)
                ? rootPayload.result
                : Array.isArray(rootPayload)
                    ? rootPayload
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
    const cacheKey = [
        profile.id,
        profile.api || '',
        profile['secret-id'] || '',
        profile.model || '',
        profile['api-url'] || '',
        profile.proxy || '',
    ].join(':');
    if (modelCatalogCache.has(cacheKey)) {
        return modelCatalogCache.get(cacheKey);
    }

    // Prefer ST's server-side status route so secrets, proxy presets, and
    // custom-compatible providers behave the same way as native model loading.
    try {
        const response = await fetch('/api/backends/chat-completions/status', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify(buildStatusRequestBodyForProfile(profile)),
            signal: AbortSignal.timeout(10000),
        });

        if (response.ok) {
            const responseData = await response.json();
            const models = normalizeFetchedModels(profile, responseData);
            if (models.length > 0) {
                modelCatalogCache.set(cacheKey, models);
                return models;
            }
        }
    } catch (error) {
    }

    // Last resort for providers whose /status route is unavailable.
    const endpoint = getModelsEndpointForProfile(profile);
    if (endpoint) {
        try {
            const secretKey = getSecretKeyForProfile(profile);
            const secretValue = secretKey && profile['secret-id'] ? await findSecret(secretKey, profile['secret-id']) : null;
            const api = String(profile?.api || '').toLowerCase();
            let resolvedEndpoint = endpoint;

            if (api === 'makersuite' && secretValue) {
                const separator = resolvedEndpoint.includes('?') ? '&' : '?';
                resolvedEndpoint = `${resolvedEndpoint}${separator}key=${encodeURIComponent(secretValue)}`;
            }

            const headers = {};
            if (secretValue && api !== 'makersuite') {
                headers.Authorization = `Bearer ${secretValue}`;
            }
            const response = await fetch(resolvedEndpoint, {
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
        const fallbackModelId = getDefaultModelForSelection(profile.id);
        const fallbackModel = fallbackModelId
            ? { id: fallbackModelId, name: fallbackModelId, provider: profile.name || profile.api || '' }
            : null;

        // Strategy 1: Read from the DOM model <select> only when this is the active profile.
        if (profile.id === currentProfileId) {
            const profileControl = getModelSelectElementForProfile(profile);
            if (profileControl) {
                const profileModels = readModelsFromControl(profileControl, profile);
                if (profileModels.length > 0) {
                    if (fallbackModel && !profileModels.some(model => model.id === fallbackModel.id)) {
                        profileModels.unshift(fallbackModel);
                    }
                    return profileModels;
                }
            }
        }

        // Strategy 2: Ask ST for the selected profile's model catalog.
        const fetchedModels = await fetchModelsForProfile(profile);
        if (fetchedModels.length > 0) {
            if (fallbackModel && !fetchedModels.some(model => model.id === fallbackModel.id)) {
                fetchedModels.unshift(fallbackModel);
            }
            return fetchedModels;
        }

        // Strategy 3: Use the saved/current model even if model discovery fails.
        if (fallbackModel) {
            return [fallbackModel];
        }
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
    if (autoScan) autoScan.value = String(settings.autoScanInterval ?? DEFAULT_SETTINGS.autoScanInterval);

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

    // Sync tone pills
    const tonePills = document.querySelectorAll('#tk-cfg-tone .tk-pill');
    tonePills.forEach(pill => {
        pill.classList.toggle('active', pill.dataset.v === (settings.extractionTone || 'Polite'));
    });

    // Sync archive folder size pills
    const folderSizePills = document.querySelectorAll('#tk-cfg-folder-size .tk-pill');
    const currentFolderSize = String(settings.archiveFolderSize || 100);
    folderSizePills.forEach(pill => {
        pill.classList.toggle('active', pill.dataset.v === currentFolderSize);
    });

    // Sync facts per batch inputs
    const minFactsInput = document.getElementById('tk-cfg-minfacts');
    if (minFactsInput) minFactsInput.value = String(settings.minFactsPerBatch || 1);

    const maxFactsInput = document.getElementById('tk-cfg-maxfacts-batch');
    if (maxFactsInput) maxFactsInput.value = String(settings.maxFactsPerBatch || 15);

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

    // Show/hide the stop button alongside extract/re-extract running state.
    const setExtractionRunningUI = (running) => {
        const stopBtn = document.getElementById('tk-stop-btn');
        if (stopBtn) stopBtn.style.display = running ? '' : 'none';
        const progress = document.getElementById('tk-progress');
        if (progress) progress.classList.toggle('active', running);
        if (!running) {
            const bar = document.getElementById('tk-progress-bar');
            if (bar) bar.style.width = '0%';
        }
    };

    // Extract button
    const extractBtn = document.getElementById('tk-extract-btn');
    if (extractBtn) {
        extractBtn.addEventListener('click', async () => {
            if (isExtracting) return;
            extractBtn.classList.add('running');
            document.getElementById('tk-reextract-btn')?.classList.add('running');
            setExtractionRunningUI(true);
            const bar = document.getElementById('tk-progress-bar');

            await runExtraction(
                false,
                (html) => addTerminalLine(html),
                (pct) => { if (bar) bar.style.width = pct + '%'; },
                (fact) => { addFactLine(fact); updateStats(); },
            );

            syncFactPinDOM();
            addCursorLine();
            updateStats();
            setExtractionRunningUI(false);
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
            setExtractionRunningUI(true);
            const bar = document.getElementById('tk-progress-bar');

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

            syncFactPinDOM();
            addCursorLine();
            updateStats();
            setExtractionRunningUI(false);
            reextractBtn.classList.remove('running');
            document.getElementById('tk-extract-btn')?.classList.remove('running');
        });
    }

    // Stop button — abort an in-progress extraction.
    const stopBtn = document.getElementById('tk-stop-btn');
    if (stopBtn) {
        stopBtn.addEventListener('click', () => {
            if (!isExtracting) return;
            stopExtraction();
            stopBtn.disabled = true;
            stopBtn.textContent = '▣ stopping…';
            // Re-enable label after the loop finishes (button hides anyway).
            setTimeout(() => {
                stopBtn.disabled = false;
                stopBtn.textContent = '▣ stop';
            }, 1500);
        });
    }

    // Archive button — open the archive panel.
    const archiveBtn = document.getElementById('tk-archive-btn');
    if (archiveBtn) {
        archiveBtn.addEventListener('click', toggleArchive);
    }

    // Clear unpinned facts button — also acts as a soft reset of the extraction
    // state so the user can start a fresh extract without refreshing the browser.
    const clearFactsBtn = document.getElementById('tk-clear-facts-btn');
    if (clearFactsBtn) {
        clearFactsBtn.addEventListener('click', async () => {
            const regularFacts = getFacts().filter(f => !f.pinned);

            // Reset in-memory extraction flags and any UI running-state, regardless of
            // whether there are facts to clear, so this button can recover from
            // a stuck state without a browser refresh.
            isExtracting = false;
            stopRequested = false;
            document.getElementById('tk-extract-btn')?.classList.remove('running');
            document.getElementById('tk-reextract-btn')?.classList.remove('running');
            const stopBtn = document.getElementById('tk-stop-btn');
            if (stopBtn) {
                stopBtn.style.display = 'none';
                stopBtn.disabled = false;
                stopBtn.textContent = '▣ stop';
            }
            const progress = document.getElementById('tk-progress');
            if (progress) progress.classList.remove('active');
            const bar = document.getElementById('tk-progress-bar');
            if (bar) bar.style.width = '0%';

            if (regularFacts.length === 0) {
                // Still reset lastScannedIndex so a subsequent extract rescans from message 1.
                const data = getTkData();
                data.lastScannedIndex = 0;
                delete data.pausedOnEmpties;
                setTkData(data);
                addTerminalLine('<span class="tk-dim">No unpinned facts to clear · scan reset · ready to extract.</span>');
                addCursorLine();
                return;
            }

            // clearNonPinnedFacts() also resets lastScannedIndex to 0.
            clearNonPinnedFacts();
            await injectFacts();
            refreshTerminalContent();
            addTerminalLine(`<span class="tk-success">✓ Cleared ${regularFacts.length} unpinned fact${regularFacts.length === 1 ? '' : 's'} · scan reset · ready to extract</span>`);
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

    // Fact search box — live text filter over the active facts list.
    const factSearch = document.getElementById('tk-fact-search');
    if (factSearch) {
        factSearch.addEventListener('input', applyFilter);
    }
    const factSearchClear = document.getElementById('tk-fact-search-clear');
    if (factSearchClear) {
        factSearchClear.addEventListener('click', () => {
            if (!factSearch) return;
            factSearch.value = '';
            applyFilter();
            factSearch.focus();
        });
    }

    // Fact action buttons (delegated)
    const body = document.getElementById('tk-body');
    if (body) {
        body.addEventListener('click', async (e) => {
            const btn = e.target.closest('[data-action]');
            if (!btn) return;

            const action = btn.dataset.action;
            const factId = parseFloat(btn.dataset.factId);

            if (action === 'pin') {
                toggleFactPin(factId);
                btn.classList.toggle('pinned');
                updateStats();
                injectFacts();
            } else if (action === 'edit') {
                const success = await editFact(factId);
                if (success) {
                    refreshTerminalContent();
                    await injectFacts();
                }
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
            } else if (action === 'archive') {
                if (archiveActiveFact(factId)) {
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
                    await injectFacts();
                }
            } else if (action === 'source') {
                const sourceIdx = parseInt(btn.dataset.source);
                await jumpToSourceMessage(sourceIdx, 'active');
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
    // Scoped to #tk-body so it never touches archive cards (which also use
    // .tk-fact / .fact-body) — the archive has its own independent searchbar.
    const q = (document.getElementById('tk-fact-search')?.value || '').trim().toLowerCase();
    document.querySelectorAll('#tk-body .tk-fact').forEach(card => {
        const category = [...card.classList].find(c => c.startsWith('cat-'))?.replace('cat-', '');
        if (!category) return;
        const catMatch = activeFilter === 'all' || category === activeFilter;
        const text = (card.querySelector('.fact-body')?.textContent || '').toLowerCase();
        const searchMatch = !q || text.includes(q) || category.includes(q);
        card.style.display = (catMatch && searchMatch) ? 'flex' : 'none';
    });
    document.querySelectorAll('#tk-body .tk-fact-thread').forEach(thread => {
        const visibleFacts = Array.from(thread.querySelectorAll('.tk-fact')).some(card => card.style.display !== 'none');
        thread.style.display = visibleFacts ? '' : 'none';
    });
}

// ═══════════════════════════════════════════════════════════════════
// AUTO-SCAN
// ═══════════════════════════════════════════════════════════════════

async function maybeRunAutoScan() {
    const settings = getSettings();
    const pendingMessages = getPendingMessagesCount();

    if (settings.autoScanInterval <= 0 || pendingMessages < settings.autoScanInterval || isExtracting) {
        return false;
    }

    const badge = document.getElementById('tk-auto-scan-badge');
    setAutoScanPopupState('Initializing...', `${pendingMessages} new messages queued`, 'running');
    toastr.info(`${pendingMessages} new message${pendingMessages === 1 ? '' : 's'} queued`, 'ThreadKeeper — Initializing', { timeOut: 5000, progressBar: true });
    if (badge) {
        badge.textContent = 'scanning…';
        badge.className = 'tk-new-badge tk-scan-scanning';
        badge.style.display = '';
    }

    const factsBefore = getFacts().length;

    try {
        setAutoScanPopupState('Now extracting...', `Scanning ${pendingMessages} new messages`, 'running');
        toastr.info(`Scanning ${pendingMessages} new message${pendingMessages === 1 ? '' : 's'}`, 'ThreadKeeper — Scanning', { timeOut: 6000, progressBar: true });
        await runExtraction(false);
        const newCount = getFacts().length - factsBefore;
        if (isTerminalOpen) refreshTerminalContent();
        if (badge) {
            badge.textContent = newCount > 0 ? `✓ ${newCount} new` : '✓ done';
            badge.className = `tk-new-badge ${newCount > 0 ? 'tk-scan-done' : 'tk-scan-idle'}`;
            setTimeout(() => {
                badge.style.display = 'none';
                badge.className = 'tk-new-badge';
            }, newCount > 0 ? 5000 : 2000);
        }
        setAutoScanPopupState(
            newCount > 0 ? 'Extraction complete' : 'No new facts found',
            newCount > 0 ? `Saved ${newCount} new fact${newCount === 1 ? '' : 's'}` : 'ThreadKeeper is up to date',
            'success',
        );
        if (newCount > 0) {
            toastr.success(`Saved ${newCount} new fact${newCount === 1 ? '' : 's'}`, 'ThreadKeeper — Extraction Complete', { timeOut: 8500, progressBar: true });
        } else {
            toastr.success('ThreadKeeper is up to date', 'ThreadKeeper — No New Facts', { timeOut: 3000, progressBar: true });
        }
        hideAutoScanPopup(newCount > 0 ? 4500 : 3500);
        return true;
    } catch (err) {
        console.error('[ThreadKeeper] Auto-scan error:', err);
        if (badge) {
            badge.textContent = '⚠ scan failed';
            badge.className = 'tk-new-badge tk-scan-error';
            setTimeout(() => {
                badge.style.display = 'none';
                badge.className = 'tk-new-badge';
            }, 4000);
        }
        setAutoScanPopupState('Auto-scan failed', err?.message || 'Unknown error', 'error');
        toastr.error(err?.message || 'Unknown error', 'ThreadKeeper — Scan Failed', { timeOut: 4500, progressBar: true });
        hideAutoScanPopup(5500);
        return false;
    }
}

function onNewMessage() {
    void maybeRunAutoScan();
}

// ═══════════════════════════════════════════════════════════════════
// CHAT CHANGE — reload facts + inject
// ═══════════════════════════════════════════════════════════════════

async function onChatChanged() {
    // Halt any in-flight extraction on the previous chat — its remaining writes
    // would otherwise land on this new chat's metadata (cross-chat bleed).
    stopRequested = true;
    // Reset folder-view state — a folder open against the previous chat's
    // archive would render stale indexes against this chat's archive.
    viewingFolderRange = null;
    archiveSearchQuery = '';
    // Continuation seeding runs BEFORE the pin-only global seeding: a full
    // carry includes the pinned facts, and once the chat has data the pin
    // seeding bails out on its own.
    await maybeSeedGroupContinuation();
    restorePinnedFromGlobal();
    await injectFacts();
    if (isTerminalOpen) refreshTerminalContent();
    updateArchiveCount();
    if (showingArchive) renderArchivePanel();
    void maybeRunAutoScan();
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
        <span class="tk-menu-label">ThreadKeeper</span>
        <span class="tk-new-badge" id="tk-auto-scan-badge" style="display:none"></span>`;
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
                    case 'wipe':
                        {
                            const result = await wipeThreadKeeperData();
                            setExtensionPrompt(EXTENSION_PROMPT_KEY, '', extension_prompt_types.IN_CHAT, 0);
                            return `Wiped ThreadKeeper data. Chats: ${result.cleanedChats}, settings: ${result.cleanedSettings ? 'yes' : 'no'}`;
                        }
                    default:
                        return 'Usage: /threadkeeper [open|extract|reextract|facts|clear|wipe]';
                }
            },
            helpString: 'ThreadKeeper memory management. Subcommands: open, extract, reextract, facts, clear, wipe',
        }));
    } catch (e) {
    }
}

export async function onExtensionDelete() {
    await wipeThreadKeeperData();
}

// ═══════════════════════════════════════════════════════════════════
// CLEANUP / UNLOAD
// ═══════════════════════════════════════════════════════════════════

function cleanup() {
    removeEventSourceListener(event_types.CHAT_CHANGED, onChatChanged);
    removeEventSourceListener(event_types.CHARACTER_MESSAGE_RENDERED, onNewMessage);
    removeEventSourceListener(event_types.USER_MESSAGE_RENDERED, onNewMessage);
    removeEventSourceListener(event_types.CHAT_COMPLETION_PROMPT_READY, onChatCompletionPromptReady);
    document.removeEventListener('click', handleGlobalClick);
    mobileStyleLink?.remove();
    mobileStyleLink = null;
    if (autoScanPopupHideTimer) {
        clearTimeout(autoScanPopupHideTimer);
        autoScanPopupHideTimer = null;
    }
    document.getElementById('tk-auto-scan-popup')?.remove();
    document.getElementById('threadkeeper-overlay')?.remove();
    document.querySelectorAll('#threadkeeper-menu-item').forEach(el => el.remove());
    setExtensionPrompt(EXTENSION_PROMPT_KEY, '', extension_prompt_types.IN_CHAT, 0);
}

function removeEventSourceListener(eventName, handler) {
    if (typeof eventSource.removeListener === 'function') {
        eventSource.removeListener(eventName, handler);
        return;
    }

    if (typeof eventSource.off === 'function') {
        eventSource.off(eventName, handler);
    }
}

// ═══════════════════════════════════════════════════════════════════
// INITIALIZATION
// ═══════════════════════════════════════════════════════════════════

jQuery(async function () {
    // Load settings and persist to ensure they're saved on first load
    loadSettings();
    await saveSettings();
    installUninstallHook();

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
    eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, onChatCompletionPromptReady);

    // Clean up when the page unloads (extension disabled without reload, or page close)
    window.addEventListener('beforeunload', cleanup, { once: true });

    // Register slash commands
    registerSlashCommands();

    // Initial injection if chat already loaded
    await maybeSeedGroupContinuation();
    await injectFacts();
    void maybeRunAutoScan();

});
