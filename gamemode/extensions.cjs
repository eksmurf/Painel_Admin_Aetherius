'use strict';
const { fail } = require('./protocol.cjs');
const { animations } = require('./extension-catalog.cjs');
const { createExtensionStore } = require('./extension-store.cjs');
const { createWorldHost, distance } = require('./world-host.cjs');
const { createWorldRuntime } = require('./world-runtime.cjs');
const success = (message, data) => ({ status: 'succeeded', message, ...(data ? { data } : {}) });
function createExtensions({ mp, host, store, db, config, load, now = Date.now }) {
  const repository = createExtensionStore(db);
  const world = createWorldHost({ mp, host, now });
  const catalogs = { items: config.items, npcs: config.npcs || [], weathers: config.weathers || [], animations };
  catalogs.pets = catalogs.npcs.filter(row => row.petKind);
  const professions = load('core/profession-registry');
  const modes = new Map();
  const modePending = new Set();
  const inspection = require('./inventory-inspection.cjs').createInventoryInspection({mp,host,db,items:catalogs.items});
  const modeState = operator => {
    const current=modes.get(operator.actorId);
    return current && current.operator.session===operator.session && current.expires>now() ? {values:{...current.values},expiresAt:current.expires,leaseRemainingMs:current.expires-now()} : {values:{},expiresAt:0,leaseRemainingMs:0};
  };
  mp.makeProperty('aapAppearance', { isVisibleByOwner:false, isVisibleByNeighbors:true, updateOwner:'', updateNeighbor:`
    const actor=ctx.sp.Actor.from(ctx.refr);
    if(actor && ctx.value){
      if(ctx.state.aapStamp!==ctx.value.stamp){ctx.state.aapStamp=ctx.value.stamp;ctx.state.aapUntil=Date.now()+Math.min(15000,ctx.value.leaseMs||0);}
      const active=Date.now()<ctx.state.aapUntil;
      actor.setAlpha(active && ctx.value.invisible ? 0 : active && ctx.value.ghost ? 0.35 : 1,false);
      actor.setGhost(!!(active && ctx.value.ghost));
    }
  ` });
  const mirror = (id, values, leaseMs) => mp.set(id,'aapAppearance',{invisible:!!values.invisible,ghost:!!values.ghost,leaseMs,stamp:now()});
  const runtime = createWorldRuntime({ mp, host, world, db, repository, catalogs, load, now, weatherWorldspaces:config.globalWeatherWorldspaces });
  const ready = repository.init().then(() => runtime.init());
  async function weatherState() {
    await ready;
    const current=await repository.get('weather','server');
    return {enabled:current?.scope==='server' && current.enabled===true,weather:current?.weather || null,label:current?.label || null,revision:current?.revision || 0};
  }
  const select = (kind, id) => {
    const row = catalogs[kind]?.find(entry => entry.id === id);
    if (!row) fail('INVALID', 'Seleção ausente no catálogo autorizado.');
    return row;
  };
  async function resources({ kind, query = '', page = 1, category = '', scope, ownerId, searchBy }, operator) {
    await ready;
    if(kind==='playerInventory' || (kind==='items' && ['players','chests'].includes(scope)))return inspection.search({kind,query,page,scope,ownerId,searchBy},operator);
    let rows;
    if (catalogs[kind]) rows = catalogs[kind];
    else if (kind === 'professions') rows = professions.list().filter(p => p.enabled).map(p => ({ id: p.code, label: p.label, category: p.category }));
    else if (kind === 'factionRoles') rows = (await db.query("SELECT r.id,r.name,r.label,r.scope_id,f.name AS faction FROM governance_roles r JOIN factions f ON CAST(f.id AS CHAR)=r.scope_id WHERE r.scope_type='faction' ORDER BY f.name,r.weight DESC")).map(r => ({ id: String(r.id), label: `${r.faction} · ${r.label}`, category: r.faction }));
    else if (kind === 'bans') rows = (await db.query('SELECT account_id,reason,updated_ms FROM aetherius_admin_bans WHERE active=1 ORDER BY updated_ms DESC')).map(r => ({ id: String(r.account_id), label: `Conta ${r.account_id}`, reason: r.reason, updatedAt: r.updated_ms }));
    else rows = await repository.list({ destinations: 'destination', zones: 'zone', weatherRegions: 'weather', jobs: 'job' }[kind]);
    const categories = [...new Set(rows.map(r => r.category).filter(Boolean))].sort();
    const words = query.trim().toLocaleLowerCase('pt-BR').split(/\s+/).filter(Boolean);
    rows = rows.filter(r => (!category || r.category === category) && words.every(w => [r.id,r.label,r.descriptor,r.editorId,r.reason].join(' ').toLocaleLowerCase('pt-BR').includes(w)));
    return { rows: rows.slice((page - 1) * 20, page * 20), total: rows.length, page, pageSize: 20, categories };
  }
  async function prepare(action, p, operator, target) {
    await ready;
    if (action === 'world.animation') return select('animations', p.animation);
    if (action === 'profession.set') {
      if (!professions.validate(p.profession).ok || p.rank > (config.maxProfessionRank || 3)) fail('INVALID', 'Profissão ou graduação inválida.');
    }
    if (action === 'staff.mode' && !['reset','noclip','speed','freecam','god','ghost','invisible'].includes(p.mode)) fail('INVALID', 'Modo inválido.');
    if (action === 'destination.teleport') {
      const entry = await repository.get('destination', p.destination);
      if (!entry) fail('INVALID', 'Destino removido.');
      world.resolve(entry.location.cellOrWorldDesc, ['CELL','WRLD']);
      return entry;
    }
    if (action === 'pet.assign' || action === 'npc.spawn') {
      const npc = select(action === 'pet.assign' ? 'pets' : 'npcs', p.npc);
      world.resolve(npc.descriptor, ['NPC_']);
      return { npc, location: world.location(operator.actorId) };
    }
    if (action === 'weather.save') {
      if(p.enabled==='false')return null;
      const weather = select('weathers', p.weather);
      world.resolve(weather.descriptor, ['WTHR']);
      return { weather };
    }
    if (action === 'destination.save') return { location: world.location(operator.actorId) };
    if (action === 'job.save') {
      const pickup = await repository.get('destination', p.pickup), delivery = await repository.get('destination', p.delivery);
      if (!pickup || !delivery || p.pickup === p.delivery || distance(pickup.location, delivery.location) < 1024) fail('INVALID', 'Selecione dois destinos separados por pelo menos 1024 unidades.');
      return { pickup: pickup.location, delivery: delivery.location };
    }
    return null;
  }
  async function execute({ operation: op, definition, params: p, operator, target, prepared, validateSession }) {
    const action = op.action;
    const atomic = callback => store.atomic(op, target, definition.permission, validateSession, callback);
    if(action==='weather.save') {
      const result=await atomic(async conn=>{
        const payload={scope:'server',enabled:p.enabled==='true',weather:prepared?.weather.id || null,label:prepared?.weather.label || null,descriptor:prepared?.weather.descriptor || null};
        const revision=await repository.write(conn,'weather','server',p.revision,payload);
        return success(payload.enabled?'Clima do servidor salvo. Sincronização no próximo ciclo.':'Clima natural restaurado. Sincronização no próximo ciclo.',{enabled:payload.enabled,weather:payload.weather,label:payload.label,revision});
      });
      return result;
    }
    if (action === 'world.probe') {
      const server = { actorId: operator.actorId, location: world.location(operator.actorId), percentages: mp.get(operator.actorId, 'percentages'), state: load('core/character-state').get(operator.characterId), managedEntities: await runtime.count() };
      const client = await world.request(operator, 'probe');
      validateSession();
      return success('Diagnóstico recebido. Dados da mira são informados pelo cliente.', { server, client });
    }
    if (action === 'world.animation') { await world.request(target, 'animation', { animation: prepared.id }); return success('Evento de animação enviado e aceito pelo cliente.'); }
    if (action === 'npc.spawn') {
      const actorId=await runtime.spawnOnce(operator,prepared.npc.descriptor,validateSession);
      return success('NPC criado na sua posição, sem reposição automática.',{actorId,npc:prepared.npc.label});
    }
    if (action === 'staff.mode') {
      if(modePending.has(operator.actorId))fail('BUSY','Aguarde a confirmação do modo anterior.');
      modePending.add(operator.actorId);
      try {
      const next = { ...modeState(operator).values };
      if (p.mode === 'reset') for (const key of Object.keys(next)) delete next[key];
      else if (p.enabled === 'true') next[p.mode] = p.mode === 'speed' ? p.speed : true;
      else delete next[p.mode];
      await world.request(operator,'modes',{values:next,leaseMs:15000});
      validateSession();
      modes.set(operator.actorId, { operator, values: next, expires: now() + 15000 });
      mirror(operator.actorId,next,15000);
      return success('Modos de atendimento atualizados.', modeState(operator));
      } finally {modePending.delete(operator.actorId);}
    }
    if (action === 'player.recover') {
      await load('death-service').adminRecover(target.actorId, target.characterId);
      return success('Recuperação aplicada pelo serviço de morte existente.');
    }
    if (action === 'destination.teleport') { world.move(target.actorId, prepared.location); return success('Destino aplicado e conferido no servidor.'); }
    if (['player.ban','player.unban'].includes(action)) {
      const result = await atomic(async conn => {
        const [accounts] = await conn.query('SELECT status FROM accounts WHERE id=? FOR UPDATE', [target.accountId]);
        const [bans] = await conn.query('SELECT previous_status,active FROM aetherius_admin_bans WHERE account_id=? FOR UPDATE', [target.accountId]);
        if (action === 'player.ban') {
          if (accounts[0]?.status !== 'active') fail('INVALID', 'A conta já possui uma restrição.');
          if (bans.length) await conn.query('UPDATE aetherius_admin_bans SET previous_status=?,active=1,reason=?,banned_by=?,updated_ms=? WHERE account_id=?', ['active',op.reason,op.accountId,now(),target.accountId]);
          else await conn.query('INSERT INTO aetherius_admin_bans(account_id,previous_status,active,reason,banned_by,updated_ms) VALUES (?, ?,1,?,?,?)', [target.accountId,'active',op.reason,op.accountId,now()]);
          await conn.query("UPDATE accounts SET status='banned' WHERE id=?", [target.accountId]);
        } else {
          if (!bans[0]?.active || accounts[0]?.status !== 'banned') fail('INVALID', 'Não há banimento deste painel para revogar.');
          await conn.query('UPDATE accounts SET status=? WHERE id=?', [bans[0].previous_status,target.accountId]);
          await conn.query('UPDATE aetherius_admin_bans SET active=0,reason=?,banned_by=?,updated_ms=? WHERE account_id=?', [op.reason,op.accountId,now(),target.accountId]);
        }
        return success(action === 'player.ban' ? 'Conta banida. A whitelist recusará novas entradas.' : 'Banimento revogado; os demais requisitos de acesso continuam válidos.');
      });
      if (action === 'player.ban') for (const player of host.players().filter(p => p.accountId === target.accountId)) { try { host.kick(player); } catch {} }
      return result;
    }
    if (action === 'profession.set') return atomic(async conn => {
      const [old] = await conn.query('SELECT id,status FROM character_professions WHERE character_id=? AND profession_code=? FOR UPDATE', [target.characterId,p.profession]);
      if (old.length > 1) fail('CONFLICT', 'Há registros antigos duplicados desta profissão; revisão necessária.');
      if (p.enabled === 'true' && old[0]?.status !== 'active') {
        const [count] = await conn.query("SELECT COUNT(*) AS total FROM character_professions WHERE character_id=? AND status='active'", [target.characterId]);
        if (Number(count[0].total) >= (config.maxProfessions || 3)) fail('LIMIT', 'Limite de profissões ativas atingido.');
      }
      const status = p.enabled === 'true' ? 'active' : 'revoked';
      if (old.length) await conn.query('UPDATE character_professions SET status=?,rank=?,xp=?,granted_by_character_id=? WHERE id=?', [status,p.rank,p.xp,op.characterId,old[0].id]);
      else await conn.query('INSERT INTO character_professions(character_id,profession_code,status,rank,xp,granted_by_character_id) VALUES (?,?,?,?,?,?)', [target.characterId,p.profession,status,p.rank,p.xp,op.characterId]);
      return success('Profissão atualizada no cadastro existente.');
    });
    if (action === 'faction.membership') return atomic(async conn => {
      const [roles] = await conn.query("SELECT r.* FROM governance_roles r JOIN factions f ON CAST(f.id AS CHAR)=r.scope_id WHERE r.id=? AND r.scope_type='faction'", [p.role]);
      if (!roles.length) fail('INVALID', 'Cargo RP não encontrado.');
      const role = roles[0];
      const [rows] = await conn.query("SELECT id FROM governance_memberships WHERE character_id=? AND scope_type='faction' AND scope_id=? FOR UPDATE", [target.characterId,role.scope_id]);
      if (rows.length > 1) fail('CONFLICT', 'Vínculo antigo duplicado; revisão necessária.');
      const status = p.enabled === 'true' ? 'active' : 'revoked';
      if (rows.length) await conn.query('UPDATE governance_memberships SET role_id=?,status=?,on_duty=0,granted_by_character_id=? WHERE id=?', [role.id,status,op.characterId,rows[0].id]);
      else await conn.query("INSERT INTO governance_memberships(character_id,scope_type,scope_id,role_id,status,on_duty,granted_by_character_id) VALUES (?,'faction',?,?,?,0,?)", [target.characterId,role.scope_id,role.id,status,op.characterId]);
      return success('Vínculo atualizado nos cargos existentes do governo.');
    });
    if (action === 'pet.assign') {
      const result = await atomic(async conn => {
        if (prepared.npc.petKind === 'horse') {
          const [horses] = await conn.query('SELECT id FROM horses WHERE owner_character_id=? FOR UPDATE', [target.characterId]);
          if (horses.length) fail('CONFLICT', 'O personagem já possui cavalo. Use Chamar acompanhante ou o mercado existente.');
          await conn.query('INSERT INTO horses(name,base_id,owner_character_id) VALUES (?,?,?)', [p.name,world.resolve(prepared.npc.descriptor,['NPC_']),target.characterId]);
        } else {
          const old = await repository.get('pet', String(target.characterId), conn);
          await repository.write(conn, 'pet', String(target.characterId), old?.revision || 0, { label: p.name, descriptor: prepared.npc.descriptor, petKind: prepared.npc.petKind });
        }
        return success('Acompanhante atribuído. Use Chamar acompanhante para colocá-lo no mundo.');
      });
      await runtime.dismiss(target.characterId);
      return result;
    }
    if (action === 'pet.dismiss') { await runtime.dismiss(target.characterId); return success('Acompanhante recolhido. Propriedade preservada.'); }
    if (action === 'pet.summon') { const actorId = await runtime.summon(target); return success('Acompanhante colocado perto do jogador.', { actorId }); }
    const [kind, verb] = action.split('.');
    if (['destination','zone','weather','job'].includes(kind) && ['save','remove'].includes(verb)) return atomic(async conn => {
      if (kind === 'destination' && verb === 'remove') {
        const [jobs] = await conn.query("SELECT payload_json FROM aetherius_admin_world WHERE kind='job'");
        if (jobs.some(j => { const v=JSON.parse(j.payload_json); return v.pickup === p.key || v.delivery === p.key; })) fail('CONFLICT', 'Destino usado por um trabalho. Edite ou remova o trabalho primeiro.');
      }
      let payload = null;
      if (verb === 'save') {
        const { key, revision, ...values } = p;
        payload = { ...values, enabled: p.enabled === undefined ? true : p.enabled === 'true' };
        if (prepared?.location) payload.location = prepared.location;
        if (prepared?.npc) payload.descriptor = prepared.npc.descriptor;
        if (prepared?.weather) payload.descriptor = prepared.weather.descriptor;
        if (kind === 'job') { payload.pickupLocation = prepared.pickup; payload.deliveryLocation = prepared.delivery; }
      }
      const revision = await repository.write(conn, kind, p.key, p.revision, payload);
      return success(verb === 'save' ? 'Configuração salva. O próximo ciclo aplica a alteração.' : 'Configuração removida.', { key: p.key, revision });
    });
    fail('UNAVAILABLE', 'Ação sem executor.');
  }
  let busy = false;
  async function tick() {
    if (busy) return;
    busy = true;
    try {
      await ready;
      for (const [id, state] of modes) {
        if(modePending.has(id))continue;
        const current = host.session(id), auth = current?.session === state.operator.session ? await store.authorize(current) : null;
        if(modePending.has(id) || modes.get(id)!==state)continue;
        if ((state.values.freecam && state.expires<=now()) || !auth?.permissions.includes('panel.open') || !auth.permissions.includes('staff.modes') || !world.healthy(id)) {
          modes.delete(id);
          try { mirror(id,{},0); } catch {}
          if (current?.session === state.operator.session) {
            world.request(current,'modes',{ values:{},leaseMs:0 }).catch(() => {});
          }
          continue;
        }
        // No request acknowledgement can keep server protection alive beyond its lease.
        modePending.add(id);
        world.request(current,'modes',{ values:state.values,leaseMs:15000 }).then(() => { if (modes.get(id) === state) { state.expires=now()+15000; mirror(id,state.values,15000); } }).catch(() => {}).finally(()=>modePending.delete(id));
      }
      await runtime.tick();
    } finally { busy = false; }
  }
  const interval = setInterval(() => tick().catch(e => console.error('[aetherius-admin] world tick:', e.message)), 5000); interval.unref?.();
  mp.on('onHitDamageAttempt', (aggressor, target) => {
    for (const id of [aggressor, target]) {
      const s = modes.get(id);
      if (s && s.expires > now() && host.session(id)?.session === s.operator.session && (s.values.god || s.values.ghost || s.values.invisible)) return false;
    }
    return true;
  });
  return { ready, prepare, execute, resources, modeState, weatherState, item: id => catalogs.items.find(row => row.id === id), receive: world.receive, runtime, tick,
    shutdown: async () => { clearInterval(interval); modes.clear(); world.shutdown(); await runtime.shutdown(); }
  };
}
module.exports = { createExtensions };
