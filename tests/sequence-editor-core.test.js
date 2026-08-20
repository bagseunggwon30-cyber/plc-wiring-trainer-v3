const test=require('node:test');
const assert=require('node:assert/strict');
const Core=require('../src/ui/sequence-editor-core.js');

test('a new sequence sheet is independent and starts blank',()=>{
  const doc=Core.createDocument();
  assert.equal(doc.schemaVersion,1);
  assert.deepEqual(doc.symbols,[]);
  assert.deepEqual(doc.wires,[]);
  assert.equal(doc.sheet.format,'A3-L');
});

test('symbol catalog covers three-phase power and classic control symbols',()=>{
  const types=Core.SYMBOL_CATALOG.map(item=>item.type);
  for(const type of ['mccb-3p','mc-main-3p','eocr-3p','motor-3p','pe','pb-no','pb-nc','contact-no','contact-nc','coil','timer-coil','lamp']){
    assert.ok(types.includes(type),type);
  }
  assert.equal(Core.symbolDefinition('mc-main-3p').terminals.length,6);
  assert.deepEqual(Core.symbolDefinition('coil').terminals.map(term=>term.id),['A1','A2']);
});

test('manual terminal wiring uses orthogonal routes and endpoint identity',()=>{
  let doc=Core.createDocument();
  ({document:doc}=Core.addSymbol(doc,'pb-no',{x:250,y:180,ref:'PB1'}));
  ({document:doc}=Core.addSymbol(doc,'coil',{x:650,y:180,ref:'MC1'}));
  const [pb,coil]=doc.symbols;
  ({document:doc}=Core.connect(doc,{kind:'terminal',symbolId:pb.id,terminalId:'13'},{kind:'terminal',symbolId:coil.id,terminalId:'A1'}));
  assert.equal(doc.wires.length,1);
  assert.deepEqual(doc.wires[0].from,{kind:'terminal',symbolId:pb.id,terminalId:'13'});
  assert.equal(doc.wires[0].points.length,4);
  assert.equal(doc.wires[0].points[0].y,doc.wires[0].points[1].y);
  assert.equal(doc.wires[0].points[2].x,doc.wires[0].points[3].x);
});

test('series insertion splits one selected wire through the inserted symbol',()=>{
  let doc=Core.createDocument();
  ({document:doc}=Core.addSymbol(doc,'pb-nc',{x:180,y:220,ref:'PB0'}));
  ({document:doc}=Core.addSymbol(doc,'coil',{x:760,y:220,ref:'MC1'}));
  ({document:doc}=Core.connect(doc,{kind:'terminal',symbolId:doc.symbols[0].id,terminalId:'21'},{kind:'terminal',symbolId:doc.symbols[1].id,terminalId:'A1'}));
  const originalWire=doc.wires[0].id;
  const result=Core.insertSeries(doc,originalWire,'pb-no',{ref:'PB1'});
  doc=result.document;
  assert.equal(doc.symbols.length,3);
  assert.equal(doc.wires.length,2);
  assert.equal(doc.wires.some(wire=>wire.id===originalWire),false);
  assert.equal(doc.wires.filter(wire=>wire.from.symbolId===result.symbol.id||wire.to.symbolId===result.symbol.id).length,2);
});

test('parallel insertion keeps the original path and adds a branch',()=>{
  let doc=Core.createDocument();
  ({document:doc}=Core.addSymbol(doc,'pb-no',{x:280,y:250,ref:'PB1'}));
  ({document:doc}=Core.addSymbol(doc,'coil',{x:720,y:250,ref:'MC1'}));
  ({document:doc}=Core.connect(doc,{kind:'terminal',symbolId:doc.symbols[0].id,terminalId:'14'},{kind:'terminal',symbolId:doc.symbols[1].id,terminalId:'A1'}));
  const originalWire=doc.wires[0].id;
  const result=Core.insertParallel(doc,originalWire,'contact-no',{ref:'MC1'});
  doc=result.document;
  assert.ok(doc.wires.some(wire=>wire.id===originalWire));
  assert.equal(doc.wires.length,3);
  assert.equal(result.symbol.ref,'MC1');
});

test('starter template creates a real 3-phase power path and self-hold control branch',()=>{
  const doc=Core.createTemplate('motor-starter');
  assert.ok(doc.symbols.some(symbol=>symbol.type==='mccb-3p'&&symbol.ref==='QF1'));
  assert.ok(doc.symbols.some(symbol=>symbol.type==='mc-main-3p'&&symbol.ref==='MC1'));
  assert.ok(doc.symbols.some(symbol=>symbol.type==='coil'&&symbol.ref==='MC1'));
  assert.ok(doc.symbols.some(symbol=>symbol.type==='contact-no'&&symbol.ref==='MC1'));
  assert.ok(doc.symbols.some(symbol=>symbol.type==='eocr-3p'&&symbol.ref==='EOCR1'));
  assert.ok(doc.symbols.some(symbol=>symbol.type==='motor-3p'&&symbol.ref==='M1'));
  assert.ok(doc.wires.length>=14);
  assert.ok(Core.validateDocument(doc).every(issue=>issue.severity!=='error'));
});

test('electrician practical catalog includes protection, selector, limit, relay, and timer contacts',()=>{
  const types=Core.SYMBOL_CATALOG.map(item=>item.type);
  for(const type of ['eocr-nc','selector-no','limit-no','limit-nc','relay-coil','relay-contact-no','relay-contact-nc']){
    assert.ok(types.includes(type),type);
  }
  assert.deepEqual(Core.symbolDefinition('eocr-nc').terminals.map(term=>term.id),['95','96']);
});

test('forward reverse practical template has self-hold and electrical interlock cross references',()=>{
  const doc=Core.createTemplate('forward-reverse');
  const refs=ref=>doc.symbols.filter(symbol=>symbol.ref===ref).map(symbol=>symbol.type);
  assert.ok(refs('MC1').includes('mc-main-3p'));
  assert.ok(refs('MC1').includes('coil'));
  assert.ok(refs('MC1').includes('contact-no'));
  assert.ok(refs('MC1').includes('contact-nc'));
  assert.ok(refs('MC2').includes('mc-main-3p'));
  assert.ok(refs('MC2').includes('coil'));
  assert.ok(refs('MC2').includes('contact-no'));
  assert.ok(refs('MC2').includes('contact-nc'));
  assert.ok(doc.symbols.some(symbol=>symbol.type==='eocr-nc'&&symbol.ref==='EOCR1'));
  assert.ok(Core.validateDocument(doc).every(issue=>issue.severity!=='error'));
});

test('invalid imports are rejected instead of mutating the active sheet',()=>{
  assert.throws(()=>Core.deserializeDocument('{"schemaVersion":99}'),/지원하지 않는/);
  assert.throws(()=>Core.deserializeDocument('{bad json'),/JSON/);
});
