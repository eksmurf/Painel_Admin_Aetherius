'use strict';
const crypto = require('node:crypto');
const { actions, byId } = require('./catalog.cjs');
const { fail, validate } = require('./protocol.cjs');
const ranks = { moderator: 1, admin: 2, owner: 3 };
function createService({ host, store, enabledActions, items = [], extensions = null, now = Date.now }) {
  const enabled = new Set(enabledActions);
  const limits = new Map();
  function rateLimit(actorId) {
    const time = now();
    let bucket = limits.get(actorId);
    if (!bucket || time - bucket.start >= 10000) { bucket = { start: time, count: 0 }; limits.set(actorId, bucket); }
    if (++bucket.count > 20) fail('RATE_LIMIT', 'Aguarde alguns segundos antes de tentar novamente.');
    if (limits.size > 2048) for (const [id, item] of limits) if (time - item.start >= 10000) limits.delete(id);
  }
  function current(actorId, expected) {
    const session = host.session(actorId);
    if (!session || (expected && session.session !== expected.session)) fail('SESSION_EXPIRED', 'A sessão mudou. Atualize a lista de jogadores.');
    return session;
  }
  async function authorize(operator, permission) {
    const auth = await store.authorize(operator);
    current(operator.actorId, operator);
    if (!auth || !auth.permissions.includes('panel.open') || (permission && !auth.permissions.includes(permission))) fail('FORBIDDEN', 'Você não tem permissão para esta operação.');
    return auth;
  }
  function catalog(auth) {
    return actions.filter(action => !action.panelHidden).map(action => ({ ...action, enabled: !action.unavailable && enabled.has(action.id) && auth.permissions.includes(action.permission), unavailable: action.unavailable || (!auth.permissions.includes(action.permission) ? 'Seu cargo não possui esta permissão.' : !enabled.has(action.id) ? 'Ação não habilitada pelo servidor.' : '') }));
  }
  async function players(operator, data) {
    const needle = (data.query || '').toLocaleLowerCase('pt-BR');
    const rows = host.players().map(player => ({ actorId: player.actorId, session: player.session, label: host.visibleName(operator, player), self: player.actorId === operator.actorId }));
    const filtered = rows.filter(player => !needle || player.label.toLocaleLowerCase('pt-BR').includes(needle) || player.actorId.toString(16).includes(needle.replace(/^0x/, '')));
    const page = data.page || 1;
    return { rows: filtered.slice((page - 1) * 20, page * 20), total: filtered.length, online: rows.length, page, pageSize: 20 };
  }
  async function action(operator, message) {
    const data = message.data;
    const definition = byId.get(data.action);
    if (definition.unavailable || !enabled.has(data.action)) fail('UNAVAILABLE', 'Ação não habilitada neste servidor.');
    let auth = await authorize(operator, definition.permission);
    const target = definition.targetKind === 'self' ? operator : definition.targetKind === 'account' ? await store.account(data.target.accountId) : current(data.target.actorId, data.target);
    const currentTarget = () => { if (!target.offline) current(target.actorId, target); };
    const targetRole = await store.targetRole(target.accountId);
    currentTarget();
    if (target.accountId === operator.accountId && ['player.ban', 'player.unban'].includes(data.action)) fail('INVALID', 'Não é possível alterar o próprio banimento.');
    if (target.actorId === operator.actorId && ['player.kick', 'player.bring', 'player.teleportTo', 'character.retire'].includes(data.action)) fail('INVALID', 'Selecione outro jogador para esta ação.');
    if (target.actorId !== operator.actorId && auth.role !== 'owner' && (ranks[targetRole] || 0) >= (ranks[auth.role] || 0)) fail('FORBIDDEN', 'Seu cargo não pode executar esta ação sobre este membro da Staff.');
    const hash = crypto.createHash('sha256').update(JSON.stringify([data.action, target.offline ? target.accountId : target.actorId, target.session, data.reason, Object.entries(data.params).sort()])).digest('hex');
    const operation = { requestId: message.requestId, accountId: operator.accountId, characterId: operator.characterId, targetAccountId: target.accountId, targetCharacterId: target.characterId, action: data.action, reason: data.reason, sensitive: !!definition.sensitive, hash };
    const reservation = await store.reserve(operation);
    if (!reservation.fresh) {
      if (reservation.hash !== hash) fail('CONFLICT', 'Este identificador já foi usado para outra operação.');
      return reservation.result || { status: 'unknown', message: 'Operação já recebida. Consulte a auditoria antes de repetir.' };
    }
    let effectStarted = false;
    try {
      // Every await can outlive a session or role. Check again just before effects.
      auth = await authorize(operator, definition.permission);
      const latestTargetRole = await store.targetRole(target.accountId);
      if (target.actorId !== operator.actorId && auth.role !== 'owner' && (ranks[latestTargetRole] || 0) >= (ranks[auth.role] || 0)) fail('FORBIDDEN', 'A permissão sobre o alvo mudou.');
      current(operator.actorId, operator);
      currentTarget();
      const validateSession = () => { current(operator.actorId, operator); currentTarget(); };
      const item = data.action === 'inventory.grant' ? (extensions?.item(data.params.item) || items.find(entry => entry.id === data.params.item)) : null;
      if (data.action === 'inventory.grant' && !item) fail('INVALID', 'Item não autorizado no catálogo.');
      if (data.action === 'economy.setGold' || data.action === 'inventory.grant' || data.action === 'character.retire') {
        if (item) host.resolveItem(item); // Fail closed before changing inventory.
        validateSession();
        effectStarted = true;
        const result = await store.mutate(operation, data.params, target, { item, host, validateSession, permission: definition.permission });
        // Store commits the domain change and result together. Never reapply a delta on reconnect.
        if (data.action === 'character.retire') {
          try { validateSession(); host.kick(target); } catch { /* retired state remains committed */ }
        }
        return result;
      }
      validateSession();
      let result;
      if (data.action === 'identity.reveal') {
        result = { status: 'succeeded', message: 'Identidade consultada e registrada.', data: { identity: host.realName(target) } };
      } else if (data.action === 'player.kick') {
        effectStarted = true;
        host.kick(target);
        result = { status: 'succeeded', message: 'Desconexão da sessão solicitada ao servidor.' };
      } else if (data.action === 'player.bring' || data.action === 'player.teleportTo') {
        effectStarted = true;
        host.teleport(data.action === 'player.bring' ? target : operator, data.action === 'player.bring' ? operator : target);
        result = { status: 'succeeded', message: 'Localização atualizada no servidor.' };
      } else if (extensions) {
        const prepared = await extensions.prepare(data.action, data.params, operator, target);
        const finalAuth = await authorize(operator, definition.permission);
        const finalTargetRole = await store.targetRole(target.accountId);
        if (target.accountId !== operator.accountId && finalAuth.role !== 'owner' && (ranks[finalTargetRole] || 0) >= (ranks[finalAuth.role] || 0)) fail('FORBIDDEN','A permissão sobre o alvo mudou.');
        validateSession();
        effectStarted = true;
        result = await extensions.execute({ operation, definition, params: data.params, operator, target, prepared, validateSession });
      } else {
        fail('UNAVAILABLE', 'Extensão não instalada neste servidor.');
      }
      await store.finish(operation, result);
      return result;
    } catch (error) {
      if (error.noEffect) effectStarted = false;
      const result = { status: effectStarted ? 'unknown' : 'rejected', code: error.code || 'OPERATION_FAILED', message: effectStarted ? 'Não foi possível confirmar o resultado. Consulte a auditoria antes de repetir.' : error.code ? error.message : 'Operação recusada antes da execução.' };
      try { await store.finish(operation, result); } catch { /* accepted operation remains for reconciliation */ }
      return result;
    }
  }
  async function handle(actorId, raw) {
    let message;
    let operator;
    try {
      rateLimit(actorId);
      message = validate(raw);
      operator = current(actorId);
      const auth = await authorize(operator, message.type === 'audit' ? 'logs.view' : null);
      if (['open', 'players'].includes(message.type) && !auth.permissions.includes('players.view')) fail('FORBIDDEN', 'Você não tem permissão para consultar jogadores.');
      let data;
      if (message.type === 'open') data = { operator: { role: auth.role, label: host.visibleName(operator, operator) }, actions: catalog(auth), inventoryInspection: auth.permissions.includes('inventory.inspect'), resources: extensions ? Object.entries(require('./extension-catalog.cjs').resourcePermissions).filter(([, permission]) => auth.permissions.includes(permission)).map(([kind]) => kind).filter(kind => require('./extension-catalog.cjs').visibleResources.includes(kind)) : [], items: auth.permissions.includes('inventory.grant') ? items.slice(0, 100).map(({ id, label, category }) => ({ id, label, category })) : [], players: await players(operator, {}) };
      else if (message.type === 'players') data = await players(operator, message.data);
      else if (message.type === 'audit') data = await store.audit(message.data, auth.permissions.includes('logs.view.security'));
        else if (message.type === 'weather') {
          await authorize(operator,'world.weather');
          if (!extensions || !enabled.has('weather.save')) fail('UNAVAILABLE','Clima do servidor indisponível.');
          data = await extensions.weatherState();
          await authorize(operator,'world.weather');
        }
        else if (message.type === 'modes') {
        await authorize(operator,'staff.modes');
        if (!extensions || !enabled.has('staff.mode')) fail('UNAVAILABLE','Modo de atendimento indisponível.');
        data = extensions.modeState(operator);
      }
      else if (message.type === 'resources') {
        await authorize(operator, require('./extension-catalog.cjs').resourcePermissions[message.data.kind]);
        if (!extensions) fail('UNAVAILABLE', 'Catálogo não instalado.');
        const inspect = message.data.kind === 'playerInventory' || (message.data.kind === 'items' && ['players','chests'].includes(message.data.scope));
        if (inspect) await authorize(operator,'inventory.inspect');
        data = await extensions.resources(message.data, operator);
        await authorize(operator, inspect ? 'inventory.inspect' : require('./extension-catalog.cjs').resourcePermissions[message.data.kind]);
      }
      else if (message.type === 'action') return { version: 1, requestId: message.requestId, type: message.type, ...await action(operator, message) };
      else data = {};
      current(actorId, operator);
      return { version: 1, requestId: message.requestId, type: message.type, status: 'succeeded', data };
    } catch (error) {
      if (operator && error.code === 'FORBIDDEN') {
        try { await store.denied(operator.accountId, message?.type); } catch { /* no operation was executed */ }
      }
      return { version: 1, requestId: message?.requestId || (typeof raw?.requestId === 'string' && /^[a-zA-Z0-9_-]{8,64}$/.test(raw.requestId) ? raw.requestId : null), type: message?.type || 'error', status: 'rejected', code: error.code || 'UNAVAILABLE', message: error.code ? error.message : 'Serviço indisponível. Nenhuma nova ação foi autorizada.' };
    }
  }
  return { handle };
}
module.exports = { createService };
