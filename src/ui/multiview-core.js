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
    }else if(type==='MC'){
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
    }else if(type==='EOCR'){
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
    connectedTermsForDevice,buildIoRows,routeOrthogonal,normalizeDiagramLayouts,unique
  };
});
