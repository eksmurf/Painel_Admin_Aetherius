# Pesquisa técnica e evidências

Data: 20/09/2026. Método: leitura do código local, documentos do projeto e documentação/código público oficial do SkyMP. Nenhum comando administrativo foi executado em jogo.

## Base de referência

O README da raiz descreve uma fase anterior do laboratório. A árvore `Aetherius-RP-Local` contém a integração Aetherius/Mercurius mais recente encontrada, com `aetherius/gamemode`, `aetherius/ui`, cliente e servidor. Foi escolhida como alvo proposto do plano, sem presumir qual executável está ativo neste momento.

HEAD local observado: `24b31a07f8f54392c2187bd077a7f2bbb81144b5`. Havia alterações locais em README, dados de configuração, scripts e CMake. O HEAD sozinho não identifica todos os arquivos em uso; registrar hashes e diff dos artefatos no marco M0.

Referências históricas do laboratório: Mercurius `3bda96fa751f42d358e85e53d8c75c8719ad0abd`, upstream `f926944b18e3aed4bc3864ce668626c05ec2545f` e Heavy RP `f686977343156a2b188dc1271cabe9b2ae197e6a`. Esses pins não equivalem automaticamente à versão de um cliente já instalado.

## Documentação pública consultada

| Fonte primária | Conclusão utilizada |
|---|---|
| [Skyrim Platform](https://github.com/skyrim-multiplayer/skymp/blob/main/docs/docs_skyrim_platform.md) | O cliente SkyMP é construído sobre Skyrim Platform; documentação tem vínculo com a versão |
| [Browser / UI](https://github.com/skyrim-multiplayer/skymp/blob/main/docs/skyrim_platform/browser.md) | Interface HTML no CEF, foco/visibilidade e ponte entre página e plataforma |
| [Exclusive features](https://github.com/skyrim-multiplayer/skymp/blob/main/docs/skyrim_platform/features.md) | `findConsoleCommand` permite interceptar comandos; isso não documenta execução universal autoritativa no servidor |
| [Serverside scripting](https://github.com/skyrim-multiplayer/skymp/blob/main/docs/docs_serverside_scripting_reference.md) | Propriedades, eventos e leitura/escrita pelo global `mp`; visibilidade de proprietário e vizinhos é configurável |
| [ConsoleCommandsService no pin upstream](https://github.com/skyrim-multiplayer/skymp/blob/f926944b18e3aed4bc3864ce668626c05ec2545f/skymp5-client/src/services/services/consoleCommandsService.ts) | Catálogo limitado e encaminhamento de comandos pelo cliente |
| [ConsoleCommands.cpp no pin upstream](https://github.com/skyrim-multiplayer/skymp/blob/f926944b18e3aed4bc3864ce668626c05ec2545f/skymp5-server/cpp/server_guest_lib/ConsoleCommands.cpp) | Dispatch, autorização nativa e limites concretos das operações |

As páginas em `main` foram consultadas como documentação pública, sem atualizar dependências. Para detalhes de comportamento, a análise confrontou os arquivos locais. A página local `docs/docs_server_command_line_api.md` fala da antiga CLI de inicialização do servidor; ela não é documentação dos comandos de chat ou do console ingame.

## Fontes locais e achados

Os caminhos desta tabela são relativos a `Aetherius-RP-Local/`.

| Arquivo / símbolo | Evidência e consequência |
|---|---|
| `README.md`, `docs/aetherius/INTEGRATION.md` | Integração própria, UI herdada e perfil offline; não substituir pela árvore Heavy RP indiscriminadamente |
| `aetherius/gamemode/phase0-basic.js`, handler `customPacket` | Obtém ator por usuário de rede antes de despachar UI/chat; base para identidade do operador |
| `skymp5-client/src/services/services/BridgeService.ts`, `onBrowserMessage` | Encaminha eventos da UI como JSON; validação administrativa precisa ocorrer no servidor |
| `aetherius/gamemode/core/ui-event-router.js`, `dispatch` | Invoca handler do prefixo e fallback nos demais; cada handler deve filtrar seu namespace |
| `aetherius/gamemode/phase0-basic.js`, propriedades de UI | `browserModal` e `panelData` são visíveis só ao dono; padrão aproveitável com cuidado de sequência e persistência |
| `aetherius/ui/index.html`, `handleServerModal` | UI principalmente de voz; trecho de toast comentado e não foi encontrado `handlePanelData`; respostas existentes não garantem feedback visível |
| `skymp5-client/src/services/services/browserService.ts` | F1/F2/F6, Enter e Escape já têm comportamento; coordenar novo painel com menus e HUD |
| `aetherius/gamemode/admin-service.js`, `ROLE_PERMISSIONS` | Permissões derivadas de cargo; VIP não concede autoridade |
| Mesmo arquivo, `registerStaffRole` | Ausência de linha ou erro não apagam explicitamente entrada anterior; revisar recarga e revogação |
| `aetherius/gamemode/commands.js`, `removeActiveCharacter` | Existe limpeza de cache de Staff no caminho de remoção; testar todas as saídas e reutilização de ator |
| `aetherius/gamemode/whitelist.js`, `checkWhitelist` | Busca conta por vínculo de Discord com `profileId`; diverge da identidade pretendida nos documentos mais novos do Heavy RP |
| `aetherius/packages/database/schema.sql` | Existem `staff_roles`, `staff_permissions` e `audit_logs`; existência de tabela não prova uso pelo serviço |
| `aetherius/gamemode/admin-service.js`, `kickPlayer` / `retireCharacter` | Passam `targetActorId` a `mp.kick`; divergência concreta em relação ao binding nativo |
| `skymp5-server/ts/index.ts` | Expõe a instância de servidor como global `mp` no carregamento do gamemode |
| `skymp5-server/ts/scampNative.ts`, `cpp/addon/ScampServer.cpp` | `kick` recebe `userId`; `getUserByActor` resolve a associação. Revalidar sessão e aceitar usuário zero |
| `aetherius/gamemode/admin-service.js`, `auditLog` | Falhas de auditoria são capturadas sem abortar a operação; corrigir no serviço comum |
| Mesmo arquivo, `giveItemAdmin` | Validação de item descrita como permissiva quando o resolvedor não está disponível; painel deve bloquear essa condição |
| Mesmo arquivo, `setGold` | Leitura e delta separados admitem corrida; precisa de semântica atômica antes da liberação |
| `aetherius/gamemode/commands.js`, handlers administrativos | Vários handlers não retornam/aguardam a Promise do serviço; dispatcher não comprova sucesso da operação |
| Mesmo arquivo, `/status` | Rótulo de Staff sem verificação explícita no handler; catálogo da UI não pode confiar na descrição como permissão |
| `skymp5-server/cpp/server_guest_lib/ConsoleCommands.cpp` | Flag ampla de console e configuração global são independentes do RBAC RP |
| `skymp5-server/cpp/server_guest_lib/MpChangeForms.cpp` | Flag de console é serializada; revisar atores persistidos ao fechar caminhos alternativos |

Os achados acima são resultado de inspeção estática; os impactos em runtime devem ser reproduzidos em testes controlados. Nenhum foi corrigido nesta entrega de planejamento.

## O que ainda precisa ser demonstrado

1. Identidade autenticada real para Staff, inclusive vínculo de conta e troca de personagem; o modo offline não comprova esse requisito.
2. Ponte de ida e volta com respostas privadas, sem sobrescrita e sem prender cursor/teclado.
3. Resultado de teleporte entre células, expulsão da sessão correta e sincronização de inventário/economia entre dois clientes.
4. Compatibilidade dos IDs efetivamente resolvidos no ambiente e dos bundles instalados com o código analisado.
5. Disponibilidade e assinatura das funções nativas para recursos futuros. Não assumir que uma chamada presente no gamemode implementa o mesmo comportamento do Skyrim Vanilla.
6. Persistência, deduplicação e reconciliação sob queda do servidor, do banco ou do cliente.

Essas provas compõem os marcos de implementação. O planejamento não depende de instalar um painel web externo, abrir portas adicionais ou substituir o sistema de mods.
