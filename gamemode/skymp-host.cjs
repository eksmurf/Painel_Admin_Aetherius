'use strict';
const { randomUUID } = require('node:crypto');
const { fail } = require('./protocol.cjs');
function createHost({ mp, commands, identity, espm, maxPlayers = 64 }) {
  const sessions = new Map();
  const invalidate = userId => { for (const [actorId, data] of sessions) if (data.userId === userId) sessions.delete(actorId); };
  function session(actorId) {
    try {
      const character = commands.getActiveCharacterData(actorId);
      const userId = mp.getUserByActor(actorId);
      if (!character || !Number.isSafeInteger(character.accountId) || character.accountId < 1 || !Number.isSafeInteger(character.characterId) || character.characterId < 1 || !Number.isInteger(userId) || userId < 0 || !mp.isConnected(userId) || mp.getUserActor(userId) !== actorId) { sessions.delete(actorId); return null; }
      const guid = mp.getUserGuid(userId);
      let current = sessions.get(actorId);
      if (!current || current.character !== character || current.guid !== guid || current.userId !== userId) {
        current = { actorId, userId, guid, character, accountId: character.accountId, characterId: character.characterId, session: randomUUID() };
        sessions.set(actorId, current);
      }
      return current;
    } catch { return null; }
  }
  function assertCurrent(expected) {
    if (session(expected.actorId)?.session !== expected.session) fail('SESSION_EXPIRED', 'A sessão do jogador mudou.');
  }
  function players() {
    const rows = [];
    for (let userId = 0; userId < maxPlayers; userId++) {
      try { if (mp.isConnected(userId)) { const player = session(mp.getUserActor(userId)); if (player) rows.push(player); } } catch { /* unused slot */ }
    }
    return rows;
  }
  function teleport(source, destination) {
    assertCurrent(source); assertCurrent(destination);
    const location = mp.get(destination.actorId, 'locationalData');
    if (!location || typeof location.cellOrWorldDesc !== 'string' || !['pos', 'rot'].every(key => Array.isArray(location[key]) && location[key].length === 3 && location[key].every(Number.isFinite))) fail('LOCATION_INVALID', 'Localização indisponível.');
    const copy = { cellOrWorldDesc: location.cellOrWorldDesc, pos: [...location.pos], rot: [...location.rot] };
    mp.set(source.actorId, 'locationalData', copy);
    const after = mp.get(source.actorId, 'locationalData');
    if (!after || after.cellOrWorldDesc !== copy.cellOrWorldDesc || !after.pos.every((value, index) => Math.abs(value - copy.pos[index]) < 5)) throw new Error('Teleport not confirmed');
  }
  function kick(target) {
    assertCurrent(target);
    // Same actor->user boundary corrected by Heavy RP's skymp-adapter. Zero is valid.
    const userId = mp.getUserByActor(target.actorId);
    if (!Number.isInteger(userId) || userId < 0 || userId !== target.userId) fail('SESSION_EXPIRED', 'A sessão do jogador mudou.');
    mp.kick(userId);
    sessions.delete(target.actorId);
  }
  function resolveItem(item) {
    if (typeof mp.getIdFromDesc !== 'function' || typeof mp.lookupEspmRecordById !== 'function') fail('UNAVAILABLE', 'Catálogo de itens indisponível.');
    const id = mp.getIdFromDesc(item.descriptor);
    const entry = espm.lookup(id);
    if (!Number.isInteger(id) || id <= 0 || entry.indisponivel || !entry.existe || !espm.pareceItem(id).ok) fail('INVALID', 'Item não encontrado entre os itens autorizados do servidor.');
    return id;
  }
  async function deliverItem(target, baseId, quantity) {
    assertCurrent(target);
    const self = { type: 'form', desc: mp.getDescFromId(target.actorId) };
    const base = { type: 'espm', desc: mp.getDescFromId(baseId) };
    const before = await mp.callPapyrusFunction('method', 'ObjectReference', 'GetItemCount', self, [base]);
    if (!Number.isInteger(before) || before < 0) throw new Error('Inventory count unavailable');
    assertCurrent(target);
    await mp.callPapyrusFunction('method', 'ObjectReference', 'AddItem', self, [base, quantity, true]);
    assertCurrent(target);
    const after = await mp.callPapyrusFunction('method', 'ObjectReference', 'GetItemCount', self, [base]);
    if (after !== before + quantity) throw new Error('Inventory delivery not confirmed');
  }
  return { session, players, invalidate, teleport, kick, resolveItem, deliverItem,
    visibleName: (observer, target) => identity.getDisplayName(observer.character, target.character),
    realName: target => identity.getCharacterFullName(target.character),
    send: (operator, response) => { assertCurrent(operator); mp.sendCustomPacket(operator.userId, JSON.stringify({ customPacketType: 'aetheriusAdmin', response })); }
  };
}
module.exports = { createHost };
