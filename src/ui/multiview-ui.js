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
      .mv-node.focused .mv-box{stroke:#168de2;stroke-width:3;filter:drop-shadow(0 0 4px #5ab8f5)}
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
      .mv-power-rail-label{font-size:10px;font-weight:800}
      .mv-sequence-section{stroke-width:1.4;stroke-dasharray:7 5}
      .mv-sequence-section-title{font-size:14px;font-weight:800;letter-spacing:.4px}
      .mv-junction-dot{fill:#111;stroke:#fff;stroke-width:1;pointer-events:none}
      .mv-grid-minor{stroke:#ecebe5;stroke-width:1}.mv-grid-major{stroke:#ddd9ce;stroke-width:1}
      body.mv-diagram #palette{background:#16222b}
      body.mv-palletizer-mode{grid-template-columns:0 minmax(0,1fr) 0!important;overflow:hidden}
      body.mv-sequence-editor-mode{grid-template-columns:0 minmax(0,1fr) 0!important;overflow:hidden}
      body.mv-palletizer-mode header{min-width:0;max-width:100vw;overflow-x:hidden}
      body.mv-sequence-editor-mode header{min-width:0;max-width:100vw;overflow-x:hidden}
      body.mv-palletizer-mode #palette,body.mv-palletizer-mode #right{visibility:hidden!important;overflow:hidden!important;box-sizing:border-box!important;min-width:0!important;width:0!important;padding:0!important;border:0!important;margin:0!important}
      body.mv-sequence-editor-mode #palette,body.mv-sequence-editor-mode #right{visibility:hidden!important;overflow:hidden!important;box-sizing:border-box!important;min-width:0!important;width:0!important;padding:0!important;border:0!important;margin:0!important}
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
      '<button class="mv-view-btn" data-view="sequence" title="빈 도면에서 동력·제어 회로를 직접 작성">✏️ 시퀀스 편집기</button>'+
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
      <div id="mv-sequence-editor"></div>
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
    // The view buttons live inside the advanced-tools flyout at narrow desktop
    // widths. Leaving it open covers the automation-lab tabs and intercepts
    // their pointer events after a view is selected.
    const advancedTools=q('#advanced-tools');if(advancedTools?.open)advancedTools.open=false;
    MV.view=view; S.workspaceView=view;
    const canvas=q('#canvas'), wrap=q('#mv-stage'), io=q('#mv-io'), svgEl=q('#mv-svg'), palletizer=q('#mv-palletizer'), toolbar=q('#mv-toolbar'), hint=q('#mv-hint');
    canvas.style.display=view==='panel'?'block':'none';
    wrap.classList.toggle('show',view!=='panel');
    io.classList.toggle('show',view==='io');
    palletizer?.classList.toggle('show',view==='palletizer');
    svgEl.style.display=view==='schematic'?'block':'none';
    toolbar.style.display=view==='schematic'?'flex':'none';
    hint.style.display=view==='schematic'?'block':'none';
    window.PLCTrainerSequenceEditor?.setVisible?.(view==='sequence');
    if(window.PLCTrainerAutomationLabs)window.PLCTrainerAutomationLabs.setVisible?.(view==='palletizer');
    else window.PLCTrainerPalletizer3D?.setVisible?.(view==='palletizer');
    document.body.classList.toggle('mv-diagram',view!=='panel');
    document.body.classList.toggle('mv-palletizer-mode',view==='palletizer');
    document.body.classList.toggle('mv-sequence-editor-mode',view==='sequence');
    q('#mv-view-group')?.querySelectorAll('.mv-view-btn').forEach(b=>b.classList.toggle('active',b.dataset.view===view));
    if(view==='panel'){
      status('실물 제어반 보기 · 기존 장비/결선 편집');
      requestAnimationFrame(()=>{try{applyTransform();}catch(_){}});
      return;
    }
    MV.pending=null; MV.selectedWire=null;
    renderActive();
    if(view==='schematic')requestAnimationFrame(()=>fitCurrent(false));
    const title=view==='schematic'?'종이 결선도':view==='sequence'?'전기 시퀀스 편집기':view==='io'?'PLC I/O 연결표':'자동화 제어 실습실';
    status(view==='palletizer'
      ?`${title} · 3축/2축 서보 · MPS · 공압 · LS/Mitsubishi 내부 주소 이미지`
      :view==='sequence'
        ?`${title} · 빈 도면에서 동력·제어 도형과 결선을 직접 작성`
        :`${title} 보기 · 같은 S.wires Netlist와 실시간 동기화`);
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

  function drawVerticalPort(g,devId,termId,x,y,label,placement,pol){
    const key=`${devId}.${termId}`;
    MV.portMap.set(key,{x,y,dev:devId,term:String(termId),axis:'vertical'});
    const live=typeof SIM!=='undefined'&&SIM.liveTerms?.has?.(key);
    const c=svg('circle',{cx:x,cy:y,r:5.5,className:`mv-port${MV.pending&&MV.pending.dev===devId&&String(MV.pending.term)===String(termId)?' pending':''}${live?' live':''}`});
    c.dataset.dev=devId;c.dataset.term=termId;c.dataset.port='1';g.appendChild(c);
    const textY=placement==='top'?y-9:y+14;
    g.appendChild(svg('text',{x,y:textY,'text-anchor':'middle',className:'mv-term-label'},String(termId)));
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
      const elems=MV.sequenceMode==='power'
        ? Core.powerElementsForDevice(devId,dev,def)
        : MV.sequenceMode==='combined'
          ? Core.combinedSequenceElementsForDevice(devId,dev,def,{connectedTerminals:connected})
          : Core.filterSequenceElements(Core.sequenceElementsForDevice(devId,dev,def,{connectedTerminals:connected}),{controlOnly:!MV.showAllTerminals});
      for(const el of elems)arr.push({devId,dev,def,el,key:itemKey(devId,el.id)});
    }
    return arr;
  }

  function setSequenceMode(mode){
    MV.sequenceMode=mode==='power'?'power':mode==='control'?'control':'combined';MV.focusedSequenceKey=null;
    q('#mv-sequence-combined')?.classList.toggle('active',MV.sequenceMode==='combined');
    q('#mv-sequence-control')?.classList.toggle('active',MV.sequenceMode==='control');
    q('#mv-sequence-power')?.classList.toggle('active',MV.sequenceMode==='power');
    const all=q('#mv-all-terminals');if(all)all.style.display=MV.sequenceMode==='control'?'inline-block':'none';
    renderActive();fitCurrent(false);
    status(MV.sequenceMode==='power'
      ? '동력 회로 · L/N·R/S/T·PE 실제 장비 단자 도형'
      : MV.sequenceMode==='control'
        ? '제어 시퀀스 · NO/NC·코일 실제 장비 단자 도형'
        : '이전 자동 생성 시퀀스 보기는 더 이상 사용하지 않습니다.');
  }

  const sequenceKindLabel=kind=>({
    'contact-no':'NO','contact-nc':'NC','contact-changeover':'전환','coil':'COIL',load:'LOAD',block:'I/O',
    'breaker-3p':'MCCB 3P','breaker-2p':'MCCB 2P','fuse-2p':'FUSE 2P','fuse-1p':'FUSE',
    'contactor-3p':'MC 3P','overload-3p':'EOCR','motor-3p':'M 3~',earth:'PE'
  })[kind]||kind;

  function renderSequenceLibrary(catalog){
    const panel=q('#mv-sequence-library'),list=q('#mv-sequence-list'),summary=q('.mv-library-summary');
    if(!panel||!list||MV.view!=='sequence')return;
    const groups=catalog||Core.buildSequenceCatalog(S.devices,LIB,S.wires,{mode:MV.sequenceMode,controlOnly:!MV.showAllTerminals});
    const query=String(q('#mv-sequence-search')?.value||'').trim().toLocaleLowerCase('ko');
    const visible=[];
    for(const group of groups){
      const elements=group.elements.filter(element=>!query||`${group.label} ${group.type} ${element.label} ${element.kind} ${element.terminals.join(' ')}`.toLocaleLowerCase('ko').includes(query));
      if(elements.length)visible.push({...group,elements});
    }
    list.replaceChildren();
    const count=visible.reduce((sum,group)=>sum+group.elements.length,0);
    const modeLabel=MV.sequenceMode==='power'?'동력':MV.sequenceMode==='control'?'제어':'통합';
    summary.textContent=`${modeLabel} 장비 ${groups.length}대 · 사용 가능한 도형 ${count}개 · 실제 단자 연동`;
    if(!visible.length){const empty=document.createElement('div');empty.className='mv-library-empty';empty.textContent='검색 조건에 맞는 장비 도형이 없습니다.';list.appendChild(empty);return;}
    for(const group of visible){
      const section=document.createElement('section');section.className='mv-library-device';
      const heading=document.createElement('h4');heading.textContent=group.label;
      const type=document.createElement('small');type.textContent=group.type;heading.appendChild(type);section.appendChild(heading);
      for(const element of group.elements){
        const button=document.createElement('button');button.type='button';button.className=`mv-library-symbol${MV.focusedSequenceKey===element.key?' active':''}`;button.dataset.key=element.key;
        const kind=document.createElement('span');kind.className='mv-symbol-kind';kind.textContent=sequenceKindLabel(element.kind);
        const label=document.createElement('span');label.textContent=`${element.label} · ${element.terminals.join(' / ')}`;
        button.append(kind,label);button.onclick=()=>focusSequenceSymbol(element.key);section.appendChild(button);
      }
      list.appendChild(section);
    }
  }

  function focusSequenceSymbol(key){
    const bounds=MV.nodeBounds.get(key);if(!bounds)return;
    MV.focusedSequenceKey=key;renderSequence();
    const el=q('#mv-svg'),rect=el.getBoundingClientRect(),zoom=Math.max(.8,MV.pan.sequence.k);
    MV.pan.sequence={x:bounds.x+bounds.w/2-rect.width/(2*zoom),y:bounds.y+bounds.h/2-rect.height/(2*zoom),k:zoom};
    applyDiagramViewBox();status(`시퀀스 도형 선택: ${key} · 제목을 드래그해 배치하고 단자 ○를 연결하세요`);
  }
  function seqSize(item){
    if(['breaker-3p','contactor-3p','overload-3p'].includes(item.el.kind))return {w:230,h:130};
    if(['breaker-2p','fuse-2p'].includes(item.el.kind))return {w:230,h:108};
    if(item.el.kind==='fuse-1p')return {w:230,h:84};
    if(item.el.kind==='motor-3p')return {w:210,h:150};
    if(item.el.kind==='earth')return {w:230,h:Math.max(110,48+Math.ceil(item.el.terminals.length/2)*19)};
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

  function terminalPol(item,term){return (item.def.terminals||[]).find(candidate=>String(candidate.id)===String(term))?.pol;}
  function drawPowerSymbol(g,p,size,item){
    const kind=item.el.kind;
    g.appendChild(svg('rect',{x:p.x,y:p.y,width:size.w,height:size.h,rx:4,className:'mv-box'}));
    const head=svg('rect',{x:p.x,y:p.y,width:size.w,height:24,rx:4,className:'mv-node-head'});head.dataset.dragKey=item.key;g.appendChild(head);
    g.appendChild(svg('text',{x:p.x+size.w/2,y:p.y+17,className:'mv-symbol-label'},item.el.label));
    if(kind==='motor-3p'){
      const cx=p.x+size.w*.62,cy=p.y+82;
      g.appendChild(svg('circle',{cx,cy,r:39,className:'mv-symbol-line'}));
      g.appendChild(svg('text',{x:cx,y:cy-2,'text-anchor':'middle',className:'mv-symbol-label'},'M'));
      g.appendChild(svg('text',{x:cx,y:cy+17,'text-anchor':'middle',className:'mv-term-label'},'3~'));
      ['U','V','W'].filter(term=>item.el.terminals.includes(term)).forEach((term,index)=>{const y=p.y+50+index*25;drawPort(g,item.devId,term,p.x+8,y,Core.termLabel(item.def,term),'L',terminalPol(item,term));g.appendChild(svg('line',{x1:p.x+14,y1:y,x2:cx-35,y2:cy-20+index*20,className:'mv-symbol-line'}));});
      if(item.el.terminals.includes('PE')){const y=p.y+126;drawPort(g,item.devId,'PE',p.x+size.w-8,y,Core.termLabel(item.def,'PE'),'R','PE');g.appendChild(svg('line',{x1:cx+25,y1:cy+30,x2:p.x+size.w-14,y2:y,className:'mv-symbol-line'}));}
      return;
    }
    if(kind==='earth'){
      const terminals=item.el.terminals,half=Math.ceil(terminals.length/2);
      terminals.slice(0,half).forEach((term,index)=>drawPort(g,item.devId,term,p.x+8,p.y+45+index*19,Core.termLabel(item.def,term),'L','PE'));
      terminals.slice(half).forEach((term,index)=>drawPort(g,item.devId,term,p.x+size.w-8,p.y+45+index*19,Core.termLabel(item.def,term),'R','PE'));
      const x=p.x+size.w/2,y=p.y+size.h-20;g.appendChild(svg('line',{x1:x,y1:p.y+38,x2:x,y2:y-12,className:'mv-symbol-line'}));
      [24,16,8].forEach((width,index)=>g.appendChild(svg('line',{x1:x-width/2,y1:y+index*5,x2:x+width/2,y2:y+index*5,className:'mv-symbol-line'})));
      return;
    }
    const poles=item.el.poles||[];
    poles.forEach((pole,index)=>{
      if(pole.length<2)return;const [from,to]=pole,y=p.y+47+index*24,m=p.x+size.w/2;
      drawPort(g,item.devId,from,p.x+8,y,Core.termLabel(item.def,from),'L',terminalPol(item,from));
      drawPort(g,item.devId,to,p.x+size.w-8,y,Core.termLabel(item.def,to),'R',terminalPol(item,to));
      g.appendChild(svg('line',{x1:p.x+14,y1:y,x2:m-20,y2:y,className:'mv-symbol-line'}));
      g.appendChild(svg('line',{x1:m+20,y1:y,x2:p.x+size.w-14,y2:y,className:'mv-symbol-line'}));
      if(kind.startsWith('breaker')){
        g.appendChild(svg('circle',{cx:m-18,cy:y,r:2.5,fill:'#111'}));g.appendChild(svg('circle',{cx:m+18,cy:y,r:2.5,fill:'#111'}));
        g.appendChild(svg('line',{x1:m-16,y1:y-2,x2:m+14,y2:y-13,className:'mv-contact-line'}));
      }else if(kind==='contactor-3p'){
        g.appendChild(svg('line',{x1:m-18,y1:y-12,x2:m-18,y2:y+12,className:'mv-contact-line'}));g.appendChild(svg('line',{x1:m+18,y1:y-12,x2:m+18,y2:y+12,className:'mv-contact-line'}));
      }else if(kind==='overload-3p'){
        g.appendChild(svg('path',{d:`M ${m-20} ${y} l 8 -9 l 8 18 l 8 -18 l 8 9`,className:'mv-symbol-line'}));
      }else if(kind.startsWith('fuse')){
        g.appendChild(svg('rect',{x:m-20,y:y-9,width:40,height:18,className:'mv-symbol-line'}));
      }
    });
    if(kind==='contactor-3p'&&poles.length>1){const m=p.x+size.w/2;g.appendChild(svg('line',{x1:m,y1:p.y+36,x2:m,y2:p.y+106,stroke:'#555','stroke-dasharray':'4 4','stroke-width':1.2}));}
  }

  const classicPowerKinds=new Set(['breaker-3p','breaker-2p','fuse-2p','fuse-1p','contactor-3p','overload-3p','motor-3p','earth']);
  const isClassicPowerItem=item=>classicPowerKinds.has(item.el.kind)||(item.el.kind==='block'&&item.el.deviceKind==='power');
  const classicLayoutKey=key=>`combined::${key}`;
  function classicSize(item){
    if(['breaker-3p','contactor-3p','overload-3p'].includes(item.el.kind))return {w:180,h:122};
    if(['breaker-2p','fuse-2p'].includes(item.el.kind))return {w:160,h:112};
    if(item.el.kind==='fuse-1p')return {w:140,h:100};
    if(item.el.kind==='motor-3p')return {w:190,h:158};
    if(item.el.kind==='earth')return {w:150,h:118};
    if(item.el.kind==='block')return {w:220,h:Math.max(92,52+Math.ceil(item.el.terminals.length/2)*18)};
    return {w:142,h:item.el.kind==='contact-changeover'?116:100};
  }
  function ensureClassicSequenceLayout(items){
    const lay=S.diagramLayouts.sequence;
    const power=items.filter(isClassicPowerItem),control=items.filter(item=>!isClassicPowerItem(item));
    const stages={
      'breaker-3p':0,'breaker-2p':0,'fuse-2p':0,'fuse-1p':0,
      'contactor-3p':1,'overload-3p':2,'motor-3p':3,earth:4,block:1
    };
    const stageCounts=new Map();
    for(const item of power){
      const stage=stages[item.el.kind]??1,index=stageCounts.get(stage)||0;stageCounts.set(stage,index+1);
      const key=classicLayoutKey(item.key);if(!lay[key])lay[key]={x:70+index*220,y:150+stage*150};
    }
    const upstream=control.filter(item=>!['coil','load'].includes(item.el.kind));
    const sinks=control.filter(item=>['coil','load'].includes(item.el.kind));
    const columns=Math.min(6,Math.max(1,upstream.length,sinks.length));
    upstream.forEach((item,index)=>{const key=classicLayoutKey(item.key);if(!lay[key])lay[key]={x:560+(index%6)*155,y:150+Math.floor(index/6)*118};});
    sinks.forEach((item,index)=>{const key=classicLayoutKey(item.key);if(!lay[key])lay[key]={x:560+(index%6)*155,y:560+Math.floor(index/6)*118};});
    return {power,control,controlColumns:columns,controlRows:Math.max(Math.ceil(upstream.length/6),Math.ceil(sinks.length/6),1)};
  }
  function drawClassicPowerSymbol(g,p,size,item){
    const kind=item.el.kind;
    g.appendChild(svg('rect',{x:p.x,y:p.y,width:size.w,height:size.h,rx:5,fill:'#fff','fill-opacity':.82,stroke:'#7892a5','stroke-width':1.1}));
    const head=svg('rect',{x:p.x,y:p.y,width:size.w,height:23,rx:5,className:'mv-node-head'});head.dataset.dragKey=classicLayoutKey(item.key);g.appendChild(head);
    g.appendChild(svg('text',{x:p.x+size.w/2,y:p.y+16,className:'mv-symbol-label'},item.el.label));
    if(kind==='motor-3p'){
      const phases=['U','V','W'].filter(term=>item.el.terminals.includes(term)),cx=p.x+size.w/2,cy=p.y+101;
      phases.forEach((term,index)=>{const x=cx+(index-1)*38;drawVerticalPort(g,item.devId,term,x,p.y+36,Core.termLabel(item.def,term),'top',terminalPol(item,term));g.appendChild(svg('line',{x1:x,y1:p.y+42,x2:cx+(index-1)*20,y2:cy-35,className:'mv-symbol-line'}));});
      g.appendChild(svg('circle',{cx,cy,r:37,className:'mv-symbol-line'}));g.appendChild(svg('text',{x:cx,y:cy-1,'text-anchor':'middle',className:'mv-symbol-label'},'M'));g.appendChild(svg('text',{x:cx,y:cy+16,'text-anchor':'middle',className:'mv-term-label'},'3~'));
      if(item.el.terminals.includes('PE')){drawVerticalPort(g,item.devId,'PE',p.x+size.w-20,p.y+size.h-18,Core.termLabel(item.def,'PE'),'bottom','PE');g.appendChild(svg('line',{x1:cx+26,y1:cy+27,x2:p.x+size.w-20,y2:p.y+size.h-24,className:'mv-symbol-line'}));}
      return;
    }
    if(kind==='earth'){
      const terminals=item.el.terminals.slice(0,4),cx=p.x+size.w/2;
      terminals.forEach((term,index)=>{const x=cx+(index-(terminals.length-1)/2)*30;drawVerticalPort(g,item.devId,term,x,p.y+36,Core.termLabel(item.def,term),'top','PE');g.appendChild(svg('line',{x1:x,y1:p.y+42,x2:cx,y2:p.y+70,className:'mv-symbol-line'}));});
      g.appendChild(svg('line',{x1:cx,y1:p.y+70,x2:cx,y2:p.y+86,className:'mv-symbol-line'}));
      [34,22,10].forEach((width,index)=>g.appendChild(svg('line',{x1:cx-width/2,y1:p.y+88+index*7,x2:cx+width/2,y2:p.y+88+index*7,className:'mv-symbol-line'})));
      return;
    }
    if(kind==='block'){
      const terms=item.el.terminals,half=Math.ceil(terms.length/2);
      terms.slice(0,half).forEach((term,index)=>drawPort(g,item.devId,term,p.x+8,p.y+42+index*18,Core.termLabel(item.def,term),'L',terminalPol(item,term)));
      terms.slice(half).forEach((term,index)=>drawPort(g,item.devId,term,p.x+size.w-8,p.y+42+index*18,Core.termLabel(item.def,term),'R',terminalPol(item,term)));
      return;
    }
    const poles=item.el.poles||[],center=p.x+size.w/2,top=p.y+36,bottom=p.y+size.h-17;
    poles.forEach((pole,index)=>{
      if(pole.length<2)return;const [from,to]=pole,x=center+(index-(poles.length-1)/2)*42,mid=(top+bottom)/2;
      drawVerticalPort(g,item.devId,from,x,top,Core.termLabel(item.def,from),'top',terminalPol(item,from));
      drawVerticalPort(g,item.devId,to,x,bottom,Core.termLabel(item.def,to),'bottom',terminalPol(item,to));
      g.appendChild(svg('line',{x1:x,y1:top+6,x2:x,y2:mid-18,className:'mv-symbol-line'}));g.appendChild(svg('line',{x1:x,y1:mid+18,x2:x,y2:bottom-6,className:'mv-symbol-line'}));
      if(kind.startsWith('breaker')){g.appendChild(svg('circle',{cx:x,cy:mid-16,r:2.5,fill:'#111'}));g.appendChild(svg('circle',{cx:x,cy:mid+16,r:2.5,fill:'#111'}));g.appendChild(svg('line',{x1:x-1,y1:mid-14,x2:x+12,y2:mid+10,className:'mv-contact-line'}));}
      else if(kind==='contactor-3p'){g.appendChild(svg('line',{x1:x-12,y1:mid-12,x2:x+12,y2:mid-12,className:'mv-contact-line'}));g.appendChild(svg('line',{x1:x-12,y1:mid+12,x2:x+12,y2:mid+12,className:'mv-contact-line'}));}
      else if(kind==='overload-3p'){g.appendChild(svg('path',{d:`M ${x} ${mid-18} l -8 8 l 16 8 l -16 8 l 8 8`,className:'mv-symbol-line'}));}
      else if(kind.startsWith('fuse'))g.appendChild(svg('rect',{x:x-9,y:mid-18,width:18,height:36,className:'mv-symbol-line'}));
    });
    if(poles.length>1&&['breaker-3p','contactor-3p'].includes(kind))g.appendChild(svg('line',{x1:center-52,y1:p.y+size.h/2,x2:center+52,y2:p.y+size.h/2,stroke:'#555','stroke-dasharray':'4 4','stroke-width':1.1}));
  }
  function drawClassicControlSymbol(g,p,size,item){
    const kind=item.el.kind,cx=p.x+size.w/2,top=p.y+29,bottom=p.y+size.h-14,mid=(top+bottom)/2;
    g.appendChild(svg('rect',{x:p.x,y:p.y,width:size.w,height:size.h,rx:5,fill:'#fff','fill-opacity':.86,stroke:'#b99f6b','stroke-width':1.1}));
    const head=svg('rect',{x:p.x,y:p.y,width:size.w,height:22,rx:5,className:'mv-node-head'});head.dataset.dragKey=classicLayoutKey(item.key);g.appendChild(head);
    g.appendChild(svg('text',{x:cx,y:p.y+15,className:'mv-symbol-label'},item.el.label));
    if(kind==='block'){
      const terms=item.el.terminals,half=Math.ceil(terms.length/2);
      terms.slice(0,half).forEach((term,index)=>drawPort(g,item.devId,term,p.x+8,p.y+39+index*18,Core.termLabel(item.def,term),'L',terminalPol(item,term)));
      terms.slice(half).forEach((term,index)=>drawPort(g,item.devId,term,p.x+size.w-8,p.y+39+index*18,Core.termLabel(item.def,term),'R',terminalPol(item,term)));
      return;
    }
    if(kind==='contact-changeover'){
      const [common,no,nc]=item.el.terminals;drawVerticalPort(g,item.devId,common,cx,top,Core.termLabel(item.def,common),'top',terminalPol(item,common));
      drawVerticalPort(g,item.devId,no,cx-28,bottom,Core.termLabel(item.def,no),'bottom',terminalPol(item,no));drawVerticalPort(g,item.devId,nc,cx+28,bottom,Core.termLabel(item.def,nc),'bottom',terminalPol(item,nc));
      g.appendChild(svg('line',{x1:cx,y1:top+6,x2:cx,y2:mid-8,className:'mv-symbol-line'}));g.appendChild(svg('line',{x1:cx,y1:mid-8,x2:cx-26,y2:bottom-8,className:'mv-contact-line'}));g.appendChild(svg('line',{x1:cx-28,y1:bottom-8,x2:cx-28,y2:bottom-5,className:'mv-symbol-line'}));g.appendChild(svg('line',{x1:cx+28,y1:mid+8,x2:cx+28,y2:bottom-5,className:'mv-symbol-line'}));return;
    }
    const [from,to]=item.el.terminals;drawVerticalPort(g,item.devId,from,cx,top,Core.termLabel(item.def,from),'top',terminalPol(item,from));drawVerticalPort(g,item.devId,to,cx,bottom,Core.termLabel(item.def,to),'bottom',terminalPol(item,to));
    if(kind==='contact-no'||kind==='contact-nc'){
      g.appendChild(svg('line',{x1:cx,y1:top+6,x2:cx,y2:mid-17,className:'mv-symbol-line'}));g.appendChild(svg('line',{x1:cx,y1:mid+17,x2:cx,y2:bottom-6,className:'mv-symbol-line'}));
      g.appendChild(svg('circle',{cx,cy:mid-15,r:2.5,fill:'#111'}));g.appendChild(svg('circle',{cx,cy:mid+15,r:2.5,fill:'#111'}));g.appendChild(svg('line',{x1:cx-1,y1:mid-12,x2:cx+12,y2:mid+10,className:'mv-contact-line'}));
      if(kind==='contact-nc')g.appendChild(svg('line',{x1:cx-14,y1:mid+13,x2:cx+14,y2:mid-13,className:'mv-contact-line'}));
    }else if(kind==='coil'){
      g.appendChild(svg('line',{x1:cx,y1:top+6,x2:cx,y2:mid-22,className:'mv-symbol-line'}));g.appendChild(svg('circle',{cx,cy:mid,r:22,className:'mv-symbol-line'}));g.appendChild(svg('text',{x:cx,y:mid+4,'text-anchor':'middle',className:'mv-symbol-label'},'COIL'));g.appendChild(svg('line',{x1:cx,y1:mid+22,x2:cx,y2:bottom-6,className:'mv-symbol-line'}));
    }else if(kind==='load'){
      g.appendChild(svg('line',{x1:cx,y1:top+6,x2:cx,y2:mid-20,className:'mv-symbol-line'}));g.appendChild(svg('circle',{cx,cy:mid,r:20,className:'mv-symbol-line'}));g.appendChild(svg('line',{x1:cx-13,y1:mid-13,x2:cx+13,y2:mid+13,className:'mv-symbol-line'}));g.appendChild(svg('line',{x1:cx-13,y1:mid+13,x2:cx+13,y2:mid-13,className:'mv-symbol-line'}));g.appendChild(svg('line',{x1:cx,y1:mid+20,x2:cx,y2:bottom-6,className:'mv-symbol-line'}));
    }
  }
  function drawSequenceJunctions(group){
    const counts=new Map();
    for(const wire of S.wires||[])for(const ref of [wire.from,wire.to]){const key=`${ref.dev}.${ref.term}`;counts.set(key,(counts.get(key)||0)+1);}
    for(const [key,count] of counts)if(count>1){const port=MV.portMap.get(key);if(port)group.appendChild(svg('circle',{cx:port.x,cy:port.y,r:4.2,className:'mv-junction-dot'}));}
  }
  function renderCombinedSequence(){
    const nodeG=q('#mv-nodes'),wireG=q('#mv-wires'),overlayG=q('#mv-overlay');nodeG.innerHTML='';wireG.innerHTML='';overlayG.innerHTML='';MV.portMap.clear();MV.nodeBounds.clear();
    const items=sequenceItems(),sections=ensureClassicSequenceLayout(items),controlColumns=sections.controlColumns,controlRight=Math.max(1120,560+controlColumns*155),sheetBottom=Math.max(840,720+(sections.controlRows-1)*118);
    wireG.appendChild(svg('rect',{x:42,y:55,width:440,height:sheetBottom-20,rx:9,fill:'#eaf4fb',stroke:'#5e96ba',className:'mv-sequence-section'}));
    wireG.appendChild(svg('text',{x:62,y:83,fill:'#23658e',className:'mv-sequence-section-title'},'3상 동력회로'));
    wireG.appendChild(svg('rect',{x:510,y:55,width:controlRight-500,height:sheetBottom-20,rx:9,fill:'#fff8df',stroke:'#b58a32',className:'mv-sequence-section'}));
    wireG.appendChild(svg('text',{x:530,y:83,fill:'#8a6112',className:'mv-sequence-section-title'},'제어 회로'));
    [['R/L1','#8b4513'],['S/L2','#111'],['T/L3','#6b7280']].forEach(([label,color],index)=>{const x=120+index*40;wireG.appendChild(svg('text',{x,y:111,'text-anchor':'middle',fill:color,className:'mv-power-rail-label'},label));wireG.appendChild(svg('line',{x1:x,y1:116,x2:x,y2:142,stroke:color,'stroke-width':2.4}));});
    wireG.appendChild(svg('line',{x1:545,y1:115,x2:controlRight-35,y2:115,stroke:'#a22','stroke-width':2.7}));wireG.appendChild(svg('text',{x:545,y:104,fill:'#a22',className:'mv-ladder-label'},'L / +24V 기준선'));
    wireG.appendChild(svg('line',{x1:545,y1:sheetBottom-48,x2:controlRight-35,y2:sheetBottom-48,stroke:'#2463a0','stroke-width':2.7}));wireG.appendChild(svg('text',{x:545,y:sheetBottom-58,fill:'#2463a0',className:'mv-ladder-label'},'N / 0V 기준선'));
    for(const item of items){
      const p=layoutPoint(classicLayoutKey(item.key),100,100),size=classicSize(item),active=elementActive(item),g=svg('g',{className:`mv-node${active?' mv-symbol-active':''}${MV.focusedSequenceKey===item.key?' focused':''}`});g.dataset.key=item.key;g.dataset.dev=item.devId;
      if(isClassicPowerItem(item))drawClassicPowerSymbol(g,p,size,item);else drawClassicControlSymbol(g,p,size,item);
      nodeG.appendChild(g);MV.nodeBounds.set(item.key,{x:p.x,y:p.y,w:size.w,h:size.h});
    }
    drawSharedWires(wireG);drawSequenceJunctions(overlayG);
    MV.nodeBounds.set('__sequence-rails',{x:42,y:55,w:controlRight-42,h:sheetBottom-20});
    renderSequenceLibrary(Core.buildSequenceCatalog(S.devices,LIB,S.wires,{mode:'combined',controlOnly:true}));
    q('#mv-title').textContent='이전 시퀀스 보기';
    q('#mv-hint').textContent='왼쪽은 MCCB→MC→EOCR→3상 모터 동력부, 오른쪽은 PB·보조접점·타이머·코일 제어부입니다. 같은 장비 ID와 실제 단자 ○를 사용하며 검은 점은 실제 분기 접속점입니다.';
  }
  function renderSequence(){
    if(MV.sequenceMode==='combined'){renderCombinedSequence();return;}
    const nodeG=q('#mv-nodes'), wireG=q('#mv-wires');nodeG.innerHTML='';wireG.innerHTML='';MV.portMap.clear();MV.nodeBounds.clear();
    const items=sequenceItems();ensureSequenceLayout(items);
    const railHeight=Math.max(1200,items.length*80);
    if(MV.sequenceMode==='control'){
      nodeG.appendChild(svg('line',{x1:55,y1:45,x2:55,y2:railHeight,className:'mv-ladder-rail'}));
      nodeG.appendChild(svg('text',{x:35,y:35,className:'mv-ladder-label'},'L / +24V'));
    }else{
      const phaseRails=[['R/L1','#8b4513'],['S/L2','#111'],['T/L3','#6b7280'],['N','#2563eb'],['PE','#15803d']];
      phaseRails.forEach(([label,color],index)=>{const x=42+index*16;nodeG.appendChild(svg('line',{x1:x,y1:48,x2:x,y2:railHeight,stroke:color,'stroke-width':2.4,opacity:.78}));nodeG.appendChild(svg('text',{x,y:35,'text-anchor':'middle',fill:color,className:'mv-power-rail-label'},label));});
    }
    for(const item of items){
      const p=layoutPoint(item.key,100,100),size=seqSize(item),active=elementActive(item),g=svg('g',{className:`mv-node${active?' mv-symbol-active':''}${MV.focusedSequenceKey===item.key?' focused':''}`});g.dataset.key=item.key;g.dataset.dev=item.devId;
      if(item.el.kind==='block'){
        g.appendChild(svg('rect',{x:p.x,y:p.y,width:size.w,height:size.h,rx:4,className:'mv-box'}));
        const head=svg('rect',{x:p.x,y:p.y,width:size.w,height:27,rx:4,className:'mv-node-head'});head.dataset.dragKey=item.key;g.appendChild(head);
        g.appendChild(svg('text',{x:p.x+8,y:p.y+18,className:'mv-node-title'},item.el.label));
        const terms=item.el.terminals,half=Math.ceil(terms.length/2);
        terms.slice(0,half).forEach((t,i)=>drawPort(g,item.devId,t,p.x,p.y+43+i*19,Core.termLabel(item.def,t),'L',(item.def.terminals||[]).find(x=>x.id===t)?.pol));
        terms.slice(half).forEach((t,i)=>drawPort(g,item.devId,t,p.x+size.w,p.y+43+i*19,Core.termLabel(item.def,t),'R',(item.def.terminals||[]).find(x=>x.id===t)?.pol));
      }else if(['breaker-3p','breaker-2p','fuse-2p','fuse-1p','contactor-3p','overload-3p','motor-3p','earth'].includes(item.el.kind)){
        drawPowerSymbol(g,p,size,item);
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
    const railX=Math.max(920,...[...MV.nodeBounds.values()].map(b=>b.x+b.w))+80;
    if(MV.sequenceMode==='control'){
      nodeG.appendChild(svg('line',{x1:railX,y1:45,x2:railX,y2:railHeight,className:'mv-ladder-rail'}));
      nodeG.appendChild(svg('text',{x:railX-12,y:35,'text-anchor':'end',className:'mv-ladder-label'},'N / 0V'));
    }
    MV.nodeBounds.set('__sequence-rails',{x:42,y:35,w:railX-42,h:railHeight});
    drawSharedWires(wireG);
    renderSequenceLibrary(Core.buildSequenceCatalog(S.devices,LIB,S.wires,{mode:MV.sequenceMode,controlOnly:!MV.showAllTerminals}));
    q('#mv-title').textContent=MV.sequenceMode==='power'?'⚡ 동력 회로':'🔁 제어 시퀀스';
    q('#mv-hint').textContent=MV.sequenceMode==='power'
      ? 'R/S/T/N/PE 전원 기준과 현재 장비의 MCCB·MC·EOCR·모터·접지 도형입니다. 각 도형의 실제 단자 ○를 차례로 클릭해 동력선을 연결하세요.'
      : '오른쪽 현재 장비 도형을 선택 → 제목을 드래그해 배치 → 단자 ○ 두 개를 차례로 클릭해 결선합니다. 전체 단자를 켜면 MC 주접점도 함께 표시됩니다.';
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
    else if(MV.view==='sequence')window.PLCTrainerSequenceEditor?.renderActive?.();
    else if(MV.view==='io')renderIo();
    else if(MV.view==='palletizer'){
      if(window.PLCTrainerAutomationLabs)window.PLCTrainerAutomationLabs.renderActive?.();
      else window.PLCTrainerPalletizer3D?.renderActive?.();
    }
    if(MV.view==='schematic')applyDiagramViewBox();
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
