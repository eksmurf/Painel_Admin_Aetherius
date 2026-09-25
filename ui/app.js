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
  const categories = [['moderation', 'Moderação', 'Atendimento e controle da sessão.'], ['administration', 'Administração', 'Inventário, economia e ferramentas de atendimento.'], ['resources', 'Catálogos', 'Inventários de jogadores: pesquise por item ou por jogador.'], ['audit', 'Auditoria', 'Consulte o resultado e o motivo de cada operação.'], ['staff', 'Staff', 'Acesso e responsabilidades da equipe.']];
  const resourceLabels = {items:'Itens',playerInventory:'Inventários de jogadores',animations:'Animações',destinations:'Destinos',npcs:'NPCs',zones:'Zonas de NPCs',weathers:'Climas',weatherRegions:'Regiões de clima',jobs:'Trabalhos de transporte',factionRoles:'Cargos RP',professions:'Profissões',pets:'Acompanhantes',bans:'Contas banidas'};
  state.resources = []; state.resourceKind = 'playerInventory'; state.resourceData = null; state.inventorySearchBy='items'; state.inventoryOwner=null; state.inventoryInspection=false; state.inventoryBack=null; state.resourceLoading=false;
  let resourceRequest=0;
  const statusLabels = { succeeded: 'Concluída', accepted: 'Recebida', rejected: 'Recusada', failed: 'Falhou', unknown: 'A conferir' };
  const roleLabels = { moderator: 'Moderador', admin: 'Administrador', owner: 'Responsável' };
  function node(tag, text, className) { const element = document.createElement(tag); if (text !== undefined && text !== null) element.textContent = text; if (className) element.className = className; return element; }
  function button(text, callback, className) { const element = node('button', text, className); element.type = 'button'; element.addEventListener('click', callback); return element; }
  // Tilted UI paints CEF's PET_VIEW only. Native select popups use PET_POPUP,
  // so keep form values in the select but draw the entire menu in the page.
  const enhancedSelects = new WeakMap();
  let selectSequence = 0, activeSelect = null;
  function closeSelect(focus = false) {
    if (!activeSelect) return;
    const { trigger, menu } = activeSelect; activeSelect = null;
    menu.remove(); trigger.setAttribute('aria-expanded', 'false'); trigger.removeAttribute('aria-activedescendant');
    if (focus && trigger.isConnected) trigger.focus();
  }
  function enhanceSelects() {
    for (const select of root.querySelectorAll('select')) {
      if (enhancedSelects.has(select)) continue;
      const label = select.closest('label');
      const title = select.getAttribute('aria-label') || (label && [...label.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim()) || 'Selecionar opção';
      const id = `aap-select-${++selectSequence}`;
      const trigger = button('', () => { if (activeSelect?.trigger === trigger) closeSelect(); else show(); }, 'aap-select');
      trigger.id = id; trigger.setAttribute('role', 'combobox'); trigger.setAttribute('aria-label', title);
      trigger.setAttribute('aria-haspopup', 'listbox'); trigger.setAttribute('aria-expanded', 'false'); trigger.setAttribute('aria-controls', id + '-list');
      select.hidden = true; select.tabIndex = -1; select.setAttribute('aria-hidden', 'true'); select.after(trigger);
      const sync = () => {
        trigger.textContent = select.selectedOptions[0]?.textContent || 'Selecione…'; trigger.disabled = select.disabled;
        trigger.setAttribute('aria-required', String(select.required));
        if (activeSelect?.trigger === trigger) closeSelect();
      };
      enhancedSelects.set(select, trigger); sync();
      select.addEventListener('change', sync);
      select.addEventListener('invalid', event => { event.preventDefault(); trigger.setAttribute('aria-invalid', 'true'); trigger.focus(); show(); });
      new MutationObserver(sync).observe(select, { childList:true, subtree:true, characterData:true, attributes:true });
      let index = -1, options = [], rows = [], prefix = '', typedAt = 0;
      function highlight(next) {
        index = next;
        rows.forEach((row, i) => { row.classList.toggle('aap-active', i === index); });
        if (rows[index]) {
          trigger.setAttribute('aria-activedescendant', rows[index].id);
          const row = rows[index], menu = row.parentElement;
          if (row.offsetTop < menu.scrollTop) menu.scrollTop = row.offsetTop;
          else if (row.offsetTop + row.offsetHeight > menu.scrollTop + menu.clientHeight) menu.scrollTop = row.offsetTop + row.offsetHeight - menu.clientHeight;
        }
      }
      function choose() {
        if (!options[index] || select.disabled) return;
        select.value = options[index].value; trigger.removeAttribute('aria-invalid');
        closeSelect(true); select.dispatchEvent(new Event('input', {bubbles:true})); select.dispatchEvent(new Event('change', {bubbles:true}));
      }
      function show() {
        if (trigger.disabled || !trigger.isConnected) return;
        closeSelect(); options = [...select.options].filter(option => !option.disabled && !option.hidden);
        const menu = node('div', null, 'aap-select-menu'); menu.id = id + '-list'; menu.setAttribute('role', 'listbox'); menu.setAttribute('aria-label', title);
        rows = options.map((option, i) => {
          const row = node('div', option.textContent, 'aap-select-option'); row.id = `${id}-option-${i}`;
          row.setAttribute('role', 'option'); row.setAttribute('aria-selected', String(option.value === select.value));
          row.addEventListener('mousedown', e => e.preventDefault());
          row.addEventListener('mousemove', () => { if (index !== i) highlight(i); });
          row.addEventListener('click', () => { index = i; choose(); }); menu.append(row); return row;
        });
        if (!rows.length) menu.append(node('div', 'Nenhuma opção disponível', 'aap-select-empty'));
        function position() {
          const rect = trigger.getBoundingClientRect(), bounds = root.getBoundingClientRect();
          // The menu is a direct child of the translated panel. Position in its
          // padding-box coordinates, not viewport coordinates (which add the offset twice).
          const left = rect.left - bounds.left - root.clientLeft;
          const top = rect.top - bounds.top - root.clientTop;
          const width = Math.min(rect.width, root.clientWidth - 16);
          const below = Math.max(0, root.clientHeight - top - rect.height - 8), above = Math.max(0, top - 8);
          const upwards = below < 180 && above > below;
          menu.style.width = `${width}px`; menu.style.left = `${Math.max(8, Math.min(left, root.clientWidth - width - 8))}px`;
          menu.style.maxHeight = `${Math.min(280, upwards ? above : below)}px`;
          menu.style.top = `${upwards ? top - Math.min(menu.scrollHeight + 2, 280, above) - 4 : top + rect.height + 4}px`;
        }
        root.append(menu); activeSelect = {trigger, menu, position}; trigger.setAttribute('aria-expanded', 'true'); trigger.focus(); position();
        highlight(Math.max(0, options.findIndex(option => option.value === select.value)));
      }
      trigger.addEventListener('keydown', event => {
        const isOpen = activeSelect?.trigger === trigger;
        if (event.key === 'Escape' && isOpen) { event.preventDefault(); event.stopPropagation(); closeSelect(true); return; }
        if (event.key === 'Tab') { closeSelect(); return; }
        if (['ArrowDown','ArrowUp','Home','End','Enter',' '].includes(event.key)) {
          event.preventDefault(); event.stopPropagation();
          if (!isOpen) { show(); return; }
          if (event.key === 'Enter' || event.key === ' ') choose();
          else highlight(event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : Math.max(0, Math.min(options.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1))));
        } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
          event.preventDefault(); if (!isOpen) show();
          prefix = Date.now() - typedAt > 700 ? event.key : prefix + event.key; typedAt = Date.now();
          const next = options.findIndex(option => option.textContent.toLocaleLowerCase().startsWith(prefix.toLocaleLowerCase()));
          if (next >= 0) highlight(next);
        }
      });
    }
  }
  document.addEventListener('mousedown', event => { if (activeSelect && !activeSelect.trigger.contains(event.target) && !activeSelect.menu.contains(event.target)) closeSelect(); });
  root.addEventListener('scroll', event => { if (activeSelect && !activeSelect.menu.contains(event.target)) activeSelect.position(); }, true);
  window.addEventListener('resize', () => closeSelect());
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
    state.operator = data.operator; state.actions = data.actions; state.items = data.items; state.players = data.players; state.resources = data.resources || []; state.inventoryInspection=!!data.inventoryInspection; if(!state.resources.includes(state.resourceKind))state.resourceKind=state.resources[0] || 'items';
    state.open = true; root.hidden = false; focusGame(true); render();
  }
  async function open() {
    const epoch = generation;
    try { const response = await request('open'); if (epoch !== generation) return; applyOpen(response); }
    catch (error) { if (epoch !== generation) return; state.notice = { message: error.message, kind: 'error' }; state.open = true; root.hidden = false; focusGame(true); render(); }
  }
  function close() {
    closeSelect();
    generation++;
    for (const [id, entry] of pending) { discard(id); clearTimeout(entry.timer); entry.reject(new Error('Painel fechado.')); }
    pending.clear(); state.busy = false; state.query = ''; state.filters = {}; state.tab = 'moderation'; state.inventoryOwner=null;state.inventorySearchBy='items';state.inventoryBack=null;state.inventoryInspection=false;state.resourceQuery='';state.resourceLoading=false;resourceRequest++;
    state.resources = []; state.resourceData = null; state.result = null;
    state.open = false; state.target = null; state.dialog = null; state.notice = null; state.operator = null; state.players = { rows: [], total: 0, page: 1 }; state.audit = { rows: [], total: 0, page: 1 }; state.actions = []; state.items = [];
    root.replaceChildren(); root.hidden = true; focusGame(false);
  }
  function ensure(response) {
    if (response.status !== 'succeeded') {
      if (response.code === 'FORBIDDEN' || response.code === 'SESSION_EXPIRED') { state.operator = null; state.target = null; state.players = { rows: [], total: 0, page: 1 }; state.audit = { rows: [], total: 0, page: 1 }; state.actions = []; state.items = []; state.resources=[];state.resourceData=null;state.result=null;state.dialog = null; }
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
    content.append(targetBar()); const grid=node('div',null,'aap-grid aap-actions aap-actions-'+state.tab);
    const actions=state.actions.filter(entry=>entry.category===state.tab && !entry.panelHidden);
    for(const action of actions){
      const waiting=!action.targetKind && !state.target;
      const execute=button(action.label,()=>showAction(action),'aap-action'+(!action.enabled?' aap-action-denied':waiting?' aap-action-waiting':''));
      execute.disabled=!action.enabled || waiting || state.busy;
      execute.setAttribute('aria-label',action.label);
      if(!action.enabled)execute.title=action.unavailable || 'Sem acesso';
      grid.append(execute);
    }
    content.append(grid);
    const summary=node('div',null,'aap-summary');summary.setAttribute('aria-label','Sumário das ações');
    for(const action of actions)summary.append(node('p',action.label+' - '+action.description));
    content.append(summary);
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
  function dismissDialog() { if (state.busy) return; closeSelect(); state.dialog?.remove(); state.dialog = null; root.querySelector('.aap-nav button[aria-selected="true"]')?.focus(); }
  function resourceInput(source, initial) {
    const wrapper = node('div', null, 'aap-resource-picker'); const search = node('input'); search.value=initial === undefined ? '' : String(initial); search.placeholder = 'Buscar nome, categoria ou identificador'; search.setAttribute('aria-label', `Buscar em ${resourceLabels[source] || source}`);
    const input = node('select'); input.required = true; const status = node('small'); let page = 1, total = 0, serial = 0;
    const load = async (next = 1) => {
      const ticket = ++serial, epoch = generation; status.textContent = 'Consultando…';
      try {
        const data = ensure(await request('resources', {kind:source,query:search.value,page:next}));
        if (ticket !== serial || epoch !== generation || !state.open) return;
        page=data.page; total=data.total; input.replaceChildren();
        const empty=node('option','Selecione…'); empty.value=''; input.append(empty);
        for (const row of data.rows) { const option=node('option',`${row.label || row.id}${row.category ? ' · '+row.category : ''}`); option.value=row.id; input.append(option); }
        if (initial !== undefined && data.rows.some(row=>row.id===String(initial))) { input.value=String(initial); initial=undefined; }
        status.textContent=`${total} resultados · página ${page}`;
        prev.disabled=page<=1; nextButton.disabled=page*20>=total;
      } catch(error) { status.textContent=error.message; }
    };
    const prev=button('Anterior',()=>load(page-1)), nextButton=button('Próxima',()=>load(page+1)); prev.disabled=true; nextButton.disabled=true;
    const searchButton=button('Buscar',()=>load(1)); search.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();load(1);}});
    const controls=node('div',null,'aap-picker-controls'); controls.append(searchButton,prev,nextButton);
    wrapper.append(search,controls,input,status); load(); return {wrapper,input};
  }
  function showModes(action) {
    const box=dialog('Modo de atendimento'), grid=node('div',null,'aap-mode-grid');
    box.append(node('p','Todos os modos afetam somente você. Ao ativar a câmera livre, o painel fecha para liberar os controles. F7 reabre o painel para desativá-la.','muted'));
    const status=node('p','Consultando estado no servidor…','muted');status.setAttribute('role','status');
    const speedLabel=node('label','Velocidade (%)'), speed=node('input');speed.type='number';speed.required=true;speed.min='25';speed.max='500';speed.step='1';speed.value='100';speedLabel.append(speed);
    const controls=new Map();let values={},expires=0,loading=true,pendingMode=false,revision=0;
    const overlay=state.dialog,epoch=generation;
    function current(){return state.open && state.dialog===overlay && generation===epoch;}
    function paint(){
      for(const [key,control] of controls){const active=!!values[key] && Date.now()<expires;control.className='aap-mode '+(loading?'aap-mode-unknown':active?'aap-mode-on':'aap-mode-off');control.setAttribute('aria-pressed',String(active));control.disabled=loading || pendingMode;control.textContent=control.dataset.label+' · '+(loading?'Consultando':active?'Ativo':'Desativado');}
      reset.disabled=loading || pendingMode; speed.disabled=pendingMode;applySpeed.disabled=loading || pendingMode || !values.speed;
    }
    function apply(data){values=data.values || {};expires=Date.now()+(data.leaseRemainingMs || 0);loading=false;if(values.speed && document.activeElement!==speed)speed.value=String(values.speed);paint();}
    async function refresh(){if(!current() || pendingMode)return;const observed=revision;try{const data=ensure(await request('modes'));if(current() && observed===revision && !pendingMode){apply(data);status.textContent='Verde: ativo. Vermelho: desativado.';}}catch(error){if(current() && observed===revision && !pendingMode){loading=true;paint();status.textContent=error.message;}}}
    async function change(mode,enabled){
      if(loading || pendingMode)return;
      if(mode==='speed' && !speed.reportValidity())return;
      pendingMode=true;revision++;state.busy=true;paint();status.textContent='Aguardando confirmação…';
      try{
        const response=await request('action',{action:action.id,target:null,params:{mode,enabled:String(enabled),speed:mode==='speed'?Number(speed.value):100}});
        if(!current())return;
        const data=ensure(response);apply(data);status.textContent=response.message;
        if(mode==='freecam' && enabled && data.values?.freecam){close();return;}
      }catch(error){if(current()){loading=true;status.textContent=error.message+' Atualizando estado…';}}
      finally{pendingMode=false;if(generation===epoch)state.busy=false;if(current()){paint();if(loading)refresh();}else if(state.open && generation===epoch)render();}
    }
    for(const [key,title] of [['god','Invulnerabilidade'],['noclip','Atravessar colisões'],['ghost','Fantasma'],['invisible','Invisível'],['speed','Velocidade'],['freecam','Câmera livre']]){
      const control=button(title,()=>change(key,!(values[key] && Date.now()<expires)));control.dataset.label=title;controls.set(key,control);grid.append(control);
    }
    const reset=button('Desativar todos',()=>change('reset',false)),applySpeed=button('Aplicar velocidade',()=>change('speed',true));
    box.append(grid,speedLabel,applySpeed,status,reset,button('Fechar',dismissDialog));paint();refresh();
    const poll=setInterval(()=>{if(!current()){clearInterval(poll);return;}paint();refresh();},5000);
  }
  function showWeather(action) {
    const box=dialog('Clima do servidor'),overlay=state.dialog,epoch=generation;
    let revision=null,saving=false;
    const current=()=>state.open && state.dialog===overlay && generation===epoch;
    const status=node('p','Consultando clima atual…','muted');status.setAttribute('role','status');
    box.append(node('p','Aplica o clima nas áreas externas do servidor, incluindo quem entrar depois. Interiores e mundos especiais mantêm seu clima natural.'),status);
    const form=node('form'),label=node('label','Clima'),picker=resourceInput('weathers');picker.input.required=true;label.append(picker.wrapper);form.append(label);
    const reasonLabel=node('label','Motivo da ação'),reason=node('textarea');reason.required=true;reason.minLength=5;reason.maxLength=240;reason.placeholder='Descreva o atendimento ou evento.';reasonLabel.append(reason);form.append(reasonLabel);
    const feedback=node('p','','aap-unavailable');feedback.setAttribute('role','alert');form.append(feedback);
    const buttons=node('div',null,'aap-dialog-buttons'),apply=button('Aplicar ao servidor',()=>change(true),'aap-primary'),reset=button('Restaurar clima natural',()=>change(false)),cancel=button('Fechar',dismissDialog);buttons.append(apply,reset,cancel);form.append(buttons);box.append(form);
    function controls(){apply.disabled=saving || revision===null;reset.disabled=saving || revision===null;cancel.disabled=saving;}
    function show(data){revision=data.revision;status.textContent=data.enabled?'Clima configurado: '+data.label:'Clima natural do jogo';controls();}
    async function refresh(){try{const data=ensure(await request('weather'));if(current())show(data);}catch(error){if(current()){revision=null;status.textContent=error.message;controls();}}}
    async function change(enabled){
      if(saving || revision===null)return;
      if(reason.value.trim().length<5 || !reason.reportValidity()){feedback.textContent='Informe um motivo com pelo menos 5 caracteres.';return;}
      if(enabled && !form.reportValidity())return;
      saving=true;state.busy=true;controls();feedback.textContent='Salvando configuração…';
      try{
        const response=await request('action',{action:action.id,target:null,reason:reason.value.trim(),params:{revision,enabled:String(enabled),weather:enabled?picker.input.value:'natural'}});
        if(!current())return;const data=ensure(response);show(data);feedback.textContent=response.message;
      }catch(error){if(current()){feedback.textContent=error.message;await refresh();}}
      finally{saving=false;if(generation===epoch)state.busy=false;if(current())controls();else if(state.open && generation===epoch)render();}
    }
    form.addEventListener('submit',event=>{event.preventDefault();change(true);});enhanceSelects();controls();refresh();
  }
  function showAction(action, initial = {}) {
    if ((!state.target && !action.targetKind) || !action.enabled) return;
    if(action.id==='staff.mode'){showModes(action);return;}
    if(action.id==='weather.save'){showWeather(action);return;}
    const target = action.targetKind ? null : { ...state.target }; const box = dialog(action.label); box.append(node('p', action.description));
    const summary = node('div', null, 'aap-target'); summary.append(node('strong', target ? target.label : action.targetKind === 'self' ? 'Sua sessão / posição atual' : 'Conta banida'), node('small', target ? `0x${target.actorId.toString(16).toUpperCase()}` : 'Acesso validado no servidor')); box.append(summary);
    const form = node('form'); const inputs = {};
    let accountInput;
    if (action.targetKind === 'account') { const label=node('label','Conta'); const picker=resourceInput('bans'); accountInput=picker.input; label.append(picker.wrapper); form.append(label); }
    for (const field of action.fields) {
      const spec=action.inputs?.[field]; const label = node('label', spec?.label || { item: 'Item autorizado', quantity: 'Quantidade (1–100)', amount: 'Novo saldo RP (Septims)' }[field]); let input,wrapper;
      if (spec?.source || field==='item') { const picker=resourceInput(spec?.source || 'items', initial[field]); input=picker.input; wrapper=picker.wrapper; }
      else if (spec?.choices) { input=node('select'); for (const [key,text] of spec.choices) { const option=node('option',text); option.value=key; input.append(option); } }
      else if (field === 'item') { input = node('select'); for (const item of state.items) { const option = node('option', item.label); option.value = item.id; input.append(option); } }
      else { input = node('input'); input.type = spec?.type === 'text' ? 'text' : 'number'; if(input.type==='number'){input.min=String(spec?.min ?? (field==='quantity'?1:0)); input.max=String(spec?.max ?? (field==='quantity'?100:1000000)); input.step='1';} else {input.maxLength=spec?.maxLength || 80; if(spec?.pattern) input.pattern=spec.pattern;} input.value=spec?.value ?? (field==='quantity'?'1':''); }
      if (!wrapper && initial[field] !== undefined) input.value=String(initial[field]);
      input.required = true; inputs[field] = input; label.append(wrapper || input); form.append(label);
    }
    let reason;
      if(!['world.probe','npc.spawn'].includes(action.id)) { const label = node('label', 'Motivo da ação'); reason = node('textarea'); reason.required = true; reason.minLength = 5; reason.maxLength = 240; reason.placeholder = 'Descreva o atendimento ou a justificativa.'; label.append(reason); form.append(label); }
    const message = node('p', action.danger ? 'Confira o alvo. Esta ação interrompe ou altera o acesso do jogador.' : 'A operação será registrada com a sua conta.', 'muted'); form.append(message);
    const error = node('p', '', 'aap-unavailable'); error.setAttribute('role', 'alert'); form.append(error);
      const controls = node('div', null, 'aap-dialog-buttons'); const cancel = button('Cancelar', dismissDialog); const confirm = button(action.id==='npc.spawn'?'Spawnar NPC':'Confirmar ação', () => {} , action.danger ? 'aap-danger' : 'aap-primary'); confirm.type = 'submit'; controls.append(cancel, confirm); form.append(controls);
    form.addEventListener('submit', async event => {
      event.preventDefault(); if (state.busy || !form.reportValidity()) return;
      if (reason && reason.value.trim().length < 5) { error.textContent = 'Informe um motivo com pelo menos 5 caracteres.'; return; }
      state.busy = true; confirm.disabled = true; cancel.disabled = true; confirm.textContent = 'Aguardando servidor…';
      const epoch = generation;
      const params = Object.fromEntries(Object.entries(inputs).map(([key, input]) => [key, input.type==='number' ? Number(input.value) : input.value]));
      try {
        const response = await request('action', { action: action.id, target: action.targetKind==='self' ? null : action.targetKind==='account' ? {accountId:Number(accountInput.value)} : { actorId: target.actorId, session: target.session }, ...(reason?{reason:reason.value.trim()}:{}), params });
        if (epoch !== generation) return;
        state.notice = { message: response.message + (response.data?.identity ? ` ${response.data.identity}` : ''), kind: response.status === 'succeeded' ? '' : response.status === 'unknown' ? 'warning' : 'error', requestId: response.requestId };
        state.result = response.status==='succeeded' && response.data && !response.data.identity ? response.data : null;
        if (response.code === 'FORBIDDEN' || response.code === 'SESSION_EXPIRED') { state.operator = null; state.actions = []; state.players = { rows: [], total: 0, page: 1 }; state.target = null; state.audit = { rows: [], total: 0, page: 1 }; state.resources=[];state.resourceData=null;state.result=null; }
      } catch (err) { if (epoch === generation) state.notice = { message: err.message, kind: 'warning' }; }
      finally { if (epoch === generation) { state.busy = false; state.dialog = null; if (state.open) render(); } }
    }); box.append(form); enhanceSelects(); const firstInput = Object.values(inputs)[0] || accountInput || reason || confirm; (enhancedSelects.get(firstInput) || firstInput).focus();
  }
  async function refreshResources(page=1) {
    const epoch=generation, ticket=++resourceRequest;
    const data={kind:'playerInventory',query:state.resourceQuery || '',page,searchBy:state.inventorySearchBy,...(state.inventoryOwner?{ownerId:state.inventoryOwner}:{})};
    state.resourceLoading=true;state.resourceData=null;state.notice=null;render();
    try { const response=await request('resources',data); if(epoch!==generation || ticket!==resourceRequest)return; state.resourceData=ensure(response); }
    catch(error){if(epoch===generation && ticket===resourceRequest)state.notice={message:error.message,kind:'error'};}
    finally{if(epoch===generation && ticket===resourceRequest){state.resourceLoading=false;if(state.open)render();}}
  }
  function renderResources(content) {
    if(!state.inventoryInspection){content.append(node('p','Seu cargo não possui permissão para consultar inventários.','aap-empty'));return;}
    const query=node('input');query.placeholder=state.inventoryOwner || state.inventorySearchBy==='items'?'Nome do item ou identificador':'Nome do jogador ou ID';query.value=state.resourceQuery || '';query.maxLength=80;query.setAttribute('aria-label','Buscar nos inventários');
    const filters=node('form',null,'aap-filters aap-inventory-filters'+(state.inventoryOwner?' aap-owner-filters':''));
    if(!state.inventoryOwner){
      const [label,kind]=filterSelect('Buscar por',[['items','Item'],['players','Jogador']],state.inventorySearchBy);filters.append(label);
      kind.addEventListener('change',()=>{state.inventorySearchBy=kind.value;state.resourceQuery='';state.resourceData=null;refreshResources();});
    }
    filters.append(query);
    const search=button('Buscar',()=>{state.resourceQuery=query.value;refreshResources();});search.disabled=state.resourceLoading;
    filters.addEventListener('submit',event=>{event.preventDefault();search.click();});filters.append(search);content.append(filters);
    if(state.inventoryOwner)content.append(button('Voltar à pesquisa',()=>{
      const back=state.inventoryBack || {searchBy:'players',query:'',page:1};state.inventoryOwner=null;state.inventorySearchBy=back.searchBy;state.resourceQuery=back.query;state.inventoryBack=null;refreshResources(back.page);
    },'aap-back-search'));
    if(state.resourceLoading){const loading=node('p','Consultando inventários…','muted');loading.setAttribute('role','status');content.append(loading);return;}
    if(!state.resourceData){content.append(node('p','Pesquise por item para ver o total e quem possui, ou escolha Jogador para abrir um inventário.','aap-empty'));return;}
    const data=state.resourceData;
    function openInventory(ownerId){
      state.inventoryBack={searchBy:state.inventorySearchBy,query:state.resourceQuery || '',page:data.page};
      state.inventoryOwner=ownerId;state.resourceQuery='';state.inventorySearchBy='items';refreshResources();
    }
    if(data.ownerLabel)content.append(node('h3','Inventário de '+data.ownerLabel));
    if(data.note)content.append(node('p',data.note,'muted aap-inventory-note'));
    const list=node('div',null,data.view==='itemOwners'?'aap-item-results':'aap-grid');
    for(const row of data.rows){
      const card=node('article',null,'aap-card');card.append(node('h3',row.label || row.id));
      if(data.view==='owners'){
        card.append(node('p',(row.online?'Online':'Offline')+' · Personagem #'+row.ownerId));
        card.append(button('Ver inventário',()=>openInventory(row.ownerId)));
      }else if(data.view==='itemOwners'){
        card.append(node('p','Total entre jogadores: '+row.totalCount+' · '+row.owners.length+' personagem(ns)','aap-inventory-total'),node('small',row.descriptor));
        const holders=node('div',null,'aap-inventory-holders');
        for(const owner of row.owners){
          const holder=node('div',null,'aap-inventory-holder'),details=node('div');
          details.append(node('strong',owner.ownerLabel+' · Quantidade: '+owner.count),node('small','Personagem #'+owner.ownerId+' · '+owner.source));
          const open=button('Ver inventário',()=>openInventory(owner.ownerId));open.setAttribute('aria-label','Ver inventário de '+owner.ownerLabel+' (personagem '+owner.ownerId+')');holder.append(details,open);holders.append(holder);
        }
        card.append(holders);
      }else{
        card.append(node('p','Quantidade: '+row.count),node('small',row.source),node('small',row.descriptor));
      }
      list.append(card);
    }
    content.append(list);
    if(!data.rows.length)content.append(node('p','Nenhum resultado encontrado.','aap-empty'));
    content.append(paginate(data,refreshResources));
  }
  function render() {
    if (!state.open || state.dialog) return;
    closeSelect();
    root.replaceChildren();
    const header = node('header', null, 'aap-header'); const brand = node('div', null, 'aap-brand');
    brand.append(node('div', 'A', 'aap-mark')); const titles = node('div'); titles.append(node('h1', 'Aetherius RP'), node('small', 'Painel administrativo')); brand.append(titles); header.append(brand);
    const account = node('div', null, 'aap-header-actions');
    if (window.AetheriusAdminDemo) account.append(node('span', 'Demonstração · dados fictícios', 'aap-badge aap-demo'));
    if (state.operator) account.append(node('span', state.operator.label, 'muted'), node('span', roleLabels[state.operator.role] || state.operator.role, 'aap-badge'));
    account.append(button('Fechar · Esc', close)); header.append(account); root.append(header);
    const layout = node('div', null, 'aap-layout'); layout.append(renderSidebar()); const main = node('main', null, 'aap-main'); const nav = node('nav', null, 'aap-nav'); nav.setAttribute('aria-label', 'Áreas administrativas'); nav.setAttribute('role', 'tablist');
    for (const [id, label] of categories) { const tab = button(label, () => { state.tab = id; state.notice = null; state.result=null; if (id === 'audit') refreshAudit(); else render(); }); tab.setAttribute('role', 'tab'); tab.setAttribute('aria-selected', String(state.tab === id)); nav.append(tab); }
    main.append(nav); const content = node('div', null, 'aap-content');
    if (state.notice) { const notice = node('div', state.notice.message, `aap-notice ${state.notice.kind}`); notice.setAttribute('role', 'status'); if (state.notice.requestId) notice.append(node('div', `Solicitação: ${state.notice.requestId}`, 'muted')); content.append(notice); }
    if(state.result)content.append(node('pre',JSON.stringify(state.result,null,2),'aap-result'));
    const [, label, description] = categories.find(category => category[0] === state.tab); const title = node('div', null, 'aap-title'); title.append(node('h2', label), node('p', description)); content.append(title);
    if (!state.operator) content.append(node('p', 'Acesso restrito à Staff autorizada.', 'aap-empty'), button('Tentar conectar', open));
    else if (state.tab === 'audit') renderAudit(content); else if(state.tab==='resources')renderResources(content); else renderActions(content);
    main.append(content); layout.append(main); root.append(layout);
    const footer = node('footer', null, 'aap-status'); footer.append(node('span', window.AetheriusAdminDemo ? 'Ambiente de demonstração — nenhuma alteração no servidor' : state.operator ? 'Acesso validado pelo servidor' : 'Sem sessão administrativa'), node('span', state.busy ? 'Operação em andamento' : 'F7 abre / fecha · Esc fecha')); root.append(footer);
    enhanceSelects();
  }
  root.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); state.dialog ? dismissDialog() : close(); }
    if (event.key === 'Tab' && state.dialog) {
      const focusable = [...state.dialog.querySelectorAll('button:not(:disabled),input,select,textarea')].filter(el => !el.hidden && !el.disabled); const first = focusable[0]; const last = focusable.at(-1);
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
