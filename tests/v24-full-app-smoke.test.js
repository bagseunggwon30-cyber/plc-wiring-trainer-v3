const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ROOT = path.join(__dirname, '..');

class ClassList { constructor(){this.s=new Set();} add(...x){x.forEach(v=>this.s.add(v));} remove(...x){x.forEach(v=>this.s.delete(v));} toggle(x){if(this.s.has(x)){this.s.delete(x);return false;}this.s.add(x);return true;} contains(x){return this.s.has(x);} }
class FakeElement {
  constructor(tag='div', id=''){this.tagName=tag.toUpperCase();this.id=id;this.style={};this.dataset={};this.classList=new ClassList();this.children=[];this.attributes={};this.value='';this.checked=false;this.files=[];this.textContent='';this._html='';this.parentNode=null;this.ownerDocument=null;this.clientWidth=1600;this.clientHeight=1000;this.scrollWidth=1600;this.scrollHeight=1000;}
  appendChild(c){if(c){this.children.push(c);c.parentNode=this;}return c;} append(...cs){cs.forEach(c=>this.appendChild(c));}
  remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(x=>x!==this);} replaceChildren(...cs){this.children=[];this.append(...cs);}
  setAttribute(k,v){this.attributes[k]=String(v); if(k==='id')this.id=String(v); if(k==='class')String(v).split(/\s+/).forEach(x=>x&&this.classList.add(x));}
  getAttribute(k){return this.attributes[k]??null;} removeAttribute(k){delete this.attributes[k];}
  addEventListener(){} removeEventListener(){} dispatchEvent(){return true;} click(){if(typeof this.onclick==='function')this.onclick({target:this});}
  querySelector(sel){return this.ownerDocument?.querySelector(sel)||new FakeElement();} querySelectorAll(){return [];}
  closest(){return null;} focus(){} blur(){} select(){} setPointerCapture(){} releasePointerCapture(){}
  getBoundingClientRect(){return {x:0,y:0,left:0,top:0,right:this.clientWidth,bottom:this.clientHeight,width:this.clientWidth,height:this.clientHeight};}
  getScreenCTM(){return {inverse(){return {a:1,b:0,c:0,d:1,e:0,f:0};}};}
  createSVGPoint(){return {x:0,y:0,matrixTransform(){return {x:this.x,y:this.y};}};}
  getContext(){return {fillRect(){},drawImage(){},clearRect(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},fillText(){},measureText(){return {width:10};}};}
  toBlob(cb){cb(Buffer.from('x'));}
  set innerHTML(v){this._html=String(v);} get innerHTML(){return this._html;}
  get firstChild(){return this.children[0]||null;} get lastChild(){return this.children[this.children.length-1]||null;}
}
class FakeDocument {
  constructor(){this.map=new Map();this.body=this.make('body','body');this.documentElement=this.make('html','html');this.readyState='complete';}
  make(tag,id=''){const e=new FakeElement(tag,id);e.ownerDocument=this;if(id)this.map.set('#'+id,e);return e;}
  querySelector(sel){if(this.map.has(sel))return this.map.get(sel);if(sel.startsWith('#'))return this.make(sel==='#work'?'svg':'div',sel.slice(1));return this.make('div');}
  querySelectorAll(){return [];}
  createElement(tag){return this.make(tag);} createElementNS(ns,tag){return this.make(tag);} createTextNode(t){const e=this.make('#text');e.textContent=String(t);return e;}
  addEventListener(){} removeEventListener(){}
}

test('full application script initializes with v2.4 pack and all modular runtimes in a DOM smoke harness', () => {
  const document=new FakeDocument();
  const storage=new Map();
  const context={console,document,navigator:{userAgent:'vm-smoke'},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k),clear:()=>storage.clear()},
    structuredClone:global.structuredClone,crypto:{randomUUID:()=>Math.random().toString(36).slice(2)},performance:{now:()=>Date.now()},Date,Math,JSON,Object,Array,Map,Set,WeakMap,WeakSet,Promise,RegExp,String,Number,Boolean,Symbol,Error,TypeError,
    setTimeout:(fn)=>{if(typeof fn==='function')fn();return 1;},clearTimeout(){},setInterval:()=>1,clearInterval(){},requestAnimationFrame:(fn)=>{if(typeof fn==='function')fn(Date.now());return 1;},cancelAnimationFrame(){},
    alert(){},confirm:()=>true,prompt:(m,d)=>d??'',getComputedStyle:()=>({}),CSS:{escape:s=>String(s)},
    Blob:class Blob{},FileReader:class {readAsText(){if(this.onload)this.onload();}},Image:class {set src(v){if(this.onload)this.onload();}},XMLSerializer:class {serializeToString(){return '<svg/>'; }},
    URL:{createObjectURL:()=> 'blob:x',revokeObjectURL(){}},btoa:s=>Buffer.from(s,'binary').toString('base64'),atob:s=>Buffer.from(s,'base64').toString('binary'),
    ResizeObserver:class {observe(){}disconnect(){}},MutationObserver:class {observe(){}disconnect(){}},Event:class {},CustomEvent:class {},
  };
  context.window=context;context.globalThis=context;context.self=context;context.addEventListener=()=>{};context.removeEventListener=()=>{};context.open=()=>null;
  vm.createContext(context);
  for(const f of ['src/device-packs/device-pack-registry.js','src/device-packs/ls-xgb-v24-pack.js','src/runtime/rack-runtime.js','src/runtime/analog-runtime.js','src/runtime/modbus-runtime.js','src/runtime/drive-runtime.js','src/ui/device-config.js']){
    vm.runInContext(fs.readFileSync(path.join(ROOT,f),'utf8'),context,{filename:f,timeout:10000});
  }
  const html=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');const script=html.match(/<script>([\s\S]*?)<\/script>/i)[1];
  vm.runInContext(script,context,{filename:'index.inline.js',timeout:30000});
  const result=vm.runInContext(`({version:PROJECT_SCHEMA_VERSION,devices:Object.keys(LIB).length,goals:GOALS.length,hasXBL:!!LIB['XBL-C41A'],hasPD:!!LIB['XBF-PD02A'],g23:GOALS.find(g=>g.id==='g23')?.checks?.length,pack:window.V24_DEVICE_PACK_REPORT,runtimes:!!(window.PLCRackRuntime&&window.PLCAnalogRuntime&&window.PLCModbusRuntime&&window.PLCDriveRuntime),configUi:!!window.PLCTrainerDeviceConfig})`,context);
  assert.equal(result.version,9);
  assert.equal(result.devices,71);
  assert.equal(result.goals,24);
  assert.equal(result.hasXBL,true);
  assert.equal(result.hasPD,true);
  assert.equal(result.g23,6);
  assert.equal(result.runtimes,true);
  assert.equal(result.configUi,true);
  assert.deepEqual([...result.pack.packs],['ls-xgb-v24']);
  assert.deepEqual([...result.pack.errors],[]);
});
