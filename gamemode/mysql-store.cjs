'use strict';
const { randomUUID } = require('node:crypto');
const { fail } = require('./protocol.cjs');
function createMysqlStore({ db, transactionService }) {
  async function authorize(session, connection) {
    const sql = `SELECT s.role, p.permission FROM staff_roles s
      JOIN accounts a ON a.id = s.account_id AND a.status = 'active'
      JOIN characters c ON c.account_id = a.id AND c.id = ? AND c.status = 'approved'
      JOIN aetherius_admin_permissions p ON p.role = s.role
      WHERE s.account_id = ?` + (connection ? ' FOR UPDATE' : '');
    const params = [session.characterId, session.accountId];
    const rows = connection ? (await connection.query(sql, params))[0] : await db.query(sql, params);
    if (!rows.length || !['moderator', 'admin', 'owner'].includes(rows[0].role)) return null;
    return { role: rows[0].role, permissions: rows.map(row => row.permission) };
  }
  async function targetRole(accountId) {
    return (await db.query('SELECT role FROM staff_roles WHERE account_id = ?', [accountId]))[0]?.role || null;
  }
  async function reserve(op) {
    try {
      await db.query(`INSERT INTO aetherius_admin_operations
        (request_id,account_id,character_id,target_account_id,target_character_id,action,reason,is_sensitive,payload_hash)
        VALUES (?,?,?,?,?,?,?,?,?)`, [op.requestId, op.accountId, op.characterId, op.targetAccountId, op.targetCharacterId, op.action, op.reason, op.sensitive ? 1 : 0, op.hash]);
      return { fresh: true };
    } catch (error) {
      if (error.code !== 'ER_DUP_ENTRY') throw error;
      const rows = await db.query('SELECT payload_hash,result_json,status FROM aetherius_admin_operations WHERE account_id=? AND request_id=?', [op.accountId, op.requestId]);
      const row = rows[0];
      if (!row) throw error;
      return { fresh: false, hash: row.payload_hash, result: row.result_json ? JSON.parse(row.result_json) : null };
    }
  }
  async function finish(op, result, connection) {
    const sql = 'UPDATE aetherius_admin_operations SET status=?,result_json=? WHERE account_id=? AND request_id=?';
    const params = [result.status, JSON.stringify(result), op.accountId, op.requestId];
    if (connection) await connection.query(sql, params); else await db.query(sql, params);
  }
  async function mutate(op, params, target, { item, host, validateSession, permission }) {
    const conn = await db.getConnection();
    let committed = false;
    try {
      await conn.beginTransaction();
      const authorization = await authorize({ accountId: op.accountId, characterId: op.characterId }, conn);
      if (!authorization?.permissions.includes('panel.open') || !authorization.permissions.includes(permission)) fail('FORBIDDEN', 'Permissão revogada antes da execução.');
      const [targetRoles] = await conn.query('SELECT role FROM staff_roles WHERE account_id=? FOR UPDATE', [target.accountId]);
      const rank = { moderator: 1, admin: 2, owner: 3 };
      if (target.accountId !== op.accountId && authorization.role !== 'owner' && (rank[targetRoles[0]?.role] || 0) >= rank[authorization.role]) fail('FORBIDDEN', 'A permissão sobre o alvo mudou.');
      const [rows] = await conn.query('SELECT gold,status FROM characters WHERE id=? AND account_id=? FOR UPDATE', [target.characterId, target.accountId]);
      if (!rows.length || rows[0].status !== 'approved') fail('TARGET_UNAVAILABLE', 'Personagem indisponível.');
      validateSession();
      const options = { characterId: target.characterId, reason: op.reason, module: 'aetherius-admin', idempotencyKey: `aap:${op.accountId}:${op.requestId}` };
      let result;
      if (op.action === 'economy.setGold') {
        const before = Number(rows[0].gold);
        const delta = params.amount - before;
        await transactionService.tx.applyGoldDelta(conn, target.characterId, delta);
        await transactionService.tx.recordGoldLedger(conn, { ...options, delta });
        result = { status: 'succeeded', message: 'Saldo RP atualizado.', data: { before, after: params.amount } };
      } else if (op.action === 'inventory.grant') {
        const baseId = host.resolveItem(item);
        await transactionService.tx.applyInventoryDelta(conn, target.characterId, baseId, params.quantity);
        await transactionService.tx.recordInventoryLedger(conn, { ...options, baseId, delta: params.quantity });
        result = { status: 'unknown', message: 'Item registrado no inventário RP. Entrega no jogo aguardando conferência.', data: { item: item.label, quantity: params.quantity, baseId, persisted: true } };
      } else {
        await conn.query("UPDATE characters SET status='retired' WHERE id=?", [target.characterId]);
        result = { status: 'succeeded', message: 'Personagem encerrado. Novas entradas serão recusadas.' };
      }
      validateSession();
      await finish(op, result, conn);
      await conn.commit();
      committed = true;
      if (op.action === 'inventory.grant') {
        try {
          validateSession();
          await host.deliverItem(target, result.data.baseId, params.quantity);
          const confirmed = { ...result, status: 'succeeded', message: 'Item registrado no RP e conferido no inventário do servidor.' };
          await finish(op, confirmed);
          result = confirmed;
        } catch { /* A committed grant is never blindly delivered again. Audit remains unknown. */ }
      }
      return result;
    } catch (error) {
      if (!committed) await conn.rollback();
      throw error;
    } finally { conn.release(); }
  }
  async function audit(filters, includeSensitive) {
    const clauses = ['1=1']; const params = [];
    if (!includeSensitive) clauses.push('is_sensitive=0');
    if (filters.action) { clauses.push('action=?'); params.push(filters.action); }
    if (filters.status) { clauses.push('status=?'); params.push(filters.status); }
    if (filters.query) { clauses.push('(request_id=? OR CAST(target_character_id AS CHAR)=?)'); params.push(filters.query, filters.query); }
    const where = clauses.join(' AND ');
    const count = await db.query(`SELECT COUNT(*) AS total FROM aetherius_admin_operations WHERE ${where}`, params);
    const page = filters.page || 1;
    const rows = await db.query(`SELECT id,request_id,account_id,target_character_id,action,reason,status,created_at
      FROM aetherius_admin_operations WHERE ${where} ORDER BY id DESC LIMIT 20 OFFSET ${(page - 1) * 20}`, params);
    // Never return result_json: it may include revealed names.
    return { rows, total: Number(count[0].total), page, pageSize: 20 };
  }
  async function denied(accountId, type) {
    await db.query(`INSERT INTO aetherius_admin_operations (request_id,account_id,action,reason,is_sensitive,payload_hash,status)
      VALUES (?,?,'access.denied',?,1,?,'rejected')`, [randomUUID(), accountId, `Acesso negado: ${type || 'unknown'}`, '0'.repeat(64)]);
  }
  async function account(accountId) {
    const rows = await db.query('SELECT id,status FROM accounts WHERE id=?', [accountId]);
    if (!rows.length) fail('TARGET_UNAVAILABLE', 'Conta não encontrada.');
    return { accountId, characterId: null, offline: true };
  }
  async function atomic(op, target, permission, validateSession, callback) {
    const conn = await db.getConnection();
    let commitAttempted = false;
    try {
      await conn.beginTransaction();
      const auth = await authorize({ accountId: op.accountId, characterId: op.characterId }, conn);
      if (!auth?.permissions.includes('panel.open') || !auth.permissions.includes(permission)) fail('FORBIDDEN', 'Permissão revogada.');
      const [roles] = await conn.query('SELECT role FROM staff_roles WHERE account_id=? FOR UPDATE', [target.accountId]);
      const rank = { moderator: 1, admin: 2, owner: 3 };
      if (target.accountId !== op.accountId && auth.role !== 'owner' && (rank[roles[0]?.role] || 0) >= rank[auth.role]) fail('FORBIDDEN', 'A permissão sobre o alvo mudou.');
      const [accounts] = await conn.query('SELECT status FROM accounts WHERE id=? FOR UPDATE', [target.accountId]);
      if (!accounts.length || (!target.offline && accounts[0].status !== 'active')) fail('TARGET_UNAVAILABLE', 'Conta indisponível.');
      if (!target.offline) {
        const [characters] = await conn.query('SELECT status FROM characters WHERE id=? AND account_id=? FOR UPDATE', [target.characterId, target.accountId]);
        if (characters[0]?.status !== 'approved') fail('TARGET_UNAVAILABLE', 'Personagem indisponível.');
      }
      validateSession();
      const result = await callback(conn);
      validateSession();
      await finish(op, result, conn);
      commitAttempted = true;
      await conn.commit();
      return result;
    } catch (error) { await conn.rollback(); if (!commitAttempted) error.noEffect = true; throw error; }
    finally { conn.release(); }
  }
  return { authorize, targetRole, reserve, finish, mutate, audit, denied, account, atomic };
}
module.exports = { createMysqlStore };
