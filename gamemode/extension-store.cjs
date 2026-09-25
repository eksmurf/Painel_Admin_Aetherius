'use strict';
const { fail } = require('./protocol.cjs');
const { definitions } = require('./extension-catalog.cjs');
const schema = [
  `CREATE TABLE IF NOT EXISTS aetherius_admin_world (kind VARCHAR(24) NOT NULL, entry_key VARCHAR(48) NOT NULL, revision INTEGER NOT NULL, payload_json TEXT NOT NULL, PRIMARY KEY(kind,entry_key))`,
  `CREATE TABLE IF NOT EXISTS aetherius_admin_bans (account_id INTEGER PRIMARY KEY, previous_status VARCHAR(24) NOT NULL, active INTEGER NOT NULL, reason VARCHAR(240) NOT NULL, banned_by INTEGER NOT NULL, updated_ms BIGINT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS aetherius_admin_entities (entry_key VARCHAR(96) PRIMARY KEY, descriptor VARCHAR(200) NOT NULL, kind VARCHAR(24) NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS aetherius_carry_runs (character_id INTEGER PRIMARY KEY, active_json TEXT, last_finished_ms BIGINT NOT NULL DEFAULT 0)`
];
function createExtensionStore(db) {
  async function init() {
    for (const sql of schema) await db.query(sql);
    // Imported SQLite schemas once lost the UNIQUE attribute on these indexes.
    // Add constraints without deleting or merging any existing record.
    for (const [name, table, columns] of [
      ['aap_request_once','aetherius_admin_operations','account_id,request_id'],
      ['aap_gold_once','gold_transactions','idempotency_key'],
      ['aap_inventory_once','inventory_transactions','idempotency_key'],
      ['aap_profession_once','character_professions','character_id,profession_code'],
      ['aap_membership_once','governance_memberships','character_id,scope_type,scope_id']
    ]) {
      try { await db.query(`CREATE UNIQUE INDEX ${name} ON ${table} (${columns})`); }
      catch(error) { if (!/already exists|Duplicate key name/i.test(error.message)) throw error; }
    }
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      const [exists] = await conn.query('SELECT id FROM aetherius_admin_migrations WHERE id=?', ['002-alduinak']);
      if (!exists.length) {
        for (const permission of new Set(definitions.map(row => row.permission))) {
          // Existing permission removals remain deliberate. Seed only newly introduced permissions.
          if (['players.teleport'].includes(permission)) continue;
          for (const role of ['admin', 'owner']) await conn.query('INSERT IGNORE INTO aetherius_admin_permissions(role,permission) VALUES (?,?)', [role, permission]);
        }
        for (const permission of ['world.inspect', 'world.animation', 'players.recover']) await conn.query('INSERT IGNORE INTO aetherius_admin_permissions(role,permission) VALUES (?,?)', ['moderator', permission]);
        await conn.query('INSERT INTO aetherius_admin_migrations(id) VALUES (?)', ['002-alduinak']);
      }
      const [inventoryMigration] = await conn.query('SELECT id FROM aetherius_admin_migrations WHERE id=?', ['003-inventory-inspection']);
      if (!inventoryMigration.length) {
        for (const role of ['admin','owner']) await conn.query('INSERT IGNORE INTO aetherius_admin_permissions(role,permission) VALUES (?,?)', [role,'inventory.inspect']);
        await conn.query('INSERT INTO aetherius_admin_migrations(id) VALUES (?)', ['003-inventory-inspection']);
      }
      await conn.commit();
    } catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
  }
  async function list(kind) {
    return (await db.query('SELECT entry_key,revision,payload_json FROM aetherius_admin_world WHERE kind=? ORDER BY entry_key', [kind]))
      .map(row => ({ ...JSON.parse(row.payload_json), id: row.entry_key, revision: Number(row.revision) }));
  }
  async function get(kind, key, conn) {
    const sql = 'SELECT revision,payload_json FROM aetherius_admin_world WHERE kind=? AND entry_key=?';
    const rows = conn ? (await conn.query(sql + ' FOR UPDATE', [kind, key]))[0] : await db.query(sql, [kind, key]);
    return rows.length ? { ...JSON.parse(rows[0].payload_json), id: key, revision: Number(rows[0].revision) } : null;
  }
  async function write(conn, kind, key, revision, payload) {
    const old = await get(kind, key, conn);
    if ((old?.revision || 0) !== revision) fail('CONFLICT', 'A configuração mudou. Consulte a revisão atual antes de salvar.');
    if (!old && payload === null) fail('INVALID', 'Configuração não encontrada.');
    if (payload === null) await conn.query('DELETE FROM aetherius_admin_world WHERE kind=? AND entry_key=? AND revision=?', [kind, key, revision]);
    else if (old) await conn.query('UPDATE aetherius_admin_world SET revision=?,payload_json=? WHERE kind=? AND entry_key=? AND revision=?', [revision + 1, JSON.stringify(payload), kind, key, revision]);
    else {
      const [count] = await conn.query('SELECT COUNT(*) AS total FROM aetherius_admin_world WHERE kind=?', [kind]);
      if (Number(count[0].total) >= 256) fail('LIMIT', 'Limite de 256 configurações desta categoria.');
      await conn.query('INSERT INTO aetherius_admin_world(kind,entry_key,revision,payload_json) VALUES (?,?,1,?)', [kind, key, JSON.stringify(payload)]);
    }
    return revision + 1;
  }
  return { init, list, get, write };
}
module.exports = { createExtensionStore, schema };
