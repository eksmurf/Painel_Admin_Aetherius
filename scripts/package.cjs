'use strict';
const fs = require('node:fs'); const path = require('node:path'); const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..'); const target = path.join(root, 'dist');
const files = ['OPERACAO.md', 'INTEGRACAO_INGAME.md', 'PROMPT_INSTALACAO.md', 'IMPLEMENTACAO.md', 'scripts/migrate.cjs', 'scripts/integrate.cjs', 'ui/app.js', 'ui/admin.css', 'ui/index.html', 'config/admin-panel.example.json', 'migrations/001_admin_panel.sql', ...fs.readdirSync(path.join(root, 'gamemode')).filter(file => file.endsWith('.cjs')).map(file => `gamemode/${file}`)];
fs.mkdirSync(target, { recursive: true });
const manifest = [];
for (const relative of files) { const content = fs.readFileSync(path.join(root, relative)); const output = path.join(target, relative); fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, content); manifest.push({ path: relative, sha256: crypto.createHash('sha256').update(content).digest('hex') }); }
fs.writeFileSync(path.join(target, 'manifest.json'), JSON.stringify({ version: require('../package.json').version, files: manifest }, null, 2));
console.log(`Pacote gerado: ${files.length} arquivos. Demonstração excluída.`);
