'use strict';
const actions = [
  { id: 'player.teleportTo', label: 'Ir até jogador', category: 'moderation', permission: 'players.teleport', description: 'Move você para a localização do jogador.', fields: [] },
  { id: 'player.bring', label: 'Trazer jogador', category: 'moderation', permission: 'players.teleport', description: 'Move o jogador para a sua localização.', fields: [] },
  { id: 'player.kick', label: 'Expulsar da sessão', category: 'moderation', permission: 'players.kick', description: 'Encerra a conexão atual. Não impede uma nova entrada.', fields: [], danger: true },
  { id: 'inventory.grant', label: 'Entregar item', category: 'administration', permission: 'inventory.grant', description: 'Entrega um item do catálogo autorizado.', fields: ['item', 'quantity'] },
  { id: 'economy.setGold', label: 'Definir saldo', category: 'administration', permission: 'economy.adjust', description: 'Define o saldo RP em Septims, com registro financeiro.', fields: ['amount'] },
  { id: 'identity.reveal', label: 'Revelar identidade', category: 'administration', permission: 'identity.reveal', description: 'Consulta privada do nome real. Não altera a identidade RP.', fields: [], sensitive: true },
  { id: 'character.retire', label: 'Encerrar personagem', category: 'administration', permission: 'characters.permakill', description: 'Aposenta o personagem e encerra sua sessão.', fields: [], danger: true },
  { id: 'player.ban', label: 'Banir conta', category: 'moderation', description: 'Bloqueio persistente de acesso.', unavailable: 'Banimento persistente não está disponível nesta versão.' },
  { id: 'world.animation', label: 'Executar animação', category: 'tools', description: 'Animações para atendimento e eventos.', unavailable: 'Aguardando validação das animações no servidor.' },
  { id: 'world.probe', label: 'Investigar mundo', category: 'tools', description: 'Censo de fauna e diagnóstico de entidades.', unavailable: 'Ferramentas de mundo não estão habilitadas neste servidor.' },
  { id: 'staff.manage', label: 'Gerenciar cargos', category: 'staff', description: 'Conceder ou revogar acesso administrativo.', unavailable: 'As concessões são feitas pelo responsável pelo servidor.' },
  { id: 'whitelist.manage', label: 'Gerenciar whitelist', category: 'staff', description: 'Análise de acesso e personagens.', unavailable: 'Utilize o fluxo de whitelist existente do servidor.' }
];
const byId = new Map(actions.map(action => [action.id, action]));
module.exports = { actions, byId };
