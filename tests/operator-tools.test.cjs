'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./extension-fixture.cjs');
const params=(enabled=true)=>({mode:'freecam',enabled:String(enabled),speed:100});
const target=f=>({actorId:200,session:f.host.session(200).session});
test('every staff mode rejects a supplied player target and only commands the operator',async t=>{
  const f=await fixture(t),before=structuredClone([...f.actors]);
  for(const mode of ['freecam','god','ghost','invisible','speed','noclip']){
    assert.equal((await f.call('staff.mode',{...params(),mode},target(f))).code,'INVALID');
    assert.equal((await f.call('staff.mode',{...params(),mode})).status,'succeeded');
  }
  assert(f.sent.every(p=>p.user===0));assert(f.sent.every(p=>!p.data.cameraLocation));
  for(const [id,actor] of before)assert.deepEqual(f.actors.get(id).locationalData,actor.locationalData);
  assert.equal((await f.db.query("SELECT COUNT(*) AS n FROM aetherius_admin_operations WHERE action='staff.mode' AND target_account_id<>1"))[0].n,0);
});
test('camera expires or loses permission without teleporting either player',async t=>{
  for(const revoke of [false,true]){
    const f=await fixture(t),origin=structuredClone(f.actors.get(100).locationalData);
    f.actors.get(200).locationalData.pos=[5000,6000,100];
    assert.equal((await f.call('staff.mode',params())).status,'succeeded');
    if(revoke)await f.db.query("DELETE FROM aetherius_admin_permissions WHERE permission='staff.modes'");else f.advance(15001);
    await f.extensions.tick();
    assert.equal(f.extensions.modeState(f.host.session(100)).values.freecam,undefined);
    assert.deepEqual(f.actors.get(100).locationalData,origin);assert.deepEqual(f.actors.get(200).locationalData.pos,[5000,6000,100]);
  }
});
test('a delayed renewal cannot reopen the camera after the operator disables it',async t=>{
  const f=await fixture(t);assert.equal((await f.call('staff.mode',params())).status,'succeeded');
  const authorize=f.store.authorize;let release,entered,first=true;
  const gate=new Promise(r=>{release=r;}),started=new Promise(r=>{entered=r;});
  f.store.authorize=async(...args)=>{if(first){first=false;entered();await gate;}return authorize(...args);};
  const renewal=f.extensions.tick();await started;
  try{assert.equal((await f.call('staff.mode',params(false))).status,'succeeded');}finally{release();}
  await renewal;assert.equal(f.sent.filter(p=>p.command==='modes').at(-1).data.values.freecam,undefined);
});
test('manual NPC spawn uses only the caller position and replay never duplicates a mob',async t=>{
  const f=await fixture(t);f.actors.get(100).locationalData.pos=[100,200,300];f.actors.get(200).locationalData.pos=[90000,60000,100];
  assert.equal((await f.call('npc.spawn',{npc:'dog'},target(f))).code,'INVALID');
  const message={version:1,requestId:'npc_once_00000001',type:'action',data:{action:'npc.spawn',target:null,params:{npc:'dog'}}};
  const first=await f.service.handle(100,message);assert.equal(first.status,'succeeded');
  assert.equal((await f.service.handle(100,message)).status,'succeeded');
  assert.deepEqual(f.actors.get(first.data.actorId).locationalData,f.actors.get(100).locationalData);
  assert.equal(await f.extensions.runtime.count(),1);
  assert.equal((await f.db.query("SELECT COUNT(*) AS n FROM aetherius_admin_world WHERE kind='zone'"))[0].n,0);
  const audit=(await f.db.query("SELECT target_account_id,reason FROM aetherius_admin_operations WHERE action='npc.spawn'"))[0];assert.equal(audit.target_account_id,1);assert.match(audit.reason,/operador/);
  f.actors.get(first.data.actorId).isDead=true;await f.extensions.tick();f.advance(300001);await f.extensions.tick();assert.equal(await f.extensions.runtime.count(),0);
});
test('old zone definitions are inert and invalid NPCs or old zone writes create nothing',async t=>{
  const f=await fixture(t);await f.db.query("INSERT INTO aetherius_admin_world(kind,entry_key,revision,payload_json) VALUES ('zone','old',1,?)",[JSON.stringify({enabled:true,descriptor:'23a92:Skyrim.esm',location:f.actors.get(100).locationalData,count:5,radius:4096,respawnSeconds:30})]);
  await f.extensions.tick();assert.equal(await f.extensions.runtime.count(),0);
  assert.equal((await f.call('npc.spawn',{npc:'forged'})).status,'rejected');
  assert.equal((await f.call('zone.save',{key:'new',label:'Zona',revision:0,npc:'dog',count:1,radius:4096,respawnSeconds:60,enabled:'true'})).code,'UNAVAILABLE');
  await f.db.query("DELETE FROM aetherius_admin_permissions WHERE permission='world.npcs'");
  assert.equal((await f.call('npc.spawn',{npc:'dog'})).code,'FORBIDDEN');assert.equal(await f.extensions.runtime.count(),0);
});
test('a session change during spawn removes the created NPC',async t=>{
  const f=await fixture(t),spawn=f.mp.callPapyrusFunction;
  f.mp.callPapyrusFunction=(...args)=>{const result=spawn(...args);f.data.set(100,{accountId:1,characterId:1});return result;};
  assert.notEqual((await f.call('npc.spawn',{npc:'dog'})).status,'succeeded');assert.equal(await f.extensions.runtime.count(),0);assert.equal(f.destroyed.length,1);
});
