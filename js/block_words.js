(function () {
    'use strict';

    const STORAGE_KEY = 'kraftCollageBlockNotes.v2';
    const originalTextNodes = new WeakMap();
    let globalObserver = null;
    let globalApplyTimer = null;
    let isApplyingGlobal = false;

    function getState() {
        return window.iphoneSimState || {};
    }

    function getRules() {
        let rules = [];
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            const parsed = raw ? JSON.parse(raw) : [];
            if (Array.isArray(parsed)) rules = parsed;
        } catch (error) {
            rules = [];
        }
        return rules
            .filter(rule => rule && rule.enabled !== false)
            .map(rule => ({
                id: String(rule.id || ''),
                text: String(rule.text || '').trim(),
                scope: rule.scope === 'chat' ? 'chat' : 'global',
                chatMode: rule.chatMode === 'text' ? 'text' : 'message',
                contactScope: rule.contactScope === 'selected' ? 'selected' : 'all',
                contacts: Array.isArray(rule.contacts) ? rule.contacts.map(String) : []
            }))
            .filter(rule => rule.text);
    }

    function getRulesForGlobal() {
        return getRules().filter(rule => rule.scope === 'global');
    }

    function getRulesForChat(contactId) {
        const cid = String(contactId || '');
        return getRules().filter(rule => {
            if (rule.scope !== 'chat') return false;
            if (rule.contactScope !== 'selected') return true;
            return rule.contacts.map(String).includes(cid);
        });
    }

    function replaceAllText(source, target, replacement = '') {
        if (!target) return source;
        return String(source).split(target).join(replacement);
    }

    function applyTextRules(text, rules) {
        return rules.reduce((next, rule) => replaceAllText(next, rule.text, ''), String(text || ''));
    }

    function isPlainChatTextMessage(message) {
        const type = String(message && message.type || 'text');
        return !type || ['text', 'system', 'voice_call_text', 'call_rejected'].includes(type);
    }

    function applyChatBlockWords(message, contactId) {
        if (message && message.role === 'user') {
            return { hidden: false, message };
        }
        if (!message || typeof message.content !== 'string' || !isPlainChatTextMessage(message)) {
            return { hidden: false, message };
        }
        const rules = getRulesForChat(contactId);
        if (!rules.length) return { hidden: false, message };

        const content = String(message.content || '');
        const hideWholeMessage = rules.some(rule => rule.chatMode === 'message' && content.includes(rule.text));
        if (hideWholeMessage) return { hidden: true, message: null };

        const textRules = rules.filter(rule => rule.chatMode === 'text');
        if (!textRules.length) return { hidden: false, message };
        const nextContent = applyTextRules(content, textRules);
        if (nextContent === content) return { hidden: false, message };
        return { hidden: false, message: Object.assign({}, message, { content: nextContent }) };
    }

    function shouldSkipGlobalTextNode(node) {
        const parent = node && node.parentElement;
        if (!parent) return true;
        if (!node.nodeValue || !node.nodeValue.trim()) return true;
        if (parent.closest('script, style, textarea, input, select, option, iframe, #wechat-block-words-screen')) return true;
        if (parent.closest('.chat-message.user')) return true;
        return false;
    }

    function restoreTextNodes(root = document.body) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let node = walker.nextNode();
        while (node) {
            if (originalTextNodes.has(node)) {
                const original = originalTextNodes.get(node);
                if (node.nodeValue !== original) node.nodeValue = original;
            }
            node = walker.nextNode();
        }
    }

    function applyGlobalBlockWords(root = document.body) {
        if (!root) return;
        isApplyingGlobal = true;
        const rules = getRulesForGlobal();
        restoreTextNodes(root);
        if (!rules.length) {
            setTimeout(() => { isApplyingGlobal = false; }, 0);
            return;
        }

        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let node = walker.nextNode();
        while (node) {
            if (!shouldSkipGlobalTextNode(node)) {
                if (!originalTextNodes.has(node)) originalTextNodes.set(node, node.nodeValue);
                const original = originalTextNodes.get(node);
                const nextValue = applyTextRules(original, rules);
                if (node.nodeValue !== nextValue) node.nodeValue = nextValue;
            }
            node = walker.nextNode();
        }
        setTimeout(() => { isApplyingGlobal = false; }, 0);
    }

    function scheduleGlobalApply() {
        clearTimeout(globalApplyTimer);
        globalApplyTimer = setTimeout(() => applyGlobalBlockWords(document.body), 80);
    }

    function startGlobalObserver() {
        if (globalObserver || !document.body) return;
        globalObserver = new MutationObserver((mutations) => {
            if (isApplyingGlobal) return;
            if (!getRulesForGlobal().length) return;
            if (mutations.some(mutation => mutation.type === 'childList' || mutation.type === 'characterData')) {
                scheduleGlobalApply();
            }
        });
        globalObserver.observe(document.body, {
            childList: true,
            characterData: true,
            subtree: true
        });
    }

    function refreshChatAfterRulesChange() {
        const state = getState();
        const currentChatContactId = state.currentChatContactId;
        if (currentChatContactId && typeof window.renderChatHistory === 'function') {
            try {
                window.renderChatHistory(currentChatContactId, true);
            } catch (error) {
                console.warn('[BlockWords] render chat failed', error);
            }
        }
    }

    function refreshBlockWordsEffects() {
        applyGlobalBlockWords(document.body);
        startGlobalObserver();
        refreshChatAfterRulesChange();
    }

    window.getBlockWordRules = getRules;
    window.applyGlobalBlockWords = applyGlobalBlockWords;
    window.refreshBlockWordsEffects = refreshBlockWordsEffects;
    window.applyBlockWordsToChatRenderMessage = function (message, contactId) {
        return applyChatBlockWords(message, contactId);
    };
    window.applyBlockWordsToChatContextMessage = function (message, contactId) {
        const result = applyChatBlockWords(message, contactId);
        return result.hidden ? null : result.message;
    };

    window.addEventListener('storage', (event) => {
        if (event.key === STORAGE_KEY) refreshBlockWordsEffects();
    });

    window.addEventListener('message', (event) => {
        if (event && event.data && event.data.type === 'kraft-block-words-updated') {
            refreshBlockWordsEffects();
        }
        if (event && event.data && event.data.type === 'close-kraft-block-words') {
            const screen = document.getElementById('wechat-block-words-screen');
            if (screen) screen.classList.add('hidden');
            refreshBlockWordsEffects();
        }
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', refreshBlockWordsEffects);
    } else {
        refreshBlockWordsEffects();
    }
})();
