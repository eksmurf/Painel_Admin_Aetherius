'use strict';
const {fail}=require('./protocol.cjs');
function createInventoryInspection({mp,host,db,items}) {
  let catalog;
  function index() {
    if (!catalog) { catalog=new Map(); for(const item of items) {try {catalog.set(mp.getIdFromDesc(item.descriptor),item);}catch{}} }
    return catalog;
  }
  function itemInfo(baseId) {
    const item=index().get(baseId);
    return {itemId:item?.id,baseId,descriptor:item?.descriptor || `0x${baseId.toString(16).toUpperCase()}`,itemLabel:item?.label || `Item 0x${baseId.toString(16).toUpperCase()}`,category:item?.category || '',editorId:item?.editorId || ''};
  }
  function live(actorId) {
    try {
      const entries=mp.get(actorId,'inventory')?.entries;
      if(!Array.isArray(entries))return null;
      const counts=new Map();
      for(const entry of entries) if(Number.isSafeInteger(entry.baseId) && entry.baseId>0 && Number.isSafeInteger(entry.count) && entry.count>0) counts.set(entry.baseId,(counts.get(entry.baseId)||0)+entry.count);
      return [...counts].map(([base_id,count])=>({base_id,count}));
    }catch{return null;}
  }
  function matches(row,query){return query.trim().toLowerCase().split(/\s+/).filter(Boolean).every(word=>[row.itemLabel,row.itemId,row.editorId,row.descriptor,String(row.baseId)].join(' ').toLowerCase().includes(word));}
  function page(rows,p,extra={}){return {rows:rows.slice((p-1)*20,p*20),page:p,pageSize:20,total:rows.length,categories:[],...extra};}
  async function search({kind,scope='players',ownerId,query='',page:p=1,searchBy='players'},operator) {
    const online=host.players(), byCharacter=new Map(online.map(player=>[player.characterId,player]));
    const characters=await db.query('SELECT id,status FROM characters ORDER BY id LIMIT 5001');
    if(characters.length>5000)fail('LIMIT','Muitos personagens para esta consulta. Contate a equipe técnica.');
    const ownerLabel=id=>byCharacter.has(id)?host.visibleName(operator,byCharacter.get(id)):`Personagem #${id}`;
    if(kind==='playerInventory' && ownerId===undefined && searchBy==='players') {
      const rows=characters.map(c=>({id:String(c.id),ownerId:c.id,label:ownerLabel(c.id),online:byCharacter.has(c.id),characterStatus:c.status})).filter(row=>[row.id,row.label].join(' ').toLowerCase().includes(query.toLowerCase().trim()));
      return page(rows,p,{view:'owners',note:'Selecione um jogador para consultar seus itens. Jogadores offline aparecem pelo identificador do personagem.'});
    }
    if(ownerId!==undefined && !characters.some(c=>c.id===ownerId))fail('INVALID','Personagem não encontrado.');
    const chests=kind==='items' && scope==='chests';
    const sourceRows=await db.query(chests?'SELECT ci.container_id,ci.base_id,ci.count FROM container_inventory ci ORDER BY ci.container_id,ci.base_id LIMIT 5001':`SELECT character_id,base_id,count FROM character_inventory${ownerId===undefined?'':' WHERE character_id=?'} ORDER BY character_id,base_id LIMIT 5001`,ownerId===undefined || chests?[]:[ownerId]);
    if(sourceRows.length>5000)fail('LIMIT','Consulta extensa. Abra o inventário de um jogador específico.');
    const groups=new Map();
    for(const row of sourceRows){const id=chests?row.container_id:row.character_id;if(!groups.has(id))groups.set(id,[]);groups.get(id).push(row);}
    const owners=chests?await db.query('SELECT id,object_id,label,owner_character_id FROM containers ORDER BY id LIMIT 5001'):characters.filter(c=>ownerId===undefined || c.id===ownerId);
    if(owners.length>5000)fail('LIMIT','Muitos baús cadastrados para esta consulta.');
    const rows=[];
    for(const owner of owners){
      let actual=null;
      if(chests){try{actual=live(mp.getIdFromDesc(owner.object_id));}catch{}}
      else if(byCharacter.has(owner.id)){
        const player=byCharacter.get(owner.id);
        if(host.session(player.actorId)?.session===player.session)actual=live(player.actorId);
      }
      // The native inventory replaces the persisted snapshot; never add both counts.
      const entries=actual || groups.get(owner.id) || [];
      const counts=new Map();for(const entry of entries)if(Number(entry.count)>0)counts.set(Number(entry.base_id),(counts.get(Number(entry.base_id))||0)+Number(entry.count));
      for(const [baseId,count] of counts){
        const item=itemInfo(baseId);if(!matches(item,query))continue;
        rows.push({id:`${chests?'chest':'player'}:${owner.id}:${baseId}`,label:item.itemLabel,...item,count,ownerId:owner.id,ownerLabel:chests?(owner.label || `Baú #${owner.id}`):ownerLabel(owner.id),objectId:chests?owner.object_id:undefined,source:actual?'Ao vivo no servidor':'Registro persistido',online:!chests && byCharacter.has(owner.id)});
      }
    }
    const note='Jogadores conectados: inventário ao vivo quando disponível. Offline: último registro persistido. Os totais abrangem inventários de jogadores; baús não entram na soma.';
    if(kind==='playerInventory' && ownerId===undefined && searchBy==='items') {
      const grouped=new Map();
      for(const row of rows){
        if(!grouped.has(row.baseId))grouped.set(row.baseId,{id:String(row.baseId),baseId:row.baseId,label:row.itemLabel,descriptor:row.descriptor,totalCount:0,owners:[]});
        const item=grouped.get(row.baseId);item.totalCount+=row.count;item.owners.push({ownerId:row.ownerId,ownerLabel:row.ownerLabel,count:row.count,source:row.source,online:row.online});
      }
      // Aggregate the complete result before paging, never just the visible owners.
      const result=[...grouped.values()].sort((a,b)=>a.label.localeCompare(b.label,'pt-BR') || a.baseId-b.baseId);
      return page(result,p,{view:'itemOwners',note});
    }
    return page(rows,p,{view:'inventory',ownerLabel:ownerId===undefined?null:ownerLabel(ownerId),note:chests?'Baús cadastrados no sistema de propriedades. Conteúdo ao vivo quando disponível; caso contrário, registro persistido.':note});
  }
  return {search};
}
module.exports={createInventoryInspection};
