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
  if (!['open', 'players', 'action', 'audit', 'close'].includes(message.type)) fail('INVALID', 'Ação desconhecida.');
  const data = message.data || {};
  if (JSON.stringify(message).length > 4096) fail('INVALID', 'Solicitação muito grande.');
  if (message.type === 'action') {
    keys(data, ['action', 'target', 'reason', 'params']);
    if (!byId.has(data.action)) fail('INVALID', 'Ação desconhecida.');
    keys(data.target, ['actorId', 'session']);
    if (!integer(data.target.actorId, 1, 0xffffffff) || typeof data.target.session !== 'string' || !/^[a-zA-Z0-9_-]{16,64}$/.test(data.target.session)) fail('INVALID', 'Selecione novamente o jogador.');
    if (typeof data.reason !== 'string' || data.reason.trim().length < 5 || data.reason.length > 240 || /[\x00-\x1f]/.test(data.reason)) fail('INVALID', 'Informe um motivo entre 5 e 240 caracteres.');
    keys(data.params || {}, byId.get(data.action).fields || []);
    const params = data.params || {};
    if (data.action === 'inventory.grant' && (typeof params.item !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(params.item) || !integer(params.quantity, 1, 100))) fail('INVALID', 'Selecione um item e uma quantidade entre 1 e 100.');
    if (data.action === 'economy.setGold' && !integer(params.amount, 0, 1000000)) fail('INVALID', 'Informe um saldo inteiro entre 0 e 1.000.000.');
    return { ...message, data: { ...data, reason: data.reason.trim(), params } };
  }
  if (message.type === 'players' || message.type === 'audit') {
    keys(data, message.type === 'audit' ? ['query', 'page', 'action', 'status'] : ['query', 'page']);
    if (data.query !== undefined && (typeof data.query !== 'string' || data.query.length > 80)) fail('INVALID', 'Busca inválida.');
    if (data.page !== undefined && !integer(data.page, 1, 10000)) fail('INVALID', 'Página inválida.');
    if (data.action && !byId.has(data.action)) fail('INVALID', 'Filtro inválido.');
    if (data.status && !['accepted', 'succeeded', 'rejected', 'failed', 'unknown'].includes(data.status)) fail('INVALID', 'Filtro inválido.');
  } else keys(data, []);
  return { ...message, data };
}
module.exports = { AdminError, fail, validate };
