'use strict';
const { randomUUID } = require('node:crypto');
const { fail } = require('./protocol.cjs');
const { distance } = require('./world-host.cjs');
function createWorldRuntime({ mp, host, world, db, repository, catalogs, load, now = Date.now, weatherWorldspaces = ['00003c:Skyrim.esm','000800:Dragonborn.esm'] }) {
  const entities = new Map(), pets = new Map(), petLocks = new Set(), weather = new Map();
  let placements=0;
  const normalize=desc=>String(desc).toLowerCase().replace(/^0+(?=[0-9a-f]+:)/,'');
  const weatherAreas=new Set(weatherWorldspaces.map(normalize)), weatherPending=new Set();
  function acceptsWeather(actorId) {
    try {
      const descriptor=world.location(actorId).cellOrWorldDesc;
      if(!weatherAreas.has(normalize(descriptor)))return false;
      world.resolve(descriptor,['WRLD']);return true;
    }catch{return false;}
  }
  let stopped = false;
  async function remove(key) {
    const entity = entities.get(key);
    if (!entity) return;
    world.destroy(entity.descriptor);
    await db.query('DELETE FROM aetherius_admin_entities WHERE entry_key=?', [key]);
    entities.delete(key);
  }
  async function place(key, kind, anchor, descriptor, location) {
    if (entities.size+placements >= 40) fail('LIMIT', 'Limite de 40 NPCs administrados simultâneos.');
    placements++;
    try {
    const entity = await world.spawn(anchor, descriptor, location);
    entities.set(key, entity);
    try { await db.query('INSERT INTO aetherius_admin_entities(entry_key,descriptor,kind) VALUES (?,?,?)', [key,entity.descriptor,kind]); }
    catch (error) { world.destroy(entity.descriptor); entities.delete(key); throw error; }
    return entity;
    } finally {placements--;}
  }
  async function spawnOnce(operator, descriptor, validateSession) {
    validateSession();
    const key='spawn:'+randomUUID(),location=world.location(operator.actorId);
    const entity=await place(key,'spawn',operator.actorId,descriptor,location);
    try{validateSession();}catch(error){await remove(key);throw error;}
    return entity.actorId;
  }
  async function init() {
    for (const row of await db.query('SELECT entry_key,descriptor FROM aetherius_admin_entities')) {
      world.destroy(row.descriptor);
      await db.query('DELETE FROM aetherius_admin_entities WHERE entry_key=?', [row.entry_key]);
    }
    // Carrying never resumes after a restart without a matching live session.
    await db.query('UPDATE aetherius_carry_runs SET active_json=NULL WHERE active_json IS NOT NULL');
  }
  async function dismiss(characterId) {
    await remove(`pet:${characterId}`); pets.delete(characterId);
  }
  async function summon(player, horseOnly = false) {
    if (petLocks.has(player.characterId)) fail('BUSY', 'Acompanhante em atualização.');
    petLocks.add(player.characterId);
    try {
      let pet = horseOnly ? null : await repository.get('pet', String(player.characterId));
      if (!pet) {
        const horses = await db.query('SELECT id,name,base_id,health FROM horses WHERE owner_character_id=? ORDER BY id LIMIT 1', [player.characterId]);
        if (!horses.length) fail('INVALID', 'O personagem não possui acompanhante.');
        pet = { descriptor: mp.getDescFromId(Number(horses[0].base_id)), label: horses[0].name, petKind: 'horse', horseId: horses[0].id };
      }
      world.resolve(pet.descriptor, ['NPC_']);
      if (host.session(player.actorId)?.session !== player.session) fail('SESSION_EXPIRED', 'Sessão encerrada.');
      await dismiss(player.characterId);
      const entity = await place(`pet:${player.characterId}`, 'pet', player.actorId, pet.descriptor, world.near(player.actorId));
      pets.set(player.characterId, { player, ...entity, horseId: pet.horseId || null });
      return entity.actorId;
    } finally { petLocks.delete(player.characterId); }
  }
  async function tick() {
    if (stopped) return;
    const online = host.players();
    // Old zones remain historical data only. Manual spawns are never replenished.
    for(const [key,entity] of entities)if(key.startsWith('spawn:') && !world.healthy(entity.actorId)){
      entity.deadAt ??= now();
      // Leave time to loot; cleanup never creates a replacement.
      if(now()-entity.deadAt>=300000)await remove(key);
    }
    for (const [charId, pet] of pets) {
      if (petLocks.has(charId)) continue;
      const owner=host.session(pet.player.actorId);
      if (owner?.session !== pet.player.session || !world.healthy(pet.actorId)) { await dismiss(charId); continue; }
      if (distance(world.location(pet.actorId),world.location(owner.actorId)) > 1200) world.move(pet.actorId,world.near(owner.actorId));
      if (pet.horseId) {
        const loc=world.location(pet.actorId);
        await db.query('UPDATE horses SET last_pos_x=?,last_pos_y=?,last_pos_z=?,last_cell=? WHERE id=? AND owner_character_id=?', [...loc.pos,loc.cellOrWorldDesc,pet.horseId,charId]);
      }
    }
    // One persistent server setting replaces regions. Legacy regions never resume on reset.
    const globalWeather=await repository.get('weather','server');
    for (const player of online) {
      if(weatherPending.has(player.session))continue;
      const selected=globalWeather?.scope==='server' && globalWeather.enabled && acceptsWeather(player.actorId) ? globalWeather : null;
      const stamp=selected ? `${selected.id}:${selected.revision}` : '';
      const previous=weather.get(player.session);
      if ((previous?.stamp || '') !== stamp || (selected && now()-(previous?.sent || 0)>10000)) {
        const descriptor=selected?.descriptor || null;
        weatherPending.add(player.session);
        world.request(player,'weather',{ descriptor,leaseMs:20000 }).then(() => {
          if(!stopped && host.session(player.actorId)?.session===player.session)weather.set(player.session,{stamp,sent:now()});
        }).catch(()=>{}).finally(()=>weatherPending.delete(player.session));
      }
    }
    for (const key of weather.keys()) if (!online.some(p=>p.session===key)) weather.delete(key);
  }
  function assertPlayer(player) {
    if (host.session(player.actorId)?.session!==player.session) fail('SESSION_EXPIRED','Sessão encerrada.');
    if (load('core/character-state').get(player.characterId)!=='NORMAL') fail('INVALID','Seu personagem não pode trabalhar neste estado.');
  }
  async function carry(player, key, finish = false) {
    const conn=await db.getConnection();
    try {
      await conn.beginTransaction();
      const [rows]=await conn.query('SELECT active_json,last_finished_ms FROM aetherius_carry_runs WHERE character_id=? FOR UPDATE',[player.characterId]);
      const active=rows[0]?.active_json ? JSON.parse(rows[0].active_json) : null;
      assertPlayer(player);
      if (finish) {
        if (!active || active.session!==player.session) fail('INVALID','Nenhuma carga ativa nesta sessão.');
        const job=await repository.get('job',active.key,conn);
        if (!job?.enabled || job.revision!==active.revision) fail('CONFLICT','Trabalho alterado. Cancele a carga e inicie novamente.');
        if (now()-active.started < job.minSeconds*1000 || distance(world.location(player.actorId),job.deliveryLocation)>256) fail('INVALID','Aproxime-se da entrega e cumpra o tempo mínimo.');
        const tx=load('core/transaction-service').tx;
        await tx.applyGoldDelta(conn,player.characterId,job.reward);
        await tx.recordGoldLedger(conn,{characterId:player.characterId,delta:job.reward,reason:`Entrega ${job.label}`,module:'carry-jobs',idempotencyKey:`carry:${active.id}`});
        await conn.query('UPDATE aetherius_carry_runs SET active_json=NULL,last_finished_ms=? WHERE character_id=?',[now(),player.characterId]);
        assertPlayer(player); await conn.commit();
        return `Entrega concluída: ${job.reward} Septims registrados no saldo RP.`;
      }
      if (key==='cancelar') {
        await conn.query('UPDATE aetherius_carry_runs SET active_json=NULL WHERE character_id=?',[player.characterId]);
        await conn.commit(); return 'Carga cancelada, sem pagamento.';
      }
      const job=await repository.get('job',key,conn);
      if (!job?.enabled) fail('INVALID','Trabalho não encontrado ou desativado.');
      if (active?.session===player.session) fail('CONFLICT','Você já está transportando uma carga.');
      if (rows[0]?.last_finished_ms && now()-Number(rows[0].last_finished_ms)<job.cooldownSeconds*1000) fail('RATE_LIMIT','Aguarde o intervalo entre trabalhos.');
      if (distance(world.location(player.actorId),job.pickupLocation)>256) fail('INVALID','Aproxime-se do ponto de coleta.');
      const payload=JSON.stringify({id:randomUUID(),key,revision:job.revision,session:player.session,started:now()});
      if (rows.length) await conn.query('UPDATE aetherius_carry_runs SET active_json=? WHERE character_id=?',[payload,player.characterId]);
      else await conn.query('INSERT INTO aetherius_carry_runs(character_id,active_json,last_finished_ms) VALUES (?,?,0)',[player.characterId,payload]);
      assertPlayer(player); await conn.commit();
      return `Carga iniciada: ${job.label}. Vá ao ponto de entrega e use /entregarcarga. Mínimo: ${job.minSeconds}s.`;
    } catch(error) { await conn.rollback(); throw error; } finally { conn.release(); }
  }
  return { init, tick, summon, dismiss, carry, spawnOnce, count:async()=>entities.size,
    shutdown:async()=>{ stopped=true; for(const key of [...entities.keys()]) await remove(key); }
  };
}
module.exports={createWorldRuntime};
