'use strict';
const fs = require('node:fs'); const path = require('node:path');
const filename = process.argv[2];
if (!filename || !path.isAbsolute(filename)) throw new Error('Uso: node scripts/migrate.cjs CAMINHO_ABSOLUTO/database.js. Use o módulo do ambiente de destino.');
const db = require(filename);
(async () => {
  const conn = await db.getConnection();
  try {
    const [lock] = await conn.query("SELECT GET_LOCK('aetherius_admin_migrations', 10) AS acquired");
    if (Number(lock[0].acquired) !== 1) throw new Error('Outra migração está em execução.');
    await conn.query('CREATE TABLE IF NOT EXISTS aetherius_admin_migrations (id VARCHAR(64) PRIMARY KEY, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB');
    const [applied] = await conn.query("SELECT id FROM aetherius_admin_migrations WHERE id='001_admin_panel'");
    if (!applied.length) {
      const sql = fs.readFileSync(path.join(__dirname, '../migrations/001_admin_panel.sql'), 'utf8').replace(/^--.*$/gm, '');
      for (const statement of sql.split(';').map(s => s.trim()).filter(Boolean)) await conn.query(statement);
      await conn.query("INSERT INTO aetherius_admin_migrations (id) VALUES ('001_admin_panel')");
      console.log('Migração 001_admin_panel aplicada. Nenhum cargo concedido.');
    } else console.log('Migração já aplicada; permissões atuais preservadas.');
  } finally { await conn.query("SELECT RELEASE_LOCK('aetherius_admin_migrations')").catch(() => {}); conn.release(); await db.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
