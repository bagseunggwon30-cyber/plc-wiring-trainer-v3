(function(){
  'use strict';
  if(typeof window==='undefined'||typeof document==='undefined')return;
  const Core=window.PLCTrainerSequenceCore;
  if(!Core){console.error('PLCTrainerSequenceCore missing');return;}

  const NS='http://www.w3.org/2000/svg';
  const STORAGE_KEY='plc-sequence-editor-v1';
  const state={
    root:null,document:Core.createDocument(),selectedSymbol:null,selectedWire:null,
    pendingTerminal:null,activeType:null,history:[],future:[],drag:null,visible:false
  };
  const q=selector=>state.root?.querySelector(selector);
  const svg=(tag,attrs={},text)=>{const node=document.createElementNS(NS,tag);for(const [key,value] of Object.entries(attrs)){if(value!=null)node.setAttribute(key==='className'?'class':key,String(value));}if(text!=null)node.textContent=String(text);return node;};
  const definitionFor=symbol=>Core.symbolDefinition(symbol.type);

  function loadStored(){
    try{const stored=localStorage.getItem(STORAGE_KEY);if(stored)state.document=Core.deserializeDocument(stored);}catch(error){console.warn('시퀀스 문서 복구 실패',error);}
  }
  function persist(){
    try{localStorage.setItem(STORAGE_KEY,Core.serializeDocument(state.document));}catch(error){setStatus(`자동 저장 실패: ${error.message}`,'error');}
  }
  function snapshot(){state.history.push(Core.serializeDocument(state.document));if(state.history.length>80)state.history.shift();state.future=[];}
  function commit(documentValue,message){state.document=documentValue;persist();render();if(message)setStatus(message);}
  function undo(){if(!state.history.length)return;state.future.push(Core.serializeDocument(state.document));state.document=Core.deserializeDocument(state.history.pop());clearSelection();persist();render();setStatus('실행 취소');}
  function redo(){if(!state.future.length)return;state.history.push(Core.serializeDocument(state.document));state.document=Core.deserializeDocument(state.future.pop());clearSelection();persist();render();setStatus('다시 실행');}
  function clearSelection(){state.selectedSymbol=null;state.selectedWire=null;state.pendingTerminal=null;}
  function setStatus(message,tone=''){const node=q('#seq-status');if(node){node.textContent=message;node.dataset.tone=tone;}}

  function injectStyles(){
    if(document.querySelector('#sequence-editor-style'))return;
    const style=document.createElement('style');style.id='sequence-editor-style';style.textContent=`
      #mv-sequence-editor{display:none;position:absolute;inset:0;background:#d9dde2;color:#17202a;font-family:'Malgun Gothic',sans-serif}
      #mv-sequence-editor.show{display:flex;flex-direction:column}
      .seq-topbar{height:48px;display:flex;align-items:center;gap:5px;padding:0 10px;background:#182632;color:#eef6fb;border-bottom:1px solid #09131a;box-sizing:border-box}
      .seq-topbar strong{font-size:13px;margin-right:8px}.seq-topbar button,.seq-topbar label{padding:5px 8px;border:1px solid #526979;border-radius:4px;background:#2b3e4b;color:#eef6fb;font:11px inherit;cursor:pointer}
      .seq-topbar button:hover,.seq-topbar label:hover,.seq-topbar button.active{background:#1769aa;border-color:#69bdf3}.seq-topbar .seq-spacer{flex:1}
      .seq-workspace{display:grid;grid-template-columns:220px minmax(0,1fr) 235px;min-height:0;flex:1}
      .seq-palette,.seq-inspector{overflow:auto;background:#f4f6f8;border-right:1px solid #b6bec6;padding:10px;box-sizing:border-box}.seq-inspector{border-right:0;border-left:1px solid #b6bec6}
      .seq-palette h3,.seq-inspector h3{font-size:13px;margin:0 0 8px}.seq-palette h4{margin:12px 0 5px;color:#53616c;font-size:11px}
      .seq-symbol-button{display:flex;align-items:center;width:100%;margin:0 0 5px;padding:7px 8px;border:1px solid #bcc6ce;border-radius:4px;background:white;color:#1b2b36;text-align:left;font-size:11px;cursor:grab}
      .seq-symbol-button:hover,.seq-symbol-button.active{border-color:#1773b7;background:#e5f3fd;color:#0b5b95}.seq-symbol-mark{display:inline-block;width:30px;margin-right:6px;color:#1b2730;font:700 10px Consolas;text-align:center}
      .seq-canvas-wrap{position:relative;min-width:0;min-height:0;overflow:auto;padding:18px;background:#cfd4d9;box-sizing:border-box}
      #seq-svg{display:block;width:100%;height:100%;min-width:900px;min-height:600px;background:white;box-shadow:0 2px 13px rgba(0,0,0,.28);touch-action:none}
      .seq-sheet{fill:#fff}.seq-grid-minor{stroke:#eff1f2;stroke-width:1}.seq-grid-major{stroke:#d9dde0;stroke-width:1.2}
      .seq-wire{fill:none;stroke-width:2.4;pointer-events:none}.seq-wire-hit{fill:none;stroke:transparent;stroke-width:14;cursor:pointer}.seq-wire.selected{stroke:#f07800!important;stroke-width:4}
      .seq-symbol{cursor:move}.seq-symbol .body{fill:#fff;stroke:#2e3a43;stroke-width:1.4}.seq-symbol.selected .body{stroke:#e66d00;stroke-width:3}.seq-symbol text{pointer-events:none}
      .seq-symbol-line{stroke:#111;stroke-width:2.2;fill:none}.seq-symbol-dashed{stroke:#555;stroke-width:1;stroke-dasharray:4 4}.seq-symbol-title{font-size:13px;font-weight:800;text-anchor:middle;fill:#16232c}.seq-symbol-sub{font:11px Consolas,monospace;text-anchor:middle;fill:#4c5c68}
      .seq-terminal{fill:#fff;stroke:#111;stroke-width:1.7;cursor:crosshair}.seq-terminal:hover,.seq-terminal.pending{fill:#ffd83d;stroke:#e45d00;stroke-width:3}.seq-terminal-label{font:10px Consolas,monospace;fill:#111}
      .seq-junction{fill:#111;stroke:#fff;stroke-width:1}.seq-note{font-size:14px;font-weight:700;fill:#304657}
      #seq-status{position:absolute;left:26px;bottom:26px;z-index:3;max-width:70%;padding:6px 9px;border-radius:4px;background:rgba(22,33,42,.9);color:#eef5f9;font-size:11px;pointer-events:none}#seq-status[data-tone="error"]{background:rgba(151,32,32,.94)}
      .seq-field{display:block;margin-bottom:10px;font-size:11px;color:#4b5963}.seq-field input{display:block;width:100%;box-sizing:border-box;margin-top:4px;padding:6px;border:1px solid #b7c1c9;border-radius:3px;background:#fff}
      .seq-inspector button{width:100%;margin:0 0 6px;padding:7px;border:1px solid #aab5be;border-radius:4px;background:#fff;cursor:pointer}.seq-inspector button:disabled{opacity:.45;cursor:not-allowed}.seq-inspector button.danger{color:#a31d1d}
      .seq-help{margin-top:12px;padding:8px;border-radius:4px;background:#e8edf1;color:#45545e;font-size:10px;line-height:1.55}.seq-empty{padding:8px;color:#687782;font-size:11px}
      @media(max-width:1050px){.seq-workspace{grid-template-columns:180px minmax(0,1fr) 190px}.seq-topbar button,.seq-topbar label{padding:4px 5px}}
      @media print{body>*:not(#stage){display:none!important}#mv-stage,#mv-sequence-editor{display:block!important;position:static!important}.seq-topbar,.seq-palette,.seq-inspector,#seq-status{display:none!important}.seq-workspace{display:block}.seq-canvas-wrap{padding:0;background:#fff}#seq-svg{width:100vw;height:auto;box-shadow:none}}
    `;document.head.appendChild(style);
  }

  function mount(root){
    if(!root||state.root===root)return;state.root=root;injectStyles();loadStored();
    root.innerHTML=`
      <div class="seq-topbar">
        <strong>전기 시퀀스 편집기</strong>
        <button id="seq-new" type="button">빈 도면</button>
        <button id="seq-template-starter" type="button">3상 모터 기동 예제</button>
        <button id="seq-template-forward-reverse" type="button">정·역운전 예제</button>
        <button id="seq-undo" type="button">↶ Undo</button><button id="seq-redo" type="button">↷ Redo</button>
        <button id="seq-validate" type="button">검사</button><button id="seq-print" type="button">인쇄/PDF</button>
        <span class="seq-spacer"></span><button id="seq-export" type="button">JSON 저장</button>
        <label for="seq-import-file">JSON 열기</label><input id="seq-import-file" type="file" accept="application/json,.json" hidden>
      </div>
      <div class="seq-workspace">
        <aside class="seq-palette" aria-label="전기 시퀀스 도형 팔레트"><h3>도형 팔레트</h3><div id="seq-palette"></div></aside>
        <main class="seq-canvas-wrap"><svg id="seq-svg" viewBox="0 0 1600 1050" aria-label="전기 시퀀스 도면 편집 영역">
          <defs><pattern id="seq-small-grid" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0H0V20" fill="none" class="seq-grid-minor"/></pattern><pattern id="seq-big-grid" width="100" height="100" patternUnits="userSpaceOnUse"><rect width="100" height="100" fill="url(#seq-small-grid)"/><path d="M100 0H0V100" fill="none" class="seq-grid-major"/></pattern></defs>
          <rect class="seq-sheet" width="1600" height="1050"/><rect id="seq-grid" width="1600" height="1050" fill="url(#seq-big-grid)"/>
          <g id="seq-wires"></g><g id="seq-symbols"></g><g id="seq-overlay"></g>
        </svg><div id="seq-status">도형을 선택한 뒤 빈 도면을 클릭하거나 드래그해 놓으세요.</div></main>
        <aside class="seq-inspector"><h3>속성 / 편집</h3><div id="seq-inspector"></div></aside>
      </div>`;
    renderPalette();bindUi();render();
  }

  function bindUi(){
    q('#seq-new').onclick=()=>{if((state.document.symbols.length||state.document.wires.length)&&!confirm('현재 시퀀스 도면을 비우시겠습니까?'))return;snapshot();commit(Core.createDocument(),'빈 시퀀스 도면을 만들었습니다.');clearSelection();};
    q('#seq-template-starter').onclick=()=>{if((state.document.symbols.length||state.document.wires.length)&&!confirm('현재 도면을 3상 모터 기동 예제로 교체하시겠습니까?'))return;snapshot();clearSelection();commit(Core.createTemplate('motor-starter'),'3상 동력회로와 기동·정지 자기유지 제어회로를 만들었습니다.');};
    q('#seq-template-forward-reverse').onclick=()=>{if((state.document.symbols.length||state.document.wires.length)&&!confirm('현재 도면을 전기기능사 정·역운전 예제로 교체하시겠습니까?'))return;snapshot();clearSelection();commit(Core.createTemplate('forward-reverse'),'자기유지·EOCR·상호 인터록이 포함된 정·역운전 회로를 만들었습니다.');};
    q('#seq-undo').onclick=undo;q('#seq-redo').onclick=redo;
    q('#seq-validate').onclick=validate;q('#seq-print').onclick=()=>window.print();q('#seq-export').onclick=exportDocument;q('#seq-import-file').onchange=importDocument;
    const canvas=q('#seq-svg');canvas.addEventListener('click',canvasClick);canvas.addEventListener('pointerdown',pointerDown);canvas.addEventListener('pointermove',pointerMove);canvas.addEventListener('pointerup',pointerUp);canvas.addEventListener('pointercancel',pointerUp);
    canvas.addEventListener('dragover',event=>{event.preventDefault();});canvas.addEventListener('drop',dropSymbol);
    document.addEventListener('keydown',event=>{if(!state.visible)return;if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'){event.preventDefault();event.shiftKey?redo():undo();}else if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='y'){event.preventDefault();redo();}else if((event.key==='Delete'||event.key==='Backspace')&&!['INPUT','TEXTAREA'].includes(document.activeElement?.tagName)){event.preventDefault();deleteSelected();}else if(event.key==='Escape'){state.activeType=null;clearSelection();render();setStatus('선택을 취소했습니다.');}});
  }

  function renderPalette(){
    const panel=q('#seq-palette');panel.replaceChildren();const categories=[...new Set(Core.SYMBOL_CATALOG.map(item=>item.category))];
    for(const category of categories){const heading=document.createElement('h4');heading.textContent=category;panel.appendChild(heading);for(const item of Core.SYMBOL_CATALOG.filter(candidate=>candidate.category===category)){const button=document.createElement('button');button.type='button';button.className=`seq-symbol-button${state.activeType===item.type?' active':''}`;button.dataset.symbolType=item.type;button.draggable=true;button.innerHTML=`<span class="seq-symbol-mark">${symbolMark(item.type)}</span><span>${item.label}</span>`;button.onclick=()=>{state.activeType=item.type;renderPalette();setStatus(`${item.label} 선택 · 빈 도면을 클릭하거나 드래그해 놓으세요.`);};button.ondragstart=event=>event.dataTransfer.setData('text/x-sequence-symbol',item.type);panel.appendChild(button);}}
  }
  function symbolMark(type){if(type.includes('3p'))return '3Φ';if(type.includes('nc'))return '—|/|—';if(type.includes('no')||type.includes('contact'))return '—| |—';if(type.includes('coil'))return '( )';if(type==='lamp')return '⊗';if(type==='pe')return '⏚';return '▣';}

  function canvasPoint(event){const canvas=q('#seq-svg'),matrix=canvas.getScreenCTM();if(!matrix)return {x:0,y:0};const point=new DOMPoint(event.clientX,event.clientY).matrixTransform(matrix.inverse());return {x:Math.round(point.x/20)*20,y:Math.round(point.y/20)*20};}
  function canvasClick(event){
    if(event.target.closest?.('[data-symbol-id],[data-wire-id],[data-terminal]'))return;
    if(state.activeType){const point=canvasPoint(event);snapshot();const result=Core.addSymbol(state.document,state.activeType,{x:point.x-60,y:point.y-32});state.selectedSymbol=result.symbol.id;state.selectedWire=null;commit(result.document,`${result.symbol.ref} 도형을 추가했습니다.`);return;}
    clearSelection();render();
  }
  function dropSymbol(event){event.preventDefault();const type=event.dataTransfer.getData('text/x-sequence-symbol');if(!Core.symbolDefinition(type))return;const point=canvasPoint(event);snapshot();const result=Core.addSymbol(state.document,type,{x:point.x-60,y:point.y-32});state.selectedSymbol=result.symbol.id;state.selectedWire=null;commit(result.document,`${result.symbol.ref} 도형을 배치했습니다.`);}

  function pointerDown(event){
    const terminalNode=event.target.closest?.('[data-terminal]');if(terminalNode){event.preventDefault();event.stopPropagation();terminalClick(terminalNode.dataset.symbolId,terminalNode.dataset.terminal);return;}
    const wireNode=event.target.closest?.('[data-wire-id]');if(wireNode){state.selectedWire=wireNode.dataset.wireId;state.selectedSymbol=null;render();setStatus(`결선 ${state.selectedWire} 선택 · 직렬/병렬 삽입 또는 삭제가 가능합니다.`);event.stopPropagation();return;}
    const symbolNode=event.target.closest?.('[data-symbol-id]');if(!symbolNode)return;const symbol=state.document.symbols.find(item=>item.id===symbolNode.dataset.symbolId);if(!symbol)return;state.selectedSymbol=symbol.id;state.selectedWire=null;state.drag={symbolId:symbol.id,start:canvasPoint(event),origin:{x:symbol.x,y:symbol.y},moved:false};q('#seq-svg').setPointerCapture?.(event.pointerId);render();event.stopPropagation();
  }
  function pointerMove(event){if(!state.drag)return;const point=canvasPoint(event),dx=point.x-state.drag.start.x,dy=point.y-state.drag.start.y;if(Math.abs(dx)+Math.abs(dy)<5)return;if(!state.drag.moved){snapshot();state.drag.moved=true;}state.document=Core.updateSymbol(state.document,state.drag.symbolId,{x:state.drag.origin.x+dx,y:state.drag.origin.y+dy});render(false);}
  function pointerUp(){if(!state.drag)return;if(state.drag.moved){persist();setStatus('도형 위치를 이동했습니다.');}state.drag=null;}

  function terminalClick(symbolId,terminalId){
    const endpoint={kind:'terminal',symbolId,terminalId};
    if(!state.pendingTerminal){state.pendingTerminal=endpoint;render();setStatus(`${symbolRef(symbolId)}.${terminalId}에서 결선을 시작했습니다. 두 번째 단자를 클릭하세요.`);return;}
    if(state.pendingTerminal.symbolId===symbolId&&state.pendingTerminal.terminalId===terminalId){state.pendingTerminal=null;render();setStatus('결선 시작점을 취소했습니다.');return;}
    try{snapshot();const result=Core.connect(state.document,state.pendingTerminal,endpoint);state.pendingTerminal=null;state.selectedWire=result.wire.id;state.selectedSymbol=null;commit(result.document,`결선 ${result.wire.id}을 만들었습니다.`);}catch(error){state.history.pop();state.pendingTerminal=null;render();setStatus(error.message,'error');}
  }

  function render(){if(!state.root)return;renderWires();renderSymbols();renderInspector();renderPalette();q('#seq-undo').disabled=!state.history.length;q('#seq-redo').disabled=!state.future.length;}
  function renderWires(){
    const group=q('#seq-wires');group.replaceChildren();const degree=new Map();
    for(const wire of state.document.wires){for(const endpoint of [wire.from,wire.to]){const key=endpoint.kind==='terminal'?`${endpoint.symbolId}.${endpoint.terminalId}`:`${endpoint.x},${endpoint.y}`;degree.set(key,(degree.get(key)||0)+1);}const path=wire.points.map((point,index)=>`${index?'L':'M'} ${point.x} ${point.y}`).join(' ');const hit=svg('path',{d:path,className:'seq-wire-hit','data-wire-id':wire.id});const line=svg('path',{d:path,stroke:wire.color||'#111827',className:`seq-wire${state.selectedWire===wire.id?' selected':''}`});group.append(hit,line);}
    const overlay=q('#seq-overlay');overlay.replaceChildren();for(const [key,count] of degree){if(count<2)continue;const endpoint=state.document.wires.flatMap(wire=>[wire.from,wire.to]).find(item=>(item.kind==='terminal'?`${item.symbolId}.${item.terminalId}`:`${item.x},${item.y}`)===key);try{const point=Core.endpointPoint(state.document,endpoint);overlay.appendChild(svg('circle',{cx:point.x,cy:point.y,r:5,className:'seq-junction'}));}catch(_){}}
    for(const note of state.document.notes||[])overlay.appendChild(svg('text',{x:note.x,y:note.y,className:'seq-note'},note.text));
  }

  function renderSymbols(){const group=q('#seq-symbols');group.replaceChildren();for(const symbol of state.document.symbols){const definition=definitionFor(symbol),g=svg('g',{className:`seq-symbol${state.selectedSymbol===symbol.id?' selected':''}`,'data-symbol-id':symbol.id,transform:`translate(${symbol.x} ${symbol.y})`});drawSymbol(g,symbol,definition);for(const term of definition.terminals)drawTerminal(g,symbol,term);group.appendChild(g);}}
  function drawTerminal(group,symbol,term){const pending=state.pendingTerminal?.symbolId===symbol.id&&state.pendingTerminal?.terminalId===term.id;const circle=svg('circle',{cx:term.x,cy:term.y,r:6,className:`seq-terminal${pending?' pending':''}`,'data-terminal':term.id,'data-symbol-id':symbol.id});group.appendChild(circle);const offset=term.side==='left'?10:term.side==='right'?-10:0,anchor=term.side==='left'?'start':term.side==='right'?'end':'middle',y=term.side==='top'?term.y+17:term.side==='bottom'?term.y-10:term.y-9;group.appendChild(svg('text',{x:term.x+offset,y,'text-anchor':anchor,className:'seq-terminal-label'},term.label));}
  function drawSymbol(group,symbol,def){
    const w=def.width,h=def.height,type=symbol.type;group.appendChild(svg('rect',{x:0,y:0,width:w,height:h,rx:5,className:'body'}));group.appendChild(svg('text',{x:w/2,y:17,className:'seq-symbol-title'},symbol.ref));group.appendChild(svg('text',{x:w/2,y:h-8,className:'seq-symbol-sub'},symbol.label));
    const line=(x1,y1,x2,y2,cls='seq-symbol-line')=>group.appendChild(svg('line',{x1,y1,x2,y2,className:cls}));
    if(['mccb-3p','mc-main-3p','eocr-3p'].includes(type)){for(const y of [35,75,115]){line(8,y,w/2-16,y);line(w/2+16,y,w-8,y);if(type==='mccb-3p'){group.appendChild(svg('circle',{cx:w/2-14,cy:y,r:2.5,fill:'#111'}));group.appendChild(svg('circle',{cx:w/2+14,cy:y,r:2.5,fill:'#111'}));line(w/2-12,y-2,w/2+11,y-12);}else if(type==='mc-main-3p'){line(w/2-14,y-12,w/2-14,y+12);line(w/2+14,y-12,w/2+14,y+12);}else group.appendChild(svg('path',{d:`M ${w/2-18} ${y} l 7 -8 l 7 16 l 7 -16 l 7 8`,className:'seq-symbol-line'}));}if(type==='mc-main-3p')line(w/2,26,w/2,124,'seq-symbol-dashed');}
    else if(type==='source-3p'){for(const [index,label] of ['R','S','T'].entries()){const y=35+index*40;line(16,y,w-8,y);group.appendChild(svg('text',{x:25,y:y-6,className:'seq-symbol-title'},label));}}
    else if(type==='motor-3p'){const cx=w*.6,cy=h*.52;group.appendChild(svg('circle',{cx,cy,r:38,className:'seq-symbol-line'}));group.appendChild(svg('text',{x:cx,y:cy+5,className:'seq-symbol-title'},'M 3~'));for(const [index,y] of [35,75,115].entries())line(8,y,cx-35,cy-22+index*22);line(cx+18,cy+33,w/2,h-2);}
    else if(type==='pe'){const cx=w/2;line(cx,8,cx,35);[34,22,10].forEach((width,index)=>line(cx-width/2,40+index*8,cx+width/2,40+index*8));}
    else if(type==='control-power'){line(22,35,w-8,35);line(22,115,w-8,115);group.appendChild(svg('text',{x:30,y:30,className:'seq-symbol-title'},'L'));group.appendChild(svg('text',{x:30,y:110,className:'seq-symbol-title'},'N'));}
    else if(type.includes('contact')||type.startsWith('pb-')||type.startsWith('selector-')||type.startsWith('limit-')||type==='eocr-nc'){const y=32,m=w/2;line(7,y,m-13,y);line(m+13,y,w-7,y);line(m-13,y-13,m-13,y+13);line(m+13,y-13,m+13,y+13);if(type.includes('nc'))line(m-18,y+14,m+18,y-14);if(type==='timer-contact-no')group.appendChild(svg('path',{d:`M ${m-3} 7 q 15 0 15 15`,className:'seq-symbol-line'}));}
    else if(type.includes('coil')){const y=32,m=w/2;line(7,y,m-25,y);group.appendChild(svg('path',{d:`M ${m-25} ${y} C ${m-11} 9 ${m-11} 55 ${m} ${y} C ${m+11} 9 ${m+11} 55 ${m+25} ${y}`,className:'seq-symbol-line'}));line(m+25,y,w-7,y);}
    else if(type==='lamp'||type==='buzzer'){const y=32,m=w/2;line(7,y,m-17,y);group.appendChild(svg('circle',{cx:m,cy:y,r:17,className:'seq-symbol-line'}));if(type==='lamp'){line(m-11,y-11,m+11,y+11);line(m-11,y+11,m+11,y-11);}else group.appendChild(svg('text',{x:m,y:y+4,className:'seq-symbol-title'},'BZ'));line(m+17,y,w-7,y);}
  }

  function renderInspector(){
    const panel=q('#seq-inspector');panel.replaceChildren();
    if(state.selectedSymbol){const symbol=state.document.symbols.find(item=>item.id===state.selectedSymbol);if(!symbol)return;panel.innerHTML=`<label class="seq-field">기기 번호<input id="seq-ref" value="${escapeAttribute(symbol.ref)}" maxlength="30"></label><label class="seq-field">표시 이름<input id="seq-label" value="${escapeAttribute(symbol.label)}" maxlength="80"></label><div class="seq-help">같은 물리 장비의 심볼은 동일한 기기 번호를 사용하세요.<br>예: MC 주접점, MC 코일, MC 보조접점 모두 <b>MC1</b></div><button id="seq-delete-symbol" class="danger" type="button">선택 도형 삭제</button>`;q('#seq-ref').onchange=event=>editSelected({ref:event.target.value});q('#seq-label').onchange=event=>editSelected({label:event.target.value});q('#seq-delete-symbol').onclick=deleteSelected;return;}
    if(state.selectedWire){panel.innerHTML=`<p><b>${state.selectedWire}</b> 결선 선택됨</p><button id="seq-insert-series" type="button">선택 도형 직렬 삽입</button><button id="seq-insert-parallel" type="button">선택 도형 병렬 분기</button><button id="seq-delete-wire" class="danger" type="button">선택 결선 삭제</button><div class="seq-help">먼저 왼쪽에서 2단자 제어 도형을 고른 뒤 직렬 또는 병렬 버튼을 누르세요. 병렬 분기점은 검은 점으로 표시됩니다.</div>`;q('#seq-insert-series').onclick=()=>insertSelected('series');q('#seq-insert-parallel').onclick=()=>insertSelected('parallel');q('#seq-delete-wire').onclick=deleteSelected;return;}
    const issues=Core.validateDocument(state.document);panel.innerHTML=`<div class="seq-empty">도형 또는 결선을 선택하세요.</div><div class="seq-help"><b>작성 순서</b><br>1. 도형 선택/드롭<br>2. 단자 ○ 두 개 클릭<br>3. 선을 클릭해 직렬·병렬 삽입<br>4. 기기 번호로 MC 접점/코일 연계<br><br>도형 ${state.document.symbols.length}개 · 결선 ${state.document.wires.length}개 · 오류 ${issues.filter(issue=>issue.severity==='error').length}개</div>`;
  }
  function escapeAttribute(value){return String(value).replace(/[&"<>]/g,char=>({'&':'&amp;','"':'&quot;','<':'&lt;','>':'&gt;'}[char]));}
  function symbolRef(id){return state.document.symbols.find(symbol=>symbol.id===id)?.ref||id;}
  function editSelected(patch){if(!state.selectedSymbol)return;snapshot();commit(Core.updateSymbol(state.document,state.selectedSymbol,patch),'도형 속성을 변경했습니다.');}
  function insertSelected(mode){if(!state.selectedWire)return;if(!state.activeType){setStatus('왼쪽 팔레트에서 삽입할 2단자 도형을 먼저 선택하세요.','error');return;}try{snapshot();const result=mode==='series'?Core.insertSeries(state.document,state.selectedWire,state.activeType):Core.insertParallel(state.document,state.selectedWire,state.activeType);state.selectedSymbol=result.symbol.id;state.selectedWire=null;commit(result.document,mode==='series'?'선택 결선에 도형을 직렬 삽입했습니다.':'선택 결선에 병렬 분기를 추가했습니다.');}catch(error){state.history.pop();setStatus(error.message,'error');}}
  function deleteSelected(){if(state.selectedSymbol){snapshot();const ref=symbolRef(state.selectedSymbol);commit(Core.deleteSymbol(state.document,state.selectedSymbol),`${ref} 도형과 연결 결선을 삭제했습니다.`);}else if(state.selectedWire){snapshot();commit(Core.removeWire(state.document,state.selectedWire),`${state.selectedWire} 결선을 삭제했습니다.`);}clearSelection();render();}
  function validate(){const issues=Core.validateDocument(state.document);if(!issues.length)setStatus(`검사 완료 · 도형 ${state.document.symbols.length}개 · 결선 ${state.document.wires.length}개 · 오류 없음`);else setStatus(`검사 결과: ${issues.map(issue=>issue.message).join(', ')}`,'error');}
  function exportDocument(){const blob=new Blob([Core.serializeDocument(state.document)],{type:'application/json'}),url=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=url;anchor.download=`${state.document.title.replace(/[^a-z0-9가-힣_-]+/gi,'_')||'sequence'}.json`;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),0);setStatus('시퀀스 JSON을 저장했습니다.');}
  async function importDocument(event){const file=event.target.files?.[0];event.target.value='';if(!file)return;try{const text=await file.text(),next=Core.deserializeDocument(text);snapshot();clearSelection();commit(next,`${file.name} 시퀀스 도면을 열었습니다.`);}catch(error){setStatus(error.message,'error');}}

  function setVisible(visible){state.visible=Boolean(visible);if(!state.root){const root=document.querySelector('#mv-sequence-editor');if(root)mount(root);}state.root?.classList.toggle('show',state.visible);if(state.visible)render();}
  function renderActive(){if(state.visible)render();}
  function replaceDocument(documentValue){snapshot();clearSelection();commit(Core.deserializeDocument(Core.serializeDocument(documentValue)),'시퀀스 문서를 적용했습니다.');}

  window.PLCTrainerSequenceEditor={version:'1.0.0',mount,setVisible,renderActive,replaceDocument,exportState:()=>JSON.parse(Core.serializeDocument(state.document)),get activeDocument(){return state.document;}};
})();
