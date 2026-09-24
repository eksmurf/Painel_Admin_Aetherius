'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { revokePersistedConsole } = require('../gamemode/console-guard.cjs');

function fixture(t) {
  const tempRoot = path.resolve(os.tmpdir());
  const cwd = fs.mkdtempSync(path.join(tempRoot, 'aetherius-console-guard-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(cwd)), tempRoot);
    assert.ok(path.basename(cwd).startsWith('aetherius-console-guard-'));
    fs.rmSync(cwd, { recursive: true, force: true });
  });
  fs.mkdirSync(path.join(cwd, 'world/changeForms'), { recursive: true });
  const calls = [];
  return {
    cwd, calls, settings: { databaseDriver: 'file', databaseName: 'world' },
    mp: {
      getAllForms() { throw new Error('Native enumeration must not be used'); },
      getIdFromDesc: () => 0xff000001,
      set: (...args) => calls.push(args), get: () => false,
    },
    save(name, value) {
      const filename = path.join(cwd, 'world/changeForms', name);
      fs.writeFileSync(filename, JSON.stringify(value));
      return filename;
    },
  };
}

test('empty native persistence needs no native enumeration', t => {
  const f = fixture(t);
  assert.equal(revokePersistedConsole(f.mp, f.settings, f.cwd), 0);
  assert.deepEqual(f.calls, []);
});

test('new world without changeForms has no persisted grant', t => {
  const f = fixture(t);
  assert.equal(revokePersistedConsole(f.mp, { databaseDriver: 'file', databaseName: 'new-world' }, f.cwd), 0);
});

test('revokes through mp and leaves the persisted file untouched', t => {
  const f = fixture(t);
  const filename = f.save('actor.json', { formDesc: '1', consoleCommandsAllowed: true });
  const before = fs.readFileSync(filename);
  assert.equal(revokePersistedConsole(f.mp, f.settings, f.cwd), 1);
  assert.deepEqual(f.calls, [[0xff000001, 'consoleCommandsAllowed', false]]);
  assert.deepEqual(fs.readFileSync(filename), before);
});

test('actors without grants are not modified', t => {
  const f = fixture(t);
  f.save('actor.json', { consoleCommandsAllowed: false });
  assert.equal(revokePersistedConsole(f.mp, f.settings, f.cwd), 0);
  assert.deepEqual(f.calls, []);
});

test('unconfirmed revocation blocks activation', t => {
  const f = fixture(t);
  f.save('actor.json', { formDesc: '1', consoleCommandsAllowed: true });
  f.mp.get = () => true;
  assert.throws(() => revokePersistedConsole(f.mp, f.settings, f.cwd), /Cannot revoke/);
});

test('unknown storage blocks activation', t => {
  const f = fixture(t);
  assert.throws(() => revokePersistedConsole(f.mp, { databaseDriver: 'other' }, f.cwd), /file persistence/);
});

test('grant without descriptor blocks activation before mutation', t => {
  const f = fixture(t);
  f.save('actor.json', { consoleCommandsAllowed: true });
  assert.throws(() => revokePersistedConsole(f.mp, f.settings, f.cwd), /Invalid persisted/);
  assert.deepEqual(f.calls, []);
});

test('unresolved actor blocks activation before mutation', t => {
  const f = fixture(t);
  f.save('actor.json', { formDesc: '1', consoleCommandsAllowed: true });
  f.mp.getIdFromDesc = () => 0;
  assert.throws(() => revokePersistedConsole(f.mp, f.settings, f.cwd), /Cannot resolve/);
  assert.deepEqual(f.calls, []);
});
