'use strict';
const {test}=require('node:test'), assert=require('node:assert/strict'), vm=require('node:vm'), fs=require('node:fs'), path=require('node:path');
const ts=require('../../Aetherius-RP-Local/skymp5-client/node_modules/typescript');
const compiled=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../client/AdminToolsService.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
function fixture(){
  let time=1000, sequence=0;const handlers={},updates=[],pending=[],sent=[],calls=[];
  const location={world:0x3c,pos:[0,0,100]};
  const controller={emitter:{on:(k,f)=>(handlers[k]||=[]).push(f),emit:(k,v)=>sent.push(v)},on:(k,f)=>updates.push(f),once:(k,f)=>pending.push(f)};
  const player={getFormID:()=>20,setGhost:v=>calls.push(['ghost',v]),setAlpha:v=>calls.push(['alpha',v]),getBaseActorValue:()=>110,setActorValue:(k,v)=>calls.push([k,v]),getWorldSpace:()=>location.world===0x3c?{getFormID:()=>location.world}:null,getParentCell:()=>({getFormID:()=>location.world}),getPositionX:()=>location.pos[0],getPositionY:()=>location.pos[1],getPositionZ:()=>location.pos[2]};
  const sp={Game:{getPlayer:()=>player,getCurrentCrosshairRef:()=>null,getFormFromFile:id=>({getFormID:()=>id})},Cell:{from:form=>form.getFormID()===0x123?form:null},WorldSpace:{from:form=>form.getFormID()===0x3c?form:null},Debug:{setGodMode:v=>calls.push(['god',v]),toggleCollisions:()=>calls.push(['collision']),sendAnimationEvent:(p,v)=>calls.push(['animation',v])},Weather:{from:()=>({forceActive:()=>calls.push(['weather'])}),releaseOverride:()=>calls.push(['release'])},setFreeCameraMode:v=>{calls.push(['freecam',v]);return v;}};
  const context={exports:{},Date:{now:()=>time},require:name=>name.includes('messages')?{MsgType:{CustomPacket:1}}:name.includes('worldViewMisc')?{localIdToRemoteId:id=>id}:{ClientListener:class{}}};
  vm.runInNewContext(compiled,context);new context.exports.AdminToolsService(sp,controller);
  const update=()=>{while(pending.length)pending.shift()();updates.forEach(f=>f());};
  const emit=(k,v)=>(handlers[k]||[]).forEach(f=>f(v));
  const last=()=>sent.length?JSON.parse(sent.at(-1).message.contentJsonDump).data:null;
  const send=(command,data={},token=String(++sequence))=>{emit('customPacketMessage',{message:{contentJsonDump:JSON.stringify({customPacketType:'aetheriusAdminCommand',command,data,token})}});update();return last();};
  return {send,calls,emit,update,last,location,advance:n=>{time+=n;update();}};
}
test('client rejects unknown commands and animations and deduplicates server nonce',()=>{
  const f=fixture();assert.equal(f.send('console',{text:'anything'}).ok,false);assert.equal(f.send('animation',{animation:'forged'}).ok,false);
  assert.equal(f.send('animation',{animation:'IdleWave'},'repeat').ok,true);f.send('animation',{animation:'IdleWave'},'repeat');assert.equal(f.calls.filter(c=>c[0]==='animation').length,1);
});
test('client mode lease restores speed, collision and freecam after server loss',()=>{
  const f=fixture();assert.equal(f.send('modes',{values:{god:true,speed:250,noclip:true,freecam:true},leaseMs:15000}).ok,true);
  f.advance(15001);assert(f.calls.some(c=>c[0]==='SpeedMult'&&c[1]===110));assert.equal(f.calls.filter(c=>c[0]==='collision').length,2);assert.deepEqual(f.calls.filter(c=>c[0]==='freecam').at(-1),['freecam',false]);assert.deepEqual(f.calls.filter(c=>c[0]==='god').at(-1),['god',false]);
});

test('freecam starts on the operator and rejects the obsolete remote-location contract',()=>{
  const f=fixture(),data={values:{freecam:true},leaseMs:15000};
  assert.equal(f.send('modes',{...data,cameraLocation:{cellOrWorldDesc:'123:Skyrim.esm',pos:[5000,7000,300]}}).ok,false);
  assert.equal(f.calls.length,0);assert.equal(f.send('modes',data,'camera').ok,true);
  f.send('modes',data,'camera');assert.equal(f.calls.filter(c=>c[0]==='freecam').length,1);
  assert.equal(f.send('modes',{values:{freecam:true},leaseMs:15000}).ok,true);
});

test('freecam is released by reset or disconnect',()=>{
  for(const disconnect of [false,true]){const f=fixture();f.send('modes',{values:{freecam:true},leaseMs:15000});if(disconnect){f.emit('connectionDisconnect');f.update();}else f.send('modes',{values:{},leaseMs:0});assert.deepEqual(f.calls.filter(c=>c[0]==='freecam').at(-1),['freecam',false]);}
});
test('death of another actor does not reset staff; own death does',()=>{
  const f=fixture();f.send('modes',{values:{god:true},leaseMs:15000});const n=f.calls.length;
  f.emit('applyDeathStateEvent',{isDead:true,actor:{getFormID:()=>123}});f.update();assert.equal(f.calls.length,n);
  f.emit('applyDeathStateEvent',{isDead:true,actor:{getFormID:()=>20}});f.update();assert.deepEqual(f.calls.filter(c=>c[0]==='god').at(-1),['god',false]);
});
test('weather override expires and invalid descriptors never reach a native',()=>{
  const f=fixture();assert.equal(f.send('weather',{descriptor:'bad',leaseMs:20000}).ok,false);assert.equal(f.calls.length,0);
  assert.equal(f.send('weather',{descriptor:'81a:Skyrim.esm',leaseMs:20000}).ok,true);f.advance(20001);assert.deepEqual(f.calls,[['weather'],['release']]);
});
