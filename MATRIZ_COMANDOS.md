# Matriz inicial de comandos e botões

Pesquisa em 20/09/2026. “Confirmado no código” significa que o caminho foi localizado e lido; não significa homologado ingame. A lista cobre candidatos ao painel, não todos os comandos existentes no Skyrim ou em gamemodes SkyMP.

## Console Vanilla e extensão SkyMP

O cliente e o servidor examinados tratam explicitamente `additem`, `equipitem`, `placeatme`, `disable` e o comando adicional `mp`. Neste último, o subcomando implementado é `disable`. A ponte possui schemas limitados; não equivale à sintaxe completa do console Vanilla. [Cliente upstream no pin analisado](https://github.com/skyrim-multiplayer/skymp/blob/f926944b18e3aed4bc3864ce668626c05ec2545f/skymp5-client/src/services/services/consoleCommandsService.ts), [servidor upstream no mesmo pin](https://github.com/skyrim-multiplayer/skymp/blob/f926944b18e3aed4bc3864ce668626c05ec2545f/skymp5-server/cpp/server_guest_lib/ConsoleCommands.cpp).

| Botão / intenção | Referência de console | Evidência e limite | Rota proposta / fase |
|---|---|---|---|
| Entregar item | `additem` | Caminho nativo presente; não demonstra ledger da economia RP | Serviço transacional já usado por `/additem`; M4 |
| Equipar item | `equipitem` | Caminho presente; schema da ponte aceita referência e item, não todos os parâmetros Vanilla | Adaptador autorizado e teste de inventário/equipamento; futuro |
| Criar objeto | `placeatme` | Caminho presente; servidor fixa quantidade 1 nessa implementação | Catálogo restrito, quotas, autoria e limpeza; futuro |
| Desativar objeto | `disable`, `mp disable` | Caminho presente; restringe alvos a referências dinâmicas ou atores | Restringir a objetos criados pelo painel; impedir jogadores e objetos estruturais; futuro |
| Ir até / trazer | Família `moveto` | Não consta no dispatcher de console examinado; `/tp` altera localização no servidor | Reutilizar teleporte do gamemode; ir até em M3, trazer/retornar depois |
| Teleportar para local | `coc`, `cow` | Não constam no dispatcher examinado | Lista de destinos resolvidos pelo servidor; experimento antes de planejar liberação |
| Curar / reviver | `restoreav`, `resurrect` | Não constam no dispatcher examinado | Estudar ciclo de morte/estado RP e API nativa; sem promessa de suporte |
| Alterar atributos | `setav`, `modav`, `forceav` | Não constam no dispatcher examinado | Exige integração com autoridade de atributos e combate; fora do MVP |
| Modo livre / invulnerável | `tcl`, `tgm`, `tfc` | Não constam no dispatcher examinado; eventual efeito local não comprova sincronização | Experimento isolado com reversão no fim da sessão; fora do MVP |
| Quests e remoções irreversíveis | `setstage`, `resetquest`, `markfordelete` | Sem suporte demonstrado para este painel | Excluídos da primeira versão |

Nas linhas sem caminho encontrado, a conclusão é apenas ausência nesse dispatcher: uma API alternativa pode existir e precisa de pesquisa própria. Não fornecer um executor genérico como fallback.

## Comandos de chat do gamemode Aetherius

As barras abaixo pertencem ao gamemode local; não são um catálogo universal do SkyMP. Referências: `Aetherius-RP-Local/aetherius/gamemode/commands.js` e `admin-service.js`.

| Comando registrado | Botão | Permissão atual | Situação / ação necessária |
|---|---|---|---|
| `/tp <actorId>` | Ir até jogador | `teleport` | Usa `locationalData`; validar alvo, sessão, célula, resultado e auditoria antes do MVP |
| `/kick <actorId> <motivo>` | Expulsar | `kick` | Serviço passa ator para API que recebe usuário de rede; corrigir conversão e revalidar alvo após eventual atraso |
| `/additem <actorId> <baseId> <count>` | Entregar item | `add_item` | Usa serviço transacional; reforçar quantidade, catálogo, idempotência e resolver; M4 |
| `/setgold <actorId> <valor>` | Ajustar ouro | `set_gold` | Aplica delta após leitura separada; corrigir concorrência antes de prometer saldo absoluto; M4 |
| `/anim <actorId> <animName>` | Executar animação | `teleport` | Handler presente; chamada nativa e formato do argumento precisam de validação; criar permissão específica antes de liberar |
| `/permakill <actorId> <motivo>` | Encerrar personagem | `retire_character` | Altera estado persistente para `retired`; inclui caminho de kick que requer correção; fora do MVP |
| `/status` | Diagnóstico próprio | Nenhuma checagem explícita no handler lido | Apesar da descrição “Staff”, retorna estado do próprio personagem; corrigir política antes de tratá-lo como ação restrita |

O parser atual lê ator/base de item em hexadecimal. O painel deve selecionar alvos por dados do servidor e evitar digitação de FormIDs brutos. Catálogo de itens deve manter referência estável a plugin/registro e resolver IDs na ordem realmente carregada, inclusive ESL; nenhum ID exibido no cliente é assumido automaticamente como ID válido do servidor.

## Recursos novos

| Recurso | Situação | Dependência |
|---|---|---|
| `/admin` e atalho | Não encontrados como abertura do painel | Gateway autorizado e gerenciamento de foco |
| Lista de jogadores e busca | Precisa de endpoint/evento administrativo próprio | Sessões atuais e paginação; sem expor lista a usuários comuns |
| Histórico no painel | Há gravação em `audit_logs`, sem tela administrativa completa nesta UI | Consulta paginada e `view_audit` |
| Trazer e retornar | Não identificados entre os handlers core examinados | Adaptador de localização e origem salva por sessão, com validade e expiração |
| Banir/desbanir | Permissão `ban` existe, mas isso não comprova fluxo completo de banimento | Pesquisar sistemas existentes de autenticação/moderação e integrar bloqueio persistente; não confundir kick com ban |
| Advertência e modo Staff | Sem fluxo comprovado nesta pesquisa | Regras e persistência próprias; backlog |

## Condição de liberação de qualquer botão

Documentar executor, permissão, entrada validada, conversão de IDs, resultado esperado, persistência, impacto nos demais clientes e tratamento de falhas. Testar com operador autorizado e jogador comum, em duas sessões de jogo. Só então mudar a capacidade de “experimental” para “disponível”.
