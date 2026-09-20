# Reavaliação da base Heavy RP

Data: 20/09/2026. Escopo: revisar a referência indicada pelo usuário, confrontar seus serviços com o Aetherius integrado e corrigir o planejamento. Não houve implantação de código de jogo.

## 1. Correção do alcance da análise anterior

A análise inicial consultou documentos da cópia local Heavy RP, mas examinou os comandos principalmente em `Aetherius-RP-Local/aetherius/gamemode`. Isso deixou de aproveitar diferenças importantes do Heavy RP público. Portanto, aquela análise era parcial quanto à referência indicada.

A `main` pública foi resolvida pela API do GitHub para **`f686977343156a2b188dc1271cabe9b2ae197e6a`**, com data de commit 06/09/2026. É o mesmo pin de `vendor/heavy-rp`, não uma versão nova baixada após o planejamento. A diferença está entre esse Heavy RP e a integração Aetherius.

O [admin-service.js conferido](https://github.com/vinicius3232/skymp-heavy-rp/blob/f686977343156a2b188dc1271cabe9b2ae197e6a/skymp/gamemode/admin-service.js) foi baixado da revisão fixa e comparado com a cópia local. SHA-256 idêntico: `7EA47213C4DDEAC428955027FF0C82340C97BF98C49C2FE6B673ED5A8729994A`. Dez arquivos centrais de código/documentação também foram confrontados com seus blobs Git dessa revisão, sem diferenças.

## 2. Decisão revisada

**Heavy RP é a base de reaproveitamento dos serviços administrativos; Aetherius continua sendo o destino da integração.** Aproveitar a implementação existente e seus testes, adaptando as fronteiras de rede, identidade, persistência e interface. Não começar um serviço administrativo independente nem substituir o monorepo inteiro.

| Componente | Heavy RP examinado | Diferença no Aetherius / decisão |
|---|---|---|
| Administração | Cargos, permissões, teleporte, kick, itens, ouro, encerramento e revelação de identidade | Estender o serviço compartilhado e dar resultados estruturados aos botões/chat |
| Kick | Usa adaptador que resolve ator → usuário | Corrigir o Aetherius por reaproveitamento; o defeito encontrado anteriormente não permanece nesse caminho do Heavy RP |
| Identidade online | Whitelist resolve perfil como ID da conta | Aetherius ainda consulta vínculo Discord; transportar a correção junto do contrato de login, sem mudar só uma query isolada |
| Identidade RP | Revelação explícita e restrita | Lista, busca e histórico devem respeitar anonimato; não conceder nome real a moderador por estar no painel |
| Entrada CEF | Event source `_onUiEvent` e envelope em um argumento | Aetherius usa `cef::ui:event` e `CustomPacket`; adaptar uma rota, evitando encaminhamento duplicado |
| Roteador | Despacho exclusivo ao prefixo e validação do envelope | Aetherius conserva fallback que entrega a outros handlers; reaproveitar correção com regressão dos módulos |
| Limites | Contador e políticas por evento | Desabilitados por padrão; configurar para administração, não anunciar proteção automática |
| UI | Player panel, toasts e callbacks mais completos | São referências de componentes; player panel não é painel administrativo pronto. A UI Aetherius é principalmente de voz |
| RBAC | Código ainda usa mapa estático; ADR propõe autoridade no banco | Implementar o recorte da migração no plano, distinguindo desenho de comportamento disponível |

## 3. Recursos e problemas remanescentes

O serviço público adiciona `reveal_identity` e `run_world_probe` para admin/owner. `/revelaridentidade` e `/revealidentity` estão registrados em `commands.js`; censo e sonda pertencem a módulos separados e dependem de sua ativação. O censo é consulta sob demanda; a sonda manipula inventário e não deve entrar como simples botão de leitura.

A revelação chama auditoria antes da notificação, mas `identity.auditIdentityEvent` captura o erro do banco e apenas escreve no console. Assim, a ordem das chamadas não garante bloqueio da revelação sem registro persistido. Adaptar para que a operação falhe antes de revelar quando a auditoria obrigatória falhar.

O adaptador resolve corretamente o identificador de kick, mas isso não prova que a sessão é a mesma após o atraso de três segundos do serviço. O painel deve guardar a identidade da sessão, revalidá-la na execução e confirmar a desconexão; o retorno do adaptador não é confirmação de rede.

Continuam relevantes no código público lido: cache de cargo sem revogação imediata, captura de erro em `auditLog`, ajuste absoluto de ouro por leitura e delta separados, validação de item permissiva quando a API não está disponível, ausência de autorização explícita no handler `/status` e callbacks administrativos sem retorno estruturado de resultado. Reutilizar não significa dispensar esses ajustes.

`ban`, `view_audit` e `manage_whitelist` constam do mapa de permissões, mas uma permissão declarada não entrega a função correspondente. A documentação administrativa distingue intenção de estado implementado. Ban/desban e interface completa continuam fora do MVP inicial.

## 4. RBAC e histórico

O [ADR 005](https://github.com/vinicius3232/skymp-heavy-rp/blob/f686977343156a2b188dc1271cabe9b2ae197e6a/docs/technical/ADR_005_ADMIN_RBAC.md) define autorização por permissão, cargos sem herança implícita e associação de permissões no banco. O [documento RBAC](https://github.com/vinicius3232/skymp-heavy-rp/blob/f686977343156a2b188dc1271cabe9b2ae197e6a/docs/admin/RBAC.md) declara que a implementação não foi iniciada. O plano revisado adota essa direção com migração mínima e seed dos cargos existentes.

Separar histórico operacional de registros sensíveis. `logs.view` não deve permitir ler os dados protegidos por `identity.reveal` ou eventos de gestão de cargos. A proposta de consulta do painel deve verificar permissão tanto no endpoint/evento quanto na projeção dos campos e filtros retornados.

Não implementar o painel web/Agent remoto apenas por aparecerem na documentação SkyAdmin: a demanda atual é ingame, com um canal de jogo existente. Reaproveitar as regras de autorização e auditoria sem importar serviços que não são necessários ao fluxo.

## 5. Verificação executada

Foram executadas as sete suítes existentes abaixo no checkout Heavy RP fixado, usando Node `22.23.2` do laboratório:

```text
node --test --test-reporter=tap admin-service.test.js
  permissions.behavior.test.js identity-staff-reveal.test.js
  core/skymp-adapter/index.test.js core/ui-event-gateway.test.js
  core/ui-event-router.test.js core/ui-event-rate-limiter.test.js
```

As linhas acima representam uma única invocação. Resultado: **110 testes, 19 suítes, 110 aprovados, zero falhas, zero skips**.

O recorte cobre comportamentos de permissões, encerramento de personagem, revelação de identidade, adaptador, gateway, roteamento e limitação. As dependências são simuladas nesses testes; não houve teste com banco real, CEF real ou dois clientes conectados. A matriz de segurança futura do painel continua sendo critério de aceite, não prova já atendida por esses 110 testes.

Evidências locais do laboratório: `tmp/heavy-rp-admin-review-20260920/revision.txt`, `source-verification.json` e `targeted-tests.tap`. Esses arquivos temporários não são necessários para ler o plano nem foram incluídos como código no repositório do painel.

## 6. Referências para a implementação

Todos os links fixam a revisão estudada:

- [Serviço administrativo](https://github.com/vinicius3232/skymp-heavy-rp/blob/f686977343156a2b188dc1271cabe9b2ae197e6a/skymp/gamemode/admin-service.js) e [registro dos comandos](https://github.com/vinicius3232/skymp-heavy-rp/blob/f686977343156a2b188dc1271cabe9b2ae197e6a/skymp/gamemode/commands.js).
- [Adaptador SkyMP](https://github.com/vinicius3232/skymp-heavy-rp/blob/f686977343156a2b188dc1271cabe9b2ae197e6a/skymp/gamemode/core/skymp-adapter/index.js).
- [Gateway CEF](https://github.com/vinicius3232/skymp-heavy-rp/blob/f686977343156a2b188dc1271cabe9b2ae197e6a/skymp/gamemode/core/ui-event-gateway.js), [roteador](https://github.com/vinicius3232/skymp-heavy-rp/blob/f686977343156a2b188dc1271cabe9b2ae197e6a/skymp/gamemode/core/ui-event-router.js) e [limitador](https://github.com/vinicius3232/skymp-heavy-rp/blob/f686977343156a2b188dc1271cabe9b2ae197e6a/skymp/gamemode/core/ui-event-rate-limiter.js).
- [Whitelist e identidade de conta](https://github.com/vinicius3232/skymp-heavy-rp/blob/f686977343156a2b188dc1271cabe9b2ae197e6a/skymp/gamemode/whitelist.js) e [serviço de identidade RP](https://github.com/vinicius3232/skymp-heavy-rp/blob/f686977343156a2b188dc1271cabe9b2ae197e6a/skymp/gamemode/identity-service.js).
- [Auditoria da plataforma administrativa](https://github.com/vinicius3232/skymp-heavy-rp/blob/f686977343156a2b188dc1271cabe9b2ae197e6a/docs/research/ADMIN_PLATFORM_AUDIT.md) e [matriz de segurança proposta](https://github.com/vinicius3232/skymp-heavy-rp/blob/f686977343156a2b188dc1271cabe9b2ae197e6a/docs/testing/ADMIN_SECURITY_MATRIX.md).
