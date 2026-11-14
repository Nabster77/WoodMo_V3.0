const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const ts = require('typescript');
function loader(stubs = {}) {
 const cache = {};
 function load(name) {
  if (name in stubs) return stubs[name];
  if (cache[name]) return cache[name];
  const exports = cache[name] = {};
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/lib',name+'.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
  new Function('require','exports',code)(id=>load(id.replace('@/lib/','').replace('./','')),exports); return exports;
 } return load;
}
async function main() {
 const sync = loader()('catalogSync');
 const storage = new Map();
 let cloud = [], local, pushes=0, imports=0;
 const stubs = {
  supabaseClient:{supabase:{}},
  storage:{STORAGE_KEYS:{catalogSync:'sync',catalogBackupPrefix:'backup-'},loadJSON:(k,f)=>storage.get(k)??f,saveJSON:(k,v)=>storage.set(k,structuredClone(v))},
  catalogCloud:{fetchCatalogRows:async()=>structuredClone(cloud),pushCatalogRows:async()=>{pushes++;},commitCatalogImport:async(expected,rows)=>{
   imports++; if(JSON.stringify(expected)!==JSON.stringify(cloud)) throw new Error('Cloud-Konflikt');
   const map=new Map(cloud.map(r=>[sync.keyOf(r.kind,r.id),r])); rows.forEach(r=>map.set(sync.keyOf(r.kind,r.id),{...r,updated_at:200})); cloud=[...map.values()]; return structuredClone(cloud);
  }}
 };
 const load=loader(stubs);
 const base={categories:load('shotCatalog').normalizeCategories([]),products:[],shotOptions:[{id:'rum',name:'Rum',price:1}],pfandSettings:{Friedrichshafen:3,Bregenz:3}};
 const rows=(catalog)=>[...sync.buildLocalEntries(catalog,100).values()].map(e=>({kind:e.kind,id:e.id,data:JSON.parse(e.json),updated_at:e.updatedAt,deleted:false}));
 local=structuredClone(base); cloud=rows(base);
 const engine=load('catalogEngine').createCatalogEngine({getLocal:()=>local,isEnabled:()=>true,setConflict:()=>{},applyRows:accepted=>{
  local={...local,shotOptions:accepted.find(r=>r.id==='schuss-options').data};
 }});
 assert.equal((await engine.sync()).ok,true);
 const session=await engine.prepareImport();
 const next=structuredClone(base); next.shotOptions[0].price=2;
 await engine.commitImport(session,next); assert.equal(imports,1); assert.equal(local.shotOptions[0].price,2);
 engine.localChanged(); await engine.sync(); assert.equal(pushes,0,'accepted rows must not become a second ordinary upsert');
 const staleLocal=await engine.prepareImport(); local.shotOptions[0].price=3;
 await assert.rejects(engine.commitImport(staleLocal,next),/Lokaler/); assert.equal(imports,1);
 local=structuredClone(next);
 const staleCloud=await engine.prepareImport(); cloud[0].updated_at++;
 const cloudChange=structuredClone(next); cloudChange.shotOptions[0].price=4;
 await assert.rejects(engine.commitImport(staleCloud,cloudChange),/Cloud-Konflikt/); assert.equal(local.shotOptions[0].price,2);
 // Articles missing from the imported catalog become tombstones (deleted=true); SCHUSS and shot settings are never deleted.
 {
  const store2=new Map(); let cloud2=[]; const pushed=[]; let applied=null; let local2;
  const product={id:'p-old',name:'Alt',categoryId:'cat-drinks',imageUrl:'',taxClass:'standard',prices:{Friedrichshafen:1,Bregenz:1},available:true,sortOrder:0,hasShot:false,pfand:{Friedrichshafen:0,Bregenz:0}};
  const cat={id:'cat-drinks',name:'Getränke',color:'#fff',sortOrder:0,icon:'CupSoda'};
  const base2={categories:load('shotCatalog').normalizeCategories([cat]),products:[product],shotOptions:[{id:'rum',name:'Rum',price:1}],pfandSettings:{Friedrichshafen:3,Bregenz:3}};
  cloud2=rows(base2); local2=structuredClone(base2);
  const stubs2={...stubs,storage:{...stubs.storage,loadJSON:(k,f)=>store2.get(k)??f,saveJSON:(k,v)=>store2.set(k,structuredClone(v))},catalogCloud:{fetchCatalogRows:async()=>structuredClone(cloud2),pushCatalogRows:async r=>{pushed.push(...r);},commitCatalogImport:async(expected,r)=>{const map=new Map(cloud2.map(x=>[sync.keyOf(x.kind,x.id),x]));r.forEach(x=>map.set(sync.keyOf(x.kind,x.id),{...x,updated_at:200}));cloud2=[...map.values()];return structuredClone(cloud2);}}};
  const engine2=loader(stubs2)('catalogEngine').createCatalogEngine({getLocal:()=>local2,isEnabled:()=>true,setConflict:()=>{},applyRows:r=>{applied=r;}});
  assert.equal((await engine2.sync()).ok,true);
  const session2=await engine2.prepareImport();
  const next2=structuredClone(base2); next2.products=[]; next2.categories=next2.categories.filter(c=>c.id==='cat-system-schuss');
  await engine2.commitImport(session2,next2);
  const gone=pushed.filter(r=>r.deleted).map(r=>r.kind+':'+r.id).sort();
  assert.deepEqual(gone,['category:cat-drinks','product:p-old']);
  assert(!pushed.some(r=>r.id==='cat-system-schuss'||r.kind==='setting'),'SCHUSS und Einstellungen werden nie gelöscht');
  assert(applied.some(r=>r.id==='p-old'&&r.deleted),'lokal wird die Löschung übernommen');
 }
 // A first-device conflict must block preview preparation.
 const other=loader({...stubs,storage:{...stubs.storage,loadJSON:(_k,f)=>f,saveJSON:()=>{}}})('catalogEngine').createCatalogEngine({getLocal:()=>({...base,shotOptions:[]}),isEnabled:()=>true,setConflict:()=>{},applyRows:()=>{}});
 assert.equal((await other.sync()).ok,false);
 await assert.rejects(other.prepareImport(),/konflikt/i);
 // Exercise actual restore code with a mocked transport, not a real Supabase endpoint.
 Object.defineProperty(globalThis,'navigator',{value:{onLine:true},configurable:true});
 let written=[];
 const restoreLoader=loader({
  ...stubs,
  catalogCloud:{fetchCatalogRows:async()=>rows(base),pushCatalogRows:async r=>{written.push(...r);}},
  bookingReset:{fetchLatestBookingReset:async()=>null,rememberBookingReset:()=>{}},
  cloudPull:{fetchCloudData:async()=>({transactions:[],cashSessions:[]})},
  outbox:{discardEntriesBeforeGeneration:async()=>{},enqueueEntries:async()=>{},flushOutbox:async()=>0},
  staffDirectory:{fetchAllStaffRows:async()=>[],pushStaffUser:async()=>{}},
  stornoCloud:{loadCloudStornos:async()=>[]}
 });
 const restore=restoreLoader('backupRecovery').restoreBackupSafely;
 const backup={exportedAt:'2026-11-10T10:00:00Z',data:{shotOptions:[{id:'rum',name:'Rum',price:5,locationPrices:{Bregenz:6}}],catalogVersions:{'setting:schuss-options':{updatedAt:300}}}};
 const restored=await restore(backup);
 assert.deepEqual(restored.data.shotOptions,backup.data.shotOptions); assert.equal(written.filter(r=>r.id==='schuss-options').length,1);
 written=[];
 const newerCloud=await restore({...backup,data:{...backup.data,catalogVersions:{'setting:schuss-options':{updatedAt:50}}}});
 assert.deepEqual(newerCloud.data.shotOptions,base.shotOptions); assert.equal(written.length,0,'newer cloud shots win');
 const legacy=await restore({exportedAt:backup.exportedAt,data:{}});
 assert.deepEqual(legacy.data.shotOptions,base.shotOptions); assert.equal(written.length,0,'legacy backups cannot erase shots');
 await assert.rejects(restore({...backup,data:{shotOptions:[{id:'none',name:'bad',price:-1}]}}),/Ungültige SCHUSS/);
 console.log('Synchronisierung und Backup geprüft: keine Doppelwrites, lokale/Cloud-Konflikte, Erstanmeldungskonflikt, SCHUSS-Wiederherstellung, neuere Cloud-Werte und Altbackups.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
