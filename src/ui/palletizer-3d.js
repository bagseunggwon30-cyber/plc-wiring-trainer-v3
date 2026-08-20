(function(){
  'use strict';
  if(typeof window==='undefined'||typeof document==='undefined')return;
  const Runtime=window.PLCTrainerPalletizerRuntime;
  const Three=window.THREE;
  const CameraNavigation=window.PLCTrainerCameraNavigation;
  if(!Runtime||!CameraNavigation){console.error('Palletizer runtime or camera navigation missing');return;}

  const P={
    visible:false,initialized:false,state:null,host:null,sceneHost:null,renderer:null,scene:null,camera:null,
    raf:0,lastTime:0,lastUi:0,lastSave:0,placedStamp:'',palletStamp:'',parts:{},cameraOrbit:{yaw:.78,pitch:.5,distance:15.2},
    cameraTarget:{x:0,y:2,z:0},cameraNavigationPreset:'3ds-max',drag:null,resizeObserver:null,
    renderDirty:true,activeJogs:new Map(),safetyHandlers:null,axisWorldPoint:null,
    modelLoad:{status:'idle',source:'procedural',attempts:0,generation:0,error:null,missingNodes:[],promise:null,retryTimer:0,retryAt:0,startedAt:0,completedAt:0}
  };
  const PALLETIZER_MODEL='palletizer-3axis-v2.glb';
  const MODEL_NODE_NAMES=Object.freeze(['X_Carriage','Y_Carriage','Z_Slide','Gripper','Jaw_L','Jaw_R']);
  const MODEL_RETRY_DELAYS=Object.freeze([450,1400]);
  const MODEL_LOAD_TIMEOUT_MS=12000;
  const AXIS_SCENE_RANGES=Object.freeze({
    X:Object.freeze({component:'x',start:-4.45,end:4.45}),
    Y:Object.freeze({component:'z',start:2.5,end:-2.65}),
    Z:Object.freeze({component:'y',start:.62,end:4.42})
  });
  const AXIS_WORLD_COMPONENTS=Object.freeze({X:'x',Y:'z',Z:'y'});
  const q=(selector,root=document)=>root.querySelector(selector);
  const qa=(selector,root=document)=>[...root.querySelectorAll(selector)];
  const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const mmX=value=>-4.45+(Number(value)||0)/600*8.9;
  const mmY=value=>2.5-(Number(value)||0)/420*5.15;
  const mmZ=value=>.62+(Number(value)||0)/280*3.8;
  const finite=(value,fallback=0)=>Number.isFinite(Number(value))?Number(value):fallback;
  function axisSceneCoordinate(name,axis){
    const range=AXIS_SCENE_RANGES[name],min=finite(axis?.min,0),max=finite(axis?.max,min+1),position=clamp(finite(axis?.position,min),min,max);
    const ratio=max===min?0:(position-min)/(max-min);return range.start+(range.end-range.start)*ratio;
  }
  function setAxisWorldCoordinate(binding,value){
    const node=binding?.node,parent=node?.parent;if(!node||!parent)return false;
    const point=P.axisWorldPoint||(P.axisWorldPoint=new Three.Vector3());
    parent.updateMatrixWorld(true);node.getWorldPosition(point);point[binding.worldComponent]=value;
    parent.worldToLocal(point);node.position.copy(point);node.updateMatrixWorld(true);return true;
  }
  function isEffectivelyVisible(object){for(let cursor=object;cursor;cursor=cursor.parent)if(cursor.visible===false)return false;return !!object;}
  function stopActiveJogs(){
    if(!P.state||!P.activeJogs?.size)return false;
    for(const address of P.activeJogs.values())Runtime.writeDevice(P.state,address,false);
    P.activeJogs.clear();P.renderDirty=true;if(P.initialized){updateUi(true);persist(true);schedule();}return true;
  }
  function installJogSafetyHandlers(){
    if(P.safetyHandlers)return;
    const blur=()=>stopActiveJogs(),visibility=()=>{if(document.hidden)stopActiveJogs();};
    window.addEventListener('blur',blur);document.addEventListener('visibilitychange',visibility);P.safetyHandlers={blur,visibility};
  }
  function isDescendantOf(node,parent){
    for(let cursor=node?.parent;cursor;cursor=cursor.parent)if(cursor===parent)return true;
    return false;
  }
  function resolveMovingHierarchy(model){
    const found={},duplicates=[];
    model?.traverse?.(object=>{if(!MODEL_NODE_NAMES.includes(object.name))return;if(found[object.name])duplicates.push(object.name);else found[object.name]=object;});
    const missingNodes=MODEL_NODE_NAMES.filter(name=>!found[name]),relationships=[];
    if(!missingNodes.length){
      if(!isDescendantOf(found.Y_Carriage,found.X_Carriage))relationships.push('Y_Carriage must be below X_Carriage');
      if(!isDescendantOf(found.Z_Slide,found.Y_Carriage))relationships.push('Z_Slide must be below Y_Carriage');
      if(!isDescendantOf(found.Gripper,found.Z_Slide))relationships.push('Gripper must be below Z_Slide');
      for(const jaw of ['Jaw_L','Jaw_R'])if(!isDescendantOf(found[jaw],found.Gripper))relationships.push(`${jaw} must be below Gripper`);
    }
    return {ok:missingNodes.length===0&&duplicates.length===0&&relationships.length===0,nodes:found,missingNodes,duplicates,relationships};
  }
  function resolveWorldAxisBinding(node,name){
    const targetComponent=AXIS_WORLD_COMPONENTS[name],target=new Three.Vector3(targetComponent==='x'?1:0,targetComponent==='y'?1:0,targetComponent==='z'?1:0);
    node.parent?.updateWorldMatrix?.(true,false);const parentRotation=new Three.Quaternion();node.parent?.getWorldQuaternion?.(parentRotation);
    let component='x',direction=1,best=-1;
    for(const candidate of ['x','y','z']){
      const basis=new Three.Vector3(candidate==='x'?1:0,candidate==='y'?1:0,candidate==='z'?1:0).applyQuaternion(parentRotation),alignment=basis.dot(target);
      if(Math.abs(alignment)>best){best=Math.abs(alignment);component=candidate;direction=alignment<0?-1:1;}
    }
    return {node,component,direction,worldComponent:targetComponent};
  }

  function loadSavedState(){
    let saved=null;
    try{if(typeof S!=='undefined')saved=S.palletizer3d||null;}catch(_){/* separate renderer tests */}
    return Runtime.createState(saved?{saved}:{});
  }
  function persist(force=false){
    if(!P.state)return null;
    const now=performance.now();if(!force&&now-P.lastSave<700)return null;P.lastSave=now;
    const saved=Runtime.exportState(P.state);
    try{if(typeof S!=='undefined')S.palletizer3d=saved;}catch(_){/* standalone */}
    return saved;
  }

  function injectCss(){
    if(q('#p3-style'))return;
    const style=document.createElement('style');style.id='p3-style';style.textContent=`
      #mv-palletizer{display:none;position:absolute;inset:0;background:#091119;color:#d8e4ec;overflow:hidden}
      #mv-palletizer.show{display:block}
      #p3-root{position:absolute;inset:0;display:grid;grid-template-columns:minmax(0,1fr) 330px;background:#091119;font-family:'Malgun Gothic',sans-serif}
      #p3-scene{position:relative;min-width:0;overflow:hidden;background:radial-gradient(circle at 45% 35%,#21313d,#071018 70%)}
      #p3-scene canvas{display:block;width:100%;height:100%;touch-action:none;outline:none}
      #p3-scene-badge{position:absolute;z-index:3;left:14px;top:12px;display:flex;gap:8px;align-items:center;padding:7px 10px;border:1px solid #355165;border-radius:5px;background:rgba(5,13,19,.82);backdrop-filter:blur(5px);pointer-events:none}
      #p3-scene-badge b{color:#fff;font-size:13px}#p3-scene-badge span{color:#8fb0c4;font:10px Consolas,monospace}
      #p3-camera-hint{position:absolute;z-index:3;left:14px;bottom:12px;padding:5px 8px;border-radius:4px;background:rgba(5,13,19,.75);color:#93aaba;font-size:10px;pointer-events:none}
      #p3-side{overflow:auto;border-left:1px solid #263c4b;background:#101a22;padding:12px 12px 22px;scrollbar-color:#496271 #101a22}
      .p3-section{margin:0 0 10px;padding:9px;border:1px solid #2a4252;border-radius:6px;background:#14222c;box-shadow:0 2px 8px rgba(0,0,0,.18)}
      .p3-section h3{margin:0 0 7px;color:#a9ccdf;font-size:11px;letter-spacing:.04em}.p3-section small{color:#7f9aaa;font-size:9px}
      #p3-state{display:flex;justify-content:space-between;gap:8px;margin-bottom:8px;padding:7px;border-radius:4px;background:#0d171e;color:#fff}
      #p3-state b{font-size:12px}#p3-state span{color:#81caee;font:10px Consolas,monospace;text-align:right}
      .p3-actions{display:grid;grid-template-columns:1fr 1fr;gap:5px}.p3-actions button,.p3-btn{border:1px solid #476173;border-radius:4px;background:#253846;color:#e8f2f8;padding:7px 5px;cursor:pointer;font-size:10px}
      .p3-actions button:hover,.p3-btn:hover{background:#31546b;border-color:#69a6ca}.p3-actions .run{background:#17613f;border-color:#2c9666}.p3-actions .stop{background:#7a342d;border-color:#b55a4f}
      .p3-profile{display:grid;grid-template-columns:76px 1fr;gap:7px;align-items:center;margin-bottom:8px;color:#8ba7b7;font-size:9px}.p3-profile select{width:100%;box-sizing:border-box;border:1px solid #38505f;border-radius:3px;background:#071017;color:#dcebf3;padding:5px;font:9px 'Malgun Gothic',sans-serif}
      .p3-axis{display:grid;grid-template-columns:22px 1fr auto;gap:6px;align-items:center;margin:5px 0;padding:6px;border-radius:4px;background:#0d171e}
      .p3-axis>strong{font:700 13px Consolas;color:#69c9f5}.p3-axis-main{min-width:0}.p3-axis-value{font:700 12px Consolas;color:#fff}.p3-axis-flags{margin-top:2px;color:#7793a4;font:8px Consolas,monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .p3-jog{display:grid;grid-template-columns:28px 28px;gap:3px}.p3-jog button{height:27px;border:1px solid #405968;background:#21313c;color:#fff;border-radius:3px;cursor:pointer;font:bold 12px Consolas}
      .p3-target{display:grid;grid-template-columns:1fr 46px;gap:4px;margin-top:4px}.p3-target input,.p3-grid input,#p3-address,#p3-value{min-width:0;border:1px solid #38505f;border-radius:3px;background:#071017;color:#dcebf3;padding:5px;font:10px Consolas}.p3-target button{border:1px solid #486579;border-radius:3px;background:#29465a;color:#fff;font-size:9px;cursor:pointer}
      .p3-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:5px}.p3-grid label{color:#89a4b5;font-size:8px}.p3-grid input{display:block;width:100%;box-sizing:border-box;margin-top:2px}
      .p3-write{display:grid;grid-template-columns:65px 1fr 44px;gap:4px;margin-top:7px}.p3-write button{border:1px solid #56798c;background:#26536a;color:#fff;border-radius:3px;font-size:9px;cursor:pointer}
      #p3-memory{width:100%;margin-top:7px;border-collapse:collapse;font:9px Consolas,monospace}#p3-memory th,#p3-memory td{border:1px solid #2d4350;padding:3px 4px;text-align:left}#p3-memory th{color:#92b8cc;background:#0b151c}#p3-memory td:last-child{text-align:right;color:#fff}
      #p3-log{max-height:74px;overflow:auto;margin-top:6px;color:#83a0b0;font:8px Consolas,monospace}#p3-log div{padding:2px 0;border-bottom:1px dotted #29404e}.p3-alarm{color:#ff8177!important}.p3-on{color:#75e6a7!important}
      .p3-production-only{display:none}.production-profile .p3-production-only{display:block}.p3-production-inputs{display:grid;grid-template-columns:1fr 1fr;gap:4px}.p3-production-inputs label{display:flex;align-items:center;gap:4px;padding:4px;border:1px solid #304856;border-radius:3px;background:#0b151c;color:#b9d1de;font:8px Consolas,monospace}.p3-production-inputs input{accent-color:#48ba7b}.p3-production-note{margin:0 0 6px;color:#9bc5da;font-size:9px;line-height:1.4}
      @media(max-width:920px){#p3-root{grid-template-columns:minmax(0,1fr) 285px}}
    `;document.head.appendChild(style);
  }

  function injectUi(){
    P.host=q('#mv-palletizer');if(!P.host)return false;
    P.host.innerHTML=`<div id="p3-root">
      <div id="p3-scene"><div id="p3-scene-badge"><b>3축 팔레타이징 셀</b><span>OFFLINE DIGITAL TWIN</span></div><div id="p3-camera-hint">Alt+가운데 드래그: 회전 · 가운데 드래그: 이동 · 휠: 확대/축소</div></div>
      <aside id="p3-side">
        <section class="p3-section"><div id="p3-state"><b>대기</b><span>IDLE</span></div><label class="p3-profile">PLC 선택<select id="p3-profile"><option value="ls">LS XGB / XG5000</option><option value="mitsubishi">Mitsubishi QnU / MELSOFT</option><option value="xgb-production">XGB XBC-DN32UP / XG5000 생산 계약</option></select></label><div class="p3-actions">
          <button class="run" data-action="auto">▶ 자동 시작</button><button class="stop" data-action="stop">■ 정지</button>
          <button data-action="home">⌂ 전축 원점</button><button data-action="alarm-reset">↺ 알람 리셋</button>
          <button data-action="servo">SERVO ON</button><button data-action="clear">팔레트 비우기</button>
        </div></section>
        <section class="p3-section p3-production-only" id="p3-production-controls"><h3>XGB 생산 입출력 계약 <small>P00000–P0000F · 수동 ORG</small></h3><p class="p3-production-note">실제 PLC 전송 없이 현재 오프라인 상태의 물리 입력과 생산 계약 주소 이미지를 표시합니다.</p><button class="p3-btn" data-action="manual-org" type="button">수동 ORG · Z → X → Y (M00119)</button><div class="p3-production-inputs" id="p3-production-inputs"></div></section>
        <section class="p3-section"><h3>축 수동 운전 <small>mm · 누르는 동안 JOG</small></h3>${['X','Y','Z'].map(axis=>`
          <div class="p3-axis" data-axis-card="${axis}"><strong>${axis}</strong><div class="p3-axis-main"><div class="p3-axis-value" data-axis-value="${axis}">0.00</div><div class="p3-axis-flags" data-axis-flags="${axis}">SERVO OFF</div><div class="p3-target"><input data-axis-target="${axis}" type="number" step="1" value="${axis==='Z'?238:axis==='X'?74:62}"><button data-axis-move="${axis}">ABS</button></div></div><div class="p3-jog"><button data-jog="${axis},-1">−</button><button data-jog="${axis},1">＋</button></div></div>`).join('')}</section>
        <section class="p3-section"><h3>팔레트 패턴</h3><div class="p3-grid"><label>행<input id="p3-rows" type="number" min="1" max="8" value="3"></label><label>열<input id="p3-cols" type="number" min="1" max="8" value="3"></label><label>단<input id="p3-layers" type="number" min="1" max="5" value="1"></label></div><button class="p3-btn" data-action="pattern" style="width:100%;margin-top:6px">패턴 적용 · 현재 제품 초기화</button></section>
        <section class="p3-section"><h3 id="p3-address-title">선택 PLC 주소 이미지 <small>내부 메모리 시뮬레이션</small></h3><small id="p3-profile-note">실제 PLC에는 쓰지 않습니다. 선택한 한 제조사의 교육용 기본 주소만 활성화됩니다.</small><div class="p3-write"><input id="p3-address" value="M100" aria-label="선택 PLC 주소"><input id="p3-value" value="1" aria-label="쓰기 값"><button id="p3-write">쓰기</button></div><table id="p3-memory"><thead><tr><th>주소</th><th>의미</th><th>값</th></tr></thead><tbody></tbody></table><div id="p3-log"></div></section>
      </aside></div>`;
    P.sceneHost=q('#p3-scene',P.host);return true;
  }

  function material(color,metalness=.35,roughness=.55,extra={}){return new Three.MeshStandardMaterial({color,metalness,roughness,...extra});}
  function box(parent,size,position,mat,rotation){
    const mesh=new Three.Mesh(new Three.BoxGeometry(size[0],size[1],size[2]),mat);mesh.position.set(position[0],position[1],position[2]);
    if(rotation)mesh.rotation.set(rotation[0]||0,rotation[1]||0,rotation[2]||0);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;
  }
  function cylinder(parent,radius,length,position,mat,axis='x'){
    const mesh=new Three.Mesh(new Three.CylinderGeometry(radius,radius,length,20),mat);mesh.position.set(...position);
    if(axis==='x')mesh.rotation.z=Math.PI/2;else if(axis==='z')mesh.rotation.x=Math.PI/2;mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;
  }
  function servo(parent,position,rotationY=0){
    const group=new Three.Group();group.position.set(...position);group.rotation.y=rotationY;parent.add(group);
    box(group,[.62,.58,.62],[0,0,0],P.materials.servo);box(group,[.3,.3,.12],[0,0,.36],P.materials.dark);cylinder(group,.12,.28,[0,0,.57],P.materials.shaft,'z');
    return group;
  }
  function extrusion(parent,size,position){
    const group=new Three.Group();group.position.set(...position);parent.add(group);box(group,size,[0,0,0],P.materials.frame);
    const axis=size.indexOf(Math.max(...size)),groove=.025,edge=.38;
    if(axis===0){
      for(const y of [-size[1]*edge,size[1]*edge])for(const z of [-size[2]*edge,size[2]*edge])box(group,[size[0]*.965,groove,groove],[0,y,z],P.materials.groove);
    }else if(axis===1){
      for(const x of [-size[0]*edge,size[0]*edge])for(const z of [-size[2]*edge,size[2]*edge])box(group,[groove,size[1]*.965,groove],[x,0,z],P.materials.groove);
    }else{
      for(const x of [-size[0]*edge,size[0]*edge])for(const y of [-size[1]*edge,size[1]*edge])box(group,[groove,groove,size[2]*.965],[x,y,0],P.materials.groove);
    }
    return group;
  }
  function cableChain(parent,start,end,count=14){
    const group=new Three.Group();group.name='energy-chain';parent.add(group);const a=new Three.Vector3(...start),b=new Three.Vector3(...end);
    for(let index=0;index<count;index+=1){
      const t=count===1?0:index/(count-1),point=a.clone().lerp(b,t),link=box(group,[.18,.1,.26],point.toArray(),P.materials.chain);
      link.name='energy-chain-link';
    }
    P.parts.cableChains.push(group);return group;
  }
  function safetyPost(parent,x,z,height=2.65){
    extrusion(parent,[.16,height,.16],[x,.45+height/2,z]);box(parent,[.32,.1,.32],[x,.43,z],P.materials.yellow);
  }
  function led(parent,position){
    const mesh=new Three.Mesh(new Three.SphereGeometry(.08,16,12),P.materials.ledOff.clone());mesh.position.set(...position);parent.add(mesh);return mesh;
  }
  function setLed(mesh,on,alarm=false){
    const color=alarm?0xff3f35:on?0x46ff8c:0x20313a;mesh.material.color.setHex(color);mesh.material.emissive.setHex(on||alarm?color:0x000000);mesh.material.emissiveIntensity=on||alarm?1.6:0;
  }

  function createScene(){
    if(!Three){P.sceneHost.innerHTML='<div style="padding:40px;color:#ff9a8f">3D 엔진을 불러오지 못했습니다. assets/vendor/three.min.js를 확인하세요.</div>';return false;}
    P.scene=new Three.Scene();P.scene.background=new Three.Color(0x0b151d);P.scene.fog=new Three.Fog(0x0b151d,13,25);
    P.camera=new Three.PerspectiveCamera(42,1,.1,60);
    P.renderer=new Three.WebGLRenderer({antialias:true,powerPreference:'high-performance'});P.renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.65));
    P.renderer.shadowMap.enabled=true;P.renderer.shadowMap.type=Three.PCFSoftShadowMap;P.renderer.outputEncoding=Three.sRGBEncoding;
    P.renderer.domElement.tabIndex=0;P.sceneHost.insertBefore(P.renderer.domElement,q('#p3-camera-hint',P.sceneHost));
    P.materials={
      frame:material(0x5b6870,.72,.32),rail:material(0xb6c1c8,.82,.2),dark:material(0x1b252c,.55,.45),servo:material(0x394752,.48,.35),
      blue:material(0x176fa3,.4,.35),yellow:material(0xf0bb2f,.25,.48),red:material(0xbf4038,.35,.45),wood:material(0x9a6437,.12,.72),
      box:material(0xd8a14b,.05,.7),jaw:material(0x88969e,.75,.25),sensor:material(0x20282d,.45,.42),
      shaft:material(0xd6dde1,.92,.16),groove:material(0x242d33,.48,.42),chain:material(0x10171c,.35,.5),
      guard:material(0x4e9fc1,.12,.55,{transparent:true,opacity:.2,side:Three.DoubleSide}),cabinet:material(0xc3c9c9,.58,.34),
      ledOff:material(0x20313a,.1,.4,{emissive:0x000000}),ghost:material(0x4ec9ff,.05,.45,{transparent:true,opacity:.18})
    };
    const hemi=new Three.HemisphereLight(0xc4e8ff,0x253027,1.45);P.scene.add(hemi);
    const sun=new Three.DirectionalLight(0xffffff,1.35);sun.position.set(-5,11,7);sun.castShadow=true;sun.shadow.mapSize.set(1536,1536);sun.shadow.camera.left=-10;sun.shadow.camera.right=10;sun.shadow.camera.top=9;sun.shadow.camera.bottom=-7;P.scene.add(sun);
    const floor=new Three.Mesh(new Three.PlaneGeometry(22,16),material(0x263139,.05,.9));floor.rotation.x=-Math.PI/2;floor.position.y=.02;floor.receiveShadow=true;P.scene.add(floor);
    const grid=new Three.GridHelper(20,40,0x3b5869,0x233642);grid.position.y=.025;P.scene.add(grid);
    createMachine();loadBlenderMachine({reason:'scene-init'});updateCamera();installCameraControls();resize();return true;
  }

  function updateModelBadge(){
    const badge=q('#p3-scene-badge span',P.host);if(!badge)return;
    const load=P.modelLoad,label=load.status==='ready'?'BLENDER GLB':load.status==='loading'?'3D LOADING':load.status==='retry-wait'?'3D RETRY':load.status==='waiting-loader'?'3D WAIT':'PROCEDURAL FALLBACK';
    badge.textContent=`OFFLINE DIGITAL TWIN · ${label}`;
    badge.title=load.error||`${load.source} · ${load.status}`;
  }
  function removeImportedModel(model){
    if(!model)return;model.parent?.remove?.(model);
    const shared=new Set(Object.values(P.materials||{}));
    model.traverse?.(object=>{if(!object.isMesh)return;const materials=Array.isArray(object.material)?object.material:[object.material];materials.filter(item=>item&&!shared.has(item)).forEach(item=>item.dispose?.());});
  }
  function loadModelWithTimeout(promise,generation){
    return new Promise((resolve,reject)=>{
      let settled=false;
      const timer=window.setTimeout(()=>{if(settled)return;settled=true;reject(new Error(`3D model load timed out after ${MODEL_LOAD_TIMEOUT_MS} ms`));},MODEL_LOAD_TIMEOUT_MS);
      Promise.resolve(promise).then(model=>{
        if(settled||generation!==P.modelLoad.generation){removeImportedModel(model);return;}
        settled=true;window.clearTimeout(timer);resolve(model);
      },error=>{if(settled)return;settled=true;window.clearTimeout(timer);reject(error);});
    });
  }
  function activateBlenderMachine(model,hierarchy){
    const {X_Carriage:xCarriage,Y_Carriage:yCarriage,Z_Slide:zSlide,Gripper:gripper,Jaw_L:jawL,Jaw_R:jawR}=hierarchy.nodes;
    const previous=P.parts.blenderModel;
    if(P.parts.heldBox?.parent)P.parts.runtimeLayer.add(P.parts.heldBox);
    if(previous&&previous!==model)removeImportedModel(previous);
    model.traverse(object=>{if(/^Pallet_(?:Slat|Block)/.test(object.name))object.visible=false;});
    P.scene.add(model);P.scene.updateMatrixWorld(true);
    for(const statusLed of Object.values(P.parts.leds||{}))if(statusLed&&P.parts.runtimeLayer?.attach)P.parts.runtimeLayer.attach(statusLed);
    P.parts.proceduralModel.visible=false;P.parts.machine=model;P.parts.blenderModel=model;
    P.parts.xCarriage=xCarriage;P.parts.yCarriage=yCarriage;P.parts.zSlide=zSlide;P.parts.gripper=gripper;P.parts.jaws=[jawL,jawR];
    P.parts.axisBindings={X:resolveWorldAxisBinding(xCarriage,'X'),Y:resolveWorldAxisBinding(yCarriage,'Y'),Z:resolveWorldAxisBinding(zSlide,'Z')};
    P.parts.jawBindings=[jawL,jawR].map(node=>({node,open:finite(node.userData?.openX,node.position.x),closed:finite(node.userData?.closedX,node.position.x*.91)}));
    gripper.add(P.parts.heldBox);gripper.updateMatrixWorld(true);const heldWorld=new Three.Vector3();gripper.getWorldPosition(heldWorld);heldWorld.y-=1.516;gripper.worldToLocal(heldWorld);P.parts.heldBox.position.copy(heldWorld);P.parts.heldBox.visible=false;
    P.parts.detailStats={safetyPosts:4,energyChains:3,linearRails:6,servoMotors:3,gripperComponents:10};
    P.renderDirty=true;
  }
  function installModelLoaderWait(){
    if(P.modelLoad.loaderListener)return;P.modelLoad.loaderListener=()=>{P.modelLoad.loaderListener=null;loadBlenderMachine({reason:'loader-ready'});};
    window.addEventListener('plc-trainer-imported-models-ready',P.modelLoad.loaderListener,{once:true});
  }
  function scheduleModelRetry(){
    const delay=MODEL_RETRY_DELAYS[P.modelLoad.attempts-1];if(delay===undefined||P.modelLoad.retryTimer)return;
    P.modelLoad.status='retry-wait';P.modelLoad.retryAt=Date.now()+delay;updateModelBadge();
    P.modelLoad.retryTimer=window.setTimeout(()=>{P.modelLoad.retryTimer=0;loadBlenderMachine({reason:'automatic-retry'});},delay);
  }
  function loadBlenderMachine(options={}){
    if(P.modelLoad.promise)return P.modelLoad.promise;
    const loader=window.PLCTrainerImportedModels;
    if(!loader?.loadModel){P.modelLoad.status='waiting-loader';P.modelLoad.error='3D model loader is not ready';installModelLoaderWait();updateModelBadge();return Promise.resolve(false);}
    if(P.modelLoad.status==='ready'&&!options.force)return Promise.resolve(true);
    if(P.modelLoad.retryTimer){window.clearTimeout(P.modelLoad.retryTimer);P.modelLoad.retryTimer=0;}
    P.modelLoad.status='loading';P.modelLoad.attempts+=1;P.modelLoad.error=null;P.modelLoad.missingNodes=[];P.modelLoad.startedAt=Date.now();P.modelLoad.retryAt=0;updateModelBadge();
    let promise;promise=(async()=>{
      try{
        // Yield once so P.modelLoad.promise is installed before any loader can
        // synchronously throw. This keeps retry/diagnostic state deterministic.
        await Promise.resolve();
        const generation=++P.modelLoad.generation;
        const model=await loadModelWithTimeout(loader.loadModel(PALLETIZER_MODEL,{name:'Blender-Palletizer-3Axis-v2'}),generation);
        const hierarchy=resolveMovingHierarchy(model);
        P.modelLoad.missingNodes=[...hierarchy.missingNodes,...hierarchy.duplicates.map(name=>`duplicate:${name}`),...hierarchy.relationships];
        if(!hierarchy.ok){removeImportedModel(model);throw new Error(`moving hierarchy is incomplete: ${P.modelLoad.missingNodes.join(', ')}`);}
        activateBlenderMachine(model,hierarchy);P.modelLoad.status='ready';P.modelLoad.source='blender-glb';P.modelLoad.completedAt=Date.now();P.modelLoad.error=null;
        updateMachine();updateModelBadge();schedule();return true;
      }catch(error){
        P.modelLoad.status='failed';P.modelLoad.source=P.parts.blenderModel?'blender-glb':'procedural';P.modelLoad.completedAt=Date.now();P.modelLoad.error=String(error?.message||error);
        updateModelBadge();console.warn('Blender palletizer model unavailable; procedural fallback remains active',error);scheduleModelRetry();return false;
      }finally{if(P.modelLoad.promise===promise)P.modelLoad.promise=null;}
    })();
    P.modelLoad.promise=promise;return promise;
  }
  function retryBlenderMachine(){
    if(P.modelLoad.promise)return P.modelLoad.promise;
    P.modelLoad.attempts=0;P.modelLoad.error=null;P.modelLoad.missingNodes=[];return loadBlenderMachine({force:true,reason:'manual-retry'});
  }

  function createMachine(){
    const root=new Three.Group();root.name='Procedural-Palletizer-Fallback';P.scene.add(root);P.parts.machine=root;P.parts.proceduralModel=root;
    const runtimeLayer=new Three.Group();runtimeLayer.name='Palletizer-Runtime-Workpieces';P.scene.add(runtimeLayer);P.parts.runtimeLayer=runtimeLayer;
    P.parts.cableChains=[];P.parts.detailStats={safetyPosts:0,energyChains:0,linearRails:0,servoMotors:0,gripperComponents:0};
    // 강성 베이스와 산업용 알루미늄 프로파일 프레임
    box(root,[10.8,.3,6.6],[0,.28,0],P.materials.dark);
    for(const x of [-5,5])for(const z of [-2.9,2.9])extrusion(root,[.32,1.1,.32],[x,-.3,z]);
    for(const x of [-5,5])extrusion(root,[.38,5.05,.38],[x,2.75,2.72]);
    extrusion(root,[10.45,.42,.48],[0,5.12,2.72]);
    // X축: 이중 리니어 가이드, 랙 커버, 서보와 커플링
    for(const y of [4.72,4.88]){box(root,[9.86,.095,.13],[0,y,2.48],P.materials.rail);P.parts.detailStats.linearRails+=1;}
    box(root,[9.82,.18,.12],[0,5.04,2.43],P.materials.dark);
    servo(root,[-5.12,5.13,2.72],Math.PI/2);P.parts.detailStats.servoMotors+=1;
    cylinder(root,.09,.34,[-4.75,5.13,2.72],P.materials.shaft,'x');
    cableChain(root,[-4.2,5.48,2.25],[3.6,5.48,2.25],19);P.parts.detailStats.energyChains+=1;
    // X carriage carries the Y bridge.
    const xCarriage=new Three.Group();root.add(xCarriage);P.parts.xCarriage=xCarriage;
    box(xCarriage,[.82,.66,.82],[0,4.82,2.72],P.materials.blue);
    box(xCarriage,[.54,.18,.5],[0,4.68,2.46],P.materials.rail);
    extrusion(xCarriage,[.42,.42,5.8],[0,4.62,0]);
    for(const x of [-.16,.16]){box(xCarriage,[.09,.13,5.45],[x,4.28,0],P.materials.rail);P.parts.detailStats.linearRails+=1;}
    box(xCarriage,[.38,.12,5.35],[0,4.45,0],P.materials.dark);
    servo(xCarriage,[0,4.62,2.9],0);P.parts.detailStats.servoMotors+=1;
    cylinder(xCarriage,.08,.3,[0,4.62,2.53],P.materials.shaft,'z');
    cableChain(xCarriage,[.38,4.72,2.15],[.38,4.72,-2.15],14);P.parts.detailStats.energyChains+=1;
    const yCarriage=new Three.Group();xCarriage.add(yCarriage);P.parts.yCarriage=yCarriage;
    box(yCarriage,[.86,.5,.78],[0,4.3,0],P.materials.blue);
    extrusion(yCarriage,[.38,4.35,.38],[0,2.45,0]);
    for(const x of [-.18,.18]){box(yCarriage,[.08,3.95,.12],[x,2.38,.25],P.materials.rail);P.parts.detailStats.linearRails+=1;}
    cylinder(yCarriage,.055,3.78,[0,2.36,.31],P.materials.shaft,'y');
    servo(yCarriage,[0,4.08,.05],0);P.parts.detailStats.servoMotors+=1;
    cableChain(yCarriage,[-.34,3.9,-.25],[-.34,.95,-.25],11);P.parts.detailStats.energyChains+=1;
    const zSlide=new Three.Group();yCarriage.add(zSlide);P.parts.zSlide=zSlide;
    box(zSlide,[.78,.62,.72],[0,0,0],P.materials.blue);
    box(zSlide,[.52,.16,.5],[0,.18,.1],P.materials.rail);
    const gripper=new Three.Group();gripper.position.y=-.26;zSlide.add(gripper);P.parts.gripper=gripper;
    cylinder(gripper,.17,.32,[0,-.04,0],P.materials.cabinet,'y');
    box(gripper,[.82,.16,.58],[0,-.22,0],P.materials.dark);
    box(gripper,[.62,.14,.4],[0,-.34,0],P.materials.blue);
    const leftJaw=box(gripper,[.12,.62,.18],[-.3,-.62,0],P.materials.jaw),rightJaw=box(gripper,[.12,.62,.18],[.3,-.62,0],P.materials.jaw);
    box(leftJaw,[.18,.12,.28],[0,-.27,0],P.materials.dark);box(rightJaw,[.18,.12,.28],[0,-.27,0],P.materials.dark);
    P.parts.jaws=[leftJaw,rightJaw];
    P.parts.axisBindings={X:{node:xCarriage,component:'x',direction:1,worldComponent:'x'},Y:{node:yCarriage,component:'z',direction:1,worldComponent:'z'},Z:{node:zSlide,component:'y',direction:1,worldComponent:'y'}};
    P.parts.jawBindings=[{node:leftJaw,open:-.3,closed:-.17},{node:rightJaw,open:.3,closed:.17}];
    P.parts.detailStats.gripperComponents=7;
    const held=box(gripper,[.52,.43,.52],[0,-.92,0],P.materials.box);held.visible=false;P.parts.heldBox=held;
    // target marker and sensors
    const target=box(runtimeLayer,[.7,.08,.7],[mmX(P.state.cell.pick.x),.52,mmY(P.state.cell.pick.y)],P.materials.ghost);P.parts.target=target;
    P.parts.leds={xHome:led(root,[-4.74,4.85,2.35]),xLimit:led(root,[4.74,4.85,2.35]),yHome:led(xCarriage,[.42,4.28,2.52]),yLimit:led(xCarriage,[.42,4.28,-2.52]),zHome:led(yCarriage,[.35,4.2,.32]),zLimit:led(yCarriage,[.35,.55,.32])};
    P.parts.pickGroup=new Three.Group();runtimeLayer.add(P.parts.pickGroup);
    box(P.parts.pickGroup,[1.05,.18,1.0],[mmX(P.state.cell.pick.x),.47,mmY(P.state.cell.pick.y)],P.materials.dark);
    for(const dx of [-.38,.38])for(const dz of [-.34,.34])cylinder(P.parts.pickGroup,.055,.18,[mmX(P.state.cell.pick.x)+dx,.64,mmY(P.state.cell.pick.y)+dz],P.materials.yellow,'y');
    const pickBox=box(P.parts.pickGroup,[.52,.43,.52],[mmX(P.state.cell.pick.x),.78,mmY(P.state.cell.pick.y)],P.materials.box);P.parts.pickBox=pickBox;
    P.parts.palletGroup=new Three.Group();runtimeLayer.add(P.parts.palletGroup);
    P.parts.placedGroup=new Three.Group();runtimeLayer.add(P.parts.placedGroup);
    // 설비 안전 영역: 투명 펜스와 제어함만 두고 교실 소품은 사용하지 않는다.
    const fence=new Three.Group();fence.name='industrial-safety-guard';root.add(fence);
    for(const [x,z] of [[-5.35,-3.15],[-5.35,3.15],[5.35,-3.15],[5.35,3.15]]){safetyPost(fence,x,z);P.parts.detailStats.safetyPosts+=1;}
    box(fence,[.04,2.25,5.9],[-5.35,1.78,0],P.materials.guard);box(fence,[10.65,2.25,.04],[0,1.78,3.15],P.materials.guard);
    const cabinet=new Three.Group();cabinet.name='ls-electric-control-cabinet';root.add(cabinet);
    box(cabinet,[1.25,2.35,.72],[4.55,1.62,-2.55],P.materials.cabinet);box(cabinet,[1.12,2.12,.04],[4.55,1.62,-2.18],P.materials.dark);
    box(cabinet,[.32,.16,.08],[4.55,2.27,-2.12],P.materials.blue);cylinder(cabinet,.1,.12,[4.18,2.12,-2.08],P.materials.red,'z');
    cylinder(cabinet,.055,.48,[4.88,3.02,-2.55],P.materials.dark,'y');
    for(const [y,mat] of [[3.38,P.materials.red],[3.2,P.materials.yellow],[3.02,P.materials.blue]])cylinder(cabinet,.11,.16,[4.88,y,-2.55],mat,'y');
    rebuildPallet(true);rebuildPlaced(true);
  }

  function disposeGroup(group){
    if(!group)return;
    while(group.children.length){const child=group.children.pop();child.traverse?.(obj=>{obj.geometry?.dispose?.();if(obj.material&&!Object.values(P.materials||{}).includes(obj.material))obj.material.dispose?.();});}
  }
  function rebuildPallet(force=false){
    const p=P.state.cell.pallet,stamp=[p.rows,p.cols,p.layers,p.spacingX,p.spacingY,p.origin.x,p.origin.y].join('|');if(!force&&stamp===P.palletStamp)return;P.palletStamp=stamp;
    const g=P.parts.palletGroup;if(!g)return;disposeGroup(g);
    const xs=Array.from({length:p.cols},(_,i)=>mmX(p.origin.x+i*p.spacingX)),zs=Array.from({length:p.rows},(_,i)=>mmY(p.origin.y+i*p.spacingY));
    const cx=(Math.min(...xs)+Math.max(...xs))/2,cz=(Math.min(...zs)+Math.max(...zs))/2,w=Math.max(1.15,Math.max(...xs)-Math.min(...xs)+.95),d=Math.max(1.05,Math.max(...zs)-Math.min(...zs)+.9);
    for(let i=-2;i<=2;i++)box(g,[w,.11,d/7],[cx,.5,cz+i*d/6],P.materials.wood);
    box(g,[w,.12,.15],[cx,.38,cz-d*.34],P.materials.wood);box(g,[w,.12,.15],[cx,.38,cz+d*.34],P.materials.wood);
  }
  function rebuildPlaced(force=false){
    const stamp=P.state.pallet.placed.map(item=>item.id).join('|');if(!force&&stamp===P.placedStamp)return;P.placedStamp=stamp;
    const g=P.parts.placedGroup;if(!g)return;P.parts.placedMeshes=P.parts.placedMeshes||new Map();
    if(force){disposeGroup(g);P.parts.placedMeshes.clear();}
    const live=new Set(P.state.pallet.placed.map(item=>item.id));
    for(const [id,mesh] of P.parts.placedMeshes)if(!live.has(id)){g.remove(mesh);mesh.geometry?.dispose?.();if(!Object.values(P.materials||{}).includes(mesh.material))mesh.material?.dispose?.();P.parts.placedMeshes.delete(id);}
    for(const item of P.state.pallet.placed){
      if(P.parts.placedMeshes.has(item.id))continue;
      const color=[0xd8a14b,0x5ea6c8,0x7fb765][item.layer%3],mat=material(color,.05,.68);
      const mesh=box(g,[.52,.43,.52],[mmX(item.x),.77+item.layer*.45,mmY(item.y)],mat);mesh.userData.workpieceId=item.id;P.parts.placedMeshes.set(item.id,mesh);
    }
  }

  function updateCamera(){
    if(!P.camera)return;const o=P.cameraOrbit,t=P.cameraTarget,cp=Math.cos(o.pitch);
    P.camera.position.set(t.x+Math.sin(o.yaw)*cp*o.distance,t.y+Math.sin(o.pitch)*o.distance,t.z+Math.cos(o.yaw)*cp*o.distance);P.camera.lookAt(t.x,t.y,t.z);P.renderDirty=true;if(P.initialized)schedule();
  }
  function updateCameraHint(){
    const hint=q('#p3-camera-hint',P.host);if(!hint)return;
    hint.textContent=CameraNavigation.hint(P.cameraNavigationPreset,'드래그: 회전 · 휠: 확대/축소 · 더블클릭: 카메라 초기화');
  }
  function setCameraNavigationPreset(value){
    P.cameraNavigationPreset=CameraNavigation.normalizePreset(value);P.drag=null;updateCameraHint();return P.cameraNavigationPreset;
  }
  function installCameraControls(){
    const canvas=P.renderer.domElement,raycaster=new Three.Raycaster(),pointer=new Three.Vector2();
    const legacyMapping={orbitButtons:[0,1,2],panButtons:[]};
    const pointerOnPlane=(event,plane)=>{
      const rect=canvas.getBoundingClientRect();if(!rect.width||!rect.height)return null;
      pointer.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);
      raycaster.setFromCamera(pointer,P.camera);return raycaster.ray.intersectPlane(plane,new Three.Vector3());
    };
    canvas.addEventListener('pointerdown',event=>{
      const mode=CameraNavigation.resolvePointerAction(event,P.cameraNavigationPreset,legacyMapping);if(!mode)return;
      event.preventDefault();
      if(mode==='orbit')P.drag={mode,pointerId:event.pointerId,x:event.clientX,y:event.clientY,yaw:P.cameraOrbit.yaw,pitch:P.cameraOrbit.pitch};
      else{
        P.camera.updateMatrixWorld(true);const forward=new Three.Vector3();P.camera.getWorldDirection(forward);
        const target=new Three.Vector3(P.cameraTarget.x,P.cameraTarget.y,P.cameraTarget.z),plane=new Three.Plane().setFromNormalAndCoplanarPoint(forward.clone().negate(),target),hit=pointerOnPlane(event,plane);
        if(!hit)return;P.drag={mode,pointerId:event.pointerId,plane,hit,target};
      }
      canvas.setPointerCapture?.(event.pointerId);
    });
    canvas.addEventListener('pointermove',event=>{
      if(!P.drag||P.drag.pointerId!==event.pointerId)return;
      if(P.drag.mode==='orbit'){
        const next=CameraNavigation.orbitFromDrag(P.cameraNavigationPreset,{yaw:P.drag.yaw,pitch:P.drag.pitch},{x:event.clientX-P.drag.x,y:event.clientY-P.drag.y},{yaw:.006,pitch:.005,legacyYawSign:-1,legacyPitchSign:1});
        P.cameraOrbit.yaw=next.yaw;P.cameraOrbit.pitch=clamp(next.pitch,.12,1.18);
      }else{
        const hit=pointerOnPlane(event,P.drag.plane);if(!hit)return;const target=P.drag.target.clone().add(P.drag.hit).sub(hit);P.cameraTarget={x:target.x,y:target.y,z:target.z};
      }
      updateCamera();
    });
    const end=event=>{if(!P.drag||P.drag.pointerId===event.pointerId)P.drag=null;};
    canvas.addEventListener('pointerup',end);canvas.addEventListener('pointercancel',end);canvas.addEventListener('lostpointercapture',end);
    canvas.addEventListener('auxclick',event=>{if(event.button===1)event.preventDefault();});canvas.addEventListener('contextmenu',event=>event.preventDefault());
    canvas.addEventListener('wheel',event=>{event.preventDefault();P.cameraOrbit.distance=clamp(P.cameraOrbit.distance*(event.deltaY>0?1.09:.92),6.5,23);updateCamera();},{passive:false});
    canvas.addEventListener('dblclick',()=>{P.cameraOrbit={yaw:.78,pitch:.5,distance:15.2};updateCamera();});
  }

  function updateMachine(){
    if(!P.parts.axisBindings)return;const a=P.state.axes;
    for(const name of ['X','Y','Z']){const binding=P.parts.axisBindings[name];setAxisWorldCoordinate(binding,axisSceneCoordinate(name,a[name]));}
    const closed=P.state.gripper.holding;for(const binding of P.parts.jawBindings||[])binding.node.position.x=closed?binding.closed:binding.open;
    P.parts.heldBox.visible=!!P.state.gripper.holding;P.parts.pickBox.visible=!P.state.gripper.holding&&P.state.pallet.nextIndex<Runtime.palletCapacity(P.state);
    setLed(P.parts.leds.xHome,a.X.negLimit,a.X.alarm);setLed(P.parts.leds.xLimit,a.X.posLimit,a.X.alarm);
    setLed(P.parts.leds.yHome,a.Y.negLimit,a.Y.alarm);setLed(P.parts.leds.yLimit,a.Y.posLimit,a.Y.alarm);
    setLed(P.parts.leds.zHome,a.Z.posLimit,a.Z.alarm);setLed(P.parts.leds.zLimit,a.Z.negLimit,a.Z.alarm);
    rebuildPallet();rebuildPlaced();
  }

  const PRODUCTION_INPUT_LABELS={
    eStopLoopOk:'비상정지 루프 정상',guardLoopOk:'안전문 인터록 정상',startPb:'시작 버튼',stopPb:'정지 버튼',resetPb:'리셋 버튼',autoEnableKey:'AUTO 선택 키',
    workPresent:'제품 감지',palletPresent:'팔레트 감지',vacuumOk:'진공 확인',releaseOk:'그리퍼 해제 확인',airPressureOk:'공압 압력 정상',
    xDrivePowerOk:'X축 드라이브 전원 정상',yDrivePowerOk:'Y축 드라이브 전원 정상',zDrivePowerOk:'Z축 드라이브 전원 정상',safetyRelayEdmOk:'안전 릴레이 EDM 정상',extStopLoopOk:'외부 정지 루프 정상'
  };
  const PRODUCTION_AUTO_PERMITS=['eStopLoopOk','guardLoopOk','autoEnableKey','airPressureOk','xDrivePowerOk','yDrivePowerOk','zDrivePowerOk','safetyRelayEdmOk','extStopLoopOk'];
  function isProductionProfile(profile=Runtime.getProfile(P.state)){return profile.id==='xgb-production';}
  function memoryRows(){
    const p=Runtime.getProfile(P.state),c=p.commands,d=p.setpoints,s=p.status,a=p.actual;
    const commandRows=isProductionProfile(p)
      ? [[c.autoStart,'AUTO 시작'],[c.stop,'정지'],[c.reset,'리셋'],[c.manualOrg,'수동 ORG · Z→X→Y'],[c.servoOn,'전축 서보 ON'],[c.servoOff,'전축 서보 OFF']]
      : [[c.autoStart,'자동 시작'],[c.stop,'정지'],[c.home,'원점복귀'],[c.servoOn,'전축 서보']];
    const inputRows=isProductionProfile(p)?Object.entries(p.inputs||{}).map(([role,address])=>[address,PRODUCTION_INPUT_LABELS[role]||role]):[];
    const statusRows=isProductionProfile(p)
      ? [[s.autoRunningStatus,'PLC AUTO 운전'],[s.autoReadyStatus,'PLC AUTO 준비'],[s.palletFullStatus,'팔레트 Full'],[s.alarmStatus,'PLC 알람'],[s.buzzerStatus,'부저 상태'],
        [s.xHomed,'X 원점 완료'],[s.yHomed,'Y 원점 완료'],[s.zHomed,'Z 원점 완료'],[s.xBusy,'X BUSY'],[s.yBusy,'Y BUSY'],[s.zBusy,'Z BUSY'],[s.xDone,'X DONE'],[s.yDone,'Y DONE'],[s.zDone,'Z DONE'],[s.xError,'X ERROR'],[s.yError,'Y ERROR'],[s.zError,'Z ERROR'],
        [s.xServoReadyStatus,'X 서보 Ready'],[s.yServoReadyStatus,'Y 서보 Ready'],[s.zServoReadyStatus,'Z 서보 Ready'],[s.vacuumBreakStatus,'진공 파괴'],[s.vacuumOnStatus,'진공 ON'],[s.carryingStatus,'제품 파지']]
      : [[s.autoRunning,'자동 운전'],[s.autoComplete,'완료'],[s.fault,'알람'],[s.xBusy,'X BUSY'],[s.yBusy,'Y BUSY'],[s.zBusy,'Z BUSY'],[s.xHomed,'X 원점'],[s.yHomed,'Y 원점'],[s.zHomed,'Z 원점'],[s.gripperClosed,'그리퍼'],[s.holding,'제품 파지']];
    return [
      ...commandRows,...inputRows,
      [d.x,'X 목표 mm'],[d.y,'Y 목표 mm'],[d.z,'Z 목표 mm'],[d.speed,'속도 mm/s'],
      ...statusRows,
      [a.x,'X 현재'],[a.y,'Y 현재'],[a.z,'Z 현재'],[a.placed,'적재 수'],[a.step,'스텝']
    ].filter(([address])=>typeof address==='string'&&address.length>0);
  }
  function renderProductionInputs(){
    const host=q('#p3-production-inputs',P.host),profile=Runtime.getProfile(P.state);if(!host)return;
    if(!isProductionProfile(profile)){host.replaceChildren();return;}
    host.innerHTML=Object.entries(profile.inputs||{}).map(([role,address])=>`<label><input type="checkbox" data-production-input="${address}"><span>${address} · ${esc(PRODUCTION_INPUT_LABELS[role]||role)}</span></label>`).join('');
    qa('[data-production-input]',host).forEach(input=>{
      input.checked=Runtime.readDevice(P.state,input.dataset.productionInput)===true;
      input.onchange=()=>{
        const address=input.dataset.productionInput,active=!!input.checked;
        if(!Runtime.setPhysicalInput(P.state,address,active))return;
        P.state.events.push({time:P.state.elapsed,type:'input',message:`${address} ← ${active?'ON':'OFF'}`});
        updateUi(true);persist(true);
      };
    });
  }
  function buildMemoryTable(){
    const body=q('#p3-memory tbody',P.host);body.innerHTML=memoryRows().map(([addr,label])=>`<tr><td>${addr}</td><td>${label}</td><td data-memory="${addr}">0</td></tr>`).join('');
    renderProductionInputs();
  }
  function updateUi(force=false){
    if(!P.host)return;if(force){P.renderDirty=true;if(P.visible&&P.initialized)schedule();}const now=performance.now();if(!force&&now-P.lastUi<100)return;P.lastUi=now;
    const state=P.state,auto=state.auto,profile=Runtime.getProfile(state),hasAlarm=auto.state==='FAULT'||Object.values(state.axes).some(a=>a.alarm),production=isProductionProfile(profile);
    const stateBox=q('#p3-state',P.host);q('b',stateBox).textContent=auto.message||'대기';q('span',stateBox).textContent=`${profile.id==='ls'?'LS':profile.id==='mitsubishi'?'MELSEC':'XGB'} · ${auto.state} · ${state.pallet.placed.length}/${Runtime.palletCapacity(state)}`;stateBox.classList.toggle('p3-alarm',hasAlarm);
    q('#p3-root',P.host)?.classList.toggle('production-profile',production);
    q('#p3-profile',P.host).value=profile.id;q('#p3-address-title',P.host).firstChild.textContent=`${profile.vendor} 주소 이미지 `;q('#p3-profile-note',P.host).textContent=`${profile.family} 교육용 기본 맵 · ${profile.addressStyle} · 실제 PLC 전송 없음`;
    for(const name of ['X','Y','Z']){
      const axis=state.axes[name],value=q(`[data-axis-value="${name}"]`,P.host),flags=q(`[data-axis-flags="${name}"]`,P.host);
      value.textContent=`${axis.position.toFixed(2)} mm`;value.classList.toggle('p3-alarm',!!axis.alarm);
      flags.textContent=axis.alarm?axis.alarm.code:[axis.servoOn?'SV ON':'SV OFF',axis.homed?'HOME':'NO HOME',axis.busy?'BUSY':'READY',axis.negLimit?'−LS':'',axis.posLimit?'+LS':''].filter(Boolean).join(' · ');
    }
    const servoButton=q('[data-action="servo"]',P.host),allServo=Object.values(state.axes).every(axis=>axis.servoOn);
    servoButton.textContent=allServo?'SERVO OFF':'SERVO ON';servoButton.classList.toggle('p3-on',allServo);
    qa('[data-axis-move],[data-jog]',P.host).forEach(button=>button.disabled=production);
    for(const [addr,label] of memoryRows()){const cell=q(`[data-memory="${addr}"]`,P.host);if(!cell)continue;const value=Runtime.readDevice(state,addr);cell.textContent=typeof value==='boolean'?(value?'ON':'OFF'):Number(value).toFixed(/현재/.test(label)?2:0);cell.classList.toggle('p3-on',value===true);cell.classList.toggle('p3-alarm',addr===profile.status.fault&&value===true);}
    const events=state.events.slice(-7).reverse();q('#p3-log',P.host).innerHTML=events.map(event=>`<div class="${event.type==='alarm'?'p3-alarm':''}">${event.time.toFixed(1)}s · ${esc(event.message)}</div>`).join('');
  }

  function activeProfile(){return Runtime.getProfile(P.state);}
  function manualStop(){if(P.state.auto.running)Runtime.writeDevice(P.state,activeProfile().commands.stop,true);}
  function productionAutoRejectReason(){
    if(!Object.values(P.state.axes).every(axis=>axis.homed&&!axis.alarm))return '수동 ORG 완료 전 AUTO 허가 거부';
    const profile=activeProfile(),missing=PRODUCTION_AUTO_PERMITS.filter(role=>Runtime.readDevice(P.state,profile.inputs[role])!==true);
    return missing.length ? `AUTO 허가 조건 OFF · ${missing.map(role=>`${profile.inputs[role]} ${PRODUCTION_INPUT_LABELS[role]}`).join(', ')}` : 'AUTO 시작 지령 거부';
  }
  function rejectProductionAuto(){
    const message=productionAutoRejectReason();
    P.state.auto.message=message;
    P.state.events.push({time:P.state.elapsed,type:'reject',message});
  }
  function requestProductionOrg(){
    const profile=activeProfile(),result=Runtime.writeDevice(P.state,profile.commands.manualOrg,true);
    if(result.accepted===false){
      const message='수동 ORG는 정지 상태와 전축 SERVO ON이 필요합니다';
      P.state.events.push({time:P.state.elapsed,type:'reject',message});P.state.auto.message=message;
    }else P.state.events.push({time:P.state.elapsed,type:'command',message:'수동 ORG 시작 · Z → X → Y'});
    schedule();updateUi(true);persist(true);return result;
  }
  function emitProfileChanged(){
    window.dispatchEvent(new CustomEvent('palletizer-profile-changed',{detail:{profile:Runtime.getProfile(P.state).id}}));
  }
  function bindUi(){
    q('#p3-profile',P.host).onchange=event=>{if(Runtime.setProfile(P.state,event.target.value)){buildMemoryTable();q('#p3-address',P.host).value=Runtime.getProfile(P.state).commands.autoStart;emitProfileChanged();}schedule();updateUi(true);persist(true);};
    q('[data-action="auto"]',P.host).onclick=()=>{
      const result=Runtime.writeDevice(P.state,activeProfile().commands.autoStart,true);
      if(isProductionProfile()&&result.accepted===false)rejectProductionAuto();
      schedule();updateUi(true);persist(true);
    };
    q('[data-action="stop"]',P.host).onclick=()=>{Runtime.writeDevice(P.state,activeProfile().commands.stop,true);updateUi(true);persist(true);};
    q('[data-action="home"]',P.host).onclick=()=>{
      manualStop();
      if(isProductionProfile())requestProductionOrg();
      else{Runtime.writeDevice(P.state,activeProfile().commands.home,true);schedule();updateUi(true);}
    };
    q('[data-action="manual-org"]',P.host).onclick=()=>{manualStop();requestProductionOrg();};
    q('[data-action="alarm-reset"]',P.host).onclick=()=>{Runtime.resetAlarms(P.state);updateUi(true);persist(true);};
    q('[data-action="servo"]',P.host).onclick=()=>{const on=!Object.values(P.state.axes).every(axis=>axis.servoOn);Runtime.writeDevice(P.state,activeProfile().commands.servoOn,on);updateUi(true);persist(true);};
    q('[data-action="clear"]',P.host).onclick=()=>{Runtime.resetCell(P.state,{clearPallet:true});rebuildPlaced(true);updateUi(true);persist(true);};
    q('[data-action="pattern"]',P.host).onclick=()=>{
      Runtime.stopAll(P.state,'패턴 변경');Runtime.configurePallet(P.state,{rows:q('#p3-rows',P.host).value,cols:q('#p3-cols',P.host).value,layers:q('#p3-layers',P.host).value});Runtime.resetCell(P.state,{clearPallet:true});rebuildPallet(true);rebuildPlaced(true);updateUi(true);persist(true);
    };
    qa('[data-axis-move]',P.host).forEach(button=>button.onclick=()=>{manualStop();const name=button.dataset.axisMove,input=q(`[data-axis-target="${name}"]`,P.host),profile=activeProfile(),targetAddress=profile.setpoints[name.toLowerCase()],moveAddress=profile.commands[`move${name}`];Runtime.writeDevice(P.state,profile.commands.servoOn,true);Runtime.writeDevice(P.state,targetAddress,input.value);Runtime.writeDevice(P.state,moveAddress,true);schedule();updateUi(true);});
    qa('[data-jog]',P.host).forEach(button=>{
      const [axis,rawDir]=button.dataset.jog.split(','),dir=Number(rawDir);
      const jogAddress=()=>activeProfile().commands[`jog${axis}${dir>0?'Plus':'Minus'}`];
      const start=event=>{event.preventDefault();manualStop();Runtime.writeDevice(P.state,activeProfile().commands.servoOn,true);const address=jogAddress();Runtime.writeDevice(P.state,address,true);P.activeJogs.set(event.pointerId,address);button.setPointerCapture?.(event.pointerId);P.renderDirty=true;schedule();updateUi(true);};
      const stop=event=>{const address=P.activeJogs.get(event?.pointerId)||jogAddress();P.activeJogs.delete(event?.pointerId);Runtime.writeDevice(P.state,address,false);P.renderDirty=true;updateUi(true);persist(true);};
      button.addEventListener('pointerdown',start);button.addEventListener('pointerup',stop);button.addEventListener('pointercancel',stop);button.addEventListener('lostpointercapture',stop);
    });
    q('#p3-write',P.host).onclick=()=>{
      const addr=q('#p3-address',P.host).value,value=q('#p3-value',P.host).value,result=Runtime.writeDevice(P.state,addr,value);
      if(!result.ok){P.state.events.push({time:P.state.elapsed,type:'alarm',message:result.error});}else P.state.events.push({time:P.state.elapsed,type:'write',message:`${result.address} ← ${result.value}`});
      schedule();updateUi(true);persist(true);
    };
    q('#p3-value',P.host).addEventListener('keydown',event=>{if(event.key==='Enter')q('#p3-write',P.host).click();});
  }

  function resize(){
    if(!P.renderer||!P.sceneHost)return;const rect=P.sceneHost.getBoundingClientRect();if(rect.width<20||rect.height<20)return;
    P.renderer.setSize(rect.width,rect.height,false);P.camera.aspect=rect.width/rect.height;P.camera.updateProjectionMatrix();
  }
  function animate(timestamp){
    P.raf=0;if(!P.initialized)return;
    if(!P.lastTime)P.lastTime=timestamp;const dt=Math.min(.05,Math.max(0,(timestamp-P.lastTime)/1000));P.lastTime=timestamp;
    const moving=P.state.auto.running||Object.values(P.state.axes).some(axis=>axis.busy);
    if(moving){Runtime.tick(P.state,dt);P.renderDirty=true;}
    if(P.renderDirty){updateMachine();updateUi();persist();if(P.visible&&P.renderer)P.renderer.render(P.scene,P.camera);P.renderDirty=false;}
    if(moving)schedule();
  }
  function schedule(){if(!P.raf)P.raf=requestAnimationFrame(animate);}
  function setVisible(visible){
    P.visible=!!visible;if(!P.visible)stopActiveJogs();P.renderDirty=true;if(!P.initialized)return;
    // v2.7 자동화 실습실 허브가 있으면 상위 화면의 표시는 허브가 관리한다.
    if(!q('#al-hub',P.host))P.host.classList.toggle('show',P.visible);P.lastTime=0;
    if(P.visible){resize();updateUi(true);P.renderDirty=true;schedule();}else{persist(true);window.dispatchEvent(new CustomEvent('palletizer-view-hidden'));}
  }
  function renderActive(){if(!P.initialized)return;updateMachine();updateUi(true);if(P.visible)schedule();}
  function exportState(){return persist(true)||Runtime.exportState(P.state);}
  function importState(saved){
    if(!P.state)return;
    if(saved&&typeof saved==='object')Runtime.importState(P.state,saved);
    else P.state=Runtime.createState();
    const p=P.state.cell.pallet;q('#p3-rows',P.host).value=p.rows;q('#p3-cols',P.host).value=p.cols;q('#p3-layers',P.host).value=p.layers;
    buildMemoryTable();q('#p3-address',P.host).value=Runtime.getProfile(P.state).commands.autoStart;rebuildPallet(true);rebuildPlaced(true);updateMachine();updateUi(true);persist(true);schedule();
  }
  function readDevice(addr){return Runtime.readDevice(P.state,addr);}
  function writeDevice(addr,value){const result=Runtime.writeDevice(P.state,addr,value);schedule();updateUi(true);persist(true);return result;}
  function getDiagnostics(){
    let meshCount=0;P.parts.machine?.traverse?.(object=>{if(object.isMesh)meshCount+=1;});
    const axisBindings={};
    for(const name of ['X','Y','Z']){
      const binding=P.parts.axisBindings?.[name],axis=P.state?.axes?.[name];
      const desired=axis?axisSceneCoordinate(name,axis):null,worldPosition=new Three.Vector3();binding?.node?.updateWorldMatrix?.(true,false);binding?.node?.getWorldPosition?.(worldPosition);
      axisBindings[name]={node:binding?.node?.name||null,component:binding?.component||null,direction:binding?.direction||1,worldComponent:binding?.worldComponent||AXIS_WORLD_COMPONENTS[name],runtimeMm:finite(axis?.position),sceneCoordinate:binding?finite(binding.node.position[binding.component]):null,expectedSceneCoordinate:desired===null?null:desired*(binding?.direction||1),worldCoordinate:binding?finite(worldPosition[binding.worldComponent]):null,expectedWorldCoordinate:desired};
    }
    return {
      initialized:P.initialized,visible:P.visible,meshCount,
      axes:{x:!!P.parts.xCarriage,y:!!P.parts.yCarriage,z:!!P.parts.zSlide},
      axisBindings,
      gripper:{present:!!P.parts.gripper,jaws:P.parts.jaws?.length||0,components:P.parts.detailStats?.gripperComponents||0},
      statusLeds:Object.fromEntries(Object.entries(P.parts.leds||{}).map(([name,statusLed])=>[name,{parent:statusLed.parent?.name||null,visible:isEffectivelyVisible(statusLed)}])),
      linearRails:P.parts.detailStats?.linearRails||0,
      energyChains:P.parts.detailStats?.energyChains||0,
      safetyPosts:P.parts.detailStats?.safetyPosts||0,
      blenderModel:!!P.parts.blenderModel,
      modelLoad:{status:P.modelLoad.status,source:P.modelLoad.source,attempts:P.modelLoad.attempts,error:P.modelLoad.error,missingNodes:[...P.modelLoad.missingNodes],retryAt:P.modelLoad.retryAt,startedAt:P.modelLoad.startedAt,completedAt:P.modelLoad.completedAt},
      controlCabinet:!!(P.parts.machine?.getObjectByName?.('LS_Control_Cabinet')||P.parts.machine?.getObjectByName?.('ls-electric-control-cabinet'))
    };
  }

  function init(){
    injectCss();if(!injectUi())return;P.state=loadSavedState();buildMemoryTable();bindUi();
    const pallet=P.state.cell.pallet;q('#p3-rows',P.host).value=pallet.rows;q('#p3-cols',P.host).value=pallet.cols;q('#p3-layers',P.host).value=pallet.layers;
    P.initialized=createScene();if(!P.initialized)return;installJogSafetyHandlers();P.resizeObserver=new ResizeObserver(()=>{if(P.visible){resize();P.renderDirty=true;schedule();}});P.resizeObserver.observe(P.sceneHost);updateMachine();updateUi(true);persist(true);
  }

  window.PLCTrainerPalletizer3D={
    version:Runtime.version,setVisible,renderActive,resize,exportState,importState,readDevice,writeDevice,setCameraNavigationPreset,getDiagnostics,retryModelLoad:retryBlenderMachine,
    setProfile:profile=>{const ok=Runtime.setProfile(P.state,profile);if(ok){buildMemoryTable();updateUi(true);persist(true);emitProfileChanged();}return ok;},getProfile:()=>Runtime.getProfile(P.state),
    startAuto:()=>{const result=Runtime.writeDevice(P.state,activeProfile().commands.autoStart,true);schedule();return result.ok&&result.accepted!==false;},stop:()=>Runtime.writeDevice(P.state,activeProfile().commands.stop,true),home:()=>{const result=Runtime.writeDevice(P.state,activeProfile().commands.home,true);schedule();return result.ok&&result.accepted!==false;},
    getRuntimePort:()=>({readDevice:addr=>Runtime.readDevice(P.state,addr),setPhysicalInput:(addr,value)=>Runtime.setPhysicalInput(P.state,addr,value),writeDevice:(addr,value)=>writeDevice(addr,value),stopAll:()=>Runtime.stopAll(P.state,'XG-SIM 안전 정지'),setServo:(axis,value)=>Runtime.setServo(P.state,axis,value),setObservedStatus:values=>Runtime.setObservedStatus(P.state,values),clearObservedStatus:()=>Runtime.clearObservedStatus(P.state),setPlcAuthoritative:active=>Runtime.setPlcAuthoritative(P.state,active)}),
    get state(){return P.state;},get visible(){return P.visible;},get cameraNavigationPreset(){return P.cameraNavigationPreset;}
  };
  init();
})();
