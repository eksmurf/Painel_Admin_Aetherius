'use strict';
// Closed contracts: neither the browser nor an administrator can submit console/Papyrus code.
const field = (label, type, options = {}) => ({ label, type, ...options });
const key = field('Identificador (sem espaços)', 'text', { pattern: '^[a-z0-9_-]{1,48}$' });
const revision = field('Revisão atual (0 para criar)', 'integer', { min: 0, max: 1000000, value: 0 });
const label = field('Nome', 'text', { minLength: 2, maxLength: 80 });
const select = (label, source) => field(label, 'select', { source });
const yesno = field('Ativo', 'enum', { choices: [['true', 'Sim'], ['false', 'Não']] });
const definitions = [];
function add(id, label, category, permission, description, fields = {}, extra = {}) {
  definitions.push({ id, label, category, permission, description, fields: Object.keys(fields), inputs: fields, ...extra });
}
add('player.ban', 'Banir conta', 'moderation', 'players.ban', 'Bloqueia a conta no mesmo controle de acesso da whitelist e encerra suas sessões.', {}, { danger: true });
add('player.unban', 'Revogar banimento', 'moderation', 'players.ban', 'Revoga somente um banimento aplicado por este painel. A whitelist e o personagem continuam sendo exigidos.', {}, { targetKind: 'account', danger: true });
add('player.recover', 'Recuperar jogador', 'moderation', 'players.recover', 'Recupera atributos e estabiliza o personagem pelo serviço de morte existente. Não reativa personagem aposentado.');
add('world.probe', 'Investigar mundo', 'tools', 'world.inspect', 'Consulta posição e estado no servidor e o objeto sob a mira do operador.', {}, { targetKind: 'self', sensitive: true });
add('world.animation', 'Executar animação', 'tools', 'world.animation', 'Envia uma animação do catálogo validado ao jogador selecionado.', { animation: select('Animação', 'animations') });
add('staff.mode', 'Modo de atendimento', 'tools', 'staff.modes', 'Modo temporário do operador; expira quando a autorização ou conexão termina.', {
  mode: field('Modo', 'enum', { choices: [['god', 'Invulnerabilidade'], ['noclip', 'Atravessar colisões'], ['ghost', 'Fantasma'], ['invisible', 'Invisível'], ['speed', 'Velocidade'], ['freecam', 'Câmera livre'], ['reset', 'Desativar todos']] }),
  enabled: yesno, speed: field('Velocidade (%)', 'integer', { min: 25, max: 500, value: 100 })
}, { targetKind: 'self' });
add('destination.save', 'Salvar destino', 'tools', 'world.destinations', 'Salva sua posição atual como destino nomeado. Para editar, informe a revisão exibida na consulta.', { key, label, revision }, { targetKind: 'self' });
add('destination.teleport', 'Ir para destino', 'tools', 'players.teleport', 'Teleporta o jogador selecionado para um destino salvo.', { destination: select('Destino', 'destinations') });
add('npc.spawn', 'Spawnar NPC', 'administration', 'world.npcs', 'Cria um NPC na sua posição atual, sem zona nem reposição automática.', { npc: select('NPC', 'npcs') }, { targetKind:'self' });
add('zone.save', 'Configurar zona de NPCs', 'tools', 'world.npcs', 'Configuração anterior, substituída por spawn imediato.', {
  key, label, revision, npc: select('NPC autorizado', 'npcs'), count: field('Quantidade', 'integer', { min: 1, max: 10, value: 1 }),
  radius: field('Raio de ativação (unidades)', 'integer', { min: 512, max: 20000, value: 4096 }), respawnSeconds: field('Intervalo para reposição (segundos)', 'integer', { min: 30, max: 86400, value: 300 }), enabled: yesno
}, { targetKind: 'self', unavailable:'Substituída por Spawnar NPC.' });
add('weather.save', 'Clima do servidor', 'tools', 'world.weather', 'Define o clima geral nas áreas externas do servidor, incluindo novos jogadores. Preserva interiores e mundos especiais.', {
  revision, weather: select('Clima autorizado', 'weathers'), enabled: yesno
}, { targetKind: 'self' });
add('job.save', 'Configurar trabalho de transporte', 'tools', 'world.jobs', 'Usa dois destinos existentes. A entrega exige percurso, tempo mínimo e intervalo entre pagamentos no ledger RP.', {
  key, label, revision, pickup: select('Coleta', 'destinations'), delivery: select('Entrega', 'destinations'), reward: field('Pagamento em Septims', 'integer', { min: 0, max: 10000, value: 25 }),
  minSeconds: field('Tempo mínimo (segundos)', 'integer', { min: 10, max: 3600, value: 60 }), cooldownSeconds: field('Intervalo entre trabalhos (segundos)', 'integer', { min: 60, max: 86400, value: 300 }), enabled: yesno
}, { targetKind: 'self' });
for (const [kind, title, permission] of [['destination','destino','world.destinations'], ['zone','zona de NPCs','world.npcs'], ['weather','região de clima','world.weather'], ['job','trabalho','world.jobs']]) {
  add(`${kind}.remove`, `Remover ${title}`, 'tools', permission, 'Remove a configuração pela revisão atual. Instâncias administradas são recolhidas no próximo ciclo.', { key, revision }, { targetKind: 'self', danger: true });
}
add('faction.membership', 'Administrar vínculo RP', 'administration', 'rp.factions', 'Altera a participação em uma facção já existente, usando os cargos e permissões do governo atual.', { role: select('Cargo da facção', 'factionRoles'), enabled: yesno });
add('profession.set', 'Administrar profissão', 'administration', 'rp.professions', 'Atualiza a profissão no registro usado pelos requisitos de crafting.', { profession: select('Profissão', 'professions'), rank: field('Graduação', 'integer', { min: 0, max: 100, value: 0 }), xp: field('Experiência', 'integer', { min: 0, max: 1000000, value: 0 }), enabled: yesno });
add('pet.assign', 'Atribuir acompanhante', 'administration', 'rp.pets', 'Vincula um NPC autorizado ao personagem. Cavalos usam a propriedade já existente; /acompanhante chama o animal.', { npc: select('Acompanhante autorizado', 'pets'), name: label });
add('pet.dismiss', 'Recolher acompanhante', 'administration', 'rp.pets', 'Remove a instância ativa, preservando a propriedade do acompanhante.');
add('pet.summon', 'Chamar acompanhante', 'administration', 'rp.pets', 'Posiciona o acompanhante do jogador perto dele.');
const resourcePermissions = {
  playerInventory: 'inventory.inspect',
  destinations: 'players.teleport', zones: 'world.npcs', weatherRegions: 'world.weather', jobs: 'world.jobs',
  npcs: 'world.npcs', weathers: 'world.weather', animations: 'world.animation', items: 'inventory.grant',
  factionRoles: 'rp.factions', professions: 'rp.professions', pets: 'rp.pets', bans: 'players.ban'
};
const animations = [
  ['IdleStop', 'Parar animação', 'Controle'], ['IdleWave', 'Acenar', 'Saudações'], ['IdleSilentBow', 'Reverência', 'Saudações'],
  ['IdleApplaud2', 'Aplaudir', 'Reações'], ['IdleCivilWarCheer', 'Comemorar', 'Reações'], ['IdleSalute', 'Saudação', 'Saudações'],
  ['IdleSurrender', 'Render-se', 'Posturas'], ['IdleHandsBehindBack', 'Mãos para trás', 'Posturas'], ['IdleWarmHandsStanding', 'Aquecer mãos', 'Atividades']
].map(([id, label, category]) => ({ id, label, category }));
const visibleResources = ['playerInventory'];
module.exports = { definitions, resourcePermissions, animations, visibleResources };
