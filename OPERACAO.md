# Operação do painel — 0.1.0

## Requisitos

Destino: monorepo Aetherius, com os contratos existentes de `commands`, `identity-service`, `database`, `core/transaction-service`, `core/espm`, registro de comandos e router de UI. Node.js 22; mysql2 é fornecido pelo gamemode. O banco precisa do schema/migrações operacionais Heavy RP, incluindo chave única `(character_id, base_id)` no inventário.

Contas devem ser persistentes, autenticadas e associadas a personagens aprovados. Acesso exige cargo em `staff_roles` e permissão em `aetherius_admin_permissions`; permissões do serviço antigo não substituem esta tabela.

## Instalação em homologação

1. Execute `node scripts/integrate.cjs --check`, depois `--apply`. Opcional: `--target=CAMINHO`. O script verifica os pontos de alteração e salva backups antes de integrar gamemode, UI, atalho F7 e transporte privado.
2. Compile `skymp5-client` pelo build JavaScript do projeto. Artefato: `build/dist/client/Data/Platform/Plugins/skymp5-client.js`.
3. Aplique a migração pelo runner, com o caminho absoluto do módulo de banco do ambiente desejado:

```powershell
node scripts/migrate.cjs "D:\CAMINHO\gamemode\database.js"
```

O runner usa as credenciais daquele ambiente, registra a execução e não restaura permissões removidas quando reexecutado. Não concede cargo a ninguém. Em caso de falha durante DDL, verifique a migração parcial antes de reexecutar.

4. Copie `config/admin-panel.example.json` para `aetherius/config/admin-panel.local.json`. Configure `enabled: true`, `maxPlayers` igual ao limite real de slots e as ações desejadas. A configuração privada não é criada automaticamente.
5. Publique gamemode e a pasta completa `ui/admin-panel` no runtime pelo fluxo normal do projeto; distribua o cliente compilado. Verifique que a URL de UI aponta para a página integrada.
6. Use uma conta de teste já autorizada em `staff_roles` e um segundo cliente sem privilégios. **F7** ou `/admin` abre; **Esc** fecha. O atalho Esc do cliente existente pode fechar todo o painel, inclusive um diálogo.

O módulo recusa `enableConsoleCommandsForAll`, autowhitelist sintética (`ALLOW_LOCAL_AUTOWHITELIST=true`) e offline não autorizado. `allowOfflineLab: true` permite laboratório offline com contas persistentes válidas; não cria identidade administrativa nem aceita conta zero. Offline com `NODE_ENV=production` permanece bloqueado.

Na ativação, concessões de console persistidas nos atores dinâmicos FF são revogadas. Outros módulos não devem voltar a conceder `consoleCommandsAllowed`. O painel nunca concede console nativo livre.

## Configuração de ações

Identificadores implementados para `enabledActions`:

```json
["player.teleportTo", "player.bring", "player.kick", "economy.setGold", "inventory.grant", "identity.reveal", "character.retire"]
```

Cada ação também exige permissão do cargo atual. `items` contém somente itens autorizados, por exemplo:

```json
{ "id": "pao", "label": "Pão", "descriptor": "65c97:Skyrim.esm" }
```

Confira o descriptor na load order real antes de liberar entrega. O servidor resolve o registro e recusa formas indisponíveis ou que não sejam itens. Quantidade: 1–100; saldo: inteiro de 0–1.000.000; motivo: 5–240 caracteres.

Saldo RP altera `characters.gold`, não o item Vanilla Gold001. A entrega registra inventário e ledger no mesmo commit. A chamada ao jogo ocorre depois: se a conferência ou a auditoria final falhar, fica **A conferir**. Consulte inventário e auditoria antes de repetir. O mesmo ID de solicitação não reaplica a operação; um novo ID representa uma nova operação.

## Cargos iniciais

| Cargo | Permissões |
| --- | --- |
| moderator | Painel, jogadores, teleporte, expulsão, auditoria comum |
| admin | Anteriores, itens, saldo, identidade, aposentadoria, auditoria sensível |
| owner | Mesmas ações, inclusive sobre outros cargos |

Moderadores e administradores não agem sobre cargos iguais/superiores. Não é permitido expulsar ou aposentar a própria sessão. Permissões são relidas em cada operação e novamente sob lock nas transações SQL. A UI apaga conteúdo quando o heartbeat detecta perda de autorização.

A concessão inicial segue o procedimento existente do responsável pelo servidor. Não há criação automática de Owner, edição de cargos ou whitelist neste painel.

## Chat

Com o módulo habilitado, estes aliases usam o mesmo serviço:

| Comando | Argumentos |
| --- | --- |
| `/admin` | Nenhum |
| `/tp`, `/kick`, `/permakill`, `/revelaridentidade`, `/revealidentity` | `actorIdHex motivo` |
| `/setgold` | `actorIdHex valor motivo` |
| `/additem` | `actorIdHex idDoCatalogo quantidade motivo` |

IDs de ator são hexadecimais; `/additem` recebe ID do catálogo, não FormID livre. `/anim` e o diagnóstico antigo `/status` são removidos do registro com o painel habilitado, pois não passam por este fluxo.

## Auditoria e recuperação

`aetherius_admin_operations` registra emissor, alvo, motivo, hash do pedido, horário e resultado. Identidade exige `logs.view.security` no histórico. O histórico não retorna o JSON com o nome revelado; esse nome pode existir no recibo sensível persistido. A retenção e o acesso SQL devem considerar isso.

- **Concluída:** efeito confirmado pelo adaptador; no kick, solicitação de desconexão aceita.
- **Recebida:** reserva persistida sem resultado; pode ter ocorrido interrupção.
- **Recusada:** validação impediu execução.
- **A conferir:** pode ter ocorrido efeito; não repetir automaticamente.

Apenas operações deste serviço aparecem no histórico. Os registros antigos de `audit_logs` não são importados.

Para desativar, ajuste `enabled: false` e reinicie. Isso restaura o comportamento original e os comandos legados; não é uma revogação geral dos privilégios antigos. Para retirar a integração de fonte, use backups e manifesto em `artifacts/integration/`. Preserve as tabelas de auditoria.

## Homologação pendente

Com dois clientes reais: foco/teclado/F7/Esc, jogador sem privilégio, teleporte entre células, kick/reconexão, revogação durante sessão, catálogo da load order, inventário após reconexão e aposentadoria/nova entrada. A sincronização depende também dos serviços existentes do Aetherius e não foi comprovada ingame nesta entrega.
