# Instalação ingame — referência de 23/09/2026

Este repositório contém o painel, serviço administrativo, migração MariaDB e integrador de fontes. Ele depende do cliente e servidor completos do Aetherius/SkyMP. Não inclui o jogo, modlist, DLLs compiladas, banco de jogadores ou credenciais. O [prompt de implementação](PROMPT_INSTALACAO.md) orienta o Codex a usar o que já existe no diretório de destino.

## O que foi preparado no ambiente de referência

- Integração de `phase0-basic.js`, `BridgeService.ts`, `browserService.ts` e da página principal da UI.
- Compilação do cliente TypeScript, preparação do runtime e instalação do pacote completo em mod dedicado do MO2, preservando os plugins do jogo.
- Ativação do módulo, contas persistentes de laboratório separadas para administrador/jogador, permissões, whitelist e auditoria.
- Ações iniciais: `player.teleportTo`, `player.bring` e `player.kick`; catálogo de itens vazio.
- Revogação das concessões de console pela API nativa, usando o inventário de persistência do mundo. `console-guard.cjs` e o ajuste em `install.cjs`, antes somente locais, agora estão neste repositório.
- Boot do servidor e testes de autorização com banco real e sessões simuladas. **Abertura e ações dentro do Skyrim ainda exigem homologação real.**

A instalação inicial usou MariaDB. Posteriormente, o monorepo local foi migrado para SQLite. Essa mudança pertence à infraestrutura do servidor e não é instalada pelo integrador deste painel.

## 1. Reconhecer o diretório

O layout usado como referência tem `Painel_Admin_Aetherius` e `Aetherius-RP-Local` como pastas irmãs. Outros caminhos podem ser informados ao integrador. Leia os `AGENTS.md` aplicáveis e o estado Git antes de alterar arquivos.

No monorepo devem existir:

| Componente | Caminho/contrato esperado |
| --- | --- |
| Gamemode | `aetherius/gamemode/phase0-basic.js` |
| Serviços existentes | `commands`, `identity-service`, `database`, `core/transaction-service`, `core/espm`, `core/ui-event-router`, `core/command-registry` |
| Cliente | `skymp5-client/src/services/services/BridgeService.ts` e `browserService.ts` |
| Página ingame | `aetherius/ui/index.html` |
| Saída compilada | `build/dist/client/Data` |
| Pacote preparado | `dist/client/Data` |
| Runtime local | `runtime/server` |

Não substitua o monorepo inteiro por outra revisão para satisfazer o integrador. Se os contratos diferirem, adapte somente a integração após ler as implementações existentes. Se houver apenas este repositório, será necessário obter também o cliente/servidor Aetherius compatível; HTML sozinho não fornece esses componentes.

## 2. Integrar fontes

Faça backup dos arquivos envolvidos. Na pasta do painel, com Node 22 ou superior:

```powershell
node --test tests/*.test.cjs
node scripts/integrate.cjs --check "--target=D:\CAMINHO\Aetherius-RP-Local"
# Compare os arquivos listados com quaisquer alterações locais antes de aplicar.
node scripts/integrate.cjs --apply "--target=D:\CAMINHO\Aetherius-RP-Local"
```

O `--check` não escreve. O `--apply` salva os arquivos anteriores em `artifacts/integration/`. O integrador copia o módulo administrativo, UI, exemplo de configuração e migração; também altera os pontos de entrada do cliente e servidor. Ele não compila, provisiona contas, migra banco nem instala o cliente no MO2. Os marcadores evitam duplicação, mas não comprovam que uma integração anteriormente marcada esteja completa: revise os trechos efetivamente instalados.

Fluxo esperado:

1. F7, sem menus bloqueadores, chama `window.AetheriusAdmin.toggle()` por `sp.browser.executeJavaScript`.
2. A página principal carrega `admin-panel/admin.css` e `admin-panel/app.js`.
3. A UI usa `window.skyrimPlatform.sendMessage('cef::ui:event', 'admin:request', message)`.
4. `BridgeService` envia o evento ao servidor por `CustomPacket`; o servidor associa a sessão real e valida permissão.
5. A resposta privada `customPacketType: 'aetheriusAdmin'` retorna a `window.AetheriusAdmin.receive(...)`.
6. `aetherius-admin:focus` controla foco/visibilidade; Esc deve liberar os controles.

Essa implementação usa o browser CEF do Skyrim Platform. Não exige Meridian. Preserve a UI principal existente, incluindo login/chat. `demo.html` e o preview na porta 4177 são demonstrações, não a entrada de produção.

## 3. Preparar persistência e acesso

Antes de mudanças no banco, pare somente os serviços deste ambiente e faça backup consistente da persistência e configuração. No SQLite ativo, copiar somente o arquivo principal pode omitir WAL; use o procedimento de backup do servidor.

**MariaDB/MySQL:** use o schema operacional do servidor e `scripts/migrate.cjs` com o caminho absoluto do `database.js` do ambiente correto, conforme [OPERACAO.md](OPERACAO.md). O runner e `migrations/001_admin_panel.sql` deste repositório são específicos desse backend. A migração não concede cargo a uma conta.

**SQLite já existente no Aetherius:** preserve o adaptador e as migrações do monorepo. No ambiente de referência, `runtime/server/config/database.local.json` seleciona o backend e `runtime/server/persistence/aetherius-rp.sqlite` guarda os dados RP. O schema para instalação nova fica em `aetherius/storage/schema.sqlite.sql`. Não execute o runner MariaDB nesse banco nem reaplique o schema inteiro sobre uma instalação existente. Confira as tabelas `aetherius_admin_permissions`, `aetherius_admin_operations` e o histórico `aetherius_admin_migrations`, incluindo unicidade de `(account_id, request_id)`. Se faltarem, prepare uma migração incremental no mecanismo SQLite do servidor e teste em cópia descartável. Não restaure permissões deliberadamente revogadas.

`mysql-store.cjs` mantém o nome histórico e usa a interface de banco/transações do gamemode. O Aetherius local fornece a tradução e semântica transacional para SQLite; apontar esse módulo diretamente a um driver SQLite genérico não basta. Este repositório não distribui esse adaptador de infraestrutura.

**Persistência nativa do mundo:** é independente do banco RP. `console-guard.cjs` exige `databaseDriver: 'file'` e `databaseName` nos settings nativos, resolve `changeForms` a partir do diretório de execução do servidor e revoga concessões por `mp.set`, confirmando por `mp.get`. Backend desconhecido impede ativação; adapte/teste esse contrato se o destino usar outra persistência. Não remova a verificação nem edite saves diretamente.

Use a identidade e os procedimentos de aprovação existentes. Confira conta ativa, personagem aprovado e vinculado à conta, whitelist e cargo em `staff_roles`; as permissões vêm de `aetherius_admin_permissions`. Use contas distintas para Staff e jogador comum. IDs locais não substituem autenticação de produção.

Copie `config/admin-panel.example.json` para a configuração privada do monorepo, habilite o módulo e ajuste `maxPlayers` ao limite real de slots. Comece pelas três ações do exemplo e catálogo vazio. `allowOfflineLab` só deve ser habilitado em laboratório offline com contas persistentes. `ALLOW_LOCAL_AUTOWHITELIST` deve ser falso e `enableConsoleCommandsForAll` deve estar desabilitado. Preserve o método de autenticação do servidor.

## 4. Compilar e preparar o runtime

Use primeiro as instruções de build do monorepo e as dependências já instaladas/lockfile. Na referência, com as dependências disponíveis, a compilação do cliente foi:

```powershell
# Dentro de skymp5-client
$env:DEPLOY_PLUGIN = 'false'
$env:ZIP_PLUGIN = 'false'
node node_modules/webpack/bin/webpack.js
```

Saída: `build/dist/client/Data/Platform/Plugins/skymp5-client.js`. Se DLLs ou artefatos de servidor estiverem ausentes, use o build nativo documentado para as versões do destino; o webpack não gera essas DLLs.

No monorepo local, `scripts/Prepare-Runtime.ps1` publica o gamemode e monta `dist/client`, incluindo `aetherius/ui` em `Data/Platform/UI`. Leia o script e sua configuração antes de executá-lo: ele também prepara outros arquivos do servidor. Confira a configuração privada do painel no runtime, o bundle recém-compilado e a UI integrada no pacote final. Não sobrescreva persistência ou settings particulares sem comparação e backup.

## 5. Instalar no MO2

Com Skyrim fechado, identifique a instância e perfil usados pelo jogador. A referência usou o mod dedicado `Aetherius - SkyMP Cliente Local`. Copie o **conteúdo completo** de `dist/client/Data` para a raiz desse mod, preservando/restaurando a identidade e conexão específicas daquele cliente. A raiz deve conter `SKSE` e `Platform`, não `Data/Data`.

Verifique pelo menos:

- `SKSE/Plugins/SkyrimPlatform.dll` e `MpClientPlugin.dll`;
- `Platform/Distribution/RuntimeDependencies/SkyrimPlatformImpl.dll` e demais dependências do pacote;
- `Platform/Plugins/skymp5-client.js` e settings do jogador;
- `Platform/UI/index.html`, `Platform/UI/admin-panel/app.js` e `admin.css`.

Confira compatibilidade de Skyrim/SKSE/Address Library e runtime CEF; use arquivos da mesma distribuição compatível. Habilite o mod no perfil e confira quais arquivos vencem os conflitos. Preserve ESP/ESM/ESL e sua ordem. Registre hashes de origem/destino.

O `scripts/Deploy-LocalClient.ps1` presente no monorepo de referência é uma atualização parcial de componentes e **não copia `Platform/UI`**. Ele sozinho não instala nem atualiza toda a interface. Faça a implantação completa ou complemente explicitamente a UI integrada, com backup e verificação.

Configure o endereço real do servidor. `localhost` só serve quando o servidor está na própria máquina do jogador. Se houver apenas um servidor compartilhado, não crie outro banco/runtime para cada cliente. Não reutilize a mesma identidade nos dois clientes de teste.

## 6. Validar e registrar

Use os scripts de início/parada existentes. No ambiente local, são `scripts/Start-Local.ps1` e `scripts/Stop-Local.ps1`; o início atual verifica SQLite e inicia servidor/manifesto. Confira `[aetherius-admin] enabled`, prontidão, portas configuradas e correspondência do manifesto/modlist.

Execute SKSE pelo MO2 e teste com Staff e jogador comum: F7, Esc, foco, lista real, recusa de acesso, teleporte entre células, trazer jogador, kick/reconexão, auditoria e revogação de permissão durante a sessão. Preserve os controles de autorização em toda a validação.

Se não for possível entrar no jogo ou obter o segundo cliente, registre precisamente a pendência e entregue a instalação preparada. Testes automatizados, boot e sessões simuladas não comprovam renderização/sincronização ingame.

Entregue caminhos alterados, hashes/versões, backups, comandos, resultados, limitações e reversão. Para desativar, use `enabled: false` e reinicie; isso restaura comandos legados, não revoga todos os privilégios do servidor. Preserve auditoria e dados de jogadores.
