# Painel de Administrador Aetherius

Painel administrativo ingame para o servidor SkyMP Aetherius. Interface compacta e levemente transparente, ações diretas, permissões verificadas no servidor e auditoria persistente. Configurações privadas, bancos de jogadores e arquivos do jogo não são distribuídos.

| Área | Recursos atuais |
| --- | --- |
| Moderação | Ir até/trazer jogador, expulsar, banir, revogar banimento e recuperar jogador |
| Administração | Entregar item, definir saldo RP, encerrar personagem, executar animação e investigar mundo |
| Modo de atendimento | Invulnerabilidade, colisões, fantasma, invisibilidade, velocidade e câmera livre, exclusivamente no operador |
| NPCs | Spawn imediato de um NPC autorizado na posição do operador, sem zona ou reposição automática |
| Clima do servidor | Clima sincronizado nas áreas externas configuradas, inclusive para novas conexões; restauração do clima natural |
| Catálogos | Pesquisa nos inventários por nome do jogador ou por item, totais por item e acesso ao inventário de cada proprietário |
| Auditoria e Staff | Consulta de operações e permissões, conforme a autorização da conta |

As ações sem permissão aparecem em vermelho. Ações que dependem de jogador permanecem esmaecidas até a seleção. As descrições ficam no sumário inferior esquerdo de cada aba. Os seletores são desenhados dentro do painel, com rolagem e navegação por teclado.

Na pesquisa de inventários, o estado ao vivo substitui o registro persistido quando disponível. Jogadores offline usam o último registro persistido. Baús não entram nos totais.

O modo de atendimento e o spawn de NPC ignoram a seleção de outro jogador: o servidor resolve a sessão do operador. A câmera livre fecha o painel para liberar os controles; F7 reabre o painel. Os modos temporários expiram quando deixam de ser renovados pelo servidor.

## Integração

Requer Node.js 22 com `node:sqlite` disponível e um monorepo Aetherius compatível. Não é um painel independente para qualquer instalação SkyMP. O destino padrão é `../Aetherius-RP-Local`.

```powershell
node scripts/integrate.cjs --check
node scripts/integrate.cjs --apply
# Outro destino:
node scripts/integrate.cjs --check --target=CAMINHO
```

A integração copia os módulos do gamemode, a interface e `client/AdminToolsService.ts`, conectando o transporte existente. Guarda backups em `artifacts/integration/`. Depois é necessário compilar o cliente e instalar os arquivos no runtime e no cliente do jogo conforme o [guia de integração](INTEGRACAO_INGAME.md). O comando não realiza essa implantação por conta própria.

A câmera livre exige que o cliente nativo exponha `setFreeCameraMode(boolean): boolean`. A DLL do cliente não está incluída neste repositório. Os guias de instalação anteriores descrevem a base de integração; a tabela acima descreve os recursos atuais.

O exemplo `config/admin-panel.example.json` permanece desativado e libera apenas teleporte e expulsão após ativação explícita. Cada instalação deve configurar `enabledActions`, permissões e os catálogos autorizados `items`, `npcs` e `weathers`. Os identificadores das ações e permissões estão em `gamemode/catalog.cjs` e `gamemode/extension-catalog.cjs`.

Um `catalogFile` opcional, dentro da pasta de configuração, pode fornecer os catálogos junto de `loadOrder`, que deve coincidir com a ordem carregada pelo servidor. `globalWeatherWorldspaces` define os mundos externos abrangidos pelo clima; sem configuração adicional, o escopo padrão é Tamriel e Solstheim. Interiores e mundos fora desse escopo preservam o clima natural.

## Validação e pacote

```powershell
npm test
node tests/extensions-ui.cjs
npm run package
```

Os testes das extensões usam os módulos SQLite, transações e esquema de `../Aetherius-RP-Local`. Os testes do cliente usam o TypeScript instalado em `../Aetherius-RP-Local/skymp5-client/node_modules`. O teste de interface requer Playwright e Chromium; `PLAYWRIGHT_MODULE` e `BROWSER_EXECUTABLE` permitem informar instalações existentes.

A validação local inclui 79 testes automatizados e cenários de navegador para inventários, modos do operador, spawn imediato e seletores em três tamanhos de tela. Os testes simulam a ponte do jogo e não substituem a validação dentro do Skyrim.

O pacote em `dist/` inclui os módulos, o serviço do cliente, a interface, o exemplo de configuração, a migração e os avisos de licença. Não inclui dados privados nem relatórios de estudo. `npm run preview` mantém uma demonstração básica com dados fictícios, que não representa todas as funções disponíveis no servidor.

## Licenças

Os componentes de terceiros conservam suas licenças e atribuições em [third-party/alduinak/NOTICE.md](third-party/alduinak/NOTICE.md).
