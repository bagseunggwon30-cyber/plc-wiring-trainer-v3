(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.PLCTrainerMultiViewCore=api;
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';

  const pair=(id,kind,label,a,b,extra={})=>({id,kind,label,terminals:[a,b],...extra});
  const block=(id,label,terminals,extra={})=>({id,kind:'block',label,terminals:[...terminals],...extra});
  const unique=a=>[...new Set((a||[]).filter(Boolean))];

  function deviceTag(devId,dev={},def={}){
    const role=dev.role||dev.label||'';
    if(role)return String(role).replace(/\s+/g,' ').trim();
    const short=String(devId||'').replace(/^d/i,'D');
    return `${def.label||dev.type||'DEV'} ${short}`.trim();
  }

  function termLabel(def,termId){
    const t=(def?.terminals||[]).find(x=>String(x.id)===String(termId));
    return t?.label||String(termId);
  }

  function existingTermSet(def){return new Set((def?.terminals||[]).map(t=>String(t.id)));}
  function addIfValid(out,def,item){
    const valid=existingTermSet(def);
    if(item.terminals.every(t=>valid.has(String(t))))out.push(item);
  }

  function sequenceElementsForDevice(devId,dev={},def={},options={}){
    const type=dev.type||'';
    const tag=deviceTag(devId,dev,def);
    const out=[];
    const add=item=>addIfValid(out,def,item);
    const NO=(id,label,a,b,extra={})=>add(pair(id,'contact-no',label,a,b,extra));
    const NC=(id,label,a,b,extra={})=>add(pair(id,'contact-nc',label,a,b,extra));
    const COIL=(id,label,a,b,extra={})=>add(pair(id,'coil',label,a,b,extra));
    const LOAD=(id,label,a,b,extra={})=>add(pair(id,'load',label,a,b,extra));
    const CHANGE=(id,label,c,no,nc,extra={})=>add({id,kind:'contact-changeover',label,terminals:[c,no,nc],...extra});

    if(type==='PB-1C'){
      NO('no',`${tag} NO`,'11','12',{deviceKind:'pushbutton'});
      NC('nc',`${tag} NC`,'21','22',{deviceKind:'pushbutton'});
    }else if(type==='PB-NO'){
      NO('no',tag,'1','2',{deviceKind:'pushbutton'});
    }else if(type==='PB-NC'){
      NC('nc',tag,'1','2',{deviceKind:'pushbutton'});
    }else if(type==='LIMIT'){
      NC('nc',`${tag} NC`,'1','2',{deviceKind:'limit'});
      NO('no',`${tag} NO`,'3','4',{deviceKind:'limit'});
    }else if(type==='SEL-2P'){
      NO('no',`${tag} NO`,'11','12',{deviceKind:'selector'});
      NC('nc',`${tag} NC`,'21','22',{deviceKind:'selector'});
    }else if(type==='SEL-3P'){
      NO('left',`${tag} A`,'C1','A',{deviceKind:'selector'});
      NO('right',`${tag} M`,'C2','M',{deviceKind:'selector'});
    }else if(type==='MC'||type==='MC-22B-DC24'){
      COIL('coil',`${tag} COIL`,'A1','A2',{deviceKind:'contactor'});
      NO('aux-no',`${tag} 13-14`,'13','14',{deviceKind:'contactor'});
      NC('aux-nc',`${tag} 21-22`,'21','22',{deviceKind:'contactor'});
      NO('main-1',`${tag} L1-T1`,'1L1','2T1',{deviceKind:'main-contact'});
      NO('main-2',`${tag} L2-T2`,'3L2','4T2',{deviceKind:'main-contact'});
      NO('main-3',`${tag} L3-T3`,'5L3','6T3',{deviceKind:'main-contact'});
    }else if(type==='MY2N'){
      COIL('coil',`${tag} COIL`,'13','14',{deviceKind:'relay'});
      CHANGE('c1',`${tag} C1`,'9','1','5',{deviceKind:'relay'});
      CHANGE('c2',`${tag} C2`,'12','4','8',{deviceKind:'relay'});
    }else if(type==='TIMER'||type==='FLICKER'){
      COIL('coil',`${tag} COIL`,'2','7',{deviceKind:type==='TIMER'?'timer':'flicker'});
      CHANGE('c1',`${tag} 1/3/4`,'1','3','4',{deviceKind:'timer-contact'});
      CHANGE('c2',`${tag} 8/6/5`,'8','6','5',{deviceKind:'timer-contact'});
    }else if(type==='EOCR'||type==='EOCR3DE-05DUH'){
      COIL('coil',`${tag} POWER`,'A1','A2',{deviceKind:'protection'});
      NC('trip-nc',`${tag} 95-96`,'95','96',{deviceKind:'protection'});
      if(existingTermSet(def).has('98'))NO('trip-no',`${tag} 97-98`,'97','98',{deviceKind:'protection'});
      if(existingTermSet(def).has('08'))NO('alarm',`${tag} 07-08`,'07','08',{deviceKind:'protection'});
    }else if(/^LAMP/.test(type)||type==='LAMP'){
      LOAD('lamp',tag,'+','-',{deviceKind:'lamp'});
    }else if(type==='BUZZER'){
      const ids=(def.terminals||[]).map(t=>t.id);
      if(ids.includes('+')&&ids.includes('-'))LOAD('buzzer',tag,'+','-',{deviceKind:'buzzer'});
      else if(ids.length>=2)LOAD('buzzer',tag,ids[0],ids[1],{deviceKind:'buzzer'});
    }else if(type==='SOL-Y'){
      COIL('coil',tag,'A1','A2',{deviceKind:'solenoid'});
    }else if(type==='MDR-100'||type==='PSU24'||type==='MCCB1P'||type==='MCCB'||type.startsWith('TB-')){
      out.push(block('power',tag,(def.terminals||[]).map(t=>t.id),{deviceKind:'power'}));
    }

    const mapped=new Set(out.flatMap(e=>e.terminals.map(String)));
    const connected=options.connectedTerminals?new Set(options.connectedTerminals.map(String)):null;
    const terms=(def.terminals||[]).map(t=>String(t.id));
    const remaining=terms.filter(t=>!mapped.has(t) && (!connected || connected.has(t)));
    const shouldFallback=out.length===0 || remaining.length>0;
    if(shouldFallback){
      let fallback=remaining;
      // 시퀀스 보기에서도 모든 실제 단자를 연결할 수 있어야 하므로 generic/PLC 블록은 누락 없이 분할한다.
      if(out.length===0)fallback=terms;
      const chunkSize=18;
      for(let i=0;i<fallback.length;i+=chunkSize){
        const part=fallback.slice(i,i+chunkSize);
        const suffix=fallback.length>chunkSize?` ${Math.floor(i/chunkSize)+1}`:'';
        out.push(block(`io-${Math.floor(i/chunkSize)+1}`,`${tag} I/O${suffix}`,part,{deviceKind:def.cat||'generic',compact:true}));
      }
    }
    return out;
  }

  function schematicNodeForDevice(devId,dev={},def={}){
    const terms=(def.terminals||[]).map(t=>({id:String(t.id),label:t.label||String(t.id),pol:t.pol||'',side:t.side||'R'}));
    return {id:devId,label:deviceTag(devId,dev,def),type:dev.type,category:def.cat||'',terminals:terms};
  }

  function connectedTermsForDevice(devId,wires=[]){
    const s=new Set();
    for(const w of wires||[]){
      if(w?.from?.dev===devId)s.add(String(w.from.term));
      if(w?.to?.dev===devId)s.add(String(w.to.term));
    }
    return [...s];
  }

  function filterSequenceElements(elements=[],options={}){
    if(!options.controlOnly)return [...elements];
    return elements.filter(item=>item?.deviceKind!=='main-contact');
  }

  function powerElementsForDevice(devId,dev={},def={}){
    const type=dev.type||'';
    const tag=deviceTag(devId,dev,def);
    const valid=existingTermSet(def);
    const out=[];
    const add=(id,kind,label,poles,extra={})=>{
      const terminals=(poles.every(pole=>pole.length===2)
        ? [...poles.map(pole=>pole[0]),...poles.map(pole=>pole[1])]
        : poles.flat()).map(String);
      if(terminals.every(term=>valid.has(term)))out.push({id,kind,label,terminals,poles:poles.map(pair=>pair.map(String)),...extra});
    };
    if(type==='MCCB'){
      add('power','breaker-3p',`${tag} · 3P`,[['L1','T1'],['L2','T2'],['L3','T3']],{deviceKind:'power-protection'});
    }else if(type==='MCCB1P'){
      add('power','breaker-2p',`${tag} · L/N`,[['L',"L'"],['N',"N'"]],{deviceKind:'power-protection'});
    }else if(type==='FUSE'){
      add('power','fuse-2p',`${tag} · L/N`,[['L-IN','L-OUT'],['N-IN','N-OUT']],{deviceKind:'power-protection'});
    }else if(type==='FUSE-1'){
      add('power','fuse-1p',tag,[['IN','OUT']],{deviceKind:'power-protection'});
    }else if(type==='MC'||type==='MC-22B-DC24'){
      add('power','contactor-3p',`${tag} · 3극`,[['1L1','2T1'],['3L2','4T2'],['5L3','6T3']],{deviceKind:'power-switch'});
    }else if(type==='EOCR'){
      add('power','overload-3p',`${tag} · R/S/T`,[['R-IN','R-OUT'],['S-IN','S-OUT'],['T-IN','T-OUT']],{deviceKind:'power-protection'});
    }else if(type==='EOCR3DE-05DUH'){
      add('power','overload-3p',`${tag} · L1/L2/L3`,[['L1-IN','L1-OUT'],['L2-IN','L2-OUT'],['L3-IN','L3-OUT']],{deviceKind:'power-protection'});
    }else if(type==='MOTOR-3P'){
      const phases=['U','V','W'];
      if(phases.every(term=>valid.has(term))){
        const terminals=valid.has('PE')?[...phases,'PE']:phases;
        out.push({id:'power',kind:'motor-3p',label:`${tag} · M 3~`,terminals,poles:phases.map(term=>[term]),deviceKind:'power-load'});
      }
    }else if(type==='GND-BAR'||type==='TB-PE-10'||type==='UT-2.5-PE'){
      const terminals=(def.terminals||[]).filter(term=>term.pol==='PE').map(term=>String(term.id));
      if(terminals.length)out.push({id:'earth',kind:'earth',label:`${tag} · PE`,terminals,poles:terminals.map(term=>[term]),deviceKind:'protective-earth'});
    }else if(type==='MDR-100'||type==='PSU24'||type==='TB-N-10'||type==='TB-PE-10'){
      out.push(block('power',tag,(def.terminals||[]).map(term=>term.id),{deviceKind:'power'}));
    }
    return out;
  }

  function combinedSequenceElementsForDevice(devId,dev={},def={},options={}){
    const power=powerElementsForDevice(devId,dev,def);
    const control=filterSequenceElements(
      sequenceElementsForDevice(devId,dev,def,options),
      {controlOnly:true}
    ).filter(item=>item.deviceKind!=='power');
    return [...power,...control];
  }

  function buildSequenceCatalog(devices={},library={},wires=[],options={}){
    const groups=[];
    for(const [deviceId,device] of Object.entries(devices||{})){
      const definition=library?.[device?.type];
      if(!definition)continue;
      const connectedTerminals=connectedTermsForDevice(deviceId,wires);
      const elements=options.mode==='power'
        ? powerElementsForDevice(deviceId,device,definition)
        : options.mode==='combined'
          ? combinedSequenceElementsForDevice(deviceId,device,definition,{connectedTerminals})
          : filterSequenceElements(sequenceElementsForDevice(deviceId,device,definition,{connectedTerminals}),options);
      if(!elements.length)continue;
      groups.push({
        deviceId,
        type:device.type,
        label:deviceTag(deviceId,device,definition),
        category:definition.cat||'',
        elements:elements.map(element=>({
          id:element.id,
          key:`${deviceId}::${element.id}`,
          kind:element.kind,
          label:element.label,
          terminals:[...element.terminals]
        }))
      });
    }
    return groups;
  }

  function buildIoRows(devices={},library={},wires=[],rackAddressResolver){
    const rows=[];
    for(const [id,dev] of Object.entries(devices||{})){
      const def=library[dev.type]; if(!def)continue;
      for(const t of def.terminals||[]){
        const pol=String(t.pol||'');
        if(!['DI','DO','AI','AO','AI-COM','AO-COM','IO-COM'].includes(pol) && !/^P[02][0-9A-F]$/i.test(String(t.id)))continue;
        const links=[];
        for(const w of wires||[]){
          if(w?.from?.dev===id&&String(w.from.term)===String(t.id))links.push(`${w.to.dev}.${w.to.term}`);
          else if(w?.to?.dev===id&&String(w.to.term)===String(t.id))links.push(`${w.from.dev}.${w.from.term}`);
        }
        let address='';
        if(typeof rackAddressResolver==='function'){
          try{address=rackAddressResolver(id,String(t.id))||'';}catch(_){address='';}
        }
        rows.push({deviceId:id,deviceLabel:def.label||dev.type,terminal:String(t.id),terminalLabel:t.label||String(t.id),pol,address,links});
      }
    }
    return rows;
  }

  function routeOrthogonal(a,b,midBias=0.5){
    const mid=a.x+(b.x-a.x)*midBias;
    return `M ${a.x} ${a.y} L ${mid} ${a.y} L ${mid} ${b.y} L ${b.x} ${b.y}`;
  }

  function normalizeDiagramLayouts(value){
    const base={schematic:{},sequence:{}};
    if(!value||typeof value!=='object')return base;
    for(const k of ['schematic','sequence']){
      const src=value[k];
      if(!src||typeof src!=='object')continue;
      for(const [id,p] of Object.entries(src)){
        if(Number.isFinite(Number(p?.x))&&Number.isFinite(Number(p?.y)))base[k][id]={x:Number(p.x),y:Number(p.y)};
      }
    }
    return base;
  }

  return {
    deviceTag,termLabel,sequenceElementsForDevice,schematicNodeForDevice,
    connectedTermsForDevice,filterSequenceElements,powerElementsForDevice,combinedSequenceElementsForDevice,buildSequenceCatalog,
    buildIoRows,routeOrthogonal,normalizeDiagramLayouts,unique
  };
});
