'use strict';
const fs = require('node:fs');
const path = require('node:path');
// getAllForms(0xff) is not a dynamic-actor query with the ESL-aware mapping:
// selectors are source indices, and an empty native buffer may be detached.
// Use the authoritative file persistence, then revoke through mp (never edit saves).
function revokePersistedConsole(mp, settings, cwd = process.cwd()) {
  if (settings.databaseDriver !== 'file' || typeof settings.databaseName !== 'string' || !settings.databaseName) throw new Error('Admin console preflight requires configured file persistence.');
  const folder = path.resolve(cwd, settings.databaseName, 'changeForms');
  if (!fs.existsSync(folder)) return 0;
  let revoked = 0;
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const saved = JSON.parse(fs.readFileSync(path.join(folder, entry.name), 'utf8'));
    if (saved.consoleCommandsAllowed !== true) continue;
    if (typeof saved.formDesc !== 'string' || !saved.formDesc) throw new Error('Invalid persisted console grant.');
    const actorId = mp.getIdFromDesc(saved.formDesc);
    if (!Number.isInteger(actorId) || actorId <= 0) throw new Error('Cannot resolve persisted console grant.');
    mp.set(actorId, 'consoleCommandsAllowed', false);
    if (mp.get(actorId, 'consoleCommandsAllowed') !== false) throw new Error('Cannot revoke persisted console grant.');
    revoked++;
  }
  return revoked;
}
module.exports = { revokePersistedConsole };
