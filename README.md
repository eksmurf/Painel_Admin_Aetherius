# Painel de Administrador Aetherius — planejamento

Data: 20/09/2026. Estado: pesquisa e planejamento concluídos; implementação e homologação ingame pendentes.

Objetivo: oferecer à Staff autorizada uma interface dentro do Skyrim para consultar jogadores e executar ações administrativas, com permissão validada pelo servidor e registro de auditoria.

Documentos:

1. [Plano de implementação](PLANEJAMENTO.md): interface, arquitetura, acesso, etapas e critérios de aceite.
2. [Matriz de comandos](MATRIZ_COMANDOS.md): relação entre botões, console Vanilla, comandos de chat, suporte encontrado e restrições.
3. [Pesquisa e evidências](PESQUISA_TECNICA.md): documentação consultada, fontes locais e lacunas encontradas.

A base de integração proposta é `../Aetherius-RP-Local`, que contém cliente, servidor, gamemode e UI próprios. Os checkouts `vendor/heavy-rp` e `upstream/skymp` são referências, não destinos de implantação deste painel.

**Conclusão de viabilidade:** há uma ponte CEF ↔ cliente ↔ servidor aproveitável e serviços administrativos existentes. O painel é viável como extensão do gamemode, mas não como executor irrestrito de qualquer comando Vanilla. Cada ação precisa de um adaptador autorizado, validação dos efeitos no servidor e homologação com dois clientes.

Esta entrega contém somente documentos. Não foram alterados código de jogo, configurações, permissões, banco de dados ou instalações; não foram iniciados serviços ou Skyrim.
