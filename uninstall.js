import { getContext, extension_settings } from '../../../extensions.js';
import {
    getRequestHeaders,
    saveSettings,
} from '../../../../script.js';

const MODULE_NAME = 'threadkeeper';
const EXTENSION_FOLDER_NAME = 'ST---ThreadKeeper';
const FETCH_HOOK_FLAG = '__threadkeeperUninstallHookInstalled';
const CLEANUP_FLAG = '__threadkeeperCleanupRunning';

function hasThreadKeeperMetadata(chatData) {
    return Array.isArray(chatData)
        && chatData.length > 0
        && chatData[0]?.chat_metadata
        && Object.prototype.hasOwnProperty.call(chatData[0].chat_metadata, MODULE_NAME);
}

function stripThreadKeeperMetadata(chatData) {
    if (!hasThreadKeeperMetadata(chatData)) {
        return null;
    }

    const nextHeader = {
        ...chatData[0],
        chat_metadata: { ...chatData[0].chat_metadata },
    };
    delete nextHeader.chat_metadata[MODULE_NAME];
    return [nextHeader, ...chatData.slice(1)];
}

async function postJson(url, body) {
    const response = await fetch(url, {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        throw new Error(`${url} failed with status ${response.status}`);
    }

    return await response.json();
}

async function cleanupCurrentChat() {
    const context = getContext();
    if (!context.chatMetadata || !Object.prototype.hasOwnProperty.call(context.chatMetadata, MODULE_NAME)) {
        return false;
    }

    delete context.chatMetadata[MODULE_NAME];
    await context.saveMetadata();
    return true;
}

async function cleanupCharacterChat(character, fileName) {
    const chatData = await postJson('/api/chats/get', {
        ch_name: character.name,
        file_name: fileName,
        avatar_url: character.avatar,
    });

    const cleanedChat = stripThreadKeeperMetadata(chatData);
    if (!cleanedChat) {
        return false;
    }

    await postJson('/api/chats/save', {
        ch_name: character.name,
        file_name: fileName,
        avatar_url: character.avatar,
        chat: cleanedChat,
        force: true,
    });

    return true;
}

async function cleanupGroupChat(chatId) {
    const chatData = await postJson('/api/chats/group/get', { id: chatId });
    const cleanedChat = stripThreadKeeperMetadata(chatData);
    if (!cleanedChat) {
        return false;
    }

    await postJson('/api/chats/group/save', {
        id: chatId,
        chat: cleanedChat,
        force: true,
    });

    return true;
}

async function cleanupAllStoredChats() {
    const context = getContext();
    let cleanedChats = 0;
    const seenCharacters = new Set();

    for (const character of context.characters || []) {
        if (!character?.avatar || seenCharacters.has(character.avatar)) {
            continue;
        }

        seenCharacters.add(character.avatar);

        const results = await postJson('/api/chats/search', {
            query: '',
            avatar_url: character.avatar,
            group_id: null,
        });

        for (const result of results) {
            if (await cleanupCharacterChat(character, result.file_name)) {
                cleanedChats++;
            }
        }
    }

    for (const group of context.groups || []) {
        if (!group?.id) {
            continue;
        }

        const results = await postJson('/api/chats/search', {
            query: '',
            avatar_url: null,
            group_id: group.id,
        });

        for (const result of results) {
            if (await cleanupGroupChat(result.file_name)) {
                cleanedChats++;
            }
        }
    }

    return cleanedChats;
}

async function cleanupSettings() {
    if (!Object.prototype.hasOwnProperty.call(extension_settings, MODULE_NAME)) {
        return false;
    }

    delete extension_settings[MODULE_NAME];
    await saveSettings();
    return true;
}

export async function wipeThreadKeeperData() {
    if (window[CLEANUP_FLAG]) {
        return { cleanedSettings: false, cleanedChats: 0 };
    }

    window[CLEANUP_FLAG] = true;
    try {
        const cleanedCurrent = await cleanupCurrentChat();
        const cleanedChats = await cleanupAllStoredChats();
        const cleanedSettings = await cleanupSettings();

        return {
            cleanedSettings,
            cleanedChats: cleanedChats + (cleanedCurrent ? 1 : 0),
        };
    } finally {
        window[CLEANUP_FLAG] = false;
    }
}

export function installUninstallHook() {
    if (window[FETCH_HOOK_FLAG]) {
        return;
    }

    const originalFetch = window.fetch.bind(window);
    window.fetch = async function (input, init) {
        const response = await originalFetch(input, init);

        try {
            const url = typeof input === 'string' ? input : input?.url;
            if (!response.ok || !url || !url.includes('/api/extensions/delete')) {
                return response;
            }

            const payload = init?.body ? JSON.parse(init.body) : null;
            if (payload?.extensionName === EXTENSION_FOLDER_NAME) {
                await wipeThreadKeeperData();
            }
        } catch (error) {
            console.warn('ThreadKeeper uninstall cleanup did not complete.', error);
        }

        return response;
    };

    window[FETCH_HOOK_FLAG] = true;
}
