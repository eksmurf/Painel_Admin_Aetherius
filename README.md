# Painel de Administrador Aetherius — planejamento

Data: 20/09/2026. Estado: pesquisa e planejamento concluídos; implementação e homologação ingame pendentes.

Objetivo: oferecer à Staff autorizada uma interface dentro do Skyrim para consultar jogadores e executar ações administrativas, com permissão validada pelo servidor e registro de auditoria.

Documentos:

1. [Plano de implementação](PLANEJAMENTO.md): interface, arquitetura, acesso, etapas e critérios de aceite.
2. [Matriz de comandos](MATRIZ_COMANDOS.md): relação entre botões, console Vanilla, comandos de chat, suporte encontrado e restrições.
3. [Pesquisa e evidências](PESQUISA_TECNICA.md): documentação consultada, fontes locais e lacunas encontradas.
4. [Reavaliação do Heavy RP](REAVALIACAO_HEAVY_RP.md): comparação direta com a `main` pública, componentes a reutilizar e testes executados.

A base de integração proposta é `../Aetherius-RP-Local`, que contém cliente, servidor, gamemode e UI próprios. Os checkouts `vendor/heavy-rp` e `upstream/skymp` são referências, não destinos de implantação deste painel.

**Revisão de 20/09/2026:** o [Heavy RP de vinicius3232](https://github.com/vinicius3232/skymp-heavy-rp/blob/f686977343156a2b188dc1271cabe9b2ae197e6a/skymp/gamemode/admin-service.js) passa a ser a base explícita de reaproveitamento dos serviços administrativos. A `main` consultada coincide com o pin local, mas o Aetherius integrado não contém todas as mesmas correções. O plano foi ajustado para aproveitar o adaptador de kick, gateway validado, roteamento por prefixo, permissões de identidade e desenho de RBAC. Foram executados 110 testes existentes desse recorte, todos aprovados; isso não substitui a homologação ingame.

**Conclusão de viabilidade:** há uma ponte CEF ↔ cliente ↔ servidor aproveitável e serviços administrativos existentes. O painel é viável como extensão do gamemode, mas não como executor irrestrito de qualquer comando Vanilla. Cada ação precisa de um adaptador autorizado, validação dos efeitos no servidor e homologação com dois clientes.

Esta entrega contém somente documentos. Não foram alterados código de jogo, configurações, permissões, banco de dados ou instalações; não foram iniciados serviços ou Skyrim.
