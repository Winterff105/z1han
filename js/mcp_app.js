(function () {
    const LEGACY_STORAGE_KEY = 'mcp_app_state_v1';
    const STORAGE_KEY = 'mcp_app_state_v2';
    const MAX_LOGS = 40;
    const MCP_PROTOCOL_VERSION = '2024-11-05';

    const runtime = {
        statusTone: 'idle',
        statusText: '未配置',
        statusHint: '先创建一个 MCP 节点，再绑定到联系人。',
        sessions: Object.create(null)
    };

    const $ = (id) => document.getElementById(id);

    function createId() {
        return `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    }

    function createRpcId() {
        return `rpc-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    }

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        }[ch]));
    }

    function parseKeywordList(value) {
        return String(value || '')
            .split(/[,，;；\n]+/)
            .map((item) => item.trim().toLowerCase())
            .filter(Boolean);
    }

    function serverMatchesKeywords(server, userText) {
        const keywords = parseKeywordList(server && server.keywords);
        if (!keywords.length) return true;
        const text = String(userText || '').toLowerCase();
        if (!text) return false;
        return keywords.some((keyword) => text.includes(keyword));
    }

    function scrollFormIntoView() {
        const nameInput = $('mcp-server-name');
        if (!nameInput) return;
        if (typeof nameInput.scrollIntoView === 'function') {
            nameInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        try {
            nameInput.focus({ preventScroll: true });
        } catch (error) {
            nameInput.focus();
        }
    }

    function normalizeBoundContactIds(value) {
        if (!Array.isArray(value)) return [];
        const seen = new Set();
        return value.reduce((list, item) => {
            const normalized = String(item || '').trim();
            if (!normalized || seen.has(normalized)) return list;
            seen.add(normalized);
            list.push(normalized);
            return list;
        }, []);
    }

    function normalizeTool(raw) {
        const inputSchema = raw && raw.inputSchema && typeof raw.inputSchema === 'object' && !Array.isArray(raw.inputSchema)
            ? raw.inputSchema
            : (raw && raw.input_schema && typeof raw.input_schema === 'object' && !Array.isArray(raw.input_schema)
                ? raw.input_schema
                : { type: 'object', properties: {}, additionalProperties: true });
        return {
            name: String(raw && (raw.name || raw.toolName) || '').trim() || 'unnamed_tool',
            description: String(raw && raw.description || '').trim(),
            inputSchema,
            annotations: raw && raw.annotations && typeof raw.annotations === 'object' ? raw.annotations : {}
        };
    }

    function normalizeServer(raw) {
        const transport = ['http', 'sse', 'stdio'].includes(String(raw && raw.transport || ''))
            ? String(raw.transport)
            : 'http';
        return {
            id: String(raw && raw.id || '').trim() || createId(),
            name: String(raw && raw.name || '').trim() || '未命名节点',
            transport,
            endpoint: String(raw && raw.endpoint || '').trim(),
            command: String(raw && raw.command || '').trim(),
            args: String(raw && raw.args || '').trim(),
            token: String(raw && raw.token || '').trim(),
            notes: String(raw && raw.notes || '').trim(),
            keywords: String(raw && raw.keywords || '').trim(),
            enabled: raw && raw.enabled === true,
            boundContactIds: normalizeBoundContactIds(raw && raw.boundContactIds),
            tools: Array.isArray(raw && raw.tools) ? raw.tools.map(normalizeTool) : [],
            lastToolSyncAt: Number(raw && raw.lastToolSyncAt || 0),
            lastToolSyncError: String(raw && raw.lastToolSyncError || '').trim(),
            lastHealth: String(raw && raw.lastHealth || '').trim(),
            lastConnectedAt: Number(raw && raw.lastConnectedAt || 0),
            lastUsedAt: Number(raw && raw.lastUsedAt || 0),
            updatedAt: Number(raw && raw.updatedAt || Date.now())
        };
    }

    function normalizeLog(raw) {
        return {
            id: String(raw && raw.id || '').trim() || createId(),
            time: Number(raw && raw.time || Date.now()),
            tone: ['idle', 'good', 'warn', 'error'].includes(String(raw && raw.tone || ''))
                ? String(raw.tone)
                : 'idle',
            text: String(raw && raw.text || '').trim() || '日志已更新'
        };
    }

    function normalizePreset(raw) {
        const next = raw && typeof raw === 'object' ? raw : {};
        return {
            id: String(next.id || '').trim() || createId(),
            name: String(next.name || '').trim() || '未命名预设',
            createdAt: Number(next.createdAt || Date.now()),
            servers: Array.isArray(next.servers) ? next.servers.map(normalizeServer) : []
        };
    }

    function normalizePersistedState(raw) {
        const next = raw && typeof raw === 'object' ? raw : {};
        const servers = Array.isArray(next.servers) ? next.servers.map(normalizeServer) : [];
        const logs = Array.isArray(next.logs) ? next.logs.slice(0, MAX_LOGS).map(normalizeLog) : [];
        const presets = Array.isArray(next.presets) ? next.presets.map(normalizePreset) : [];
        let activeServerId = String(next.activeServerId || '').trim();
        // Only repair a non-empty-but-missing id; keep an intentionally empty id
        // (empty = "new draft" mode) so it isn't forced back to the first server.
        if (activeServerId && servers.length > 0 && !servers.some((server) => server.id === activeServerId)) {
            activeServerId = servers[0].id;
        }
        return {
            servers,
            activeServerId,
            logs,
            presets
        };
    }

    function getAppState() {
        if (!window.iphoneSimState || typeof window.iphoneSimState !== 'object') {
            window.iphoneSimState = {};
        }
        const normalized = normalizePersistedState(window.iphoneSimState.mcp || {});
        window.iphoneSimState.mcp = normalized;
        return window.iphoneSimState.mcp;
    }

    function buildExampleServer() {
        return normalizeServer({
            name: '本地文件工具',
            transport: 'http',
            endpoint: 'http://127.0.0.1:3000/mcp',
            command: 'npx -y @modelcontextprotocol/server-filesystem',
            args: '--path C:\\Projects',
            notes: '示例节点。浏览器聊天里建议使用 HTTP / 可直连的 MCP 服务。',
            enabled: true
        });
    }

    function mirrorStateToLocalStorage() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(getAppState()));
        } catch (error) {
            console.warn('Failed to mirror MCP state to localStorage.', error);
        }
    }

    function persistState() {
        const appState = getAppState();
        appState.servers = Array.isArray(appState.servers) ? appState.servers.map(normalizeServer) : [];
        appState.logs = Array.isArray(appState.logs) ? appState.logs.slice(0, MAX_LOGS).map(normalizeLog) : [];
        appState.presets = Array.isArray(appState.presets) ? appState.presets.map(normalizePreset) : [];
        mirrorStateToLocalStorage();
        if (typeof window.saveConfig === 'function') {
            Promise.resolve(window.saveConfig()).catch((error) => {
                console.warn('Failed to persist MCP state into app config.', error);
            });
        }
    }

    function migrateLegacyStateIfNeeded() {
        const appState = getAppState();
        if (appState.servers.length > 0 || appState.logs.length > 0) return;

        const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
        if (!raw) {
            const example = buildExampleServer();
            appState.servers = [example];
            appState.activeServerId = example.id;
            appState.logs = [normalizeLog({ tone: 'good', text: '已创建示例 MCP 节点' })];
            persistState();
            return;
        }

        try {
            const parsed = JSON.parse(raw);
            const normalized = normalizePersistedState(parsed);
            appState.servers = normalized.servers;
            appState.activeServerId = normalized.activeServerId;
            appState.logs = normalized.logs;
        } catch (error) {
            const example = buildExampleServer();
            appState.servers = [example];
            appState.activeServerId = example.id;
            appState.logs = [normalizeLog({ tone: 'error', text: '旧 MCP 配置读取失败，已重置为示例节点' })];
        }

        if (appState.servers.length === 0) {
            const example = buildExampleServer();
            appState.servers = [example];
            appState.activeServerId = example.id;
        }
        persistState();
    }

    function getServers() {
        return getAppState().servers;
    }

    function getServerById(serverId) {
        const targetId = String(serverId || '').trim();
        return getServers().find((server) => server.id === targetId) || null;
    }

    function getActiveServer() {
        const appState = getAppState();
        return getServerById(appState.activeServerId);
    }

    function setActiveServerId(serverId) {
        const appState = getAppState();
        appState.activeServerId = String(serverId || '').trim();
    }

    function formatTime(timestamp) {
        if (!timestamp) return '--';
        const date = new Date(Number(timestamp) || Date.now());
        const month = `${date.getMonth() + 1}`.padStart(2, '0');
        const day = `${date.getDate()}`.padStart(2, '0');
        const hour = `${date.getHours()}`.padStart(2, '0');
        const minute = `${date.getMinutes()}`.padStart(2, '0');
        return `${month}-${day} ${hour}:${minute}`;
    }

    function transportLabel(transport) {
        if (transport === 'stdio') return 'stdio';
        if (transport === 'sse') return 'SSE';
        return 'HTTP';
    }

    function describeServer(server) {
        if (!server) return '未选择节点';
        if (server.transport === 'stdio') {
            return server.command || '需要本地命令';
        }
        return server.endpoint || '未填写地址';
    }

    function canUseServerInBrowser(server) {
        if (!server) return false;
        if (server.transport === 'stdio') return false;
        return !!String(server.endpoint || '').trim();
    }

    function getBrowserSupportText(server) {
        if (!server) return '未选择节点';
        if (server.transport === 'stdio') {
            return '浏览器不能直接启动 stdio，需要后端代理';
        }
        if (!server.endpoint) {
            return '缺少服务地址';
        }
        if (server.transport === 'sse') {
            return 'SSE 以浏览器直连模式尝试接入';
        }
        return '可用于浏览器聊天调用';
    }

    function setStatus(tone, text, hint) {
        runtime.statusTone = tone;
        runtime.statusText = text;
        runtime.statusHint = hint || '';

        const statusTextEl = $('mcp-status-text');
        const statusHintEl = $('mcp-status-hint');
        if (statusTextEl) {
            statusTextEl.textContent = text;
            statusTextEl.className = `mcp-stat-value mcp-status-${tone}`;
        }
        if (statusHintEl) {
            statusHintEl.textContent = hint || '';
        }
    }

    function pushLog(text, tone = 'idle') {
        const appState = getAppState();
        appState.logs.unshift(normalizeLog({ text, tone }));
        appState.logs = appState.logs.slice(0, MAX_LOGS);
        renderLogs();
        persistState();
    }

    function updateServer(serverId, updater) {
        const appState = getAppState();
        const index = appState.servers.findIndex((server) => server.id === serverId);
        if (index < 0) return null;
        const current = appState.servers[index];
        const draft = updater(normalizeServer(current));
        if (!draft) return null;
        const nextServer = normalizeServer({
            ...current,
            ...draft,
            id: current.id
        });
        appState.servers[index] = nextServer;
        return nextServer;
    }

    function getBindableContacts() {
        const contacts = Array.isArray(window.iphoneSimState && window.iphoneSimState.contacts)
            ? window.iphoneSimState.contacts.slice()
            : [];
        return contacts
            .filter((contact) => contact && String(contact.id || '').trim())
            .sort((a, b) => {
                const nameA = String(a.remark || a.nickname || a.name || a.id || '').trim();
                const nameB = String(b.remark || b.nickname || b.name || b.id || '').trim();
                return nameA.localeCompare(nameB, 'zh-Hans-CN');
            });
    }

    function readForm() {
        return {
            name: String($('mcp-server-name') && $('mcp-server-name').value || '').trim(),
            transport: String($('mcp-server-transport') && $('mcp-server-transport').value || 'http').trim(),
            endpoint: String($('mcp-server-endpoint') && $('mcp-server-endpoint').value || '').trim(),
            command: String($('mcp-server-command') && $('mcp-server-command').value || '').trim(),
            args: String($('mcp-server-args') && $('mcp-server-args').value || '').trim(),
            token: String($('mcp-server-token') && $('mcp-server-token').value || '').trim(),
            notes: String($('mcp-server-notes') && $('mcp-server-notes').value || '').trim(),
            keywords: String($('mcp-server-keywords') && $('mcp-server-keywords').value || '').trim(),
            enabled: !!($('mcp-server-enabled') && $('mcp-server-enabled').checked)
        };
    }

    function applyForm(server) {
        $('mcp-server-name').value = server && server.name || '';
        $('mcp-server-transport').value = server && server.transport || 'http';
        $('mcp-server-endpoint').value = server && server.endpoint || '';
        $('mcp-server-command').value = server && server.command || '';
        $('mcp-server-args').value = server && server.args || '';
        $('mcp-server-token').value = server && server.token || '';
        $('mcp-server-notes').value = server && server.notes || '';
        if ($('mcp-server-keywords')) $('mcp-server-keywords').value = server && server.keywords || '';
        $('mcp-server-enabled').checked = !!(server && server.enabled);
        updateTransportVisibility();
        renderPreview();
    }

    function updateTransportVisibility() {
        const transport = String($('mcp-server-transport') && $('mcp-server-transport').value || 'http');
        const showStdio = transport === 'stdio';

        const endpointField = $('mcp-endpoint-field');
        const commandField = $('mcp-command-field');
        const argsField = $('mcp-args-field');

        if (endpointField) endpointField.style.display = showStdio ? 'none' : 'block';
        if (commandField) commandField.style.display = showStdio ? 'block' : 'none';
        if (argsField) argsField.style.display = showStdio ? 'block' : 'none';
    }

    function renderLogs() {
        const list = $('mcp-log-list');
        if (!list) return;
        const logs = getAppState().logs;

        if (!logs.length) {
            list.innerHTML = '<div class="mcp-empty">还没有 MCP 运行日志</div>';
            return;
        }

        list.innerHTML = logs.map((log) => `
            <div class="mcp-log-item tone-${escapeHtml(log.tone)}">
                <span class="mcp-log-time">${escapeHtml(formatTime(log.time))}</span>
                <span class="mcp-log-text">${escapeHtml(log.text)}</span>
            </div>
        `).join('');
    }

    function renderServers() {
        const list = $('mcp-server-list');
        if (!list) return;
        const servers = getServers();

        if (!servers.length) {
            list.innerHTML = '<div class="mcp-empty">暂无已保存节点</div>';
            return;
        }

        const activeServer = getActiveServer();

        list.innerHTML = servers.map((server) => {
            const isActive = !!(activeServer && activeServer.id === server.id);
            const toolCount = Array.isArray(server.tools) ? server.tools.length : 0;
            const bindCount = Array.isArray(server.boundContactIds) ? server.boundContactIds.length : 0;
            const keywords = String(server.keywords || '').trim();
            const healthText = server.lastToolSyncError
                ? `tools 刷新失败`
                : (toolCount > 0 ? `${toolCount} 个 tools` : 'tools 未同步');
            return `
                <article class="mcp-server-item ${isActive ? 'active' : ''}" data-server-id="${escapeHtml(server.id)}">
                    <div class="mcp-server-item-head">
                        <div>
                            <div class="mcp-server-name">${escapeHtml(server.name)}${isActive ? ' <span class="mcp-server-editing">编辑中</span>' : ''}</div>
                            <div class="mcp-server-meta">${escapeHtml(transportLabel(server.transport))} · ${escapeHtml(describeServer(server))}</div>
                        </div>
                        <label class="mcp-switch" title="${server.enabled ? '已启用，点击停用' : '已停用，点击启用'}">
                            <input type="checkbox" data-action="toggle-enable" ${server.enabled ? 'checked' : ''}>
                            <span class="mcp-switch-track"></span>
                        </label>
                    </div>
                    <div class="mcp-server-extra">
                        <span>${server.enabled ? '已启用' : '已停用'}</span>
                        <span>联系人 ${escapeHtml(String(bindCount))}</span>
                        <span>${escapeHtml(healthText)}</span>
                        <span>关键词：${keywords ? escapeHtml(keywords) : '未设置'}</span>
                    </div>
                    <div class="mcp-server-actions">
                        <button type="button" class="mcp-mini-btn primary" data-action="edit">编辑</button>
                        <button type="button" class="mcp-mini-btn" data-action="refresh-tools">刷新 tools</button>
                        <button type="button" class="mcp-mini-btn danger" data-action="delete">删除</button>
                    </div>
                </article>
            `;
        }).join('');
    }

    function renderContactBindings() {
        const list = $('mcp-contact-bind-list');
        if (!list) return;

        const activeServer = getActiveServer();
        if (!activeServer) {
            list.innerHTML = '<div class="mcp-empty">先保存一个节点，再给它绑定联系人</div>';
            return;
        }

        const contacts = getBindableContacts();
        if (!contacts.length) {
            list.innerHTML = '<div class="mcp-empty">当前没有可绑定联系人</div>';
            return;
        }

        const boundSet = new Set(normalizeBoundContactIds(activeServer.boundContactIds));
        list.innerHTML = contacts.map((contact) => {
            const contactId = String(contact.id);
            const checked = boundSet.has(contactId);
            const contactName = String(contact.remark || contact.nickname || contact.name || contact.id || '联系人').trim();
            const contactType = contact.chatType === 'group' ? '群聊' : (contact.group || '单聊');
            return `
                <button class="mcp-contact-chip${checked ? ' is-selected' : ''}" type="button" data-contact-id="${escapeHtml(contactId)}">
                    <span class="mcp-contact-chip-name">${escapeHtml(contactName)}</span>
                    <span class="mcp-contact-chip-meta">${escapeHtml(contactType)}</span>
                </button>
            `;
        }).join('');
    }

    function renderToolList() {
        const list = $('mcp-tool-list');
        if (!list) return;

        const activeServer = getActiveServer();
        if (!activeServer) {
            list.innerHTML = '<div class="mcp-empty">请选择一个节点查看它的 tools</div>';
            return;
        }

        const tools = Array.isArray(activeServer.tools) ? activeServer.tools : [];
        if (!tools.length) {
            const errorText = activeServer.lastToolSyncError
                ? `上次同步失败：${activeServer.lastToolSyncError}`
                : '还没有同步到 tools，点一下“刷新 tools”试试。';
            list.innerHTML = `<div class="mcp-empty">${escapeHtml(errorText)}</div>`;
            return;
        }

        list.innerHTML = tools.map((tool) => {
            const propertyKeys = tool.inputSchema && tool.inputSchema.properties && typeof tool.inputSchema.properties === 'object'
                ? Object.keys(tool.inputSchema.properties)
                : [];
            return `
                <article class="mcp-tool-card">
                    <div class="mcp-tool-name">${escapeHtml(tool.name)}</div>
                    <div class="mcp-tool-desc">${escapeHtml(tool.description || '无描述')}</div>
                    <div class="mcp-tool-meta">${escapeHtml(propertyKeys.length ? `参数：${propertyKeys.join(', ')}` : '无需固定参数结构或未声明参数')}</div>
                </article>
            `;
        }).join('');
    }

    function renderPreview() {
        const preview = $('mcp-config-preview');
        if (!preview) return;
        const activeServer = getActiveServer();
        const form = readForm();
        const payload = {
            id: activeServer ? activeServer.id : '(new)',
            name: form.name || '未命名节点',
            transport: form.transport,
            endpoint: form.endpoint,
            command: form.command,
            args: form.args,
            token: form.token ? '***' : '',
            enabled: !!form.enabled,
            boundContactIds: activeServer ? activeServer.boundContactIds : [],
            toolNames: activeServer && Array.isArray(activeServer.tools)
                ? activeServer.tools.map((tool) => tool.name)
                : [],
            notes: form.notes,
            keywords: form.keywords
        };
        preview.textContent = JSON.stringify(payload, null, 2);
    }

    function refreshSummary() {
        const active = getActiveServer();
        const servers = getServers();
        const serverCountEl = $('mcp-server-count');
        const activeNameEl = $('mcp-active-server-name');

        if (serverCountEl) serverCountEl.textContent = String(servers.length);
        if (activeNameEl) activeNameEl.textContent = active ? active.name : '未选择';

        if (!active && !servers.length) {
            setStatus('idle', '未配置', '先创建一个 MCP 节点，再绑定到联系人。');
            return;
        }

        if (!active) {
            setStatus('warn', '未选择', '请选择一个节点继续配置。');
            return;
        }

        if (!active.enabled) {
            setStatus('warn', '未启用', `${active.name} 已保存，但还没有启用到聊天。`);
            return;
        }

        const toolCount = Array.isArray(active.tools) ? active.tools.length : 0;
        const bindCount = Array.isArray(active.boundContactIds) ? active.boundContactIds.length : 0;
        setStatus(
            'good',
            canUseServerInBrowser(active) ? '已接入' : '待桥接',
            `${active.name} · ${toolCount} 个 tools · 绑定 ${bindCount} 个联系人`
        );
    }

    function selectServer(serverId) {
        const server = getServerById(serverId);
        setActiveServerId(server ? server.id : '');
        if (server) {
            applyForm(server);
        } else {
            applyForm({
                name: '',
                transport: 'http',
                endpoint: '',
                command: '',
                args: '',
                token: '',
                notes: '',
                enabled: false
            });
        }
        renderServers();
        renderContactBindings();
        renderToolList();
        renderPreview();
        refreshSummary();
        persistState();
    }

    function upsertServerFromForm(options = {}) {
        const form = readForm();
        if (!form.name) {
            pushLog('请先填写节点名称', 'warn');
            return null;
        }
        if (form.transport !== 'stdio' && !form.endpoint) {
            pushLog('HTTP / SSE 节点需要填写服务地址', 'warn');
            return null;
        }
        if (form.transport === 'stdio' && !form.command) {
            pushLog('stdio 节点需要填写启动命令', 'warn');
            return null;
        }

        const currentId = String(getAppState().activeServerId || '').trim();
        const existing = currentId ? getServerById(currentId) : null;
        const nextId = existing ? existing.id : createId();
        const payload = normalizeServer({
            ...existing,
            ...form,
            id: nextId,
            enabled: options.forceEnabled === true ? true : form.enabled,
            boundContactIds: existing ? existing.boundContactIds : [],
            tools: existing ? existing.tools : [],
            lastToolSyncAt: existing ? existing.lastToolSyncAt : 0,
            lastToolSyncError: existing ? existing.lastToolSyncError : '',
            lastHealth: existing ? existing.lastHealth : '',
            lastConnectedAt: existing ? existing.lastConnectedAt : 0,
            lastUsedAt: existing ? existing.lastUsedAt : 0,
            updatedAt: Date.now()
        });

        const appState = getAppState();
        const index = appState.servers.findIndex((server) => server.id === payload.id);
        if (index >= 0) {
            appState.servers[index] = payload;
        } else {
            appState.servers.unshift(payload);
        }
        appState.activeServerId = payload.id;
        persistState();
        renderServers();
        renderContactBindings();
        renderToolList();
        renderPreview();
        refreshSummary();
        return payload;
    }

    function handleSave() {
        const server = upsertServerFromForm();
        if (!server) return;
        pushLog(`已保存节点「${server.name}」`, 'good');
    }

    async function handleConnect() {
        const server = upsertServerFromForm({ forceEnabled: true });
        if (!server) return;
        updateServer(server.id, (draft) => ({
            ...draft,
            enabled: true,
            lastConnectedAt: Date.now(),
            lastHealth: 'connected'
        }));
        persistState();
        refreshSummary();
        renderServers();
        renderPreview();
        pushLog(`已启用节点「${server.name}」`, 'good');
        try {
            await discoverServerTools(server.id, { silentSuccessLog: true });
        } catch (error) {}
    }

    function handleDisconnect() {
        const activeServer = getActiveServer();
        if (!activeServer) {
            setStatus('idle', '未连接', '当前没有启用中的 MCP 节点。');
            return;
        }
        updateServer(activeServer.id, (draft) => ({
            ...draft,
            enabled: false,
            lastHealth: 'disabled'
        }));
        persistState();
        renderServers();
        renderPreview();
        refreshSummary();
        pushLog(`已停用节点「${activeServer.name}」`, 'idle');
    }

    function handleDemoFill() {
        applyForm(buildExampleServer());
        setStatus('idle', '示例已填入', '可以直接改成你自己的 MCP 服务地址再保存。');
        renderPreview();
    }

    function handleNewDraft() {
        setActiveServerId('');
        applyForm({
            name: '',
            transport: 'http',
            endpoint: '',
            command: '',
            args: '',
            token: '',
            notes: '',
            enabled: false
        });
        renderServers();
        renderContactBindings();
        renderToolList();
        setStatus('warn', '草稿中', '填写后点“保存配置”即可创建新节点。');
        renderPreview();
    }

    function toggleContactBinding(contactId, shouldBind) {
        const activeServer = getActiveServer();
        if (!activeServer) return false;
        const targetId = String(contactId || '').trim();
        if (!targetId) return false;
        const current = new Set(normalizeBoundContactIds(activeServer.boundContactIds));
        if (shouldBind) {
            current.add(targetId);
        } else {
            current.delete(targetId);
        }
        updateServer(activeServer.id, (draft) => ({
            ...draft,
            boundContactIds: Array.from(current),
            updatedAt: Date.now()
        }));
        persistState();
        renderContactBindings();
        renderPreview();
        refreshSummary();
        return true;
    }

    function setAllBindings(enabled) {
        const activeServer = getActiveServer();
        if (!activeServer) return;
        const nextIds = enabled ? getBindableContacts().map((contact) => String(contact.id)) : [];
        updateServer(activeServer.id, (draft) => ({
            ...draft,
            boundContactIds: nextIds,
            updatedAt: Date.now()
        }));
        persistState();
        renderContactBindings();
        renderPreview();
        refreshSummary();
        pushLog(enabled ? `已将「${activeServer.name}」绑定到全部联系人` : `已清空「${activeServer.name}」的联系人绑定`, 'idle');
    }

    function sanitizeSchema(rawSchema) {
        if (!rawSchema || typeof rawSchema !== 'object' || Array.isArray(rawSchema)) {
            return { type: 'object', properties: {}, additionalProperties: true };
        }
        const next = { ...rawSchema };
        if (!next.type) next.type = 'object';
        if (next.type === 'object' && (!next.properties || typeof next.properties !== 'object' || Array.isArray(next.properties))) {
            next.properties = {};
        }
        return next;
    }

    function buildFetchHeaders(server, sessionId) {
        const headers = {
            'Content-Type': 'application/json',
            'Accept': 'application/json, text/event-stream'
        };
        const token = String(server && server.token || '').trim();
        if (token) {
            headers.Authorization = `Bearer ${token}`;
        }
        if (sessionId) {
            headers['MCP-Session-Id'] = sessionId;
        }
        return headers;
    }

    function parseSseJsonEnvelope(rawText) {
        const text = String(rawText || '').trim();
        if (!text) return null;
        const lines = text.split(/\r?\n/);
        const payloads = [];
        let current = [];
        lines.forEach((line) => {
            if (!line.trim()) {
                if (current.length) {
                    payloads.push(current.join('\n'));
                    current = [];
                }
                return;
            }
            if (line.startsWith('data:')) {
                current.push(line.slice(5).trim());
            }
        });
        if (current.length) payloads.push(current.join('\n'));
        for (let i = payloads.length - 1; i >= 0; i--) {
            const candidate = payloads[i];
            try {
                return JSON.parse(candidate);
            } catch (error) {}
        }
        return null;
    }

    async function mcpJsonRpc(server, method, params, options = {}) {
        if (!server) {
            throw new Error('MCP 节点不存在');
        }
        if (!canUseServerInBrowser(server)) {
            throw new Error(getBrowserSupportText(server));
        }

        const session = runtime.sessions[server.id] || {};
        const payload = {
            jsonrpc: '2.0',
            method
        };
        if (params !== undefined) {
            payload.params = params;
        }
        if (!options.notification) {
            payload.id = createRpcId();
        }

        const response = await fetch(server.endpoint, {
            method: 'POST',
            headers: buildFetchHeaders(server, session.sessionId),
            body: JSON.stringify(payload)
        });

        const returnedSessionId = response.headers.get('mcp-session-id') || response.headers.get('MCP-Session-Id') || session.sessionId || '';
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        if (options.notification) {
            if (!runtime.sessions[server.id]) runtime.sessions[server.id] = {};
            runtime.sessions[server.id].sessionId = returnedSessionId || runtime.sessions[server.id].sessionId || '';
            return { result: null, raw: null, sessionId: returnedSessionId };
        }

        const rawText = await response.text();
        if (!rawText.trim()) {
            return { result: null, raw: null, sessionId: returnedSessionId };
        }

        let rawData = null;
        try {
            rawData = JSON.parse(rawText);
        } catch (error) {
            rawData = parseSseJsonEnvelope(rawText);
        }

        if (!rawData) {
            throw new Error('MCP 返回内容无法解析');
        }
        if (rawData.error) {
            throw new Error(String(rawData.error.message || JSON.stringify(rawData.error)));
        }

        if (!runtime.sessions[server.id]) runtime.sessions[server.id] = {};
        runtime.sessions[server.id].sessionId = returnedSessionId || runtime.sessions[server.id].sessionId || '';
        return {
            result: rawData.result !== undefined ? rawData.result : rawData,
            raw: rawData,
            sessionId: returnedSessionId
        };
    }

    async function ensureServerSession(server) {
        if (!server) {
            throw new Error('MCP 节点不存在');
        }
        if (!canUseServerInBrowser(server)) {
            throw new Error(getBrowserSupportText(server));
        }

        const existing = runtime.sessions[server.id];
        if (existing && existing.ready) {
            return existing;
        }

        const initialized = await mcpJsonRpc(server, 'initialize', {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: {
                tools: { listChanged: true }
            },
            clientInfo: {
                name: 'z1han-main-web',
                version: '1.0.0'
            }
        });

        runtime.sessions[server.id] = {
            ready: true,
            sessionId: initialized.sessionId || '',
            serverInfo: initialized.result && initialized.result.serverInfo ? initialized.result.serverInfo : null,
            capabilities: initialized.result && initialized.result.capabilities ? initialized.result.capabilities : {}
        };

        try {
            await mcpJsonRpc(server, 'notifications/initialized', {}, { notification: true });
        } catch (error) {
            console.warn('Failed to send MCP initialized notification.', error);
        }

        return runtime.sessions[server.id];
    }

    async function listServerTools(server) {
        await ensureServerSession(server);
        const collected = [];
        let cursor = '';
        let guard = 0;

        while (guard < 20) {
            guard += 1;
            const response = await mcpJsonRpc(server, 'tools/list', cursor ? { cursor } : {});
            const result = response && response.result && typeof response.result === 'object' ? response.result : {};
            const nextTools = Array.isArray(result.tools) ? result.tools.map(normalizeTool) : [];
            collected.push(...nextTools);
            const nextCursor = String(result.nextCursor || result.next_cursor || '').trim();
            if (!nextCursor) break;
            cursor = nextCursor;
        }

        return collected;
    }

    async function discoverServerTools(serverId, options = {}) {
        const server = getServerById(serverId);
        if (!server) {
            throw new Error('要刷新的 MCP 节点不存在');
        }
        if (!canUseServerInBrowser(server)) {
            const hint = getBrowserSupportText(server);
            updateServer(server.id, (draft) => ({
                ...draft,
                lastToolSyncError: hint,
                lastHealth: 'unsupported'
            }));
            persistState();
            renderServers();
            renderToolList();
            refreshSummary();
            throw new Error(hint);
        }

        setStatus('idle', '同步中', `正在从 ${server.name} 拉取 tools...`);
        try {
            const tools = await listServerTools(server);
            updateServer(server.id, (draft) => ({
                ...draft,
                tools,
                lastToolSyncAt: Date.now(),
                lastToolSyncError: '',
                lastHealth: 'ok',
                updatedAt: Date.now()
            }));
            persistState();
            renderServers();
            renderToolList();
            renderPreview();
            refreshSummary();
            if (!options.silentSuccessLog) {
                pushLog(`已同步「${server.name}」的 ${tools.length} 个 tools`, 'good');
            }
            return tools;
        } catch (error) {
            const errorText = String(error && error.message || error || '未知错误');
            runtime.sessions[server.id] = null;
            updateServer(server.id, (draft) => ({
                ...draft,
                lastToolSyncError: errorText,
                lastHealth: 'error',
                updatedAt: Date.now()
            }));
            persistState();
            renderServers();
            renderToolList();
            renderPreview();
            refreshSummary();
            pushLog(`同步「${server.name}」tools 失败：${errorText}`, 'error');
            throw error;
        }
    }

    function serializeToolResultContent(result) {
        if (!result || typeof result !== 'object') {
            return '工具调用完成，但没有返回结构化结果。';
        }

        const segments = [];
        const contentList = Array.isArray(result.content) ? result.content : [];
        contentList.forEach((item) => {
            if (!item || typeof item !== 'object') return;
            if (typeof item.text === 'string' && item.text.trim()) {
                segments.push(item.text.trim());
                return;
            }
            if (item.type === 'resource' && item.resource && typeof item.resource === 'object') {
                if (typeof item.resource.text === 'string' && item.resource.text.trim()) {
                    segments.push(item.resource.text.trim());
                    return;
                }
                if (typeof item.resource.uri === 'string' && item.resource.uri.trim()) {
                    segments.push(`resource: ${item.resource.uri.trim()}`);
                    return;
                }
            }
            try {
                segments.push(JSON.stringify(item, null, 2));
            } catch (error) {}
        });

        if (result.structuredContent && typeof result.structuredContent === 'object') {
            try {
                segments.push(JSON.stringify(result.structuredContent, null, 2));
            } catch (error) {}
        }

        if (!segments.length && typeof result.content === 'string' && result.content.trim()) {
            segments.push(result.content.trim());
        }

        return segments.join('\n\n').trim() || '工具调用完成。';
    }

    async function callTool(serverId, toolName, args) {
        const server = getServerById(serverId);
        if (!server) {
            throw new Error('MCP 节点不存在');
        }
        await ensureServerSession(server);
        const response = await mcpJsonRpc(server, 'tools/call', {
            name: toolName,
            arguments: args && typeof args === 'object' ? args : {}
        });
        updateServer(server.id, (draft) => ({
            ...draft,
            lastUsedAt: Date.now(),
            lastHealth: 'ok',
            lastToolSyncError: '',
            updatedAt: Date.now()
        }));
        persistState();
        renderServers();
        renderPreview();
        return {
            rawResult: response.result,
            text: serializeToolResultContent(response.result)
        };
    }

    function sanitizeFunctionNamePart(value) {
        const raw = String(value || '').trim().toLowerCase();
        const cleaned = raw.replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
        return cleaned || 'tool';
    }

    function getBoundEnabledServers(contactId) {
        const normalizedContactId = String(contactId || '').trim();
        if (!normalizedContactId) return [];
        return getServers().filter((server) => (
            server
            && server.enabled
            && Array.isArray(server.boundContactIds)
            && server.boundContactIds.includes(normalizedContactId)
        ));
    }

    async function prepareChatTooling(contactId, options = {}) {
        const autoDiscover = options && options.autoDiscover !== false;
        const userText = options && options.userText;
        const servers = getBoundEnabledServers(contactId)
            .filter((server) => serverMatchesKeywords(server, userText));
        const tools = [];
        const toolIndex = Object.create(null);
        const usedNames = new Set();

        for (const server of servers) {
            let serverTools = Array.isArray(server.tools) ? server.tools.map(normalizeTool) : [];
            if (!serverTools.length && autoDiscover) {
                try {
                    serverTools = await discoverServerTools(server.id, { silentSuccessLog: true });
                } catch (error) {
                    console.warn('Failed to auto-discover MCP tools for chat.', error);
                    serverTools = [];
                }
            }
            if (!serverTools.length) continue;

            serverTools.forEach((tool) => {
                const baseName = `mcp_${sanitizeFunctionNamePart(server.name).slice(0, 18)}_${sanitizeFunctionNamePart(tool.name).slice(0, 28)}`;
                let nextName = baseName.slice(0, 60) || `mcp_${createId().slice(-8)}`;
                let suffix = 2;
                while (usedNames.has(nextName)) {
                    nextName = `${baseName.slice(0, 54)}_${suffix}`;
                    suffix += 1;
                }
                usedNames.add(nextName);

                tools.push({
                    type: 'function',
                    function: {
                        name: nextName,
                        description: `[MCP:${server.name}] ${tool.description || tool.name}`.slice(0, 1024),
                        parameters: sanitizeSchema(tool.inputSchema)
                    }
                });
                toolIndex[nextName] = {
                    serverId: server.id,
                    serverName: server.name,
                    toolName: tool.name
                };
            });
        }

        return { tools, toolIndex, servers };
    }

    async function executeChatToolCall(toolCall, toolIndex) {
        const functionPayload = toolCall && toolCall.function && typeof toolCall.function === 'object'
            ? toolCall.function
            : {};
        const openAiName = String(functionPayload.name || '').trim();
        const meta = toolIndex && toolIndex[openAiName] ? toolIndex[openAiName] : null;
        if (!meta) {
            return {
                ok: false,
                content: `MCP tool mapping not found for ${openAiName}.`
            };
        }

        let parsedArgs = {};
        if (typeof functionPayload.arguments === 'string' && functionPayload.arguments.trim()) {
            try {
                parsedArgs = JSON.parse(functionPayload.arguments);
            } catch (error) {
                parsedArgs = {
                    _raw: functionPayload.arguments
                };
            }
        } else if (functionPayload.arguments && typeof functionPayload.arguments === 'object') {
            parsedArgs = functionPayload.arguments;
        }

        try {
            const result = await callTool(meta.serverId, meta.toolName, parsedArgs);
            pushLog(`AI 调用了「${meta.serverName} / ${meta.toolName}」`, 'good');
            return {
                ok: true,
                content: result.text,
                rawResult: result.rawResult,
                meta
            };
        } catch (error) {
            const errorText = String(error && error.message || error || '未知错误');
            pushLog(`AI 调用「${meta.serverName} / ${meta.toolName}」失败：${errorText}`, 'error');
            return {
                ok: false,
                content: `MCP tool call failed: ${errorText}`,
                meta
            };
        }
    }

    function getToolSummariesForContact(contactId, options = {}) {
        const userText = options && options.userText;
        return getBoundEnabledServers(contactId)
            .filter((server) => serverMatchesKeywords(server, userText))
            .map((server) => ({
            serverId: server.id,
            serverName: server.name,
            tools: Array.isArray(server.tools) ? server.tools.map((tool) => ({
                name: tool.name,
                description: tool.description
            })) : []
        }));
    }

    async function handleRefreshTools() {
        const activeServer = getActiveServer();
        if (!activeServer) {
            pushLog('请先选择一个节点再刷新 tools', 'warn');
            return;
        }
        try {
            await discoverServerTools(activeServer.id);
        } catch (error) {}
    }

    function serverDraftFromEntry(name, entry) {
        const raw = entry && typeof entry === 'object' ? entry : {};
        const url = String(raw.url || raw.endpoint || raw.serverUrl || raw.baseUrl || '').trim();
        const command = String(raw.command || '').trim();
        let args = raw.args;
        if (Array.isArray(args)) {
            args = args.map((item) => String(item)).join(' ');
        } else {
            args = String(args || '').trim();
        }

        let transport = String(raw.transport || raw.type || '').toLowerCase().trim();
        if (transport === 'streamable-http' || transport === 'streamablehttp' || transport === 'streamable_http' || transport === 'streamable') {
            transport = 'http';
        }
        if (!['http', 'sse', 'stdio'].includes(transport)) {
            if (command) {
                transport = 'stdio';
            } else if (/\bsse\b|\/sse(\/|\?|$)/i.test(url)) {
                transport = 'sse';
            } else {
                transport = 'http';
            }
        }

        let token = String(raw.token || raw.apiKey || raw.api_key || '').trim();
        const headers = raw.headers && typeof raw.headers === 'object' && !Array.isArray(raw.headers) ? raw.headers : null;
        if (!token && headers) {
            const authKey = Object.keys(headers).find((key) => key.toLowerCase() === 'authorization');
            if (authKey) {
                token = String(headers[authKey] || '').replace(/^Bearer\s+/i, '').trim();
            }
        }

        return {
            name: String(name || raw.name || '').trim() || '未命名节点',
            transport,
            endpoint: transport === 'stdio' ? '' : url,
            command,
            args,
            token,
            notes: String(raw.notes || raw.description || '').trim(),
            keywords: String(raw.keywords || raw.triggers || '').trim(),
            enabled: raw.enabled === true
        };
    }

    function parseMcpImportText(text) {
        const trimmed = String(text || '').trim();
        if (!trimmed) {
            throw new Error('请先粘贴 JSON 内容');
        }

        let parsed;
        try {
            parsed = JSON.parse(trimmed);
        } catch (error) {
            throw new Error(`JSON 解析失败：${(error && error.message) || '格式不正确'}`);
        }

        const drafts = [];
        if (parsed && typeof parsed === 'object' && parsed.mcpServers && typeof parsed.mcpServers === 'object' && !Array.isArray(parsed.mcpServers)) {
            Object.keys(parsed.mcpServers).forEach((key) => {
                drafts.push(serverDraftFromEntry(key, parsed.mcpServers[key]));
            });
        } else if (parsed && typeof parsed === 'object' && Array.isArray(parsed.servers)) {
            parsed.servers.forEach((entry) => drafts.push(serverDraftFromEntry(entry && entry.name, entry)));
        } else if (Array.isArray(parsed)) {
            parsed.forEach((entry) => drafts.push(serverDraftFromEntry(entry && entry.name, entry)));
        } else if (parsed && typeof parsed === 'object') {
            const looksLikeSingleServer = parsed.url || parsed.endpoint || parsed.command || parsed.transport || parsed.type;
            if (looksLikeSingleServer) {
                drafts.push(serverDraftFromEntry(parsed.name, parsed));
            } else {
                Object.keys(parsed).forEach((key) => {
                    const entry = parsed[key];
                    if (entry && typeof entry === 'object') {
                        drafts.push(serverDraftFromEntry(key, entry));
                    }
                });
            }
        }

        if (!drafts.length) {
            throw new Error('没有解析到有效的 MCP 节点');
        }
        return drafts;
    }

    function handleImportJson() {
        const input = $('mcp-import-input');
        if (!input) return;

        let drafts;
        try {
            drafts = parseMcpImportText(input.value);
        } catch (error) {
            const message = String((error && error.message) || error || '导入失败');
            setStatus('warn', '导入失败', message);
            pushLog(`导入 JSON 失败：${message}`, 'error');
            return;
        }

        const appState = getAppState();
        let created = 0;
        let updated = 0;
        let firstId = '';

        drafts.forEach((draft) => {
            const existing = appState.servers.find((server) => server.name === draft.name);
            if (existing) {
                const merged = normalizeServer({
                    ...existing,
                    ...draft,
                    id: existing.id,
                    enabled: existing.enabled,
                    boundContactIds: existing.boundContactIds,
                    tools: existing.tools,
                    updatedAt: Date.now()
                });
                const index = appState.servers.findIndex((server) => server.id === existing.id);
                appState.servers[index] = merged;
                if (!firstId) firstId = merged.id;
                updated += 1;
            } else {
                const nextServer = normalizeServer({
                    ...draft,
                    id: createId(),
                    updatedAt: Date.now()
                });
                appState.servers.unshift(nextServer);
                if (!firstId) firstId = nextServer.id;
                created += 1;
            }
        });

        if (firstId) appState.activeServerId = firstId;
        persistState();
        input.value = '';
        selectServer(appState.activeServerId);
        pushLog(`已从 JSON 导入 ${drafts.length} 个节点（新增 ${created}，更新 ${updated}）`, 'good');
        setStatus('good', '导入完成', `新增 ${created} 个、更新 ${updated} 个节点。`);
    }

    function buildStandardMcpJson(serverList) {
        const servers = Array.isArray(serverList) ? serverList : getServers();
        const mcpServers = {};
        servers.forEach((server) => {
            const key = String(server.name || server.id || '未命名节点').trim() || '未命名节点';
            const entry = {};
            if (server.transport === 'stdio') {
                entry.type = 'stdio';
                if (server.command) entry.command = server.command;
                if (server.args) entry.args = server.args.split(/\s+/).filter(Boolean);
            } else {
                entry.type = server.transport === 'sse' ? 'sse' : 'http';
                if (server.endpoint) entry.url = server.endpoint;
                if (server.token) entry.headers = { Authorization: `Bearer ${server.token}` };
            }
            if (server.notes) entry.notes = server.notes;
            if (server.keywords) entry.keywords = server.keywords;
            mcpServers[key] = entry;
        });
        return JSON.stringify({ mcpServers }, null, 2);
    }

    async function copyTextToClipboard(text) {
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(text);
                return true;
            }
        } catch (error) {
            console.warn('Failed to copy MCP JSON to clipboard.', error);
        }
        return false;
    }

    async function handleCopyConfigJson() {
        const servers = getServers();
        if (!servers.length) {
            pushLog('当前没有可复制的节点配置', 'warn');
            return;
        }
        const json = buildStandardMcpJson(servers);
        const copied = await copyTextToClipboard(json);
        const input = $('mcp-import-input');
        if (input) input.value = json;
        pushLog(copied ? '已复制当前 MCP 配置 JSON' : '已生成当前 MCP 配置 JSON（见上方文本框）', 'good');
        setStatus('good', copied ? '已复制' : '已生成', copied ? '配置 JSON 已复制到剪贴板。' : '已填入文本框，可手动复制。');
    }

    function bindEvents() {
        const transport = $('mcp-server-transport');
        if (transport && !transport.dataset.bound) {
            transport.addEventListener('change', () => {
                updateTransportVisibility();
                renderPreview();
            });
            transport.dataset.bound = '1';
        }

        [
            'mcp-server-name',
            'mcp-server-endpoint',
            'mcp-server-command',
            'mcp-server-args',
            'mcp-server-token',
            'mcp-server-notes',
            'mcp-server-keywords',
            'mcp-server-enabled'
        ].forEach((id) => {
            const input = $(id);
            if (!input || input.dataset.bound) return;
            const eventName = input.type === 'checkbox' ? 'change' : 'input';
            input.addEventListener(eventName, renderPreview);
            input.dataset.bound = '1';
        });

        const saveBtn = $('mcp-save-btn');
        if (saveBtn && !saveBtn.dataset.bound) {
            saveBtn.addEventListener('click', handleSave);
            saveBtn.dataset.bound = '1';
        }

        const connectBtn = $('mcp-connect-btn');
        if (connectBtn && !connectBtn.dataset.bound) {
            connectBtn.addEventListener('click', () => {
                void handleConnect();
            });
            connectBtn.dataset.bound = '1';
        }

        const disconnectBtn = $('mcp-disconnect-btn');
        if (disconnectBtn && !disconnectBtn.dataset.bound) {
            disconnectBtn.addEventListener('click', handleDisconnect);
            disconnectBtn.dataset.bound = '1';
        }

        const refreshToolsBtn = $('mcp-refresh-tools-btn');
        if (refreshToolsBtn && !refreshToolsBtn.dataset.bound) {
            refreshToolsBtn.addEventListener('click', () => {
                void handleRefreshTools();
            });
            refreshToolsBtn.dataset.bound = '1';
        }

        const demoBtn = $('mcp-demo-btn');
        if (demoBtn && !demoBtn.dataset.bound) {
            demoBtn.addEventListener('click', handleDemoFill);
            demoBtn.dataset.bound = '1';
        }

        const newBtn = $('mcp-new-btn');
        if (newBtn && !newBtn.dataset.bound) {
            newBtn.addEventListener('click', handleNewDraft);
            newBtn.dataset.bound = '1';
        }

        const importBtn = $('mcp-import-btn');
        if (importBtn && !importBtn.dataset.bound) {
            importBtn.addEventListener('click', handleImportJson);
            importBtn.dataset.bound = '1';
        }

        const importCopyBtn = $('mcp-import-copy-btn');
        if (importCopyBtn && !importCopyBtn.dataset.bound) {
            importCopyBtn.addEventListener('click', () => {
                void handleCopyConfigJson();
            });
            importCopyBtn.dataset.bound = '1';
        }

        const importClearBtn = $('mcp-import-clear-btn');
        if (importClearBtn && !importClearBtn.dataset.bound) {
            importClearBtn.addEventListener('click', () => {
                const input = $('mcp-import-input');
                if (input) input.value = '';
            });
            importClearBtn.dataset.bound = '1';
        }

        const bindAllBtn = $('mcp-bind-all-btn');
        if (bindAllBtn && !bindAllBtn.dataset.bound) {
            bindAllBtn.addEventListener('click', () => setAllBindings(true));
            bindAllBtn.dataset.bound = '1';
        }

        const bindClearBtn = $('mcp-bind-clear-btn');
        if (bindClearBtn && !bindClearBtn.dataset.bound) {
            bindClearBtn.addEventListener('click', () => setAllBindings(false));
            bindClearBtn.dataset.bound = '1';
        }

        const closeBtn = $('close-mcp-app');
        if (closeBtn && !closeBtn.dataset.bound) {
            closeBtn.addEventListener('click', () => {
                const screen = $('mcp-app');
                if (screen) screen.classList.add('hidden');
            });
            closeBtn.dataset.bound = '1';
        }

        const list = $('mcp-server-list');
        if (list && !list.dataset.bound) {
            list.addEventListener('change', (event) => {
                const input = event.target.closest('input[data-action="toggle-enable"]');
                if (!input) return;
                const card = event.target.closest('[data-server-id]');
                if (!card) return;
                const serverId = String(card.dataset.serverId || '').trim();
                const server = getServerById(serverId);
                if (!server) return;
                const shouldEnable = input.checked;
                updateServer(serverId, (draft) => ({
                    ...draft,
                    enabled: shouldEnable,
                    lastHealth: shouldEnable ? draft.lastHealth : 'disabled',
                    updatedAt: Date.now()
                }));
                persistState();
                renderServers();
                renderPreview();
                refreshSummary();
                pushLog(`${shouldEnable ? '已启用' : '已停用'}节点「${server.name}」`, shouldEnable ? 'good' : 'idle');
            });

            list.addEventListener('click', async (event) => {
                const actionEl = event.target.closest('[data-action]');
                if (!actionEl) return;
                const action = actionEl.dataset.action;
                if (action === 'toggle-enable') return; // 由 change 事件处理
                const card = event.target.closest('[data-server-id]');
                if (!card) return;
                const serverId = String(card.dataset.serverId || '').trim();
                const server = getServerById(serverId);
                if (!server) return;

                if (action === 'delete') {
                    if (!window.confirm(`确定删除节点「${server.name}」吗？`)) return;
                    const appState = getAppState();
                    appState.servers = appState.servers.filter((item) => item.id !== serverId);
                    if (appState.activeServerId === serverId) {
                        appState.activeServerId = appState.servers[0] ? appState.servers[0].id : '';
                    }
                    delete runtime.sessions[serverId];
                    persistState();
                    if (appState.activeServerId) {
                        selectServer(appState.activeServerId);
                    } else {
                        handleNewDraft();
                    }
                    pushLog(`已删除节点「${server.name}」`, 'warn');
                    return;
                }

                if (action === 'edit') {
                    selectServer(serverId);
                    scrollFormIntoView();
                    pushLog(`正在编辑「${server.name}」，改完点“保存配置”即可更新`, 'idle');
                    return;
                }

                if (action === 'refresh-tools') {
                    selectServer(serverId);
                    try {
                        await discoverServerTools(serverId);
                    } catch (error) {}
                    return;
                }
            });
            list.dataset.bound = '1';
        }

        const contactList = $('mcp-contact-bind-list');
        if (contactList && !contactList.dataset.bound) {
            contactList.addEventListener('click', (event) => {
                const button = event.target.closest('[data-contact-id]');
                if (!button) return;
                const activeServer = getActiveServer();
                if (!activeServer) return;
                const contactId = String(button.dataset.contactId || '').trim();
                const isSelected = button.classList.contains('is-selected');
                if (toggleContactBinding(contactId, !isSelected)) {
                    const contact = getBindableContacts().find((item) => String(item.id) === contactId);
                    const contactName = String(contact && (contact.remark || contact.nickname || contact.name || contact.id) || contactId).trim();
                    pushLog(`${!isSelected ? '已绑定' : '已解绑'}联系人「${contactName}」到节点「${activeServer.name}」`, 'idle');
                }
            });
            contactList.dataset.bound = '1';
        }
    }

    function renderMcpApp() {
        migrateLegacyStateIfNeeded();
        bindEvents();
        const active = getActiveServer();
        if (active) {
            applyForm(active);
        } else {
            handleNewDraft();
            return;
        }
        renderServers();
        renderLogs();
        renderContactBindings();
        renderToolList();
        renderPreview();
        refreshSummary();
    }

    function initMcpApp() {
        bindEvents();
        renderMcpApp();
    }

    window.renderMcpApp = renderMcpApp;
    window.MCPBridge = {
        getState: () => JSON.parse(JSON.stringify(getAppState())),
        getActiveServer: () => {
            const server = getActiveServer();
            return server ? JSON.parse(JSON.stringify(server)) : null;
        },
        getBoundEnabledServers: (contactId) => JSON.parse(JSON.stringify(getBoundEnabledServers(contactId))),
        getToolSummariesForContact: (contactId) => JSON.parse(JSON.stringify(getToolSummariesForContact(contactId))),
        prepareChatTooling,
        executeChatToolCall,
        discoverServerTools,
        callTool
    };

    if (window.appInitFunctions) {
        window.appInitFunctions.push(initMcpApp);
    }

    window.addEventListener('storage', (event) => {
        if (event.key !== STORAGE_KEY && event.key !== LEGACY_STORAGE_KEY) return;
        renderMcpApp();
    });
})();
