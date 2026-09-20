'use strict';
const fs = require('node:fs'); const path = require('node:path'); const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const targetArg = process.argv.find(arg => arg.startsWith('--target='));
const target = path.resolve(targetArg ? targetArg.slice(9) : path.join(root, '../Aetherius-RP-Local'));
if (!process.argv.includes('--check') && !process.argv.includes('--apply')) throw new Error('Use --check ou --apply; --target=CAMINHO opcional.');
if (target === root || !fs.existsSync(path.join(target, 'aetherius/gamemode/phase0-basic.js'))) throw new Error('Destino não é um monorepo Aetherius reconhecido.');
const marker = '// AETHERIUS_ADMIN_PANEL';
function patchOnce(relative, anchor, addition, before = false) {
  const source = fs.readFileSync(path.join(target, relative), 'utf8');
  if (source.includes(marker)) return { relative, content: source, unchanged: true };
  if (!source.includes(anchor)) throw new Error(`Contrato mudou em ${relative}; nenhuma alteração foi aplicada.`);
  return { relative, content: source.replace(anchor, before ? addition + '\n' + anchor : anchor + '\n' + addition) };
}
const changes = [];
changes.push(patchOnce('aetherius/gamemode/phase0-basic.js', 'console.log("[phase0] SkyMP Heavy RP gamemode loaded");', `${marker}\nif (typeof mp !== 'undefined') require(path.join(gamemodeDir, 'admin-panel', 'install.cjs')).install({ mp, gamemodeDir });`));
const uiPath = 'aetherius/ui/index.html';
let ui = fs.readFileSync(path.join(target, uiPath), 'utf8');
if (!ui.includes('admin-panel/app.js')) { if (!ui.includes('</head>') || !ui.includes('</body>')) throw new Error('UI sem pontos de integração.'); ui = ui.replace('</head>', '<link rel="stylesheet" href="admin-panel/admin.css">\n</head>').replace('</body>', '<script src="admin-panel/app.js" defer></script>\n</body>'); }
changes.push({ relative: uiPath, content: ui });
const bridgePath = 'skymp5-client/src/services/services/BridgeService.ts';
let bridge = fs.readFileSync(path.join(target, bridgePath), 'utf8');
if (!bridge.includes(marker)) {
  const inputAnchor = '    const args = e.arguments;';
  const outputAnchor = '    if (msgContent["customPacketType"] !== "voipAutoConnect") {';
  if (!bridge.includes(inputAnchor) || !bridge.includes(outputAnchor)) throw new Error('Contrato BridgeService mudou.');
  bridge = bridge.replace(inputAnchor, `${inputAnchor}\n    ${marker}\n    if (args[0] === 'aetherius-admin:focus') {\n      this.sp.browser.setFocused(args[1] === true);\n      if (args[1] === true) this.sp.browser.setVisible(true);\n      return;\n    }`);
  bridge = bridge.replace(outputAnchor, `    if (msgContent['customPacketType'] === 'aetheriusAdmin') {\n      this.sp.browser.executeJavaScript('window.AetheriusAdmin && window.AetheriusAdmin.receive(' + JSON.stringify(msgContent['response']) + ')');\n      return;\n    }\n${outputAnchor}`);
}
changes.push({ relative: bridgePath, content: bridge });
changes.push(patchOnce('skymp5-client/src/services/services/browserService.ts', '    if (e.isDown([DxScanCode.F1])) {', `    ${marker}\n    if (this.badMenusOpen.size === 0 && e.isDown([DxScanCode.F7])) {\n      this.sp.browser.executeJavaScript('window.AetheriusAdmin && window.AetheriusAdmin.toggle()');\n    }`, true));
for (const file of fs.readdirSync(path.join(root, 'gamemode')).filter(name => name.endsWith('.cjs'))) changes.push({ relative: `aetherius/gamemode/admin-panel/${file}`, content: fs.readFileSync(path.join(root, 'gamemode', file), 'utf8') });
for (const file of ['app.js', 'admin.css']) changes.push({ relative: `aetherius/ui/admin-panel/${file}`, content: fs.readFileSync(path.join(root, 'ui', file), 'utf8') });
changes.push({ relative: 'aetherius/config/admin-panel.example.json', content: fs.readFileSync(path.join(root, 'config/admin-panel.example.json'), 'utf8') });
changes.push({ relative: 'aetherius/packages/database/migration-aetherius-admin-001.sql', content: fs.readFileSync(path.join(root, 'migrations/001_admin_panel.sql'), 'utf8') });
const changed = changes.filter(entry => !fs.existsSync(path.join(target, entry.relative)) || fs.readFileSync(path.join(target, entry.relative), 'utf8') !== entry.content);
if (process.argv.includes('--apply') && changed.length) {
  const backup = path.join(root, 'artifacts/integration', new Date().toISOString().replace(/[:.]/g, '-'));
  const manifest = [];
  for (const entry of changed) {
    const destination = path.join(target, entry.relative);
    const existed = fs.existsSync(destination);
    if (existed) { const saved = path.join(backup, entry.relative); fs.mkdirSync(path.dirname(saved), { recursive: true }); fs.copyFileSync(destination, saved); }
    fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.writeFileSync(destination, entry.content);
    manifest.push({ path: entry.relative, existed, sha256: crypto.createHash('sha256').update(entry.content).digest('hex') });
  }
  fs.mkdirSync(backup, { recursive: true }); fs.writeFileSync(path.join(backup, 'manifest.json'), JSON.stringify({ target, files: manifest }, null, 2));
  console.log(`Integração aplicada na fonte. Backup: ${backup}`);
}
console.log(`${changed.length} arquivos ${process.argv.includes('--apply') ? 'atualizados' : 'a atualizar'}. Banco, runtime, configurações privadas e instalação do jogo preservados.`);
changed.forEach(entry => console.log(entry.relative));
