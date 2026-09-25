'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./extension-fixture.cjs');
test('schema reinitialization preserves revoked extension permissions',async t=>{
  const f=await fixture(t);
  await f.db.query("DELETE FROM aetherius_admin_permissions WHERE role='owner' AND permission='world.weather'");
  await require('../gamemode/extension-store.cjs').createExtensionStore(f.db).init();
  assert.equal((await f.db.query("SELECT permission FROM aetherius_admin_permissions WHERE role='owner' AND permission='world.weather'")).length,0);
});
test('server weather ignores distance and releases the override inside interiors',async t=>{
  const f=await fixture(t);
  const result=await f.call('weather.save',{revision:0,weather:'clear',enabled:'true'});assert.equal(result.status,'succeeded');
  await f.extensions.tick();await new Promise(resolve=>setImmediate(resolve));
  assert(f.sent.some(p=>p.user===1 && p.command==='weather' && p.data.descriptor==='81a:Skyrim.esm'));
  f.actors.get(200).locationalData.cellOrWorldDesc='123:Skyrim.esm';await f.extensions.tick();await new Promise(resolve=>setImmediate(resolve));
  assert(f.sent.some(p=>p.user===1 && p.command==='weather' && p.data.descriptor===null));
});
test('manual NPC corpses remain available briefly and cleanup never respawns them',async t=>{
  const f=await fixture(t);
  assert.equal((await f.call('npc.spawn',{npc:'dog'})).status,'succeeded');
  await f.extensions.tick();const id=[...f.actors.keys()].find(id=>id>=0xff000000);f.actors.get(id).isDead=true;
  await f.extensions.tick();f.advance(299000);await f.extensions.tick();assert.equal(f.destroyed.length,0);
  f.advance(2000);await f.extensions.tick();assert.deepEqual(f.destroyed,[id]);assert.equal(await f.extensions.runtime.count(),0);
});
test('faction changes reuse governance membership and do not grant staff roles',async t=>{
  const f=await fixture(t);
  await f.db.query("INSERT INTO factions(id,tag,name) VALUES (1,'test','Facção teste')");
  await f.db.query("INSERT INTO governance_roles(id,scope_type,scope_id,name,label,weight) VALUES (1,'faction','1','member','Membro',0)");
  for(const enabled of ['true','false'])assert.equal((await f.call('faction.membership',{role:'1',enabled})).status,'succeeded');
  const members=await f.db.query('SELECT character_id,status FROM governance_memberships');assert.deepEqual(members,[{character_id:2,status:'revoked'}]);
  assert.equal((await f.db.query('SELECT role FROM staff_roles WHERE account_id=2')).length,0);
});
test('SQLite request uniqueness survives the legacy nonunique schema and concurrent requests',async t=>{
  const f=await fixture(t),target=f.host.session(200);
  const message={version:1,requestId:'same_request_001',type:'action',data:{action:'player.bring',target:{actorId:200,session:target.session},params:{},reason:'Atendimento duplicado'}};
  const responses=await Promise.all([f.service.handle(100,message),f.service.handle(100,message)]);
  assert.equal((await f.db.query('SELECT COUNT(*) AS n FROM aetherius_admin_operations'))[0].n,1);
  assert(responses.some(r=>r.status==='succeeded'));
});
test('ban persists on the authoritative account and unban works without an online target',async t=>{
  const f=await fixture(t);
  assert.equal((await f.call('player.ban')).status,'succeeded');assert.equal((await f.db.query('SELECT status FROM accounts WHERE id=2'))[0].status,'banned');assert.deepEqual(f.kicks,[1]);
  assert.equal((await f.call('player.unban',{}, {accountId:2})).status,'succeeded');assert.equal((await f.db.query('SELECT status FROM accounts WHERE id=2'))[0].status,'active');
  assert.equal((await f.call('player.unban',{}, {accountId:1})).code,'INVALID');
});
test('revision conflicts do not overwrite destinations and missing catalog entries do not spawn',async t=>{
  const f=await fixture(t);
  assert.equal((await f.call('destination.save',{key:'inn',label:'Estalagem',revision:0})).status,'succeeded');
  const stale=await f.call('destination.save',{key:'inn',label:'Outro',revision:0});assert.equal(stale.code,'CONFLICT');
  assert.equal((await f.call('zone.save',{key:'test',label:'Zona',revision:0,npc:'forged',count:1,radius:4096,respawnSeconds:60,enabled:'true'})).status,'rejected');
  assert.equal((await f.db.query('SELECT COUNT(*) AS n FROM aetherius_admin_entities'))[0].n,0);
});
test('transport pays once into the existing ledger and checks distance, time, session and cooldown',async t=>{
  const f=await fixture(t);
  await f.call('destination.save',{key:'a',label:'Coleta',revision:0});f.actors.get(100).locationalData.pos=[2048,0,100];
  await f.call('destination.save',{key:'b',label:'Entrega',revision:0});
  const configured=await f.call('job.save',{key:'wood',label:'Transportar lenha',revision:0,pickup:'a',delivery:'b',reward:25,minSeconds:60,cooldownSeconds:300,enabled:'true'});assert.equal(configured.status,'succeeded',JSON.stringify(configured));
  const player=f.host.session(200);await f.extensions.runtime.carry(player,'wood');
  await assert.rejects(f.extensions.runtime.carry(player,'',true),/tempo mínimo/);
  f.advance(61000);await assert.rejects(f.extensions.runtime.carry(player,'',true),/entrega/);
  f.actors.get(200).locationalData.pos=[2048,0,100];await f.extensions.runtime.carry(player,'',true);
  await assert.rejects(f.extensions.runtime.carry(player,'',true),/Nenhuma carga/);
  assert.equal((await f.db.query('SELECT gold FROM characters WHERE id=2'))[0].gold,25);
  assert.equal((await f.db.query("SELECT COUNT(*) AS n FROM gold_transactions WHERE module='carry-jobs'"))[0].n,1);
  await assert.rejects(f.extensions.runtime.carry(player,'wood'),/intervalo/);
});
test('manual NPCs spawn immediately and do not depend on players remaining in a zone',async t=>{
  const f=await fixture(t);
  for(let i=0;i<2;i++)assert.equal((await f.call('npc.spawn',{npc:'dog'})).status,'succeeded');
  await f.extensions.tick();assert.equal(await f.extensions.runtime.count(),2);
  f.connected.clear();await f.extensions.tick();assert.equal(await f.extensions.runtime.count(),2);assert.equal(f.destroyed.length,0);assert(f.actors.has(100));assert(f.actors.has(200));
});
test('pets keep one live instance, follow their owner and are cleaned on disconnect',async t=>{
  const f=await fixture(t);
  assert.equal((await f.call('pet.assign',{npc:'dog',name:'Fiel'})).status,'succeeded');
  assert.equal((await f.call('pet.summon')).status,'succeeded');assert.equal(await f.extensions.runtime.count(),1);
  await f.call('pet.summon');assert.equal(await f.extensions.runtime.count(),1);
  f.connected.delete(1);await f.extensions.tick();assert.equal(await f.extensions.runtime.count(),0);
});
test('staff protection expires and permission revocation clears it; mode effects require client acknowledgement',async t=>{
  const f=await fixture(t);
  const result=await f.call('staff.mode',{mode:'god',enabled:'true',speed:100});assert.equal(result.status,'succeeded');
  assert.equal(f.events.onHitDamageAttempt(200,100),false);f.advance(16000);assert.equal(f.events.onHitDamageAttempt(200,100),true);
  await f.extensions.tick();await new Promise(resolve=>setImmediate(resolve));assert.equal(f.events.onHitDamageAttempt(200,100),false);
  await f.db.query("DELETE FROM aetherius_admin_permissions WHERE role='owner' AND permission='staff.modes'");await f.extensions.tick();assert.equal(f.events.onHitDamageAttempt(200,100),true);
});
test('profession grants reuse the planned catalogue and existing row without duplicates',async t=>{
  const f=await fixture(t);
  for(const rank of [0,1])assert.equal((await f.call('profession.set',{profession:'miner',rank,xp:10,enabled:'true'})).status,'succeeded');
  const rows=await f.db.query('SELECT profession_code,rank FROM character_professions WHERE character_id=2');assert.deepEqual(rows,[{profession_code:'miner',rank:1}]);
  assert.equal((await f.call('profession.set',{profession:'invented',rank:0,xp:0,enabled:'true'})).status,'rejected');
});
test('resource searches are authorized independently and paginated',async t=>{
  const f=await fixture(t);
  const req={version:1,requestId:'resource_query_01',type:'resources',data:{kind:'professions',query:'miner'}};
  assert.equal((await f.service.handle(100,req)).data.rows[0].id,'miner');
  await f.db.query("DELETE FROM aetherius_admin_permissions WHERE role='owner' AND permission='rp.professions'");assert.equal((await f.service.handle(100,req)).code,'FORBIDDEN');
});
