'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createService } = require('./service.cjs');
const { createHost } = require('./skymp-host.cjs');
const { createMysqlStore } = require('./mysql-store.cjs');
const { byId } = require('./catalog.cjs');
const { revokePersistedConsole } = require('./console-guard.cjs');
const { createExtensions } = require('./extensions.cjs');
function install({ mp, gamemodeDir }) {
  const configPath = path.resolve(gamemodeDir, '../config/admin-panel.local.json');
  if (!fs.existsSync(configPath)) return null;
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  if (config.enabled !== true) return null;
  if (config.catalogFile) {
    const catalogPath = path.resolve(path.dirname(configPath), config.catalogFile);
    if (!catalogPath.startsWith(path.dirname(configPath) + path.sep)) throw Error('Catalog must remain inside config directory');
    const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
    for (const key of ['items','npcs','weathers']) config[key] = [...(config[key] || []), ...(catalog[key] || [])];
  }
  const settings = mp.getServerSettings();
  if (config.catalogFile) {
    const catalog=JSON.parse(fs.readFileSync(path.resolve(path.dirname(configPath),config.catalogFile),'utf8'));
    if(JSON.stringify(catalog.loadOrder.map(n=>n.toLowerCase()))!==JSON.stringify(settings.loadOrder.map(n=>n.toLowerCase())))throw Error('Admin catalog load order changed; rebuild and validate the catalog.');
  }
  if ((settings.offlineMode && !config.allowOfflineLab) || (settings.offlineMode && process.env.NODE_ENV === 'production') || process.env.ALLOW_LOCAL_AUTOWHITELIST === 'true') throw new Error('Admin panel requires authenticated/persistent accounts; synthetic autowhitelist is not supported.');
  if (settings.enableConsoleCommandsForAll) throw new Error('Disable enableConsoleCommandsForAll before enabling admin panel.');
  if (!Number.isInteger(config.maxPlayers) || config.maxPlayers < 1 || config.maxPlayers > 4096) throw new Error('Invalid admin maxPlayers.');
  if (!Array.isArray(config.enabledActions) || !Array.isArray(config.items)) throw new Error('Invalid admin configuration.');
  if (config.enabledActions.some(id => !byId.has(id) || byId.get(id).unavailable)) throw new Error('Unsupported enabled admin action.');
  if (config.globalWeatherWorldspaces !== undefined && (!Array.isArray(config.globalWeatherWorldspaces) || config.globalWeatherWorldspaces.length>512 || config.globalWeatherWorldspaces.some(d=>typeof d!=='string' || !/^[a-fA-F0-9]+:[^:\r\n]+\.(esm|esp|esl)$/i.test(d)))) throw Error('Invalid global weather worldspace scope.');
  const itemIds = new Set();
  for (const item of config.items) {
    if (!item || !/^[a-zA-Z0-9_-]{1,48}$/.test(item.id) || itemIds.has(item.id) || typeof item.label !== 'string' || !item.label.trim() || item.label.length > 80 || typeof item.descriptor !== 'string' || !/^[a-fA-F0-9]+:[^:\r\n]+\.(esm|esp|esl)$/i.test(item.descriptor)) throw new Error('Invalid or duplicate admin item.');
    itemIds.add(item.id);
  }
  for(const key of ['npcs','weathers']) {
    const ids=new Set();
    for(const entry of config[key] || []) {
      if(!entry || !/^[a-zA-Z0-9_-]{1,48}$/.test(entry.id) || ids.has(entry.id) || typeof entry.label!=='string' || entry.label.length>80 || !/^[a-fA-F0-9]+:[^:\r\n]+\.(esm|esp|esl)$/i.test(entry.descriptor))throw Error('Invalid '+key+' catalog');
      ids.add(entry.id);
    }
  }
  const revokedConsoleGrants = revokePersistedConsole(mp, settings);
  const load = name => require(path.join(gamemodeDir, name));
  const commands = load('commands');
  const host = createHost({ mp, commands, identity: load('identity-service'), espm: load('core/espm'), maxPlayers: config.maxPlayers });
  const store = createMysqlStore({ db: load('database'), transactionService: load('core/transaction-service') });
  const extensions = createExtensions({ mp, host, store, db: load('database'), config, load });
  const service = createService({ host, store, ...config, extensions });
  const router = load('core/ui-event-router');
  const registry = load('core/command-registry');
  // This handler owns only its namespace, including when an older router broadcasts.
  router.register('admin', async (actorId, event) => {
    if (event.type === 'admin:clientResult') { extensions.receive(actorId, event.data); return true; }
    if (event.type !== 'admin:request') return false;
    const operator = host.session(actorId);
    if (!operator) return true;
    const response = await service.handle(actorId, event.data);
    try { host.send(operator, response); } catch { /* response for a departed session is discarded */ }
    return true;
  });
  registry.register('/admin', async actorId => {
    const operator = host.session(actorId);
    if (!operator) return;
    const response = await service.handle(actorId, { version: 1, requestId: randomUUID(), type: 'open', data: {} });
    try { host.send(operator, response); } catch { /* disconnected */ }
  }, { module: 'aetherius-admin', phase: 'core', description: 'Abrir painel da Staff' });
  // Stop legacy commands from bypassing the new authorization/audit service.
  const aliases = { '/tp': 'player.teleportTo', '/kick': 'player.kick', '/setgold': 'economy.setGold', '/permakill': 'character.retire', '/revelaridentidade': 'identity.reveal', '/revealidentity': 'identity.reveal', '/additem': 'inventory.grant' };
  for (const [command, action] of Object.entries(aliases)) registry.register(command, async (actorId, args) => {
    const parts = String(args || '').trim().split(/\s+/);
    const target = /^[0-9a-fx]+$/i.test(parts[0]) ? host.session(Number.parseInt(parts[0], 16)) : null;
    const operator = host.session(actorId);
    if (!operator) return;
    let params = {}; let reason;
    if (action === 'economy.setGold') { params = { amount: Number(parts[1]) }; reason = parts.slice(2).join(' '); }
    else if (action === 'inventory.grant') { params = { item: parts[1], quantity: Number(parts[2]) }; reason = parts.slice(3).join(' '); }
    else reason = parts.slice(1).join(' ');
    const response = await service.handle(actorId, { version: 1, requestId: randomUUID(), type: 'action', data: { action, target: { actorId: target?.actorId || 0, session: target?.session || '' }, params, reason } });
    try { host.send(operator, response); } catch { /* disconnected */ }
  }, { module: 'aetherius-admin', phase: 'core' });
  // Unvalidated native animation and unrestricted diagnostic are deliberately unavailable.
  registry.unregister('/anim'); registry.unregister('/status');
  mp.on('disconnect', userId => host.invalidate(userId));
  mp.on('connect', userId => host.invalidate(userId));
  // Revoke any old broad native-console grants, including persisted actors on reconnect.
  const interval = setInterval(() => {
    for (const player of host.players()) {
      try { if (mp.get(player.actorId, 'consoleCommandsAllowed')) mp.set(player.actorId, 'consoleCommandsAllowed', false); } catch { /* no broad grant is made by this module */ }
    }
  }, 1000);
  interval.unref?.();
  const notify = async (actorId, callback) => {
    const player=host.session(actorId); if(!player)return;
    try { await extensions.ready; const text=await callback(player); commands.sendNotification(actorId,text); }
    catch(error){commands.sendNotification(actorId,error.code ? error.message : 'Operação não confirmada. Consulte a equipe.'); console.error('[aetherius-admin] player command:',error.message);}
  };
  registry.register('/acompanhante',(actorId,args)=>notify(actorId,async p=>{
    if(String(args||'').trim()==='recolher'){await extensions.runtime.dismiss(p.characterId);return 'Acompanhante recolhido.';}
    await extensions.runtime.summon(p); return 'Acompanhante chamado.';
  }),{module:'aetherius-admin',phase:'core'});
  registry.register('/callhorse',actorId=>notify(actorId,async p=>{await extensions.runtime.summon(p,true);return 'Cavalo chamado.';}),{module:'aetherius-admin',phase:'core'});
  registry.register('/carga',(actorId,args)=>notify(actorId,p=>extensions.runtime.carry(p,String(args||'').trim())),{module:'aetherius-admin',phase:'core'});
  registry.register('/entregarcarga',actorId=>notify(actorId,p=>extensions.runtime.carry(p,'',true)),{module:'aetherius-admin',phase:'core'});
  console.log(`[aetherius-admin] enabled; actions=${config.enabledActions.join(',')}; revokedConsoleGrants=${revokedConsoleGrants}`);
  return { service, extensions, ready: extensions.ready, shutdown: async () => { clearInterval(interval); router.unregister('admin'); await extensions.shutdown(); } };
}
module.exports = { install };
