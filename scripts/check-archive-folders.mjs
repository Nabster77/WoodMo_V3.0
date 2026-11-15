import assert from 'node:assert/strict';
import { archiveRootName, backupDirectorySegments, wrongArchiveFolderMessage } from '../src/lib/archiveRoot.ts';
import { ensureYearStructure, ensureReportFolder, savePdfInFolder, saveFileNoOverwrite, copyName } from '../src/lib/archiveFolders.ts';

class MemoryHandle {
  constructor(dir,name){this.dir=dir;this.name=name;}
  async getFile(){
    const contents=this.dir.files.get(this.name);
    const b=new Blob([contents]);
    return {size:b.size,arrayBuffer:()=>b.arrayBuffer()};
  }
  async createWritable(){
    let bytes;
    return {
      write:async(value)=>{ bytes=value instanceof Blob ? await value.text() : String(value); },
      close:async()=>{if(bytes===undefined)throw Error('Unwritten file');this.dir.files.set(this.name,bytes);this.dir.writes.push(this.name);},
      abort:async()=>{},
    };
  }
}
class MemoryFolder {
  constructor(){this.folders=new Map();this.files=new Map();this.writes=[];this.created=[];}
  async getDirectoryHandle(name,{create=false}={}){
    if(!this.folders.has(name)){
      if(!create)throw new DOMException('Missing','NotFoundError');
      this.folders.set(name,new MemoryFolder());this.created.push(name);
    }
    return this.folders.get(name);
  }
  async getFileHandle(name,{create=false}={}){
    if(!this.files.has(name)){
      if(!create)throw new DOMException('Missing','NotFoundError');
      this.files.set(name,'');
    }
    return new MemoryHandle(this,name);
  }
}
const parent=new MemoryFolder();
const dec=Date.parse('2026-12-31T22:30:00Z');
const jan=Date.parse('2026-12-31T23:30:00Z');
assert.equal(archiveRootName(dec),'Kasse 2026');
assert.equal(archiveRootName(jan),'Kasse 2027');
assert.deepEqual(backupDirectorySegments(jan,'Backup1'),['Kasse 2027','Backup','Backup1']);
const base=await ensureYearStructure(parent,dec);
assert.deepEqual(parent.created,['Kasse 2026']);
assert.deepEqual(base.created,['Friedrichshafen','Bregenz','Alle-Standorte','Backup']);
for (const loc of ['Friedrichshafen','Bregenz','Alle-Standorte']) {
  assert.deepEqual([...base.folders.get(loc).folders.keys()],['Tagesabschlüsse','Tagesjournal','Wochenjournal','Monatsjournal','Jahresjournal','Individuell'],`Unterordner ${loc}`);
}
const fn=base.folders.get('Friedrichshafen');
const daily=fn.folders.get('Tagesjournal');
daily.files.set('vorhanden.pdf','ALT');
await ensureYearStructure(parent,dec);
assert.deepEqual(parent.created,['Kasse 2026'],'Vorhandener Hauptordner nicht duplizieren.');
assert.strictEqual(fn.folders.get('Tagesjournal'),daily,'Vorhandener Ordner bleibt.');
assert.equal(daily.files.get('vorhanden.pdf'),'ALT','Vorhandene Datei bleibt.');
fn.folders.delete('Wochenjournal');
await ensureYearStructure(parent,dec);
assert.ok(fn.folders.has('Wochenjournal'),'Gelöschter Ordner wird wieder angelegt.');

const report={location:'Friedrichshafen',fileName:'Friedrichshafen_Tagesjournal_31-12-2026.pdf',reportPeriodStart:dec};
const target=await ensureReportFolder(parent,report,jan);
assert.strictEqual(target,daily,'Tagesjournal ohne Monatsordner.');
assert.ok(parent.folders.has('Kasse 2027'),'Neues Jahr bekommt eigenen Hauptordner.');
const january=await ensureReportFolder(parent,{location:'Bregenz',fileName:'Tagesabschluss.pdf',documentTitle:'Tagesabschluss',reportPeriodStart:jan},jan);
assert.strictEqual(january,parent.folders.get('Kasse 2027').folders.get('Bregenz').folders.get('Tagesabschlüsse').folders.get('Januar'),'Tagesabschluss im Monatsordner.');
assert.deepEqual([...parent.folders.get('Kasse 2027').folders.get('Bregenz').folders.get('Tagesabschlüsse').folders.keys()],['Januar'],'Nur benötigter Monat.');
const closedNewYear=await ensureReportFolder(parent,{location:'Friedrichshafen',fileName:'Friedrichshafen_Tagesabschluss_2026-12-31.pdf',documentTitle:'Tagesabschluss',reportPeriodStart:dec,cashSessionPeriod:{closedAt:jan}},jan);
assert.strictEqual(closedNewYear,parent.folders.get('Kasse 2027').folders.get('Friedrichshafen').folders.get('Tagesabschlüsse').folders.get('Januar'),'Abschluss nach Mitternacht am 1.1. zählt ins neue Jahr.');
const custom=await ensureReportFolder(parent,{location:'Alle Standorte',fileName:'Alle-Standorte_Journal_01-11-2026_bis_15-11-2026.pdf',reportPeriodStart:dec},jan);
assert.strictEqual(custom,base.folders.get('Alle-Standorte').folders.get('Individuell'));

assert.equal(copyName('A.pdf',1),'A (1).pdf');
assert.equal(copyName('kasse-backup-2026-11-15.json',2),'kasse-backup-2026-11-15 (2).json');
const pdf=new Blob(['PDF-v1'],{type:'application/pdf'});
const other=new Blob(['PDF-v2'],{type:'application/pdf'});
assert.equal(await savePdfInFolder(target,'Test.pdf',pdf),'Test.pdf');
assert.equal(await savePdfInFolder(target,'Test.pdf',pdf),'Test (1).pdf','Doppelte Datei → Kopie (1).');
assert.equal(await savePdfInFolder(target,'Test.pdf',other),'Test (2).pdf');
assert.equal(target.files.get('Test.pdf'),'PDF-v1','Original wird nie überschrieben.');
assert.equal(target.files.get('Test (2).pdf'),'PDF-v2');
const backup=base.folders.get('Backup');
assert.equal(await saveFileNoOverwrite(backup,'b.json',new Blob(['{}'])),'b.json');
assert.equal(await saveFileNoOverwrite(backup,'b.json',new Blob(['{}'])),'b (1).json');

// Hauptordner „Kasse 2026“ komplett gelöscht → wird im gewählten Ordner still neu angelegt, „Kasse 2027“ bleibt unberührt.
const kasse2027=parent.folders.get('Kasse 2027');
parent.folders.delete('Kasse 2026');
const rebuilt=await ensureReportFolder(parent,{location:'Bregenz',fileName:'Bregenz_Tagesjournal.pdf',reportPeriodStart:dec},dec);
assert.ok(parent.folders.has('Kasse 2026'),'Gelöschter Hauptordner wird neu angelegt.');
assert.deepEqual([...parent.folders.get('Kasse 2026').folders.keys()],['Friedrichshafen','Bregenz','Alle-Standorte','Backup'],'Komplette Struktur neu.');
assert.strictEqual(rebuilt,parent.folders.get('Kasse 2026').folders.get('Bregenz').folders.get('Tagesjournal'));
assert.strictEqual(parent.folders.get('Kasse 2027'),kasse2027,'Anderes Jahr bleibt unverändert.');
assert.deepEqual([...parent.folders.keys()].sort(),['Kasse 2026','Kasse 2027'],'Kein doppelter Hauptordner.');

// Falscher Ordner gewählt: „Kasse JJJJ“ selbst → klare Meldung ohne festen Namen wie „Woodmo“; jeder andere Name (WoodMo, XY …) ist erlaubt.
assert.match(wrongArchiveFolderMessage('Kasse 2026'),/nicht den Ordner „Kasse 2026“ selbst/);
assert.doesNotMatch(wrongArchiveFolderMessage('Kasse 2027'),/Woodmo/i);
for (const ok of ['WoodMo','XY','Kassenbuch','Kasse','Kasse 26','Documents']) assert.equal(wrongArchiveFolderMessage(ok),null,`„${ok}“ ist ein erlaubter Speicherort.`);

console.log('ARCHIV-ORDNER: Kasse 2026/2027, Standorte + Berichtsarten + Backup, fehlende Ordner neu (auch gelöschter Hauptordner), falscher Ordner erkannt, nie überschreiben, Kopien (1) OK.');
