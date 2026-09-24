# Prompt para implementar o painel dentro do jogo

Copie o texto abaixo para uma tarefa Codex Local aberta no diretório do projeto completo. O prompt não pressupõe caminhos, versões ou credenciais iguais aos do ambiente de referência.

```text
Implemente e instale o Painel Admin Aetherius dentro do Skyrim, integrado
ao cliente e servidor SkyMP existentes neste diretório. Execute o trabalho
até a validação possível, preservando dados, configurações e alterações
locais. A interface deve ser simples, profissional e funcional, com
autorização no servidor e auditoria das ações da Staff.

Repositório do painel:
https://github.com/eksmurf/Painel_Admin_Aetherius

1. INVENTÁRIO E BASE DE TRABALHO
Leia os AGENTS.md aplicáveis e examine o estado Git. Localize o painel,
o monorepo Aetherius/SkyMP, runtime, build, banco/configuração, instância
e perfil MO2, Skyrim e SKSE. O layout de referência tem as pastas irmãs
Painel_Admin_Aetherius e Aetherius-RP-Local; adapte aos caminhos encontrados.

Leia INTEGRACAO_INGAME.md, OPERACAO.md e IMPLEMENTACAO.md no painel.
Use o código e os scripts existentes. O painel não inclui o cliente/servidor
completo, DLLs, modlist, dados ou credenciais. Se algum pré-requisito não
existir, procure primeiro no diretório e nas saídas de build. Obtenha
componentes compatíveis pelas fontes documentadas do projeto ou informe
o requisito exato que precisa ser fornecido; não invente APIs ou identidades.

Determine se este computador hospedará o servidor ou somente um cliente
de um servidor existente. Faça backup antes de substituir arquivos ou
alterar persistência. Trabalhe somente nos componentes necessários.

2. INTEGRAÇÃO DAS FONTES
Execute os testes do painel. Use scripts/integrate.cjs --check com o
--target correto, revise as diferenças e então use --apply. Se os contratos
do destino diferirem, adapte os pontos de integração preservando o restante.
Confirme os trechos mesmo quando os marcadores de integração já existirem.

O resultado deve instalar o módulo em aetherius/gamemode/admin-panel,
registrá-lo no phase0-basic.js e carregar admin-panel/admin.css e app.js
na página aetherius/ui/index.html existente, preservando login e chat.

O F7 no BrowserService deve chamar window.AetheriusAdmin.toggle() por
sp.browser.executeJavaScript. A UI deve enviar cef::ui:event/admin:request
por window.skyrimPlatform.sendMessage. O BridgeService encaminha o evento
por CustomPacket e devolve respostas aetheriusAdmin para
window.AetheriusAdmin.receive. Preserve o controle de foco
aetherius-admin:focus e o fechamento por Esc.

Use o browser CEF já fornecido pelo Skyrim Platform/SkyMP. Meridian não
é dependência desta implementação. A página demo.html é apenas uma prévia;
a instalação ingame usa a página principal integrada e dados do servidor.

3. SERVIDOR, PERSISTÊNCIA E PERMISSÕES
Confira os serviços de identidade, banco, transações, comandos e router
exigidos pelo painel. Preserve validação da sessão, conta e personagem
no servidor, hierarquia de cargos, limites, idempotência e auditoria.

Identifique o backend real. Para MariaDB, utilize o runner/migração do
painel no ambiente correto. Para SQLite já integrado ao Aetherius, utilize
o adaptador e as migrações do monorepo; confira tabelas, índices únicos e
permissões existentes. O runner MariaDB não é uma migração SQLite.
Não reinicialize bancos nem reaplique seeds que restaurem permissões
deliberadamente removidas. Se faltar schema, prepare migração incremental
compatível e valide-a numa cópia descartável antes de aplicar.

Preserve console-guard.cjs e a chamada em install.cjs. Essa proteção usa
a persistência nativa do mundo com driver file para revogar concessões
de console pela API mp e confirmar o resultado. A persistência do mundo
é separada do banco RP. Não conceda console irrestrito nem edite saves
diretamente; adapte e teste o contrato se o destino usar outro driver.

Crie a configuração privada a partir do exemplo, habilite o painel e
ajuste maxPlayers ao limite real. Comece com player.teleportTo,
player.bring e player.kick; mantenha o catálogo vazio. Confira conta
Staff ativa, personagem aprovado, whitelist e cargo/permissões
persistentes pelo procedimento existente. Use uma segunda conta comum.
allowOfflineLab só se aplica a laboratório offline com contas persistentes;
não transplante IDs de laboratório para autenticação de produção.

4. BUILD E PREPARAÇÃO DO PACOTE
Compile o cliente pelos scripts/dependências do monorepo. Na referência,
o webpack de skymp5-client, com DEPLOY_PLUGIN=false e ZIP_PLUGIN=false,
gera build/dist/client/Data/Platform/Plugins/skymp5-client.js.

Prepare o runtime e dist/client usando o fluxo existente do projeto,
conferindo gamemode, configuração privada, bundle compilado e a página
integrada com seus arquivos em Data/Platform/UI/admin-panel. Se faltar
build nativo, siga as instruções e versões suportadas pelo monorepo.

5. INSTALAÇÃO NO JOGO
Com Skyrim fechado, instale o conteúdo completo de dist/client/Data
em um mod dedicado do MO2. Sua raiz deve conter SKSE e Platform.
Inclua DLLs/dependências compatíveis, scripts, bundle, página principal,
admin.css, app.js e settings de conexão/identidade daquele jogador.

Confira o perfil ativo, mod habilitado e arquivos vencedores dos conflitos.
Preserve os plugins ESP/ESM/ESL e a ordem existente. Compare hashes.
Não trate Deploy-LocalClient.ps1 como instalador completo sem inspecioná-lo:
na referência ele atualiza componentes específicos e não copia Platform/UI.

Configure endereço/portas reais e identidades distintas. localhost aponta
para o computador do jogador; não crie outro servidor se ele apenas
precisar conectar ao servidor compartilhado.

6. VALIDAÇÃO E ENTREGA
Inicie o ambiente pelos scripts existentes e confira prontidão, módulo
administrativo habilitado, portas e manifesto. Abra Skyrim via SKSE/MO2.
Valide F7/Esc, foco e controles, lista real de jogadores, acesso Staff,
recusa de jogador comum, teleporte/trazer, kick/reconexão, auditoria e
revogação durante a sessão. Use o segundo cliente de teste para ações.

Na referência, instalação, boot e autorização com sessões simuladas foram
verificados; homologação dentro do jogo ainda estava pendente. Faça essa
distinção no resultado. Se um teste real depender de ação humana ou de
outro cliente, indique exatamente o passo restante sem alegar aprovação.

Entregue a lista das ações, arquivos alterados, backups, comandos usados,
versões/hashes, testes aprovados, pendências, forma de iniciar/parar e
reversão. Não publique credenciais, bancos, saves ou arquivos do jogo.
Não faça commit ou push sem uma solicitação específica nesta tarefa.
```
