'use strict';
const { randomUUID } = require('node:crypto');
const { fail } = require('./protocol.cjs');
const validLocation = loc => loc && typeof loc.cellOrWorldDesc === 'string' && ['pos','rot'].every(key => Array.isArray(loc[key]) && loc[key].length === 3 && loc[key].every(Number.isFinite));
const distance = (a, b) => validLocation(a) && validLocation(b) && a.cellOrWorldDesc.toLowerCase() === b.cellOrWorldDesc.toLowerCase() ? Math.hypot(...a.pos.map((n, i) => n - b.pos[i])) : Infinity;
function createWorldHost({ mp, host, now = Date.now }) {
  const pending = new Map();
  function location(actorId) {
    const value = mp.get(actorId, 'locationalData');
    if (!validLocation(value)) fail('LOCATION_INVALID', 'Localização indisponível.');
    return JSON.parse(JSON.stringify(value));
  }
  function resolve(descriptor, types) {
    if (typeof descriptor !== 'string' || !/^[0-9a-f]+:[^:\r\n]+\.(esm|esp|esl)$/i.test(descriptor)) fail('INVALID', 'Descritor de plugin inválido.');
    const id = mp.getIdFromDesc(descriptor);
    const record = mp.lookupEspmRecordById(id)?.record;
    if (!id || !record || !types.includes(record.type)) fail('INVALID', 'Registro ausente ou incompatível com os plugins carregados.');
    return id;
  }
  function move(actorId, loc) {
    if (!validLocation(loc)) fail('LOCATION_INVALID', 'Destino inválido.');
    resolve(loc.cellOrWorldDesc, ['CELL','WRLD']);
    mp.set(actorId, 'locationalData', JSON.parse(JSON.stringify(loc)));
    if (distance(location(actorId), loc) > 5) throw Error('Movimento não confirmado pelo servidor');
  }
  function request(player, command, data = {}, timeoutMs = 8000) {
    if (host.session(player.actorId)?.session !== player.session) fail('SESSION_EXPIRED', 'Sessão encerrada.');
    const token = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(token); reject(Error('Cliente não confirmou a execução')); }, timeoutMs);
      timer.unref?.();
      pending.set(token, { player, resolve, reject, timer });
      try { mp.sendCustomPacket(player.userId, JSON.stringify({ customPacketType: 'aetheriusAdminCommand', token, command, data })); }
      catch (error) { clearTimeout(timer); pending.delete(token); reject(error); }
    });
  }
  function receive(actorId, data) {
    if (!data || typeof data.token !== 'string' || JSON.stringify(data).length > 8192) return;
    const entry = pending.get(data.token);
    if (!entry || entry.player.actorId !== actorId || host.session(actorId)?.session !== entry.player.session) return;
    pending.delete(data.token); clearTimeout(entry.timer);
    if (data.ok !== true) entry.reject(Error('Cliente recusou a operação: ' + String(data.error || '').slice(0, 200)));
    else entry.resolve(data.result || {});
  }
  async function spawn(anchor, descriptor, loc) {
    resolve(descriptor, ['NPC_']);
    const value = await mp.callPapyrusFunction('method', 'ObjectReference', 'PlaceAtMe', { type: 'form', desc: mp.getDescFromId(anchor) }, [{ type: 'espm', desc: descriptor }, 1, false, true]);
    if (!value?.desc) throw Error('PlaceAtMe não devolveu uma referência');
    const id = mp.getIdFromDesc(value.desc);
    if (!id || id < 0xff000000) throw Error('Referência dinâmica inválida');
    try {
      move(id, loc); mp.set(id, 'spawnPoint', loc); mp.set(id, 'spawnDelay', 1e9); mp.set(id, 'isDisabled', false);
      return { actorId: id, descriptor: value.desc };
    } catch (error) { try { mp.destroyActor(id); } catch {} throw error; }
  }
  function destroy(descriptor) {
    const id = mp.getIdFromDesc(descriptor);
    if (id < 0xff000000 || host.players().some(p => p.actorId === id)) throw Error('Recusa de remoção de ator não administrado');
    try { mp.get(id, 'locationalData'); } catch { return; } // already gone after world reset
    mp.destroyActor(id);
  }
  function near(actorId) {
    const loc = location(actorId), angle = loc.rot[2] * Math.PI / 180;
    loc.pos[0] += 96 * Math.sin(angle); loc.pos[1] += 96 * Math.cos(angle); loc.pos[2] += 64;
    return loc;
  }
  return { location, resolve, move, spawn, destroy, near, request, receive,
    healthy: id => { try { return !mp.get(id, 'isDead'); } catch { return false; } },
    shutdown: () => { for (const p of pending.values()) { clearTimeout(p.timer); p.reject(Error('Servidor encerrando')); } pending.clear(); }
  };
}
module.exports = { createWorldHost, validLocation, distance };
