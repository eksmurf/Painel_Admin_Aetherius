'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./extension-fixture.cjs');
let sequence=0;
const send=(f,type,data={})=>f.service.handle(100,{version:1,requestId:'ux_request_'+(++sequence),type,data});
test('panel hides deferred actions and catalogs and moves world tools to administration',async t=>{
 const f=await fixture(t),r=await send(f,'open');assert.equal(r.status,'succeeded');
 assert(!r.data.actions.some(a=>a.id==='identity.reveal'||a.id.startsWith('pet.')||a.category==='tools'));
 assert.equal(r.data.actions.find(a=>a.id==='staff.mode').category,'administration');
 assert.deepEqual(r.data.resources,['playerInventory']);
});
test('world probe accepts no reason and writes an automatic audit description',async t=>{
 const f=await fixture(t);
 const result=await send(f,'action',{action:'world.probe',target:null,params:{}});
 assert.equal(result.status,'succeeded');assert(result.data.server);
 const [audit]=await f.db.query("SELECT reason FROM aetherius_admin_operations WHERE action='world.probe'");assert.equal(audit.reason,'Consulta de diagnóstico do mundo');
});
test('global item lookup totals every owner, replaces live snapshots and still supports player lookup',async t=>{
 const f=await fixture(t);f.config.items.push({id:'lockpick',label:'Lockpick',descriptor:'a:Skyrim.esm'});
 await f.db.query('INSERT INTO character_inventory(character_id,base_id,count) VALUES (1,10,100),(2,10,3)');
 f.actors.get(200).inventory={entries:[{baseId:10,count:60},{baseId:10,count:40}]};
 let result=await send(f,'resources',{kind:'playerInventory',searchBy:'items',query:'lockpick'});
 assert.equal(result.status,'succeeded');assert.equal(result.data.view,'itemOwners');assert.equal(result.data.rows[0].totalCount,200);
 assert.deepEqual(result.data.rows[0].owners.map(o=>o.count),[100,100]);
 result=await send(f,'resources',{kind:'playerInventory',searchBy:'players',query:'Visível'});assert.equal(result.data.view,'owners');assert.equal(result.data.total,2);
 result=await send(f,'resources',{kind:'playerInventory',ownerId:2,searchBy:'items'});assert.equal(result.data.rows[0].count,100);
 f.actors.get(200).inventory={entries:[]};result=await send(f,'resources',{kind:'playerInventory',searchBy:'items',query:'lockpick'});assert.equal(result.data.rows[0].totalCount,100);
 assert.equal((await send(f,'resources',{kind:'playerInventory',searchBy:'bad'})).code,'INVALID');
});
test('item totals are grouped before pagination, include offline owners and never merge equal names with different IDs',async t=>{
 const f=await fixture(t);f.connected.delete(1);
 await f.db.query("INSERT INTO accounts(id,status) VALUES (3,'active')");
 for(let i=3;i<=23;i++){
   await f.db.query("INSERT INTO characters(id,account_id,first_name,last_name,status,gold) VALUES (?,3,'Offline','Teste','approved',0)",[i]);
   await f.db.query('INSERT INTO character_inventory(character_id,base_id,count) VALUES (?,10,10)',[i]);
 }
 for(let i=10;i<32;i++){
   f.config.items.push({id:'item'+i,label:'Lockpick',descriptor:i.toString(16)+':Skyrim.esm'});
   await f.db.query('INSERT INTO character_inventory(character_id,base_id,count) VALUES (2,?,5)',[i]);
 }
 const result=await send(f,'resources',{kind:'playerInventory',searchBy:'items',query:'lockpick'});
 assert.equal(result.data.total,22);assert.equal(result.data.rows.length,20);assert.equal(result.data.rows[0].totalCount,215);assert.equal(result.data.rows[0].owners.length,22);
 const next=await send(f,'resources',{kind:'playerInventory',searchBy:'items',query:'lockpick',page:2});assert.equal(next.data.rows.length,2);assert.equal(next.data.rows[0].totalCount,5);
});
test('staff toggles do not require reason but keep server-generated audit and expire truthfully',async t=>{
 const f=await fixture(t);
 const r=await send(f,'action',{action:'staff.mode',target:null,params:{mode:'god',enabled:'true',speed:100}});assert.equal(r.status,'succeeded');assert.equal(r.data.values.god,true);
 assert.equal((await send(f,'modes')).data.values.god,true);
 const [audit]=await f.db.query("SELECT reason FROM aetherius_admin_operations WHERE action='staff.mode'");assert.match(audit.reason,/próprio modo/);
 f.advance(16000);assert.deepEqual((await send(f,'modes')).data.values,{});
});
test('inventory inspection requires its permission and revoked permission stays revoked after migration',async t=>{
 const f=await fixture(t);await f.db.query("DELETE FROM aetherius_admin_permissions WHERE role='owner' AND permission='inventory.inspect'");
 await require('../gamemode/extension-store.cjs').createExtensionStore(f.db).init();
 for(const data of [{kind:'playerInventory'},{kind:'items',scope:'players',query:'Sword'},{kind:'items',scope:'chests'}])assert.equal((await send(f,'resources',data)).code,'FORBIDDEN');
});
test('player item search uses live inventory instead of double-counting the RP snapshot',async t=>{
 const f=await fixture(t);f.config.items.push({id:'sword',label:'Espada de ferro',descriptor:'500:Skyrim.esm',category:'WEAP'});
 await f.db.query('INSERT INTO character_inventory(character_id,base_id,count) VALUES (2,?,3)',[0x500]);
 f.actors.get(200).inventory={entries:[{baseId:0x500,count:8},{baseId:0x500,count:2}]};
 let result=await send(f,'resources',{kind:'items',scope:'players',query:'Espada ferro'});assert.equal(result.status,'succeeded');assert.equal(result.data.total,1);assert.equal(result.data.rows[0].count,10);assert.equal(result.data.rows[0].source,'Ao vivo no servidor');
 f.connected.delete(1);result=await send(f,'resources',{kind:'playerInventory',ownerId:2,query:'500'});assert.equal(result.data.rows[0].count,3);assert.equal(result.data.rows[0].source,'Registro persistido');
 assert.equal((await send(f,'resources',{kind:'items',scope:'players',query:'inexistente'})).data.total,0);
});
test('chest search identifies registered container and persisted quantities without changing inventory',async t=>{
 const f=await fixture(t);f.config.items.push({id:'ore',label:'Minério de ferro',descriptor:'501:Skyrim.esm'});
 await f.db.query("INSERT INTO containers(id,object_id,label,owner_character_id) VALUES (1,'abc:Skyrim.esm','Baú da oficina',2)");
 await f.db.query('INSERT INTO container_inventory(container_id,base_id,count) VALUES (1,?,7)',[0x501]);
 const result=await send(f,'resources',{kind:'items',scope:'chests',query:'Minério'});assert.equal(result.status,'succeeded');assert.equal(result.data.rows[0].count,7);assert.equal(result.data.rows[0].ownerLabel,'Baú da oficina');assert.equal(result.data.rows[0].objectId,'abc:Skyrim.esm');
 assert.equal((await f.db.query('SELECT count FROM container_inventory'))[0].count,7);
});
