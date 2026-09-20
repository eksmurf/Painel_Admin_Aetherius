'use strict';
const { createService } = require('../gamemode/service.cjs');
const { actions } = require('../gamemode/catalog.cjs');
function createDemo() {
  const players = [
    ['Marina', 11, 'owner'], ['Viajante 042', 42], ['Alva', 58], ['Desconhecido', 73], ['Soren', 81], ['Viajante 019', 19], ['Desconhecido', 96], ['Livia', 108]
  ].map(([label, id, role], index) => ({ actorId: 0xff000100 + index, characterId: id, accountId: id + 100, session: `demo_session_${id}_000000`, label, role, gold: 250 }));
  const operations = new Map(); const history = [];
  const items = [{ id: 'healing', label: 'Poção de cura', descriptor: '3eadd:Skyrim.esm' }, { id: 'bread', label: 'Pão', descriptor: '65c97:Skyrim.esm' }];
  const host = {
    session: id => players.find(p => p.actorId === id) || null,
    players: () => players,
    visibleName: (observer, target) => target.label,
    realName: target => `Personagem demonstrativo ${target.characterId}`,
    resolveItem: () => 123,
    teleport: () => {},
    kick: target => { const index = players.indexOf(target); if (index >= 0) players.splice(index, 1); }
  };
  const finish = async (op, result) => { operations.get(`${op.accountId}:${op.requestId}`).result = structuredClone(result); const row = history.find(row => row.request_id === op.requestId); if (row) row.status = result.status; };
  const store = {
    authorize: async player => player.role === 'owner' ? { role: 'owner', permissions: ['panel.open', 'players.view', 'logs.view', 'logs.view.security', ...actions.map(a => a.permission).filter(Boolean)] } : null,
    targetRole: async accountId => players.find(p => p.accountId === accountId)?.role,
    reserve: async op => {
      const key = `${op.accountId}:${op.requestId}`;
      if (operations.has(key)) return { ...operations.get(key), fresh: false };
      operations.set(key, { hash: op.hash });
      history.unshift({ id: history.length + 1, request_id: op.requestId, account_id: op.accountId, target_character_id: op.targetCharacterId, action: op.action, reason: op.reason, sensitive: op.sensitive, status: 'accepted', created_at: new Date().toISOString() });
      return { fresh: true };
    }, finish,
    mutate: async (op, params, target) => {
      const result = { status: 'succeeded', message: 'Operação simulada. Nenhum dado real foi alterado.' };
      if (op.action === 'economy.setGold') { result.data = { before: target.gold, after: params.amount }; target.gold = params.amount; }
      await finish(op, result); return result;
    },
    audit: async filters => {
      const rows = history.filter(row => (!filters.action || row.action === filters.action) && (!filters.status || row.status === filters.status) && (!filters.query || row.request_id === filters.query || String(row.target_character_id) === filters.query));
      const page = filters.page || 1; return { rows: rows.slice((page - 1) * 20, page * 20), total: rows.length, page, pageSize: 20 };
    }, denied: async () => {}
  };
  for (let index = 0; index < 8; index++) history.push({ id: index + 1, request_id: `demo-history-${index}`, account_id: 111, target_character_id: players[index].characterId, action: ['player.teleportTo', 'economy.setGold', 'player.kick'][index % 3], reason: ['Atendimento de chamado de suporte.', 'Ajuste após conferência da equipe.', 'Encerramento de sessão de teste.'][index % 3], status: index === 3 ? 'unknown' : 'succeeded', created_at: new Date(Date.now() - index * 3600000).toISOString() });
  return { service: createService({ host, store, items, enabledActions: actions.filter(a => !a.unavailable).map(a => a.id) }), operatorId: players[0].actorId, players, store, host };
}
module.exports = { createDemo };
