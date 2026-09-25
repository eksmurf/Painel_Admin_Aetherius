'use strict';
const { byId } = require('./catalog.cjs');
class AdminError extends Error { constructor(code, message) { super(message); this.code = code; } }
const fail = (code, message) => { throw new AdminError(code, message); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function keys(value, allowed) {
  if (!object(value) || Object.keys(value).some(key => !allowed.includes(key))) fail('INVALID', 'Solicitação inválida.');
}
function integer(value, min, max) { return Number.isSafeInteger(value) && value >= min && value <= max; }
function validate(message) {
  keys(message, ['version', 'requestId', 'type', 'data']);
  if (message.version !== 1 || typeof message.requestId !== 'string' || !/^[a-zA-Z0-9_-]{8,64}$/.test(message.requestId)) fail('INVALID', 'Solicitação inválida.');
  if (!['open', 'players', 'action', 'audit', 'resources', 'modes', 'weather', 'close'].includes(message.type)) fail('INVALID', 'Ação desconhecida.');
  const data = message.data || {};
  if (JSON.stringify(message).length > 4096) fail('INVALID', 'Solicitação muito grande.');
  if (message.type === 'action') {
    keys(data, ['action', 'target', 'reason', 'params']);
    if (!byId.has(data.action)) fail('INVALID', 'Ação desconhecida.');
    const definition = byId.get(data.action);
    if (definition.targetKind === 'self') {
      if (data.target !== null) fail('INVALID', 'Esta ação usa somente o próprio operador.');
    } else if (definition.targetKind === 'account') {
      keys(data.target, ['accountId']);
      if (!integer(data.target.accountId, 1, 2147483647)) fail('INVALID', 'Conta inválida.');
    } else {
      keys(data.target, ['actorId', 'session']);
      if (!integer(data.target.actorId, 1, 0xffffffff) || typeof data.target.session !== 'string' || !/^[a-zA-Z0-9_-]{16,64}$/.test(data.target.session)) fail('INVALID', 'Selecione novamente o jogador.');
    }
    const reason = data.action === 'staff.mode' ? 'Ajuste do próprio modo de atendimento' : data.action === 'npc.spawn' ? 'Spawn imediato de NPC junto ao operador' : data.action === 'world.probe' ? 'Consulta de diagnóstico do mundo' : data.reason;
    if (typeof reason !== 'string' || reason.trim().length < 5 || reason.length > 240 || /[\x00-\x1f]/.test(reason)) fail('INVALID', 'Informe um motivo entre 5 e 240 caracteres.');
    keys(data.params || {}, byId.get(data.action).fields || []);
    const params = data.params || {};
    for (const [name, spec] of Object.entries(definition.inputs || {})) {
      const value = params[name];
      if (spec.type === 'integer') {
        if (!integer(value, spec.min, spec.max)) fail('INVALID', `Valor inválido: ${spec.label}.`);
      } else if (typeof value !== 'string' || value.length > (spec.maxLength || 80) || value.length < (spec.minLength || 1) || /[\x00-\x1f]/.test(value)
        || (spec.pattern && !new RegExp(spec.pattern).test(value)) || (spec.choices && !spec.choices.some(([key]) => key === value))) fail('INVALID', `Valor inválido: ${spec.label}.`);
    }
    if (data.action === 'inventory.grant' && (typeof params.item !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(params.item) || !integer(params.quantity, 1, 100))) fail('INVALID', 'Selecione um item e uma quantidade entre 1 e 100.');
    if (data.action === 'economy.setGold' && !integer(params.amount, 0, 1000000)) fail('INVALID', 'Informe um saldo inteiro entre 0 e 1.000.000.');
    return { ...message, data: { ...data, reason: data.action === 'staff.mode' ? `${reason}: ${params.mode} ${params.enabled === 'true' ? 'ativar' : 'desativar'} (${params.speed}%)` : reason.trim(), params } };
  }
  if (message.type === 'resources') {
    keys(data, ['kind', 'query', 'page', 'category', 'scope', 'ownerId', 'searchBy']);
    if (data.searchBy !== undefined && (data.kind !== 'playerInventory' || !['items','players'].includes(data.searchBy))) fail('INVALID','Tipo de busca inválido.');
    if (data.scope !== undefined && (!['catalog','players','chests'].includes(data.scope) || data.kind !== 'items')) fail('INVALID','Escopo inválido.');
    if (data.ownerId !== undefined && (!integer(data.ownerId,1,2147483647) || data.kind !== 'playerInventory')) fail('INVALID','Personagem inválido.');
    if (!Object.hasOwn(require('./extension-catalog.cjs').resourcePermissions, data.kind)) fail('INVALID', 'Catálogo desconhecido.');
    if (data.query !== undefined && (typeof data.query !== 'string' || data.query.length > 80)) fail('INVALID', 'Busca inválida.');
    if (data.category !== undefined && (typeof data.category !== 'string' || data.category.length > 80)) fail('INVALID', 'Categoria inválida.');
    if (data.page !== undefined && !integer(data.page, 1, 10000)) fail('INVALID', 'Página inválida.');
  } else if (message.type === 'players' || message.type === 'audit') {
    keys(data, message.type === 'audit' ? ['query', 'page', 'action', 'status'] : ['query', 'page']);
    if (data.query !== undefined && (typeof data.query !== 'string' || data.query.length > 80)) fail('INVALID', 'Busca inválida.');
    if (data.page !== undefined && !integer(data.page, 1, 10000)) fail('INVALID', 'Página inválida.');
    if (data.action && !byId.has(data.action)) fail('INVALID', 'Filtro inválido.');
    if (data.status && !['accepted', 'succeeded', 'rejected', 'failed', 'unknown'].includes(data.status)) fail('INVALID', 'Filtro inválido.');
  } else keys(data, []);
  return { ...message, data };
}
module.exports = { AdminError, fail, validate };
