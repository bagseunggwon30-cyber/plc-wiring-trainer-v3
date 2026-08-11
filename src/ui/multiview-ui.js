(function(){
  'use strict';
  if(typeof window==='undefined'||typeof document==='undefined')return;
  const Core=window.PLCTrainerMultiViewCore;
  if(!Core){console.error('PLCTrainerMultiViewCore missing');return;}

  const NS='http://www.w3.org/2000/svg';
  const MV={
    view:'panel', pending:null, selectedWire:null, drag:null, panning:null,
    pan:{schematic:{x:0,y:0,k:1},sequence:{x:0,y:0,k:1}},
    portMap:new Map(), nodeBounds:new Map(), showTags:true, showNetNames:true,
    showAllTerminals:true
  };
  const q=s=>document.querySelector(s);
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const svg=(tag,attrs={},text)=>{
    const e=document.createElementNS(NS,tag);
    for(const [k,v] of Object.entries(attrs)){
      if(v==null)continue;
      if(k==='className')e.setAttribute('class',v); else e.setAttribute(k,String(v));
    }
    if(text!=null)e.textContent=String(text);
    return e;
  };

  function ensureState(){
    S.diagramLayouts=Core.normalizeDiagramLayouts(S.diagramLayouts);
    if(!S.workspaceView)S.workspaceView='panel';
  }
  function injectCss(){
    const st=document.createElement('style');
    st.id='mv-style';
    st.textContent=`
      #mv-view-group{display:inline-flex;align-items:center;gap:2px;padding:2px 4px;border:1px solid #28465f;background:#101b24;border-radius:4px}
      #mv-view-group .mv-view-btn.active{background:#1769aa;border-color:#4aa3df;color:#fff}
      #mv-stage{display:none;position:absolute;inset:0;background:#f8f8f3;overflow:hidden;z-index:12}
      #mv-stage.show{display:block}
      #mv-svg{display:block;width:100%;height:100%;background:#fff;cursor:default;touch-action:none}
      #mv-toolbar{position:absolute;left:10px;top:10px;z-index:4;display:flex;gap:4px;align-items:center;padding:5px 6px;border-radius:5px;background:rgba(21,28,35,.94);box-shadow:0 2px 10px rgba(0,0,0,.25);color:#ddd;font-size:11px}
      #mv-toolbar button{background:#303840;color:#ddd;border:1px solid #56616b;border-radius:3px;padding:3px 7px;cursor:pointer;font-size:11px}
      #mv-toolbar button:hover,#mv-toolbar button.active{background:#1769aa;color:#fff;border-color:#4aa3df}
      #mv-hint{position:absolute;left:10px;bottom:10px;z-index:4;max-width:min(720px,70%);padding:5px 8px;border-radius:4px;background:rgba(15,20,25,.88);color:#ddd;font-size:10px;pointer-events:none}
      #mv-io{display:none;position:absolute;inset:0;overflow:auto;background:#f7f7f7;color:#222;padding:54px 18px 30px}
      #mv-io.show{display:block}
      #mv-io table{width:100%;border-collapse:collapse;font-family:Consolas,'Malgun Gothic',monospace;font-size:11px;background:#fff}
      #mv-io th{position:sticky;top:0;background:#263746;color:#fff;z-index:2}
      #mv-io th,#mv-io td{border:1px solid #c9ced3;padding:5px 7px;text-align:left}
      #mv-io tr:nth-child(even){background:#f3f6f8}
      .mv-node .mv-box{fill:#fcfcfa;stroke:#3a4a56;stroke-width:1.5}
      .mv-node.selected .mv-box{stroke:#f60;stroke-width:2.5}
      .mv-node-head{fill:#324b5e;cursor:move}
      .mv-node-title{fill:#fff;font-size:12px;font-weight:700;pointer-events:none}
      .mv-node-sub{fill:#50606a;font-size:9px;pointer-events:none}
      .mv-port{fill:#fff;stroke:#111;stroke-width:1.6;cursor:crosshair}
      .mv-port:hover,.mv-port.pending{fill:#ffd54a;stroke:#e26900;stroke-width:2.6}
      .mv-port.live{fill:#fff45c;filter:drop-shadow(0 0 4px #fc0)}
      .mv-term-label{fill:#222;font-family:Consolas,'Cascadia Mono',monospace;font-size:9px;pointer-events:none}
      .mv-wire-hit{fill:none;stroke:transparent;stroke-width:12;cursor:pointer}
      .mv-wire{fill:none;stroke-width:2.3;pointer-events:none}
      .mv-wire.sel{stroke:#ff7b00!important;stroke-width:4}
      .mv-wire.live{stroke-dasharray:9 6;animation:mvflow .7s linear infinite}
      @keyframes mvflow{to{stroke-dashoffset:-30}}
      .mv-wire-label-bg{fill:#fff;stroke:#999;stroke-width:.7;opacity:.92}
      .mv-wire-label{font:9px Consolas,monospace;fill:#222;pointer-events:none}
      .mv-contact-line,.mv-symbol-line{stroke:#111;stroke-width:2;fill:none;pointer-events:none}
      .mv-symbol-active .mv-contact-line,.mv-symbol-active .mv-symbol-line{stroke:#e28b00;stroke-width:3}
      .mv-symbol-label{font-size:10px;fill:#23313b;font-weight:700;pointer-events:none;text-anchor:middle}
      .mv-ladder-rail{stroke:#aa2222;stroke-width:3;fill:none}
      .mv-ladder-label{font-size:11px;fill:#a22;font-weight:700}
      .mv-grid-minor{stroke:#ecebe5;stroke-width:1}.mv-grid-major{stroke:#ddd9ce;stroke-width:1}
      body.mv-diagram #palette{background:#16222b}
      body.mv-palletizer-mode{grid-template-columns:0 minmax(0,1fr) 0!important;overflow:hidden}
      body.mv-palletizer-mode header{min-width:0;max-width:100vw;overflow-x:hidden}
      body.mv-palletizer-mode #palette,body.mv-palletizer-mode #right{visibility:hidden!important}
      body.mv-palletizer-mode #stage{min-width:0;min-height:0}
    `;
    document.head.appendChild(st);
  }

  function injectUi(){
    if(q('#mv-stage'))return;
    const header=q('header');
    const badge=q('.edu-badge');
    const group=document.createElement('span');
    group.id='mv-view-group';
    group.innerHTML='<span style="color:#8fb3c9;font-size:10px">보기</span>'+
      '<button class="mv-view-btn active" data-view="panel" title="실물 제어반 배치와 단자 결선">🧰 실물</button>'+
      '<button class="mv-view-btn" data-view="schematic" title="종이 결선도처럼 장비 심볼과 단자를 연결">📄 결선도</button>'+
      '<button class="mv-view-btn" data-view="sequence" title="NO/NC/코일 중심 시퀀스 회로">🔁 시퀀스</button>'+
      '<button class="mv-view-btn" data-view="io" title="PLC I/O 주소와 연결표">I/O</button>'+
      '<button class="mv-view-btn" data-view="palletizer" title="3축 팔레타이징·2축 서보·MPS·공압 제어 실습">🏭 자동화 실습실</button>';
    if(badge?.nextSibling)header.insertBefore(group,badge.nextSibling); else header.appendChild(group);

    const stage=q('#stage');
    const wrap=document.createElement('div');
    wrap.id='mv-stage';
    wrap.innerHTML=`
      <div id="mv-toolbar">
        <b id="mv-title">결선도</b>
        <button id="mv-fit">⛶ 맞춤</button>
        <button id="mv-auto">↺ 자동배치</button>
        <button id="mv-tags" class="active"># 선번</button>
        <button id="mv-nets" class="active">NET</button>
        <button id="mv-delete">⌫ 선택선 삭제</button>
        <button id="mv-print">🖨 인쇄</button>
      </div>
      <svg id="mv-svg" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <pattern id="mv-small-grid" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0H0V20" fill="none" class="mv-grid-minor"/></pattern>
          <pattern id="mv-big-grid" width="100" height="100" patternUnits="userSpaceOnUse"><rect width="100" height="100" fill="url(#mv-small-grid)"/><path d="M100 0H0V100" fill="none" class="mv-grid-major"/></pattern>
        </defs>
        <rect id="mv-bg" x="-5000" y="-5000" width="20000" height="20000" fill="url(#mv-big-grid)"/>
        <g id="mv-world"><g id="mv-wires"></g><g id="mv-nodes"></g><g id="mv-overlay"></g></g>
      </svg>
      <div id="mv-io"></div>
      <div id="mv-palletizer"></div>
      <div id="mv-hint">단자 ○ 클릭 → 다른 단자 ○ 클릭 = 실제 제어반의 같은 와이어가 생성됩니다. 심볼 제목을 드래그하면 종이 배치만 이동합니다.</div>`;
    stage.appendChild(wrap);

    group.querySelectorAll('.mv-view-btn').forEach(b=>b.onclick=()=>setView(b.dataset.view));
    q('#mv-fit').onclick=()=>fitCurrent();
    q('#mv-auto').onclick=()=>{resetCurrentLayout();renderActive();fitCurrent();};
    q('#mv-tags').onclick=()=>{MV.showTags=!MV.showTags;q('#mv-tags').classList.toggle('active',MV.showTags);renderActive();};
    q('#mv-nets').onclick=()=>{MV.showNetNames=!MV.showNetNames;q('#mv-nets').classList.toggle('active',MV.showNetNames);renderActive();};
    q('#mv-delete').onclick=deleteSelectedWire;
    q('#mv-print').onclick=printCurrentView;
    installPointerHandlers();
  }

  function setView(view){
    ensureState();
    if(!['panel','schematic','sequence','io','palletizer'].includes(view))view='panel';
    MV.view=view; S.workspaceView=view;
    const canvas=q('#canvas'), wrap=q('#mv-stage'), io=q('#mv-io'), svgEl=q('#mv-svg'), palletizer=q('#mv-palletizer'), toolbar=q('#mv-toolbar'), hint=q('#mv-hint');
    canvas.style.display=view==='panel'?'block':'none';
    wrap.classList.toggle('show',view!=='panel');
    io.classList.toggle('show',view==='io');
    palletizer?.classList.toggle('show',view==='palletizer');
    svgEl.style.display=(view==='schematic'||view==='sequence')?'block':'none';
    toolbar.style.display=(view==='schematic'||view==='sequence')?'flex':'none';
    hint.style.display=(view==='schematic'||view==='sequence')?'block':'none';
    if(window.PLCTrainerAutomationLabs)window.PLCTrainerAutomationLabs.setVisible?.(view==='palletizer');
    else window.PLCTrainerPalletizer3D?.setVisible?.(view==='palletizer');
    document.body.classList.toggle('mv-diagram',view!=='panel');
    document.body.classList.toggle('mv-palletizer-mode',view==='palletizer');
    q('#mv-view-group')?.querySelectorAll('.mv-view-btn').forEach(b=>b.classList.toggle('active',b.dataset.view===view));
    if(view==='panel'){
      status('실물 제어반 보기 · 기존 장비/결선 편집');
      requestAnimationFrame(()=>{try{applyTransform();}catch(_){}});
      return;
    }
    MV.pending=null; MV.selectedWire=null;
    renderActive();
    if(view==='schematic'||view==='sequence')requestAnimationFrame(()=>fitCurrent(false));
    const title=view==='schematic'?'종이 결선도':view==='sequence'?'시퀀스 회로':view==='io'?'PLC I/O 연결표':'자동화 제어 실습실';
    status(view==='palletizer'?`${title} · 3축/2축 서보 · MPS · 공압 · LS/Mitsubishi 내부 주소 이미지`:`${title} 보기 · 같은 S.wires Netlist와 실시간 동기화`);
  }

  function currentLayout(){ensureState();return S.diagramLayouts[MV.view]||{};}
  function itemKey(devId,itemId){return `${devId}::${itemId}`;}
  function layoutPoint(key,defX,defY){
    const lay=currentLayout();
    if(!lay[key])lay[key]={x:defX,y:defY};
    return lay[key];
  }

  function schematicModels(){
    return Object.entries(S.devices).map(([id,d])=>({devId:id,dev:d,def:LIB[d.type],model:Core.schematicNodeForDevice(id,d,LIB[d.type]||{})})).filter(x=>x.def);
  }
  function schematicSize(model){
    const n=model.terminals.length;
    const per=Math.ceil(n/2);
    return {w:280,h:Math.max(110,54+per*20)};
  }
  function ensureSchematicLayout(models){
    const lay=S.diagramLayouts.schematic;
    const cols=3,gapX=90,gapY=70,startX=100,startY=90;
    let y=startY;
    for(let r=0;r<Math.ceil(models.length/cols);r++){
      const row=models.slice(r*cols,r*cols+cols);
      const maxH=Math.max(130,...row.map(x=>schematicSize(x.model).h));
      row.forEach((x,c)=>{if(!lay[x.devId])lay[x.devId]={x:startX+c*(280+gapX),y};});
      y+=maxH+gapY;
    }
  }

  function drawPort(g,devId,termId,x,y,label,side,pol){
    const key=`${devId}.${termId}`;
    MV.portMap.set(key,{x,y,dev:devId,term:String(termId)});
    const live=typeof SIM!=='undefined'&&SIM.liveTerms?.has?.(key);
    const c=svg('circle',{cx:x,cy:y,r:6,className:`mv-port${MV.pending&&MV.pending.dev===devId&&String(MV.pending.term)===String(termId)?' pending':''}${live?' live':''}`});
    c.dataset.dev=devId;c.dataset.term=termId;c.dataset.port='1';
    g.appendChild(c);
    const tx=side==='L'?x+10:x-10;
    const anchor=side==='L'?'start':'end';
    g.appendChild(svg('text',{x:tx,y:y+3,'text-anchor':anchor,className:'mv-term-label'},`${termId}${pol?` · ${pol}`:''}`));
    const tt=document.createElementNS(NS,'title');tt.textContent=`${label||termId} · ${pol||'일반'} · ${devId}.${termId}`;c.appendChild(tt);
  }

  function renderSchematic(){
    const nodeG=q('#mv-nodes'), wireG=q('#mv-wires'); nodeG.innerHTML='';wireG.innerHTML='';MV.portMap.clear();MV.nodeBounds.clear();
    const models=schematicModels();ensureSchematicLayout(models);
    for(const {devId,dev,def,model} of models){
      const p=layoutPoint(devId,100,100), size=schematicSize(model), g=svg('g',{className:'mv-node'});g.dataset.key=devId;g.dataset.dev=devId;
      g.appendChild(svg('rect',{x:p.x,y:p.y,width:size.w,height:size.h,rx:5,className:'mv-box'}));
      const head=svg('rect',{x:p.x,y:p.y,width:size.w,height:30,rx:5,className:'mv-node-head'});head.dataset.dragKey=devId;g.appendChild(head);
      g.appendChild(svg('text',{x:p.x+10,y:p.y+20,className:'mv-node-title'},model.label));
      g.appendChild(svg('text',{x:p.x+size.w-8,y:p.y+20,'text-anchor':'end',className:'mv-node-title'},dev.type));
      const terms=model.terminals, half=Math.ceil(terms.length/2), left=terms.slice(0,half),right=terms.slice(half);
      left.forEach((t,i)=>drawPort(g,devId,t.id,p.x,p.y+47+i*20,t.label,'L',t.pol));
      right.forEach((t,i)=>drawPort(g,devId,t.id,p.x+size.w,p.y+47+i*20,t.label,'R',t.pol));
      nodeG.appendChild(g);MV.nodeBounds.set(devId,{x:p.x,y:p.y,w:size.w,h:size.h});
    }
    drawSharedWires(wireG);
    q('#mv-title').textContent='📄 종이 결선도';
    q('#mv-hint').textContent='장비 블록의 실제 단자 ○를 연결합니다. 여기서 만든 와이어는 실물 제어반과 시퀀스 보기에도 즉시 동일하게 생깁니다.';
  }

  function sequenceItems(){
    const arr=[];
    for(const [devId,dev] of Object.entries(S.devices)){
      const def=LIB[dev.type];if(!def)continue;
      const connected=Core.connectedTermsForDevice(devId,S.wires);
      const elems=Core.sequenceElementsForDevice(devId,dev,def,{connectedTerminals:connected});
      for(const el of elems)arr.push({devId,dev,def,el,key:itemKey(devId,el.id)});
    }
    return arr;
  }
  function seqSize(item){
    if(item.el.kind==='block'){
      const half=Math.ceil(item.el.terminals.length/2);
      return {w:260,h:Math.max(85,50+half*19)};
    }
    return {w:190,h:82};
  }
  function ensureSequenceLayout(items){
    const lay=S.diagramLayouts.sequence;const cols=4,startX=120,startY=110,gapX=70,gapY=55;
    let y=startY;
    for(let r=0;r<Math.ceil(items.length/cols);r++){
      const row=items.slice(r*cols,r*cols+cols);const maxH=Math.max(90,...row.map(seqSize).map(s=>s.h));
      row.forEach((it,c)=>{if(!lay[it.key])lay[it.key]={x:startX+c*(190+gapX),y};});
      y+=maxH+gapY;
    }
  }
  function elementActive(item){
    if(typeof SIM==='undefined'||!SIM.on)return false;
    if(item.el.kind==='coil'&&SIM.coilState?.get?.(item.devId))return true;
    return item.el.terminals.some(t=>SIM.liveTerms?.has?.(`${item.devId}.${t}`));
  }
  function drawContactSymbol(g,p,size,item,nc){
    const y=p.y+46,x1=p.x+18,x2=p.x+size.w-18,m=size.w/2+p.x;
    g.appendChild(svg('line',{x1,y1:y,x2:m-13,y2:y,className:'mv-contact-line'}));
    g.appendChild(svg('line',{x1:m+13,y1:y,x2,y2:y,className:'mv-contact-line'}));
    g.appendChild(svg('line',{x1:m-13,y1:y-13,x2:m-13,y2:y+13,className:'mv-contact-line'}));
    g.appendChild(svg('line',{x1:m+13,y1:y-13,x2:m+13,y2:y+13,className:'mv-contact-line'}));
    if(nc)g.appendChild(svg('line',{x1:m-18,y1:y+15,x2:m+18,y2:y-15,className:'mv-contact-line'}));
  }
  function drawChangeoverSymbol(g,p,size,item){
    const x1=p.x+18,x2=p.x+size.w-18,y=p.y+46,m=p.x+size.w/2;
    g.appendChild(svg('line',{x1,y1:y,x2:m-12,y2:y,className:'mv-contact-line'}));
    g.appendChild(svg('circle',{cx:m-10,cy:y,r:2.5,fill:'#111'}));
    g.appendChild(svg('circle',{cx:m+20,cy:y-12,r:2.5,fill:'#111'}));
    g.appendChild(svg('circle',{cx:m+20,cy:y+12,r:2.5,fill:'#111'}));
    g.appendChild(svg('line',{x1:m-8,y1:y-2,x2:m+17,y2:y-12,className:'mv-contact-line'}));
    g.appendChild(svg('line',{x1:m+22,y1:y-12,x2:x2,y2:y-12,className:'mv-contact-line'}));
    g.appendChild(svg('line',{x1:m+22,y1:y+12,x2:x2,y2:y+12,className:'mv-contact-line'}));
  }
  function drawCoilSymbol(g,p,size,item){
    const y=p.y+46,m=p.x+size.w/2;
    g.appendChild(svg('line',{x1:p.x+18,y1:y,x2:m-27,y2:y,className:'mv-symbol-line'}));
    g.appendChild(svg('path',{d:`M ${m-27} ${y} C ${m-14} ${y-22}, ${m-14} ${y+22}, ${m} ${y} C ${m+14} ${y-22}, ${m+14} ${y+22}, ${m+27} ${y}`,className:'mv-symbol-line'}));
    g.appendChild(svg('line',{x1:m+27,y1:y,x2:p.x+size.w-18,y2:y,className:'mv-symbol-line'}));
  }
  function drawLoadSymbol(g,p,size,item){
    const y=p.y+46,m=p.x+size.w/2;
    g.appendChild(svg('line',{x1:p.x+18,y1:y,x2:m-18,y2:y,className:'mv-symbol-line'}));
    g.appendChild(svg('circle',{cx:m,cy:y,r:18,className:'mv-symbol-line'}));
    g.appendChild(svg('line',{x1:m-12,y1:y-12,x2:m+12,y2:y+12,className:'mv-symbol-line'}));
    g.appendChild(svg('line',{x1:m-12,y1:y+12,x2:m+12,y2:y-12,className:'mv-symbol-line'}));
    g.appendChild(svg('line',{x1:m+18,y1:y,x2:p.x+size.w-18,y2:y,className:'mv-symbol-line'}));
  }
  function renderSequence(){
    const nodeG=q('#mv-nodes'), wireG=q('#mv-wires');nodeG.innerHTML='';wireG.innerHTML='';MV.portMap.clear();MV.nodeBounds.clear();
    const items=sequenceItems();ensureSequenceLayout(items);
    // ladder reference rails
    nodeG.appendChild(svg('line',{x1:55,y1:45,x2:55,y2:Math.max(1200,items.length*80),className:'mv-ladder-rail'}));
    nodeG.appendChild(svg('text',{x:35,y:35,className:'mv-ladder-label'},'+24V'));
    for(const item of items){
      const p=layoutPoint(item.key,100,100),size=seqSize(item),active=elementActive(item),g=svg('g',{className:`mv-node${active?' mv-symbol-active':''}`});g.dataset.key=item.key;g.dataset.dev=item.devId;
      if(item.el.kind==='block'){
        g.appendChild(svg('rect',{x:p.x,y:p.y,width:size.w,height:size.h,rx:4,className:'mv-box'}));
        const head=svg('rect',{x:p.x,y:p.y,width:size.w,height:27,rx:4,className:'mv-node-head'});head.dataset.dragKey=item.key;g.appendChild(head);
        g.appendChild(svg('text',{x:p.x+8,y:p.y+18,className:'mv-node-title'},item.el.label));
        const terms=item.el.terminals,half=Math.ceil(terms.length/2);
        terms.slice(0,half).forEach((t,i)=>drawPort(g,item.devId,t,p.x,p.y+43+i*19,Core.termLabel(item.def,t),'L',(item.def.terminals||[]).find(x=>x.id===t)?.pol));
        terms.slice(half).forEach((t,i)=>drawPort(g,item.devId,t,p.x+size.w,p.y+43+i*19,Core.termLabel(item.def,t),'R',(item.def.terminals||[]).find(x=>x.id===t)?.pol));
      }else{
        g.appendChild(svg('rect',{x:p.x,y:p.y,width:size.w,height:size.h,rx:4,className:'mv-box'}));
        const head=svg('rect',{x:p.x,y:p.y,width:size.w,height:24,rx:4,className:'mv-node-head'});head.dataset.dragKey=item.key;g.appendChild(head);
        g.appendChild(svg('text',{x:p.x+size.w/2,y:p.y+17,className:'mv-symbol-label'},item.el.label));
        if(item.el.kind==='contact-no')drawContactSymbol(g,p,size,item,false);
        else if(item.el.kind==='contact-nc')drawContactSymbol(g,p,size,item,true);
        else if(item.el.kind==='contact-changeover')drawChangeoverSymbol(g,p,size,item);
        else if(item.el.kind==='coil')drawCoilSymbol(g,p,size,item);
        else if(item.el.kind==='load')drawLoadSymbol(g,p,size,item);
        if(item.el.kind==='contact-changeover'){
          const [c,no,nc]=item.el.terminals;
          drawPort(g,item.devId,c,p.x+8,p.y+46,Core.termLabel(item.def,c),'L',(item.def.terminals||[]).find(x=>x.id===c)?.pol);
          drawPort(g,item.devId,no,p.x+size.w-8,p.y+34,Core.termLabel(item.def,no),'R',(item.def.terminals||[]).find(x=>x.id===no)?.pol);
          drawPort(g,item.devId,nc,p.x+size.w-8,p.y+58,Core.termLabel(item.def,nc),'R',(item.def.terminals||[]).find(x=>x.id===nc)?.pol);
        }else{
          const [a,b]=item.el.terminals;
          drawPort(g,item.devId,a,p.x+8,p.y+46,Core.termLabel(item.def,a),'L',(item.def.terminals||[]).find(x=>x.id===a)?.pol);
          drawPort(g,item.devId,b,p.x+size.w-8,p.y+46,Core.termLabel(item.def,b),'R',(item.def.terminals||[]).find(x=>x.id===b)?.pol);
        }
      }
      nodeG.appendChild(g);MV.nodeBounds.set(item.key,{x:p.x,y:p.y,w:size.w,h:size.h});
    }
    drawSharedWires(wireG);
    q('#mv-title').textContent='🔁 시퀀스 회로';
    q('#mv-hint').textContent='NO/NC/코일은 실제 장비 단자 ID와 연결되어 있습니다. 접점 심볼에서 만든 선도 실물 제어반의 동일 단자 와이어가 됩니다.';
  }

  function wireNetLabel(wire){
    if(!MV.showNetNames)return '';
    let nets=[];try{nets=lastNets?.length?lastNets:buildNets();}catch(_){nets=[];}
    const net=nets.find(n=>n.wires?.includes?.(wire.id));
    if(!net)return '';
    const pol=[...new Set(net.members.map(m=>m.pol).filter(Boolean))].slice(0,2).join('/');
    return pol?` · ${pol}`:` · NET${nets.indexOf(net)+1}`;
  }
  function drawSharedWires(group){
    for(const w of S.wires){
      const a=MV.portMap.get(`${w.from.dev}.${w.from.term}`),b=MV.portMap.get(`${w.to.dev}.${w.to.term}`);if(!a||!b)continue;
      const d=Core.routeOrthogonal(a,b);const hit=svg('path',{d,className:'mv-wire-hit'});hit.dataset.wire=w.id;group.appendChild(hit);
      const live=typeof SIM!=='undefined'&&SIM.on&&(SIM.liveTerms?.has?.(`${w.from.dev}.${w.from.term}`)||SIM.liveTerms?.has?.(`${w.to.dev}.${w.to.term}`));
      const line=svg('path',{d,className:`mv-wire${MV.selectedWire===w.id?' sel':''}${live?' live':''}`,stroke:w.color||'#333'});group.appendChild(line);
      if(MV.showTags||MV.showNetNames){
        const mx=(a.x+b.x)/2,my=(a.y+b.y)/2;const txt=`${MV.showTags?(w.tag||w.id):''}${wireNetLabel(w)}`.trim();
        if(txt){const ww=Math.max(38,txt.length*6+8);group.appendChild(svg('rect',{x:mx-ww/2,y:my-9,width:ww,height:15,rx:3,className:'mv-wire-label-bg'}));group.appendChild(svg('text',{x:mx,y:my+2,'text-anchor':'middle',className:'mv-wire-label'},txt));}
      }
    }
  }

  function renderIo(){
    const rack=window.PLCTrainerRack;
    const rows=Core.buildIoRows(S.devices,LIB,S.wires,(devId,term)=>rack?.terminalAddress?.(S.devices[devId],term));
    const container=q('#mv-io');
    if(!rows.length){container.innerHTML='<div style="padding:30px;color:#667">PLC I/O 장비를 배치하면 주소·단자·연결 상대가 여기에 표시됩니다.</div>';return;}
    container.innerHTML=`<h2 style="margin:0 0 10px">PLC I/O / 단자 연결표</h2><div style="margin-bottom:8px;color:#566">실물/결선도/시퀀스와 같은 데이터입니다. XG5000 연동 시 이 주소표를 Bridge 매핑 기준으로 사용할 수 있습니다.</div><table><thead><tr><th>장비</th><th>주소</th><th>단자</th><th>종류</th><th>연결 상대</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.deviceLabel)}<br><small>${esc(r.deviceId)}</small></td><td><b>${esc(r.address||'-')}</b></td><td>${esc(r.terminal)}<br><small>${esc(r.terminalLabel)}</small></td><td>${esc(r.pol)}</td><td>${r.links.length?r.links.map(esc).join('<br>'):'-'}</td></tr>`).join('')}</tbody></table>`;
  }

  function renderActive(){
    ensureState();
    if(MV.view==='panel'||S.workspaceView==='panel')return;
    if(MV.view!==S.workspaceView)MV.view=S.workspaceView;
    if(MV.view==='schematic')renderSchematic();
    else if(MV.view==='sequence')renderSequence();
    else if(MV.view==='io')renderIo();
    else if(MV.view==='palletizer'){
      if(window.PLCTrainerAutomationLabs)window.PLCTrainerAutomationLabs.renderActive?.();
      else window.PLCTrainerPalletizer3D?.renderActive?.();
    }
    if(MV.view==='schematic'||MV.view==='sequence')applyDiagramViewBox();
  }

  function clientWorld(ev){
    const el=q('#mv-svg'),r=el.getBoundingClientRect(),p=MV.pan[MV.view]||{x:0,y:0,k:1};
    return {x:p.x+(ev.clientX-r.left)/p.k,y:p.y+(ev.clientY-r.top)/p.k};
  }
  function applyDiagramViewBox(){
    if(MV.view!=='schematic'&&MV.view!=='sequence')return;
    const el=q('#mv-svg'),r=el.getBoundingClientRect(),p=MV.pan[MV.view];if(r.width<10||r.height<10)return;
    el.setAttribute('viewBox',`${p.x} ${p.y} ${r.width/p.k} ${r.height/p.k}`);
  }
  function fitCurrent(animated=true){
    if(MV.view==='io'||MV.view==='panel'||MV.view==='palletizer')return;
    const bounds=[...MV.nodeBounds.values()];if(!bounds.length){MV.pan[MV.view]={x:0,y:0,k:1};applyDiagramViewBox();return;}
    const minX=Math.min(...bounds.map(b=>b.x))-70,minY=Math.min(...bounds.map(b=>b.y))-70,maxX=Math.max(...bounds.map(b=>b.x+b.w))+70,maxY=Math.max(...bounds.map(b=>b.y+b.h))+70;
    const el=q('#mv-svg'),r=el.getBoundingClientRect();const k=Math.max(.18,Math.min(2.2,r.width/(maxX-minX),r.height/(maxY-minY)));
    MV.pan[MV.view]={x:minX,y:minY,k};applyDiagramViewBox();
  }
  function resetCurrentLayout(){
    if(MV.view==='schematic')S.diagramLayouts.schematic={};
    if(MV.view==='sequence')S.diagramLayouts.sequence={};
  }

  function portClick(dev,term){
    if(!S.devices[dev]||!LIB[S.devices[dev].type])return;
    if(!MV.pending){MV.pending={dev,term};status(`도면 결선 시작: ${LIB[S.devices[dev].type].label}.${Core.termLabel(LIB[S.devices[dev].type],term)}`);renderActive();return;}
    if(MV.pending.dev===dev&&String(MV.pending.term)===String(term)){MV.pending=null;status('도면 결선 취소');renderActive();return;}
    const duplicate=S.wires.some(w=>(w.from.dev===MV.pending.dev&&String(w.from.term)===String(MV.pending.term)&&w.to.dev===dev&&String(w.to.term)===String(term))||(w.to.dev===MV.pending.dev&&String(w.to.term)===String(MV.pending.term)&&w.from.dev===dev&&String(w.from.term)===String(term)));
    if(duplicate){status('이미 같은 두 단자 사이에 와이어가 있습니다');MV.pending=null;renderActive();return;}
    const from={...MV.pending};MV.pending=null;
    connectTerms(from,{dev,term},MV.view==='sequence'?'시퀀스 결선':'도면 결선');
    renderActive();
  }
  function deleteSelectedWire(){
    if(!MV.selectedWire){status('도면에서 삭제할 와이어를 먼저 클릭하세요');return;}
    if(!S.wires.some(w=>w.id===MV.selectedWire)){MV.selectedWire=null;return;}
    snapshot();const id=MV.selectedWire;S.wires=S.wires.filter(w=>w.id!==id);MV.selectedWire=null;render();renderActive();refreshTrainerUI?.();status(`공통 와이어 ${id} 삭제 — 실물/결선도/시퀀스 모두 반영`);
  }

  function installPointerHandlers(){
    const el=q('#mv-svg');
    el.addEventListener('pointerdown',ev=>{
      const port=ev.target.closest?.('.mv-port');
      if(port){ev.stopPropagation();portClick(port.dataset.dev,port.dataset.term);return;}
      const wire=ev.target.closest?.('.mv-wire-hit');
      if(wire){MV.selectedWire=wire.dataset.wire;renderActive();status(`와이어 ${MV.selectedWire} 선택 · 삭제 버튼 또는 Delete`);ev.stopPropagation();return;}
      const drag=ev.target.closest?.('[data-drag-key]');
      if(drag){const key=drag.dataset.dragKey,p=clientWorld(ev),lay=currentLayout()[key];if(lay){MV.drag={key,start:p,origin:{...lay}};el.setPointerCapture?.(ev.pointerId);ev.preventDefault();}return;}
      if(ev.button===0||ev.button===1){const p=MV.pan[MV.view];MV.panning={sx:ev.clientX,sy:ev.clientY,x:p.x,y:p.y,k:p.k};el.setPointerCapture?.(ev.pointerId);}
    });
    el.addEventListener('pointermove',ev=>{
      if(MV.drag){const p=clientWorld(ev),lay=currentLayout()[MV.drag.key];lay.x=Math.round((MV.drag.origin.x+(p.x-MV.drag.start.x))/10)*10;lay.y=Math.round((MV.drag.origin.y+(p.y-MV.drag.start.y))/10)*10;renderActive();return;}
      if(MV.panning){const p=MV.pan[MV.view];p.x=MV.panning.x-(ev.clientX-MV.panning.sx)/p.k;p.y=MV.panning.y-(ev.clientY-MV.panning.sy)/p.k;applyDiagramViewBox();}
    });
    el.addEventListener('pointerup',()=>{MV.drag=null;MV.panning=null;});
    el.addEventListener('pointercancel',()=>{MV.drag=null;MV.panning=null;});
    el.addEventListener('wheel',ev=>{
      if(MV.view==='io'||MV.view==='panel')return;ev.preventDefault();const elr=el.getBoundingClientRect(),p=MV.pan[MV.view];const wx=p.x+(ev.clientX-elr.left)/p.k,wy=p.y+(ev.clientY-elr.top)/p.k;const nk=Math.max(.15,Math.min(4,p.k*(ev.deltaY<0?1.14:1/1.14)));p.x=wx-(ev.clientX-elr.left)/nk;p.y=wy-(ev.clientY-elr.top)/nk;p.k=nk;applyDiagramViewBox();
    },{passive:false});
    el.addEventListener('dblclick',ev=>{const wire=ev.target.closest?.('.mv-wire-hit');if(wire){MV.selectedWire=wire.dataset.wire;deleteSelectedWire();}});
    document.addEventListener('keydown',ev=>{
      if((MV.view==='schematic'||MV.view==='sequence')&&(ev.key==='Delete'||ev.key==='Backspace')&&document.activeElement?.tagName!=='INPUT'){if(MV.selectedWire){ev.preventDefault();deleteSelectedWire();}}
      if((MV.view==='schematic'||MV.view==='sequence')&&ev.key==='Escape'){MV.pending=null;MV.selectedWire=null;renderActive();}
    });
  }

  function printCurrentView(){
    if(MV.view!=='schematic'&&MV.view!=='sequence')return;
    const src=q('#mv-svg');const cloned=src.cloneNode(true);cloned.setAttribute('width','1600');cloned.setAttribute('height','1000');
    const win=window.open('','_blank','width=1200,height=800');if(!win){status('팝업 차단으로 인쇄 창을 열 수 없습니다');return;}
    win.document.write(`<html><head><title>${MV.view==='schematic'?'결선도':'시퀀스 회로'}</title><style>body{margin:0;background:white}svg{width:100vw;height:95vh}button{margin:8px}</style></head><body><button onclick="print()">인쇄 / PDF 저장</button>${cloned.outerHTML}</body></html>`);win.document.close();
  }

  function init(){
    ensureState();injectCss();injectUi();
    // 프로젝트 로딩 직후 저장된 보기로 자동 복귀하지 않고 실물을 기본으로 두어 기존 UX를 보존한다.
    setView('panel');
    window.addEventListener('resize',()=>{if(MV.view==='schematic'||MV.view==='sequence')applyDiagramViewBox();else if(MV.view==='palletizer')(window.PLCTrainerAutomationLabs||window.PLCTrainerPalletizer3D)?.resize?.();});
  }

  window.PLCTrainerMultiView={
    version:'2.7.0',renderActive,setView,fitCurrent,resetCurrentLayout,
    get view(){return MV.view;},get selectedWire(){return MV.selectedWire;}
  };
  init();
})();
