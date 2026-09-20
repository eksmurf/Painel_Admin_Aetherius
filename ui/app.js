/* Standalone view. Only the transport knows about Skyrim Platform. No console executor. */
(() => {
  'use strict';
  if (window.AetheriusAdmin) return;
  const root = document.createElement('section');
  root.id = 'aetherius-admin'; root.hidden = true; root.setAttribute('aria-label', 'Painel administrativo Aetherius');
  document.body.append(root);
  const state = { open: false, tab: 'moderation', target: null, actions: [], items: [], players: { rows: [], total: 0, page: 1 }, audit: { rows: [], total: 0, page: 1 }, filters: {}, notice: null, busy: false, operator: null, query: '', dialog: null };
  const pending = new Map();
  const discarded = new Set();
  let generation = 0;
  function discard(id) { discarded.add(id); if (discarded.size > 256) discarded.delete(discarded.values().next().value); }
  const categories = [['moderation', 'Moderação', 'Atendimento e controle da sessão.'], ['administration', 'Administração', 'Inventário, economia e identidade.'], ['tools', 'RP / Ferramentas', 'Recursos disponíveis para suporte ao mundo.'], ['audit', 'Auditoria', 'Consulte o resultado e o motivo de cada operação.'], ['staff', 'Staff', 'Acesso e responsabilidades da equipe.']];
  const statusLabels = { succeeded: 'Concluída', accepted: 'Recebida', rejected: 'Recusada', failed: 'Falhou', unknown: 'A conferir' };
  const roleLabels = { moderator: 'Moderador', admin: 'Administrador', owner: 'Responsável' };
  function node(tag, text, className) { const element = document.createElement(tag); if (text !== undefined && text !== null) element.textContent = text; if (className) element.className = className; return element; }
  function button(text, callback, className) { const element = node('button', text, className); element.type = 'button'; element.addEventListener('click', callback); return element; }
  function focusGame(value) { if (window.skyrimPlatform) window.skyrimPlatform.sendMessage('aetherius-admin:focus', value); }
  function request(type, data = {}) {
    const requestId = crypto.randomUUID ? crypto.randomUUID() : `req_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const message = { version: 1, requestId, type, data };
    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(requestId); discard(requestId); reject(new Error(type === 'action' ? 'Resultado não confirmado. Consulte a auditoria antes de repetir a ação.' : 'Servidor sem resposta. Tente atualizar em alguns segundos.')); }, 12000);
      pending.set(requestId, { resolve, reject, timer });
      try {
        if (window.AetheriusAdminDemo) window.AetheriusAdminDemo.send(message, receive);
        else if (window.skyrimPlatform) window.skyrimPlatform.sendMessage('cef::ui:event', 'admin:request', message);
        else throw new Error('Abra este painel pelo Skyrim. Para visualizar dados fictícios, utilize demo.html.');
      } catch (error) { clearTimeout(timer); pending.delete(requestId); reject(error); }
    });
    return promise;
  }
  function receive(response) {
    if (!response || response.version !== 1 || discarded.has(response.requestId)) return;
    const entry = pending.get(response.requestId);
    if (entry) { clearTimeout(entry.timer); pending.delete(response.requestId); entry.resolve(response); }
    else if (response.type === 'open' && response.status === 'succeeded') applyOpen(response);
    else if (response.type === 'action' && !entry) { state.notice = { message: response.message, kind: response.status === 'succeeded' ? '' : 'warning' }; if (state.open) render(); }
  }
  function applyOpen(response) {
    if (response.status !== 'succeeded') throw new Error(response.message || 'Acesso negado.');
    const data = response.data;
    state.operator = data.operator; state.actions = data.actions; state.items = data.items; state.players = data.players;
    state.open = true; root.hidden = false; focusGame(true); render();
  }
  async function open() {
    const epoch = generation;
    try { const response = await request('open'); if (epoch !== generation) return; applyOpen(response); }
    catch (error) { if (epoch !== generation) return; state.notice = { message: error.message, kind: 'error' }; state.open = true; root.hidden = false; focusGame(true); render(); }
  }
  function close() {
    generation++;
    for (const [id, entry] of pending) { discard(id); clearTimeout(entry.timer); entry.reject(new Error('Painel fechado.')); }
    pending.clear(); state.busy = false; state.query = ''; state.filters = {}; state.tab = 'moderation';
    state.open = false; state.target = null; state.dialog = null; state.notice = null; state.operator = null; state.players = { rows: [], total: 0, page: 1 }; state.audit = { rows: [], total: 0, page: 1 }; state.actions = []; state.items = [];
    root.replaceChildren(); root.hidden = true; focusGame(false);
  }
  function ensure(response) {
    if (response.status !== 'succeeded') {
      if (response.code === 'FORBIDDEN' || response.code === 'SESSION_EXPIRED') { state.operator = null; state.target = null; state.players = { rows: [], total: 0, page: 1 }; state.audit = { rows: [], total: 0, page: 1 }; state.actions = []; state.items = []; state.dialog = null; }
      throw new Error(response.message || 'Solicitação recusada.');
    }
    return response.data;
  }
  async function refreshPlayers(page = 1) {
    const epoch = generation;
    try {
      const response = await request('players', { query: state.query, page });
      if (epoch !== generation) return;
      state.players = ensure(response);
      if (state.target && !state.players.rows.some(row => row.actorId === state.target.actorId && row.session === state.target.session)) state.target = null;
    } catch (error) { if (epoch !== generation) return; state.notice = { message: error.message, kind: 'error' }; }
    if (state.open && !state.dialog) render();
  }
  async function refreshAudit(page = 1) {
    const epoch = generation;
    try { const response = await request('audit', { ...state.filters, page }); if (epoch !== generation) return; state.audit = ensure(response); }
    catch (error) { if (epoch !== generation) return; state.notice = { message: error.message, kind: 'error' }; }
    if (state.open) render();
  }
  function paginate(data, callback) {
    const bar = node('div', null, 'aap-page'); const count = Math.max(1, Math.ceil(data.total / 20));
    const previous = button('Anterior', () => callback(data.page - 1)); previous.disabled = data.page <= 1;
    const next = button('Próxima', () => callback(data.page + 1)); next.disabled = data.page >= count;
    bar.append(previous, node('span', `${data.page} / ${count}`), next); return bar;
  }
  function renderSidebar() {
    const sidebar = node('aside', null, 'aap-sidebar'); const title = node('div', null, 'aap-line');
    title.append(node('h3', 'Jogadores online'), node('span', String(state.players.online || 0), 'aap-badge')); sidebar.append(title);
    const search = node('form', null, 'aap-search'); const input = node('input'); input.placeholder = 'Nome visível ou ID'; input.setAttribute('aria-label', 'Buscar jogador'); input.value = state.query;
    input.addEventListener('input', () => { state.query = input.value; });
    const submit = button('Buscar', () => refreshPlayers()); search.addEventListener('submit', event => { event.preventDefault(); refreshPlayers(); }); search.append(input, submit); sidebar.append(search);
    const list = node('ul', null, 'aap-player-list');
    for (const player of state.players.rows) {
      const item = node('li'); const select = button('', () => { state.target = player; state.notice = null; render(); }, 'aap-player');
      select.setAttribute('aria-pressed', String(state.target?.actorId === player.actorId));
      select.append(node('span', `${player.label}${player.self ? ' · você' : ''}`), node('small', `0x${player.actorId.toString(16).toUpperCase()} · online`)); item.append(select); list.append(item);
    }
    if (!state.players.rows.length) list.append(node('li', state.operator ? 'Nenhum jogador encontrado.' : 'Acesso não autorizado.', 'aap-empty'));
    sidebar.append(list, paginate(state.players, refreshPlayers), button('Atualizar jogadores', () => refreshPlayers(state.players.page)));
    return sidebar;
  }
  function targetBar() {
    const box = node('div', null, 'aap-target'); const text = node('div');
    text.append(node('strong', state.target ? state.target.label : 'Nenhum jogador selecionado'), node('small', state.target ? `Alvo da ação · 0x${state.target.actorId.toString(16).toUpperCase()}` : 'Selecione um jogador na lista ao lado.'));
    box.append(text); if (state.target) box.append(button('Limpar seleção', () => { state.target = null; render(); })); return box;
  }
  function renderActions(content) {
    content.append(targetBar()); const grid = node('div', null, 'aap-grid');
    for (const action of state.actions.filter(entry => entry.category === state.tab)) {
      const card = node('article', null, 'aap-card'); card.append(node('h3', action.label), node('p', action.description));
      if (action.unavailable) card.append(node('div', action.unavailable, 'aap-unavailable'));
      const execute = button(action.enabled ? 'Selecionar ação' : 'Indisponível', () => showAction(action), action.danger ? 'aap-danger' : '');
      execute.disabled = !action.enabled || !state.target || state.busy; card.append(execute); grid.append(card);
    }
    content.append(grid);
  }
  function filterSelect(label, entries, value) {
    const wrapper = node('label', label); const select = node('select');
    for (const [key, title] of entries) { const option = node('option', title); option.value = key; select.append(option); }
    select.value = value || ''; wrapper.append(select); return [wrapper, select];
  }
  function renderAudit(content) {
    const filters = node('form', null, 'aap-filters');
    const [actionLabel, actionInput] = filterSelect('Ação', [['', 'Todas as ações'], ...state.actions.filter(a => !a.unavailable).map(a => [a.id, a.label])], state.filters.action);
    const [statusLabel, statusInput] = filterSelect('Resultado', [['', 'Todos'], ...Object.entries(statusLabels)], state.filters.status);
    const queryLabel = node('label', 'Personagem ou solicitação'); const query = node('input'); query.placeholder = 'Identificador exato'; query.value = state.filters.query || ''; queryLabel.append(query);
    const search = button('Filtrar', () => { state.filters = { action: actionInput.value, status: statusInput.value, query: query.value }; refreshAudit(); });
    filters.addEventListener('submit', event => { event.preventDefault(); search.click(); }); filters.append(actionLabel, statusLabel, queryLabel, search); content.append(filters);
    const wrap = node('div', null, 'aap-table-wrap'); const table = node('table'); const head = node('thead'); const header = node('tr');
    for (const title of ['Data / hora', 'Ação', 'Staff', 'Personagem', 'Resultado', '']) header.append(node('th', title)); head.append(header); table.append(head);
    const body = node('tbody');
    for (const entry of state.audit.rows) {
      const row = node('tr'); const label = state.actions.find(a => a.id === entry.action)?.label || entry.action;
      [new Date(entry.created_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }), label, `Conta ${entry.account_id}`, entry.target_character_id ? `#${entry.target_character_id}` : '—', statusLabels[entry.status] || entry.status].forEach(text => row.append(node('td', text)));
      const details = node('td'); details.append(button('Detalhes', () => showDetails(entry))); row.append(details); body.append(row);
    }
    table.append(body); wrap.append(table); content.append(wrap);
    if (!state.audit.rows.length) content.append(node('p', 'Nenhuma operação neste filtro.', 'aap-empty'));
    content.append(paginate(state.audit, refreshAudit));
  }
  function showDetails(entry) {
    const box = dialog('Detalhes da operação'); const list = node('dl', null, 'aap-details');
    const values = [['Ação', state.actions.find(a => a.id === entry.action)?.label || entry.action], ['Resultado', statusLabels[entry.status]], ['Staff', `Conta ${entry.account_id}`], ['Personagem', entry.target_character_id || '—'], ['Motivo', entry.reason], ['Solicitação', entry.request_id]];
    for (const [name, value] of values) list.append(node('dt', name), node('dd', value)); box.append(list, button('Fechar detalhes', dismissDialog)); box.querySelector('button').focus();
  }
  function dialog(title) {
    const overlay = node('div', null, 'aap-dialog'); const box = node('div', null, 'aap-dialog-box');
    box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-label', title); box.append(node('h2', title)); overlay.append(box); root.append(overlay); state.dialog = overlay; return box;
  }
  function dismissDialog() { if (state.busy) return; state.dialog?.remove(); state.dialog = null; root.querySelector('.aap-nav button[aria-selected="true"]')?.focus(); }
  function showAction(action) {
    if (!state.target || !action.enabled) return;
    const target = { ...state.target }; const box = dialog(action.label); box.append(node('p', action.description));
    const summary = node('div', null, 'aap-target'); summary.append(node('strong', target.label), node('small', `0x${target.actorId.toString(16).toUpperCase()}`)); box.append(summary);
    const form = node('form'); const inputs = {};
    for (const field of action.fields) {
      const label = node('label', { item: 'Item autorizado', quantity: 'Quantidade (1–100)', amount: 'Novo saldo RP (Septims)' }[field]); let input;
      if (field === 'item') { input = node('select'); for (const item of state.items) { const option = node('option', item.label); option.value = item.id; input.append(option); } }
      else { input = node('input'); input.type = 'number'; input.min = field === 'quantity' ? '1' : '0'; input.max = field === 'quantity' ? '100' : '1000000'; input.step = '1'; input.value = field === 'quantity' ? '1' : ''; }
      input.required = true; inputs[field] = input; label.append(input); form.append(label);
    }
    const label = node('label', 'Motivo da ação'); const reason = node('textarea'); reason.required = true; reason.minLength = 5; reason.maxLength = 240; reason.placeholder = 'Descreva o atendimento ou a justificativa.'; label.append(reason); form.append(label);
    const message = node('p', action.danger ? 'Confira o alvo. Esta ação interrompe ou altera o acesso do jogador.' : 'A operação será registrada com a sua conta.', 'muted'); form.append(message);
    const error = node('p', '', 'aap-unavailable'); error.setAttribute('role', 'alert'); form.append(error);
    const controls = node('div', null, 'aap-dialog-buttons'); const cancel = button('Cancelar', dismissDialog); const confirm = button('Confirmar ação', () => {} , action.danger ? 'aap-danger' : 'aap-primary'); confirm.type = 'submit'; controls.append(cancel, confirm); form.append(controls);
    form.addEventListener('submit', async event => {
      event.preventDefault(); if (state.busy || !form.reportValidity()) return;
      if (reason.value.trim().length < 5) { error.textContent = 'Informe um motivo com pelo menos 5 caracteres.'; return; }
      state.busy = true; confirm.disabled = true; cancel.disabled = true; confirm.textContent = 'Aguardando servidor…';
      const epoch = generation;
      const params = Object.fromEntries(Object.entries(inputs).map(([key, input]) => [key, key === 'item' ? input.value : Number(input.value)]));
      try {
        const response = await request('action', { action: action.id, target: { actorId: target.actorId, session: target.session }, reason: reason.value.trim(), params });
        if (epoch !== generation) return;
        state.notice = { message: response.message + (response.data?.identity ? ` ${response.data.identity}` : ''), kind: response.status === 'succeeded' ? '' : response.status === 'unknown' ? 'warning' : 'error', requestId: response.requestId };
        if (response.code === 'FORBIDDEN') { state.operator = null; state.actions = []; state.players = { rows: [], total: 0, page: 1 }; state.target = null; state.audit = { rows: [], total: 0, page: 1 }; }
      } catch (err) { if (epoch === generation) state.notice = { message: err.message, kind: 'warning' }; }
      finally { if (epoch === generation) { state.busy = false; state.dialog = null; if (state.open) render(); } }
    }); box.append(form); (Object.values(inputs)[0] || reason).focus();
  }
  function render() {
    if (!state.open || state.dialog) return;
    root.replaceChildren();
    const header = node('header', null, 'aap-header'); const brand = node('div', null, 'aap-brand');
    brand.append(node('div', 'A', 'aap-mark')); const titles = node('div'); titles.append(node('h1', 'Aetherius RP'), node('small', 'Painel administrativo')); brand.append(titles); header.append(brand);
    const account = node('div', null, 'aap-header-actions');
    if (window.AetheriusAdminDemo) account.append(node('span', 'Demonstração · dados fictícios', 'aap-badge aap-demo'));
    if (state.operator) account.append(node('span', state.operator.label, 'muted'), node('span', roleLabels[state.operator.role] || state.operator.role, 'aap-badge'));
    account.append(button('Fechar · Esc', close)); header.append(account); root.append(header);
    const layout = node('div', null, 'aap-layout'); layout.append(renderSidebar()); const main = node('main', null, 'aap-main'); const nav = node('nav', null, 'aap-nav'); nav.setAttribute('aria-label', 'Áreas administrativas'); nav.setAttribute('role', 'tablist');
    for (const [id, label] of categories) { const tab = button(label, () => { state.tab = id; state.notice = null; if (id === 'audit') refreshAudit(); else render(); }); tab.setAttribute('role', 'tab'); tab.setAttribute('aria-selected', String(state.tab === id)); nav.append(tab); }
    main.append(nav); const content = node('div', null, 'aap-content');
    if (state.notice) { const notice = node('div', state.notice.message, `aap-notice ${state.notice.kind}`); notice.setAttribute('role', 'status'); if (state.notice.requestId) notice.append(node('div', `Solicitação: ${state.notice.requestId}`, 'muted')); content.append(notice); }
    const [, label, description] = categories.find(category => category[0] === state.tab); const title = node('div', null, 'aap-title'); title.append(node('h2', label), node('p', description)); content.append(title);
    if (!state.operator) content.append(node('p', 'Acesso restrito à Staff autorizada.', 'aap-empty'), button('Tentar conectar', open));
    else if (state.tab === 'audit') renderAudit(content); else renderActions(content);
    main.append(content); layout.append(main); root.append(layout);
    const footer = node('footer', null, 'aap-status'); footer.append(node('span', window.AetheriusAdminDemo ? 'Ambiente de demonstração — nenhuma alteração no servidor' : state.operator ? 'Acesso validado pelo servidor' : 'Sem sessão administrativa'), node('span', state.busy ? 'Operação em andamento' : 'F7 abre / fecha · Esc fecha')); root.append(footer);
  }
  root.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); state.dialog ? dismissDialog() : close(); }
    if (event.key === 'Tab' && state.dialog) {
      const focusable = [...state.dialog.querySelectorAll('button:not(:disabled),input,select,textarea')]; const first = focusable[0]; const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  });
  window.addEventListener('skymp5-client:browserUnfocused', close);
  window.AetheriusAdmin = { receive, close, toggle: () => state.open ? close() : open() };
  // Reauthorize while open. Sensitive information is cleared if the session is revoked.
  setInterval(async () => {
    if (!state.open || !state.operator || state.busy || state.dialog) return;
    const epoch = generation;
    try { const response = await request('open'); if (!state.open || epoch !== generation) return; ensure(response); state.operator = response.data.operator; state.actions = response.data.actions; }
    catch (error) { if (state.open && epoch === generation) { close(); /* never retain staff data after a failed authorization heartbeat */ } }
  }, 15000);
  if (window.AetheriusAdminDemo) open();
  else if (!window.skyrimPlatform) { state.open = true; root.hidden = false; state.notice = { message: 'Interface de jogo. Abra demo.html para uma prévia com dados fictícios.', kind: 'warning' }; render(); }
})();
