'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {DatabaseSync}=require('node:sqlite');
const local=path.resolve(__dirname,'../../Aetherius-RP-Local'),gm=path.join(local,'aetherius/gamemode');
const {createStore}=require(path.join(gm,'core/sqlite-store.cjs'));
const {createHost}=require('../gamemode/skymp-host.cjs');
const {createMysqlStore}=require('../gamemode/mysql-store.cjs');
const {createService}=require('../gamemode/service.cjs');
const {createExtensions}=require('../gamemode/extensions.cjs');
const {actions}=require('../gamemode/catalog.cjs');
const tx=require(path.join(gm,'core/transaction-service.js'));
async function fixture(t){
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'aap-alduinak-')),filename=path.join(folder,'test.sqlite');
  const sqlite=new DatabaseSync(filename);sqlite.exec(fs.readFileSync(path.join(local,'aetherius/storage/schema.sqlite.sql'),'utf8'));sqlite.close();
  const db=createStore(filename);
  await db.query("INSERT INTO accounts(id,status) VALUES (1,'active'),(2,'active')");
  await db.query("INSERT INTO characters(id,account_id,first_name,last_name,status,gold) VALUES (1,1,'Staff','Teste','approved',0),(2,2,'Alvo','Teste','approved',0)");
  await db.query("INSERT INTO staff_roles(account_id,role) VALUES (1,'owner')");
  for(const permission of ['panel.open','players.view','players.teleport','players.kick','logs.view','inventory.grant'])await db.query('INSERT INTO aetherius_admin_permissions(role,permission) VALUES (?,?)',['owner',permission]);
  const data=new Map([[100,{accountId:1,characterId:1}],[200,{accountId:2,characterId:2}]]),connected=new Set([0,1]);
  const loc=()=>({cellOrWorldDesc:'3c:Skyrim.esm',pos:[0,0,100],rot:[0,0,0]});
  const actors=new Map([[100,{locationalData:loc(),percentages:{health:1,magicka:1,stamina:1}}],[200,{locationalData:loc(),percentages:{health:1,magicka:1,stamina:1}}]]);
  const events={},sent=[],kicks=[],destroyed=[];let id=0xff000010,time=100000,extensions;
  const mp={on:(key,fn)=>{events[key]=fn;},makeProperty:()=>{},getUserByActor:id=>id===100?0:id===200?1:-1,isConnected:user=>connected.has(user),getUserActor:user=>user===0?100:200,getUserGuid:user=>'guid'+user,
    getDescFromId:id=>id.toString(16)+':Skyrim.esm',getIdFromDesc:desc=>parseInt(desc,16),lookupEspmRecordById:id=>({record:{type:id===0x3c?'WRLD':id===0x23a92?'NPC_':id===0x81a?'WTHR':'MISC'}}),
    get:(id,key)=>{if(!actors.has(id))throw Error('Missing actor');return actors.get(id)[key]??(key==='isDead'?false:undefined);},
    set:(id,key,value)=>{if(!actors.has(id))throw Error('Missing actor');actors.get(id)[key]=value;},
    kick:user=>{kicks.push(user);connected.delete(user);},destroyActor:id=>{destroyed.push(id);actors.delete(id);},
    callPapyrusFunction:()=>{actors.set(++id,{locationalData:loc()});return {desc:id.toString(16)+':Skyrim.esm'};},
    sendCustomPacket:(user,payload)=>{const message=JSON.parse(payload);sent.push({user,...message});if(message.customPacketType==='aetheriusAdminCommand')queueMicrotask(()=>extensions.receive(user===0?100:200,{token:message.token,ok:true,result:{}}));}
  };
  const commands={getActiveCharacterData:id=>data.get(id)};
  const host=createHost({mp,commands,identity:{getDisplayName:()=> 'Visível',getCharacterFullName:()=> 'Privado'},espm:{lookup:()=>({existe:true}),pareceItem:()=>({ok:true})},maxPlayers:2});
  const store=createMysqlStore({db,transactionService:tx});
  const config={items:[],npcs:[{id:'dog',label:'Cão',descriptor:'23a92:Skyrim.esm',petKind:'dog'}],weathers:[{id:'clear',label:'Céu limpo',descriptor:'81a:Skyrim.esm'}]};
  const modules={'core/profession-registry':require(path.join(gm,'core/profession-registry.js')),'core/character-state':{get:()=> 'NORMAL'},'core/transaction-service':tx};
  extensions=createExtensions({mp,host,store,db,config,load:key=>modules[key],now:()=>time});await extensions.ready;
  const service=createService({host,store,extensions,enabledActions:actions.filter(a=>!a.unavailable).map(a=>a.id),now:()=>time});
  let sequence=0;
  const call=(action,params={},target)=>service.handle(100,{version:1,requestId:'test_'+String(++sequence).padStart(8,'0'),type:'action',data:{action,params,reason:'Validação automatizada',target:target===undefined?(actions.find(a=>a.id===action).targetKind==='self'?null:{actorId:200,session:host.session(200)?.session}):target}});
  t.after(async()=>{await extensions.shutdown();await db.close();for(const entry of fs.readdirSync(folder))fs.unlinkSync(path.join(folder,entry));fs.rmdirSync(folder);});
  return {db,mp,host,store,service,extensions,actors,data,connected,sent,kicks,destroyed,events,call,config,advance:ms=>{time+=ms;}};
}

module.exports={fixture};
