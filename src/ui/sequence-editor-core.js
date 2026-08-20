(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.PLCTrainerSequenceCore=api;
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';

  const terminal=(id,label,x,y,side)=>({id,label,x,y,side});
  const SYMBOL_CATALOG=[
    {type:'source-3p',category:'동력',label:'3상 전원 R·S·T',width:92,height:150,terminals:[terminal('R','R',92,35,'right'),terminal('S','S',92,75,'right'),terminal('T','T',92,115,'right')]},
    {type:'mccb-3p',category:'동력',label:'MCCB 3P',width:128,height:150,terminals:[terminal('L1','1',0,35,'left'),terminal('L2','2',0,75,'left'),terminal('L3','3',0,115,'left'),terminal('T1','4',128,35,'right'),terminal('T2','5',128,75,'right'),terminal('T3','6',128,115,'right')]},
    {type:'mc-main-3p',category:'동력',label:'MC 주접점 3P',width:128,height:150,terminals:[terminal('1L1','1',0,35,'left'),terminal('3L2','3',0,75,'left'),terminal('5L3','5',0,115,'left'),terminal('2T1','2',128,35,'right'),terminal('4T2','4',128,75,'right'),terminal('6T3','6',128,115,'right')]},
    {type:'eocr-3p',category:'동력',label:'EOCR 3P',width:128,height:150,terminals:[terminal('L1-IN','R IN',0,35,'left'),terminal('L2-IN','S IN',0,75,'left'),terminal('L3-IN','T IN',0,115,'left'),terminal('L1-OUT','R OUT',128,35,'right'),terminal('L2-OUT','S OUT',128,75,'right'),terminal('L3-OUT','T OUT',128,115,'right')]},
    {type:'motor-3p',category:'동력',label:'3상 모터',width:126,height:150,terminals:[terminal('U','U',0,35,'left'),terminal('V','V',0,75,'left'),terminal('W','W',0,115,'left'),terminal('PE','PE',63,150,'bottom')]},
    {type:'pe',category:'동력',label:'보호접지 PE',width:80,height:80,terminals:[terminal('PE','PE',40,0,'top')]},
    {type:'control-power',category:'제어',label:'제어전원 L/N',width:92,height:150,terminals:[terminal('L','L/+24V',92,35,'right'),terminal('N','N/0V',92,115,'right')]},
    {type:'pb-no',category:'제어',label:'누름버튼 NO',width:120,height:64,terminals:[terminal('13','13',0,32,'left'),terminal('14','14',120,32,'right')]},
    {type:'pb-nc',category:'제어',label:'누름버튼 NC',width:120,height:64,terminals:[terminal('21','21',0,32,'left'),terminal('22','22',120,32,'right')]},
    {type:'selector-no',category:'제어',label:'셀렉터 스위치 NO',width:120,height:64,terminals:[terminal('13','13',0,32,'left'),terminal('14','14',120,32,'right')]},
    {type:'limit-no',category:'제어',label:'리미트 스위치 NO',width:120,height:64,terminals:[terminal('13','13',0,32,'left'),terminal('14','14',120,32,'right')]},
    {type:'limit-nc',category:'제어',label:'리미트 스위치 NC',width:120,height:64,terminals:[terminal('21','21',0,32,'left'),terminal('22','22',120,32,'right')]},
    {type:'eocr-nc',category:'제어',label:'EOCR 트립 NC',width:120,height:64,terminals:[terminal('95','95',0,32,'left'),terminal('96','96',120,32,'right')]},
    {type:'contact-no',category:'제어',label:'보조접점 NO',width:120,height:64,terminals:[terminal('13','13',0,32,'left'),terminal('14','14',120,32,'right')]},
    {type:'contact-nc',category:'제어',label:'보조접점 NC',width:120,height:64,terminals:[terminal('21','21',0,32,'left'),terminal('22','22',120,32,'right')]},
    {type:'relay-contact-no',category:'제어',label:'릴레이 접점 NO',width:120,height:64,terminals:[terminal('13','13',0,32,'left'),terminal('14','14',120,32,'right')]},
    {type:'relay-contact-nc',category:'제어',label:'릴레이 접점 NC',width:120,height:64,terminals:[terminal('21','21',0,32,'left'),terminal('22','22',120,32,'right')]},
    {type:'timer-contact-no',category:'제어',label:'타이머 한시 NO',width:120,height:64,terminals:[terminal('8','8',0,32,'left'),terminal('5','5',120,32,'right')]},
    {type:'coil',category:'출력',label:'전자접촉기 코일',width:120,height:64,terminals:[terminal('A1','A1',0,32,'left'),terminal('A2','A2',120,32,'right')]},
    {type:'relay-coil',category:'출력',label:'보조릴레이 코일',width:120,height:64,terminals:[terminal('A1','A1',0,32,'left'),terminal('A2','A2',120,32,'right')]},
    {type:'timer-coil',category:'출력',label:'타이머 코일',width:120,height:64,terminals:[terminal('2','2',0,32,'left'),terminal('7','7',120,32,'right')]},
    {type:'lamp',category:'출력',label:'표시등',width:92,height:64,terminals:[terminal('+','+',0,32,'left'),terminal('-','-',92,32,'right')]},
    {type:'buzzer',category:'출력',label:'부저',width:92,height:64,terminals:[terminal('+','+',0,32,'left'),terminal('-','-',92,32,'right')]}
  ];
  const DEFINITIONS=Object.fromEntries(SYMBOL_CATALOG.map(item=>[item.type,Object.freeze({...item,terminals:item.terminals.map(term=>Object.freeze({...term}))})]));
  const clone=value=>JSON.parse(JSON.stringify(value));
  const snap=value=>Math.round(Number(value||0)/10)*10;

  function createDocument(options={}){
    return {
      schemaVersion:1,
      title:String(options.title||'새 전기 시퀀스'),
      sheet:{format:options.format||'A3-L',width:1600,height:1050,grid:20},
      symbols:[],wires:[],notes:[],counters:{symbol:1,wire:1},updatedAt:new Date().toISOString()
    };
  }

  function symbolDefinition(type){return DEFINITIONS[type]||null;}
  function nextId(items,prefix){
    const used=new Set(items.map(item=>String(item.id)));
    let index=1;while(used.has(`${prefix}${index}`))index+=1;
    return `${prefix}${index}`;
  }
  function allocateId(document,kind,prefix){
    document.counters=document.counters||{};
    let value=Number(document.counters[kind]||1);
    const items=kind==='symbol'?document.symbols:document.wires;
    const used=new Set(items.map(item=>item.id));
    while(used.has(`${prefix}${value}`))value+=1;
    document.counters[kind]=value+1;return `${prefix}${value}`;
  }
  function nextReference(document,definition){
    const prefixes={
      'source-3p':'PWR','mccb-3p':'QF','mc-main-3p':'MC','eocr-3p':'EOCR','motor-3p':'M','pe':'PE','control-power':'CP',
      'pb-no':'PB','pb-nc':'PB','selector-no':'SS','limit-no':'LS','limit-nc':'LS','eocr-nc':'EOCR',
      'contact-no':'K','contact-nc':'K','relay-contact-no':'X','relay-contact-nc':'X','timer-contact-no':'T',
      'coil':'MC','relay-coil':'X','timer-coil':'T','lamp':'HL','buzzer':'BZ'
    };
    const prefix=prefixes[definition.type]||'X';
    const refs=new Set(document.symbols.map(symbol=>symbol.ref));let index=1;
    while(refs.has(`${prefix}${index}`))index+=1;
    return `${prefix}${index}`;
  }

  function addSymbol(document,type,options={}){
    const definition=symbolDefinition(type);
    if(!definition)throw new Error(`알 수 없는 시퀀스 도형: ${type}`);
    const next=clone(document),symbol={
      id:allocateId(next,'symbol','s'),type,
      x:snap(options.x??180),y:snap(options.y??120),
      ref:String(options.ref||nextReference(next,definition)),
      label:String(options.label||definition.label)
    };
    next.symbols.push(symbol);touch(next);return {document:next,symbol};
  }

  function updateSymbol(document,symbolId,patch={}){
    const next=clone(document),symbol=next.symbols.find(item=>item.id===symbolId);
    if(!symbol)throw new Error(`도형을 찾을 수 없습니다: ${symbolId}`);
    if(patch.ref!=null)symbol.ref=String(patch.ref).trim().slice(0,30)||symbol.ref;
    if(patch.label!=null)symbol.label=String(patch.label).trim().slice(0,80)||symbol.label;
    if(Number.isFinite(Number(patch.x)))symbol.x=snap(patch.x);
    if(Number.isFinite(Number(patch.y)))symbol.y=snap(patch.y);
    rerouteAll(next);touch(next);return next;
  }

  function deleteSymbol(document,symbolId){
    const next=clone(document);
    next.symbols=next.symbols.filter(symbol=>symbol.id!==symbolId);
    next.wires=next.wires.filter(wire=>wire.from.symbolId!==symbolId&&wire.to.symbolId!==symbolId);
    touch(next);return next;
  }

  function endpointPoint(document,endpoint){
    if(endpoint?.kind==='point'&&Number.isFinite(endpoint.x)&&Number.isFinite(endpoint.y))return {x:snap(endpoint.x),y:snap(endpoint.y)};
    if(endpoint?.kind!=='terminal')throw new Error('지원하지 않는 결선 끝점입니다.');
    const symbol=document.symbols.find(item=>item.id===endpoint.symbolId);
    if(!symbol)throw new Error(`결선 도형이 없습니다: ${endpoint.symbolId}`);
    const definition=symbolDefinition(symbol.type);
    const term=definition?.terminals.find(item=>item.id===endpoint.terminalId);
    if(!term)throw new Error(`단자가 없습니다: ${endpoint.symbolId}.${endpoint.terminalId}`);
    return {x:symbol.x+term.x,y:symbol.y+term.y};
  }

  function orthogonalPoints(a,b){
    if(Math.abs(b.x-a.x)>=Math.abs(b.y-a.y)){
      const mid=snap((a.x+b.x)/2);return [{...a},{x:mid,y:a.y},{x:b.x,y:a.y},{...b}];
    }
    const mid=snap((a.y+b.y)/2);return [{...a},{x:a.x,y:mid},{x:b.x,y:mid},{...b}];
  }

  function endpointKey(endpoint){
    return endpoint.kind==='terminal'?`${endpoint.symbolId}.${endpoint.terminalId}`:`point:${endpoint.x},${endpoint.y}`;
  }

  function connect(document,from,to,options={}){
    const next=clone(document);const a=endpointPoint(next,from),b=endpointPoint(next,to);
    if(endpointKey(from)===endpointKey(to))throw new Error('같은 단자에는 결선할 수 없습니다.');
    const duplicate=next.wires.some(wire=>(endpointKey(wire.from)===endpointKey(from)&&endpointKey(wire.to)===endpointKey(to))||(endpointKey(wire.from)===endpointKey(to)&&endpointKey(wire.to)===endpointKey(from)));
    if(duplicate)throw new Error('이미 같은 끝점 사이에 결선이 있습니다.');
    const wire={id:allocateId(next,'wire','w'),from:clone(from),to:clone(to),points:orthogonalPoints(a,b),color:String(options.color||'#111827'),tag:String(options.tag||'')};
    next.wires.push(wire);touch(next);return {document:next,wire};
  }

  function removeWire(document,wireId){const next=clone(document);next.wires=next.wires.filter(wire=>wire.id!==wireId);touch(next);return next;}
  function orderedTerminals(definition){
    if(definition.terminals.length!==2)throw new Error('직렬/병렬 삽입은 2단자 제어 도형만 지원합니다.');
    const sorted=[...definition.terminals].sort((a,b)=>a.x-b.x||a.y-b.y);return [sorted[0].id,sorted[1].id];
  }

  function insertSeries(document,wireId,type,options={}){
    const wire=document.wires.find(item=>item.id===wireId);if(!wire)throw new Error('선택한 결선을 찾을 수 없습니다.');
    const definition=symbolDefinition(type);const [input,output]=orderedTerminals(definition);
    const a=endpointPoint(document,wire.from),b=endpointPoint(document,wire.to);
    let next=removeWire(document,wireId);let result=addSymbol(next,type,{...options,x:(a.x+b.x-definition.width)/2,y:(a.y+b.y-definition.height)/2});next=result.document;
    ({document:next}=connect(next,wire.from,{kind:'terminal',symbolId:result.symbol.id,terminalId:input},{color:wire.color,tag:wire.tag}));
    ({document:next}=connect(next,{kind:'terminal',symbolId:result.symbol.id,terminalId:output},wire.to,{color:wire.color,tag:wire.tag}));
    return {document:next,symbol:next.symbols.find(item=>item.id===result.symbol.id)};
  }

  function insertParallel(document,wireId,type,options={}){
    const wire=document.wires.find(item=>item.id===wireId);if(!wire)throw new Error('선택한 결선을 찾을 수 없습니다.');
    const definition=symbolDefinition(type);const [input,output]=orderedTerminals(definition);
    const a=endpointPoint(document,wire.from),b=endpointPoint(document,wire.to);
    let result=addSymbol(document,type,{...options,x:(a.x+b.x-definition.width)/2,y:Math.min(a.y,b.y)-100});let next=result.document;
    ({document:next}=connect(next,wire.from,{kind:'terminal',symbolId:result.symbol.id,terminalId:input},{color:wire.color}));
    ({document:next}=connect(next,{kind:'terminal',symbolId:result.symbol.id,terminalId:output},wire.to,{color:wire.color}));
    return {document:next,symbol:next.symbols.find(item=>item.id===result.symbol.id)};
  }

  function rerouteAll(document){
    for(const wire of document.wires){
      try{wire.points=orthogonalPoints(endpointPoint(document,wire.from),endpointPoint(document,wire.to));}catch(_){wire.points=[];}
    }
  }
  function touch(document){document.updatedAt=new Date().toISOString();}

  function createTemplate(name){
    if(name==='forward-reverse')return createForwardReverseTemplate();
    if(name!=='motor-starter')return createDocument();
    let doc=createDocument({title:'3상 모터 기동·정지 자기유지 시퀀스'});
    const add=(type,x,y,ref)=>{const result=addSymbol(doc,type,{x,y,ref});doc=result.document;return result.symbol;};
    const source=add('source-3p',80,120,'R/S/T'),qf=add('mccb-3p',260,120,'QF1'),mc=add('mc-main-3p',490,120,'MC1'),eocr=add('eocr-3p',720,120,'EOCR1'),motor=add('motor-3p',960,120,'M1'),pe=add('pe',990,350,'PE');
    const phasePairs=[['R','L1','T1','1L1','2T1','L1-IN','L1-OUT','U'],['S','L2','T2','3L2','4T2','L2-IN','L2-OUT','V'],['T','L3','T3','5L3','6T3','L3-IN','L3-OUT','W']];
    for(const [src,qin,qout,mcin,mcout,ein,eout,mterm] of phasePairs){
      ({document:doc}=connect(doc,{kind:'terminal',symbolId:source.id,terminalId:src},{kind:'terminal',symbolId:qf.id,terminalId:qin},{color:src==='R'?'#8b4513':src==='S'?'#111827':'#64748b'}));
      ({document:doc}=connect(doc,{kind:'terminal',symbolId:qf.id,terminalId:qout},{kind:'terminal',symbolId:mc.id,terminalId:mcin}));
      ({document:doc}=connect(doc,{kind:'terminal',symbolId:mc.id,terminalId:mcout},{kind:'terminal',symbolId:eocr.id,terminalId:ein}));
      ({document:doc}=connect(doc,{kind:'terminal',symbolId:eocr.id,terminalId:eout},{kind:'terminal',symbolId:motor.id,terminalId:mterm}));
    }
    ({document:doc}=connect(doc,{kind:'terminal',symbolId:pe.id,terminalId:'PE'},{kind:'terminal',symbolId:motor.id,terminalId:'PE'},{color:'#15803d'}));
    const cp=add('control-power',80,560,'L/N'),stop=add('pb-nc',300,560,'PB0'),start=add('pb-no',500,560,'PB1'),coil=add('coil',800,560,'MC1'),hold=add('contact-no',500,440,'MC1');
    ({document:doc}=connect(doc,{kind:'terminal',symbolId:cp.id,terminalId:'L'},{kind:'terminal',symbolId:stop.id,terminalId:'21'}));
    ({document:doc}=connect(doc,{kind:'terminal',symbolId:stop.id,terminalId:'22'},{kind:'terminal',symbolId:start.id,terminalId:'13'}));
    ({document:doc}=connect(doc,{kind:'terminal',symbolId:start.id,terminalId:'14'},{kind:'terminal',symbolId:coil.id,terminalId:'A1'}));
    ({document:doc}=connect(doc,{kind:'terminal',symbolId:coil.id,terminalId:'A2'},{kind:'terminal',symbolId:cp.id,terminalId:'N'}));
    ({document:doc}=connect(doc,{kind:'terminal',symbolId:stop.id,terminalId:'22'},{kind:'terminal',symbolId:hold.id,terminalId:'13'}));
    ({document:doc}=connect(doc,{kind:'terminal',symbolId:hold.id,terminalId:'14'},{kind:'terminal',symbolId:coil.id,terminalId:'A1'}));
    doc.notes.push({id:'n1',x:80,y:70,text:'동력회로 R/S/T → QF1 → MC1 → EOCR1 → M1'});
    doc.notes.push({id:'n2',x:80,y:500,text:'제어회로 L → PB0(NC) → PB1(NO) ∥ MC1(13-14) → MC1 코일 → N'});
    touch(doc);return doc;
  }

  function createForwardReverseTemplate(){
    let doc=createDocument({title:'전기기능사 3상 모터 정·역운전 시퀀스'});
    const add=(type,x,y,ref)=>{const result=addSymbol(doc,type,{x,y,ref});doc=result.document;return result.symbol;};
    const link=(a,at,b,bt,color)=>{({document:doc}=connect(doc,{kind:'terminal',symbolId:a.id,terminalId:at},{kind:'terminal',symbolId:b.id,terminalId:bt},{color}));};
    const source=add('source-3p',60,110,'R/S/T'),qf=add('mccb-3p',210,110,'QF1');
    const forward=add('mc-main-3p',430,80,'MC1'),reverse=add('mc-main-3p',430,270,'MC2');
    const overload=add('eocr-3p',680,170,'EOCR1'),motor=add('motor-3p',930,170,'M1'),pe=add('pe',970,370,'PE');
    const phases=[['R','L1','T1','1L1','2T1'],['S','L2','T2','3L2','4T2'],['T','L3','T3','5L3','6T3']];
    phases.forEach(([src,qin,qout,mcin,mcout],index)=>{const color=index===0?'#8b4513':index===1?'#111827':'#64748b';link(source,src,qf,qin,color);link(qf,qout,forward,mcin,color);link(qf,qout,reverse,mcin,color);});
    [['2T1','L1-IN'],['4T2','L2-IN'],['6T3','L3-IN']].forEach(([out,input])=>link(forward,out,overload,input));
    [['2T1','L3-IN'],['4T2','L2-IN'],['6T3','L1-IN']].forEach(([out,input])=>link(reverse,out,overload,input));
    [['L1-OUT','U'],['L2-OUT','V'],['L3-OUT','W']].forEach(([out,input])=>link(overload,out,motor,input));
    link(pe,'PE',motor,'PE','#15803d');

    const cp=add('control-power',60,620,'L/N'),stop=add('pb-nc',230,620,'PB0'),trip=add('eocr-nc',390,620,'EOCR1');
    const fwdPb=add('pb-no',570,550,'PB1'),revPb=add('pb-no',570,730,'PB2');
    const fwdHold=add('contact-no',570,450,'MC1'),revHold=add('contact-no',570,830,'MC2');
    const revInterlock=add('contact-nc',760,550,'MC2'),fwdInterlock=add('contact-nc',760,730,'MC1');
    const fwdCoil=add('coil',970,550,'MC1'),revCoil=add('coil',970,730,'MC2');
    link(cp,'L',stop,'21');link(stop,'22',trip,'95');
    link(trip,'96',fwdPb,'13');link(fwdPb,'14',revInterlock,'21');link(revInterlock,'22',fwdCoil,'A1');link(fwdCoil,'A2',cp,'N');
    link(trip,'96',fwdHold,'13');link(fwdHold,'14',revInterlock,'21');
    link(trip,'96',revPb,'13');link(revPb,'14',fwdInterlock,'21');link(fwdInterlock,'22',revCoil,'A1');link(revCoil,'A2',cp,'N');
    link(trip,'96',revHold,'13');link(revHold,'14',fwdInterlock,'21');
    doc.notes.push({id:'n1',x:60,y:55,text:'동력회로: MC2는 두 상을 교환하여 역회전 · MC1/MC2 동시 투입 금지'});
    doc.notes.push({id:'n2',x:60,y:530,text:'제어회로: PB0 정지 + EOCR 95-96 + 자기유지 + 상대측 b접점 전기적 인터록'});
    touch(doc);return doc;
  }

  function validateDocument(document){
    const issues=[];const symbolIds=new Set();const wireIds=new Set();
    for(const symbol of document.symbols||[]){
      if(symbolIds.has(symbol.id))issues.push({severity:'error',code:'DUPLICATE_SYMBOL',message:`중복 도형 ID ${symbol.id}`});symbolIds.add(symbol.id);
      if(!symbolDefinition(symbol.type))issues.push({severity:'error',code:'UNKNOWN_SYMBOL',message:`알 수 없는 도형 ${symbol.type}`});
    }
    for(const wire of document.wires||[]){
      if(wireIds.has(wire.id))issues.push({severity:'error',code:'DUPLICATE_WIRE',message:`중복 결선 ID ${wire.id}`});wireIds.add(wire.id);
      try{endpointPoint(document,wire.from);endpointPoint(document,wire.to);}catch(error){issues.push({severity:'error',code:'BROKEN_ENDPOINT',message:error.message});}
    }
    return issues;
  }

  function serializeDocument(document){return JSON.stringify(document,null,2);}
  function deserializeDocument(text){
    let value;try{value=JSON.parse(String(text));}catch(_){throw new Error('시퀀스 JSON을 읽을 수 없습니다.');}
    if(value?.schemaVersion!==1)throw new Error(`지원하지 않는 시퀀스 문서 버전: ${value?.schemaVersion}`);
    if(!Array.isArray(value.symbols)||!Array.isArray(value.wires))throw new Error('시퀀스 문서 구조가 올바르지 않습니다.');
    const doc=clone(value);doc.counters=doc.counters||{symbol:nextId(doc.symbols,'s').slice(1),wire:nextId(doc.wires,'w').slice(1)};
    const issues=validateDocument(doc).filter(issue=>issue.severity==='error');
    if(issues.length)throw new Error(issues[0].message);rerouteAll(doc);return doc;
  }

  return {
    SYMBOL_CATALOG,symbolDefinition,createDocument,addSymbol,updateSymbol,deleteSymbol,
    endpointPoint,orthogonalPoints,connect,removeWire,insertSeries,insertParallel,
    createTemplate,validateDocument,serializeDocument,deserializeDocument
  };
});
