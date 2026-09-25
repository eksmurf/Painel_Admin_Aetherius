'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./extension-fixture.cjs');
let n=0;const state=f=>f.service.handle(100,{version:1,requestId:'weather_state_'+(++n),type:'weather',data:{}});
const flush=()=>new Promise(r=>setImmediate(r));
async function cycle(f){await flush();await f.extensions.tick();await flush();}
const apply=(f,revision=0,enabled='true',weather='clear')=>f.call('weather.save',{revision,enabled,weather});
test('one global setting reaches distant players and late joins, including other normal worldspaces',async t=>{
 const f=await fixture(t);f.connected.delete(1);f.actors.get(200).locationalData.pos=[900000,900000,100];
 assert.equal((await state(f)).data.enabled,false);assert.equal((await apply(f)).status,'succeeded');await cycle(f);
 assert(f.sent.some(p=>p.user===0 && p.command==='weather' && p.data.descriptor));assert(!f.sent.some(p=>p.user===1 && p.command==='weather'));
 f.connected.add(1);await cycle(f);assert(f.sent.some(p=>p.user===1 && p.command==='weather' && p.data.descriptor));
 const lookup=f.mp.lookupEspmRecordById;f.mp.lookupEspmRecordById=id=>id===0x800?{record:{type:'WRLD'}}:lookup(id);
 f.actors.get(200).locationalData.cellOrWorldDesc='000800:Dragonborn.esm';f.advance(11000);f.sent.length=0;await cycle(f);
 assert(f.sent.some(p=>p.user===1 && p.command==='weather' && p.data.descriptor));
});
test('natural reset keeps a revision and never resurrects legacy regional weather',async t=>{
 const f=await fixture(t);await f.db.query("INSERT INTO aetherius_admin_world(kind,entry_key,revision,payload_json) VALUES ('weather','legacy',1,?)",[JSON.stringify({enabled:true,descriptor:'81a:Skyrim.esm',location:f.actors.get(100).locationalData,radius:20000,priority:1})]);
 await cycle(f);assert(!f.sent.some(p=>p.command==='weather' && p.data.descriptor));
 await apply(f);await cycle(f);f.sent.length=0;
 f.actors.get(100).locationalData.cellOrWorldDesc='123:Skyrim.esm';
 assert.equal((await apply(f,1,'false','natural')).status,'succeeded');await cycle(f);
 assert(f.sent.some(p=>p.user===1 && p.command==='weather' && p.data.descriptor===null));
 const read=await state(f);assert.equal(read.data.enabled,false);assert.equal(read.data.revision,2);
 const stored=(await f.db.query("SELECT payload_json FROM aetherius_admin_world WHERE entry_key='server'"))[0];assert.equal(JSON.parse(stored.payload_json).scope,'server');
});
test('weather uses optimistic concurrency, catalog validation and existing staff permission',async t=>{
 const f=await fixture(t);const r=await Promise.all([apply(f),apply(f)]);assert.equal(r.filter(x=>x.status==='succeeded').length,1);assert.equal(r.filter(x=>x.code==='CONFLICT').length,1);
 assert.equal((await apply(f,1,'true','unknown')).code,'INVALID');assert.equal((await state(f)).data.revision,1);
 await f.db.query("DELETE FROM aetherius_admin_permissions WHERE role='owner' AND permission='world.weather'");
 assert.equal((await state(f)).code,'FORBIDDEN');assert.equal((await apply(f,1,'false','natural')).code,'FORBIDDEN');
});
test('worlds outside the reviewed climate scope are protected and returning outside reapplies weather',async t=>{
 const f=await fixture(t);await apply(f);await cycle(f);f.sent.length=0;
 f.actors.get(200).locationalData.cellOrWorldDesc='2ee41:Skyrim.esm';await cycle(f);
 assert(f.sent.some(p=>p.user===1 && p.command==='weather' && p.data.descriptor===null));
 f.sent.length=0;f.actors.get(200).locationalData.cellOrWorldDesc='00003C:Skyrim.esm';await cycle(f);
 assert(f.sent.some(p=>p.user===1 && p.command==='weather' && p.data.descriptor));
});
test('saved global weather can be reloaded from persistence by a new runtime',async t=>{
 const f=await fixture(t);await apply(f);await cycle(f);f.sent.length=0;
 const {createWorldRuntime}=require('../gamemode/world-runtime.cjs');const {createExtensionStore}=require('../gamemode/extension-store.cjs');
 const sent=[];const runtime=createWorldRuntime({mp:f.mp,host:f.host,db:f.db,repository:createExtensionStore(f.db),catalogs:{},load:()=>({}),world:{location:id=>f.actors.get(id).locationalData,resolve:()=>0x3c,request:async(p,c,d)=>sent.push({p,c,d})}});
 await runtime.tick();await flush();assert.equal(sent.filter(p=>p.d.descriptor==='81a:Skyrim.esm').length,2);await runtime.shutdown();
});
