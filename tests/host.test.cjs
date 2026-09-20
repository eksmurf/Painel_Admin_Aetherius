'use strict';
const { test } = require('node:test'); const assert = require('node:assert/strict');
const { createHost } = require('../gamemode/skymp-host.cjs');
function setup() {
  let connected = true; const calls = []; const chars = { 100: { accountId: 1, characterId: 10 }, 200: { accountId: 2, characterId: 20 } };
  const locations = { 100: { cellOrWorldDesc: '1:Skyrim.esm', pos: [0,0,0], rot: [0,0,0] }, 200: { cellOrWorldDesc: '2:Skyrim.esm', pos: [100,200,300], rot: [0,0,0] } };
  let inventory = 3;
  const mp = { getUserByActor: id => id === 100 ? 0 : 1, getUserActor: id => id === 0 ? 100 : 200, isConnected: id => connected && id < 2, getUserGuid: id => `guid-${id}`, kick: id => calls.push(id), get: id => locations[id], set: (id, _, value) => { locations[id] = value; }, getIdFromDesc: () => 15, lookupEspmRecordById: () => ({}), getDescFromId: id => `${id}:Skyrim.esm`, callPapyrusFunction: async (_kind,_class,name,self,args) => { calls.push([name,self,args]); if (name === 'AddItem') inventory += args[1]; else return inventory; }, sendCustomPacket: (id, data) => calls.push([id, data]) };
  const host = createHost({ mp, commands: { getActiveCharacterData: id => chars[id] }, identity: { getDisplayName: () => 'Desconhecido', getCharacterFullName: () => 'Nome' }, espm: { lookup: () => ({ existe: true }), pareceItem: () => ({ ok: true }) }, maxPlayers: 2 });
  return { host, calls, mp, chars, disconnect: () => { connected = false; } };
}
test('network slot zero is valid and kick uses it instead of actor ID', () => { const f = setup(); f.host.kick(f.host.session(100)); assert.deepEqual(f.calls, [0]); });
test('same actor reused after disconnect receives a new session token', () => { const f = setup(); const first = f.host.session(100); f.host.invalidate(0); assert.notEqual(f.host.session(100).session, first.session); assert.throws(() => f.host.kick(first)); });
test('character replacement invalidates session', () => { const f = setup(); const first = f.host.session(100); f.chars[100] = { accountId: 1, characterId: 10 }; assert.notEqual(f.host.session(100).session, first.session); });
test('disconnected actor cannot receive a private reply', () => { const f = setup(); const session = f.host.session(100); f.disconnect(); assert.throws(() => f.host.send(session, {})); assert.equal(f.calls.length, 0); });
test('teleport includes cell and verifies authoritative location', () => { const f = setup(); f.host.teleport(f.host.session(100), f.host.session(200)); assert.equal(f.mp.get(100).cellOrWorldDesc, '2:Skyrim.esm'); });
test('item calls use typed form references and verify count after adding', async () => { const f = setup(); await f.host.deliverItem(f.host.session(100), 15, 2); assert.equal(f.calls[1][0], 'AddItem'); assert.equal(f.calls[1][1].type, 'form'); assert.equal(f.calls[1][2][0].type, 'espm'); assert.deepEqual(f.calls[1][2].slice(1), [2, true]); });
test('item resolver is fail-closed when capability is unavailable', () => { const f = setup(); f.mp.lookupEspmRecordById = undefined; assert.throws(() => f.host.resolveItem({ descriptor: 'f:Skyrim.esm' })); });
test('synthetic account zero is not an administrative identity', () => { const f = setup(); f.chars[100].accountId = 0; assert.equal(f.host.session(100), null); });
