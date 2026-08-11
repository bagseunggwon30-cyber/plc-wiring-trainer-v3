(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.PLCTrainerPalletizerRuntime=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  const VERSION='2.6.0';
  const EPS=1e-6;
  const AXIS_DEFAULTS={
    X:{min:0,max:600,home:0,homeDirection:-1,maxSpeed:260,accel:700,decel:800,homeSpeed:90,tolerance:.35},
    Y:{min:0,max:420,home:0,homeDirection:-1,maxSpeed:220,accel:650,decel:750,homeSpeed:80,tolerance:.35},
    Z:{min:0,max:280,home:280,homeDirection:1,maxSpeed:180,accel:600,decel:700,homeSpeed:65,tolerance:.3}
  };
  const DEFAULT_CELL={
    pick:{x:74,y:62,z:24},
    safeZ:238,
    pallet:{origin:{x:342,y:146,z:24},rows:3,cols:3,layers:1,spacingX:62,spacingY:58,layerHeight:34},
    dwell:{grip:.28,release:.24}
  };
  const AUTO_STEPS={
    IDLE:0,HOMING:10,MOVE_PICK_XY:20,LOWER_PICK:30,GRIP:40,LIFT_PICK:50,
    MOVE_PLACE_XY:60,LOWER_PLACE:70,RELEASE:80,LIFT_PLACE:90,NEXT:100,
    COMPLETE:110,PAUSED:120,FAULT:900
  };
  const DEVICE_MAP={
    commands:{
      autoStart:'M100',stop:'M101',reset:'M102',home:'M110',grip:'M120',release:'M121',servoOn:'M130',
      moveX:'M140',moveY:'M141',moveZ:'M142',jogXPlus:'M150',jogXMinus:'M151',jogYPlus:'M152',
      jogYMinus:'M153',jogZPlus:'M154',jogZMinus:'M155'
    },
    setpoints:{x:'D100',y:'D102',z:'D104',speed:'D110'},
    status:{
      autoRunning:'M200',autoComplete:'M201',fault:'M202',
      xBusy:'M210',yBusy:'M211',zBusy:'M212',xHomed:'M220',yHomed:'M221',zHomed:'M222',
      xInPosition:'M230',yInPosition:'M231',zInPosition:'M232',gripperClosed:'M240',holding:'M241',
      xNegLimit:'M250',xPosLimit:'M251',yNegLimit:'M252',yPosLimit:'M253',zNegLimit:'M254',zPosLimit:'M255'
    },
    actual:{x:'D200',y:'D202',z:'D204',placed:'D210',step:'D211',cycle:'D212'}
  };
  const WRITABLE_D=new Set(Object.values(DEVICE_MAP.setpoints));

  function finite(value,fallback=0){const n=Number(value);return Number.isFinite(n)?n:fallback;}
  function clamp(value,min,max){return Math.max(min,Math.min(max,value));}
  function approach(value,target,amount){return value<target?Math.min(target,value+amount):Math.max(target,value-amount);}
  function clone(value){return JSON.parse(JSON.stringify(value));}
  function address(value){return String(value||'').trim().toUpperCase().replace(/\s+/g,'');}
  function bool(value){return value===true||value===1||value==='1'||String(value).toLowerCase()==='true'||String(value).toUpperCase()==='ON';}

  function createAxis(name,overrides={}){
    const cfg={...(AXIS_DEFAULTS[name]||AXIS_DEFAULTS.X),...overrides};
    const position=clamp(finite(overrides.position,cfg.home),cfg.min,cfg.max);
    return {
      name,min:cfg.min,max:cfg.max,home:cfg.home,homeDirection:cfg.homeDirection,
      maxSpeed:cfg.maxSpeed,accel:cfg.accel,decel:cfg.decel,homeSpeed:cfg.homeSpeed,tolerance:cfg.tolerance,
      position,target:position,velocity:0,commandSpeed:Math.min(cfg.maxSpeed,140),mode:'idle',jogDirection:0,
      servoOn:false,homed:false,busy:false,inPosition:true,alarm:null,
      negLimit:position<=cfg.min+cfg.tolerance,posLimit:position>=cfg.max-cfg.tolerance
    };
  }

  function createState(options={}){
    const cell={...clone(DEFAULT_CELL),...(options.cell||{})};
    cell.pick={...DEFAULT_CELL.pick,...(options.cell?.pick||{})};
    cell.pallet={...clone(DEFAULT_CELL.pallet),...(options.cell?.pallet||{})};
    cell.pallet.origin={...DEFAULT_CELL.pallet.origin,...(options.cell?.pallet?.origin||{})};
    cell.dwell={...DEFAULT_CELL.dwell,...(options.cell?.dwell||{})};
    const state={
      version:VERSION,elapsed:0,
      axes:{
        X:createAxis('X',options.axes?.X),Y:createAxis('Y',options.axes?.Y),Z:createAxis('Z',options.axes?.Z)
      },
      cell,
      gripper:{closed:false,holding:false,workpieceId:null},
      pallet:{placed:[],nextIndex:0},
      auto:{running:false,state:'IDLE',previous:'IDLE',timer:0,cycle:0,message:'대기',fault:null},
      memory:{M:{},D:{D100:cell.pick.x,D102:cell.pick.y,D104:cell.safeZ,D110:140}},
      events:[]
    };
    refreshMemory(state);
    if(options.saved)importState(state,options.saved);
    return state;
  }

  function addEvent(state,type,message){
    state.events.push({time:Number(state.elapsed.toFixed(3)),type,message});
    if(state.events.length>80)state.events.splice(0,state.events.length-80);
  }
  function axisFor(state,name){return state.axes[String(name||'').toUpperCase()]||null;}
  function setServo(state,name,on=true){
    const names=name? [String(name).toUpperCase()] : ['X','Y','Z'];
    let changed=false;
    for(const n of names){
      const axis=axisFor(state,n);if(!axis)continue;
      axis.servoOn=!!on;changed=true;
      if(!axis.servoOn){axis.mode='idle';axis.velocity=0;axis.busy=false;axis.inPosition=false;}
    }
    refreshMemory(state);return changed;
  }
  function resetAxisAlarm(axis){
    axis.alarm=null;axis.mode='idle';axis.velocity=0;axis.busy=false;
    axis.inPosition=Math.abs(axis.target-axis.position)<=axis.tolerance;
  }
  function resetAlarms(state){
    Object.values(state.axes).forEach(resetAxisAlarm);
    state.auto.fault=null;
    if(state.auto.state==='FAULT')transition(state,'IDLE','알람 리셋');
    refreshMemory(state);
  }
  function setAxisAlarm(state,axis,code,message){
    axis.alarm={code,message};axis.mode='idle';axis.velocity=0;axis.busy=false;axis.inPosition=false;
    if(state.auto.running){state.auto.running=false;state.auto.fault={axis:axis.name,code,message};transition(state,'FAULT',`${axis.name}축 ${message}`);}
    addEvent(state,'alarm',`${axis.name}: ${message}`);refreshMemory(state);
  }

  function commandAxis(state,name,target,options={}){
    const axis=axisFor(state,name);if(!axis)return false;
    if(!axis.servoOn){setAxisAlarm(state,axis,'SERVO_OFF','서보가 꺼져 있습니다');return false;}
    if(axis.alarm)return false;
    target=finite(target,axis.position);
    if(target<axis.min-EPS||target>axis.max+EPS){setAxisAlarm(state,axis,'SOFT_LIMIT',`목표 ${target.toFixed(1)} mm가 이동 범위를 벗어났습니다`);return false;}
    axis.target=clamp(target,axis.min,axis.max);
    axis.commandSpeed=clamp(finite(options.speed,axis.commandSpeed||140),1,axis.maxSpeed);
    axis.mode='position';axis.jogDirection=0;axis.busy=Math.abs(axis.target-axis.position)>axis.tolerance;axis.inPosition=!axis.busy;
    if(!axis.busy){axis.mode='idle';axis.velocity=0;}
    refreshMemory(state);return true;
  }
  function homeAxis(state,name){
    const axis=axisFor(state,name);if(!axis)return false;
    if(!axis.servoOn){setAxisAlarm(state,axis,'SERVO_OFF','원점복귀 전 서보를 켜야 합니다');return false;}
    if(axis.alarm)return false;
    axis.mode='home';axis.target=axis.home;axis.jogDirection=0;axis.busy=true;axis.inPosition=false;axis.homed=false;
    refreshMemory(state);return true;
  }
  function homeAll(state){
    setServo(state,null,true);
    let ok=true;for(const name of ['X','Y','Z'])ok=homeAxis(state,name)&&ok;
    addEvent(state,'command','전축 원점복귀');return ok;
  }
  function jogAxis(state,name,direction,speed){
    const axis=axisFor(state,name);if(!axis)return false;
    const dir=Math.sign(finite(direction,0));if(!dir)return stopAxis(state,name);
    if(!axis.servoOn){setAxisAlarm(state,axis,'SERVO_OFF','서보가 꺼져 있습니다');return false;}
    if(axis.alarm)return false;
    if((dir<0&&axis.negLimit)||(dir>0&&axis.posLimit)){setAxisAlarm(state,axis,dir<0?'NEG_LIMIT':'POS_LIMIT','리미트 방향으로 조그할 수 없습니다');return false;}
    axis.commandSpeed=clamp(finite(speed,Math.min(90,axis.maxSpeed)),1,axis.maxSpeed);
    axis.mode='jog';axis.jogDirection=dir;axis.busy=true;axis.inPosition=false;axis.target=dir>0?axis.max:axis.min;
    refreshMemory(state);return true;
  }
  function stopAxis(state,name){
    const axis=axisFor(state,name);if(!axis)return false;
    axis.mode='idle';axis.velocity=0;axis.jogDirection=0;axis.target=axis.position;axis.busy=false;axis.inPosition=true;
    refreshMemory(state);return true;
  }
  function stopAll(state,reason='정지'){
    Object.keys(state.axes).forEach(name=>stopAxis(state,name));
    if(state.auto.running){state.auto.running=false;transition(state,'PAUSED',reason);}
    refreshMemory(state);
  }

  function updateLimits(axis){
    axis.negLimit=axis.position<=axis.min+axis.tolerance;
    axis.posLimit=axis.position>=axis.max-axis.tolerance;
  }
  function tickAxis(state,axis,dt){
    updateLimits(axis);
    if(!axis.servoOn||axis.alarm||axis.mode==='idle'){
      axis.velocity=0;axis.busy=false;updateLimits(axis);return;
    }
    let target=axis.target,speed=axis.commandSpeed;
    if(axis.mode==='home'){target=axis.home;speed=axis.homeSpeed;}
    else if(axis.mode==='jog')target=axis.jogDirection>0?axis.max:axis.min;
    const distance=target-axis.position;
    if(Math.abs(distance)<=axis.tolerance){
      axis.position=target;axis.velocity=0;axis.mode='idle';axis.busy=false;axis.inPosition=true;
      if(Math.abs(target-axis.home)<=axis.tolerance)axis.homed=true;
      updateLimits(axis);return;
    }
    const dir=Math.sign(distance);
    const brakingSpeed=Math.sqrt(Math.max(0,2*axis.decel*Math.abs(distance)));
    const desired=dir*Math.min(speed,brakingSpeed);
    const rate=Math.sign(axis.velocity)===dir?axis.accel:axis.decel;
    axis.velocity=approach(axis.velocity,desired,rate*dt);
    let next=axis.position+axis.velocity*dt;
    if((dir>0&&next>=target)||(dir<0&&next<=target))next=target;
    axis.position=clamp(next,axis.min,axis.max);axis.busy=true;axis.inPosition=false;
    updateLimits(axis);
    if(axis.mode==='jog'&&((axis.jogDirection<0&&axis.negLimit)||(axis.jogDirection>0&&axis.posLimit))){
      setAxisAlarm(state,axis,axis.jogDirection<0?'NEG_LIMIT':'POS_LIMIT','조그 중 리미트에 도달했습니다');return;
    }
    if(Math.abs(axis.position-target)<=axis.tolerance){
      axis.position=target;axis.velocity=0;axis.mode='idle';axis.busy=false;axis.inPosition=true;
      if(Math.abs(target-axis.home)<=axis.tolerance)axis.homed=true;
      updateLimits(axis);
    }
  }

  function palletCapacity(state){
    const p=state.cell.pallet;return Math.max(1,Math.trunc(p.rows))*Math.max(1,Math.trunc(p.cols))*Math.max(1,Math.trunc(p.layers));
  }
  function palletSlot(state,index=state.pallet.nextIndex){
    const p=state.cell.pallet,cols=Math.max(1,Math.trunc(p.cols)),rows=Math.max(1,Math.trunc(p.rows));
    index=Math.max(0,Math.trunc(index));
    const perLayer=cols*rows,layer=Math.floor(index/perLayer),inLayer=index%perLayer;
    const row=Math.floor(inLayer/cols),col=inLayer%cols;
    return {index,row,col,layer,x:p.origin.x+col*p.spacingX,y:p.origin.y+row*p.spacingY,z:p.origin.z+layer*p.layerHeight};
  }
  function axesReady(state,names=['X','Y','Z']){return names.every(n=>{const a=state.axes[n];return !a.alarm&&!a.busy&&a.inPosition;});}
  function allHomed(state){return Object.values(state.axes).every(a=>a.homed&&!a.alarm);}
  function transition(state,next,message){
    const auto=state.auto;if(auto.state!==next){auto.previous=auto.state;auto.state=next;auto.timer=0;}
    if(message)auto.message=message;refreshMemory(state);
  }
  function faultIfAny(state){
    const hit=Object.values(state.axes).find(a=>a.alarm);
    if(!hit)return false;
    state.auto.running=false;state.auto.fault={axis:hit.name,...hit.alarm};transition(state,'FAULT',`${hit.name}축 ${hit.alarm.message}`);return true;
  }
  function startAuto(state){
    if(faultIfAny(state))return false;
    if(state.pallet.nextIndex>=palletCapacity(state)){transition(state,'COMPLETE','팔레트가 가득 찼습니다');return false;}
    setServo(state,null,true);
    state.auto.running=true;state.auto.fault=null;
    if(!allHomed(state)){transition(state,'HOMING','자동 원점복귀');for(const n of ['X','Y','Z'])homeAxis(state,n);}
    else{
      commandAxis(state,'Z',state.cell.safeZ);
      commandAxis(state,'X',state.cell.pick.x);commandAxis(state,'Y',state.cell.pick.y);
      transition(state,'MOVE_PICK_XY','픽업 위치로 이동');
    }
    addEvent(state,'command','자동운전 시작');refreshMemory(state);return true;
  }
  function setGripper(state,closed){
    state.gripper.closed=!!closed;
    if(!closed&&state.gripper.holding){state.gripper.holding=false;state.gripper.workpieceId=null;}
    refreshMemory(state);
  }
  function resetCell(state,options={}){
    stopAll(state,'리셋');resetAlarms(state);
    state.gripper.closed=false;state.gripper.holding=false;state.gripper.workpieceId=null;
    if(options.clearPallet!==false){state.pallet.placed=[];state.pallet.nextIndex=0;state.auto.cycle=0;}
    transition(state,'IDLE','대기');state.auto.running=false;state.auto.timer=0;state.events=[];
    refreshMemory(state);return true;
  }
  function placeHeldWorkpiece(state){
    if(!state.gripper.holding)return false;
    const slot=palletSlot(state,state.pallet.nextIndex);
    const item={id:state.gripper.workpieceId||`BOX-${state.pallet.nextIndex+1}`,placedAt:Number(state.elapsed.toFixed(3)),...slot};
    state.pallet.placed.push(item);state.pallet.nextIndex++;state.auto.cycle++;
    state.gripper.holding=false;state.gripper.workpieceId=null;state.gripper.closed=false;
    addEvent(state,'placed',`${item.id} → ${item.row+1}행 ${item.col+1}열 ${item.layer+1}단`);return true;
  }

  function tickAuto(state,dt){
    const auto=state.auto;if(!auto.running)return;
    if(faultIfAny(state))return;
    auto.timer+=dt;
    const pick=state.cell.pick,slot=palletSlot(state,state.pallet.nextIndex);
    switch(auto.state){
      case 'HOMING':
        for(const n of ['X','Y','Z']){const a=state.axes[n];if(!a.homed&&a.mode==='idle')homeAxis(state,n);}
        if(allHomed(state)){
          commandAxis(state,'Z',state.cell.safeZ);commandAxis(state,'X',pick.x);commandAxis(state,'Y',pick.y);
          transition(state,'MOVE_PICK_XY','픽업 위치로 이동');
        }
        break;
      case 'MOVE_PICK_XY':
        if(axesReady(state)){
          commandAxis(state,'Z',pick.z);transition(state,'LOWER_PICK','제품 높이로 하강');
        }
        break;
      case 'LOWER_PICK':
        if(axesReady(state,['Z'])){state.gripper.closed=true;transition(state,'GRIP','그리퍼 흡착');}
        break;
      case 'GRIP':
        if(auto.timer>=state.cell.dwell.grip){
          state.gripper.holding=true;state.gripper.workpieceId=`BOX-${state.pallet.nextIndex+1}`;
          commandAxis(state,'Z',state.cell.safeZ);transition(state,'LIFT_PICK','제품 상승');
        }
        break;
      case 'LIFT_PICK':
        if(axesReady(state,['Z'])){
          commandAxis(state,'X',slot.x);commandAxis(state,'Y',slot.y);transition(state,'MOVE_PLACE_XY','팔레트 위치로 이동');
        }
        break;
      case 'MOVE_PLACE_XY':
        if(axesReady(state,['X','Y','Z'])){commandAxis(state,'Z',slot.z);transition(state,'LOWER_PLACE','적재 높이로 하강');}
        break;
      case 'LOWER_PLACE':
        if(axesReady(state,['Z'])){state.gripper.closed=false;transition(state,'RELEASE','제품 해제');}
        break;
      case 'RELEASE':
        if(auto.timer>=state.cell.dwell.release){placeHeldWorkpiece(state);commandAxis(state,'Z',state.cell.safeZ);transition(state,'LIFT_PLACE','안전 높이로 상승');}
        break;
      case 'LIFT_PLACE':
        if(axesReady(state,['Z']))transition(state,'NEXT','다음 제품 확인');
        break;
      case 'NEXT':
        if(state.pallet.nextIndex>=palletCapacity(state)){
          state.auto.running=false;transition(state,'COMPLETE',`자동 적재 완료 · ${state.pallet.placed.length}개`);addEvent(state,'complete','팔레타이징 완료');
        }else{
          commandAxis(state,'X',pick.x);commandAxis(state,'Y',pick.y);transition(state,'MOVE_PICK_XY','다음 픽업 위치로 이동');
        }
        break;
      default:
        state.auto.running=false;transition(state,'FAULT','알 수 없는 자동 시퀀스 단계');
    }
  }

  function refreshMemory(state){
    const M=state.memory.M,D=state.memory.D,a=state.axes;
    M.M200=!!state.auto.running;M.M201=state.auto.state==='COMPLETE';M.M202=state.auto.state==='FAULT'||!!state.auto.fault||Object.values(a).some(x=>x.alarm);
    M.M210=a.X.busy;M.M211=a.Y.busy;M.M212=a.Z.busy;
    M.M220=a.X.homed;M.M221=a.Y.homed;M.M222=a.Z.homed;
    M.M230=a.X.inPosition;M.M231=a.Y.inPosition;M.M232=a.Z.inPosition;
    M.M240=state.gripper.closed;M.M241=state.gripper.holding;
    M.M250=a.X.negLimit;M.M251=a.X.posLimit;M.M252=a.Y.negLimit;M.M253=a.Y.posLimit;M.M254=a.Z.negLimit;M.M255=a.Z.posLimit;
    D.D200=Number(a.X.position.toFixed(2));D.D202=Number(a.Y.position.toFixed(2));D.D204=Number(a.Z.position.toFixed(2));
    D.D210=state.pallet.placed.length;D.D211=AUTO_STEPS[state.auto.state]??-1;D.D212=state.auto.cycle;
  }
  function readDevice(state,rawAddress){
    const key=address(rawAddress);refreshMemory(state);
    if(/^M\d+$/.test(key))return !!state.memory.M[key];
    if(/^D\d+$/.test(key))return finite(state.memory.D[key],0);
    return undefined;
  }
  function writeDevice(state,rawAddress,value){
    const key=address(rawAddress);
    if(/^D\d+$/.test(key)){
      if(!WRITABLE_D.has(key))return {ok:false,error:`${key}는 읽기 전용 또는 미정의 주소입니다`};
      const n=finite(value,NaN);if(!Number.isFinite(n))return {ok:false,error:'숫자 설정값이 필요합니다'};
      state.memory.D[key]=n;refreshMemory(state);return {ok:true,address:key,value:n};
    }
    if(!/^M\d+$/.test(key))return {ok:false,error:'M 또는 D 주소 형식이 필요합니다'};
    const on=bool(value);state.memory.M[key]=on;
    if(key==='M100'&&on)startAuto(state);
    else if(key==='M101'&&on)stopAll(state,'PLC 정지 지령');
    else if(key==='M102'&&on)resetCell(state,{clearPallet:false});
    else if(key==='M110'&&on)homeAll(state);
    else if(key==='M120'&&on)setGripper(state,true);
    else if(key==='M121'&&on)setGripper(state,false);
    else if(key==='M130')setServo(state,null,on);
    else if(['M140','M141','M142'].includes(key)&&on){
      const index={'M140':['X','D100'],'M141':['Y','D102'],'M142':['Z','D104']}[key];
      commandAxis(state,index[0],state.memory.D[index[1]],{speed:state.memory.D.D110});
    }else if(['M150','M151','M152','M153','M154','M155'].includes(key)){
      const map={M150:['X',1],M151:['X',-1],M152:['Y',1],M153:['Y',-1],M154:['Z',1],M155:['Z',-1]};
      const [axis,dir]=map[key];if(on)jogAxis(state,axis,dir,state.memory.D.D110);else if(state.axes[axis].mode==='jog'&&state.axes[axis].jogDirection===dir)stopAxis(state,axis);
    }else if(!Object.values(DEVICE_MAP.commands).includes(key)){
      return {ok:false,error:`${key}는 정의되지 않은 명령 주소입니다`};
    }
    refreshMemory(state);return {ok:true,address:key,value:on};
  }

  function tick(state,dt){
    dt=clamp(finite(dt,0),0,.1);if(dt<=0){refreshMemory(state);return state;}
    state.elapsed+=dt;
    tickAuto(state,dt);
    for(const axis of Object.values(state.axes))tickAxis(state,axis,dt);
    refreshMemory(state);return state;
  }
  function configurePallet(state,patch={}){
    const p=state.cell.pallet;
    if(patch.rows!=null)p.rows=clamp(Math.trunc(finite(patch.rows,p.rows)),1,8);
    if(patch.cols!=null)p.cols=clamp(Math.trunc(finite(patch.cols,p.cols)),1,8);
    if(patch.layers!=null)p.layers=clamp(Math.trunc(finite(patch.layers,p.layers)),1,5);
    for(const k of ['spacingX','spacingY','layerHeight'])if(patch[k]!=null)p[k]=clamp(finite(patch[k],p[k]),10,150);
    if(patch.origin)p.origin={...p.origin,...patch.origin};
    if(state.pallet.nextIndex>palletCapacity(state))state.pallet.nextIndex=palletCapacity(state);
    refreshMemory(state);return clone(p);
  }
  function exportState(state){
    return clone({
      version:VERSION,elapsed:state.elapsed,axes:state.axes,cell:state.cell,gripper:state.gripper,
      pallet:state.pallet,auto:state.auto,memory:{D:state.memory.D},events:state.events
    });
  }
  function importState(state,saved={}){
    if(!saved||typeof saved!=='object')return state;
    if(saved.cell){
      state.cell={...state.cell,...clone(saved.cell)};
      state.cell.pick={...DEFAULT_CELL.pick,...(saved.cell.pick||{})};
      state.cell.pallet={...clone(DEFAULT_CELL.pallet),...(saved.cell.pallet||{})};
      state.cell.pallet.origin={...DEFAULT_CELL.pallet.origin,...(saved.cell.pallet?.origin||{})};
      state.cell.dwell={...DEFAULT_CELL.dwell,...(saved.cell.dwell||{})};
    }
    for(const name of ['X','Y','Z'])if(saved.axes?.[name]){
      const base=createAxis(name),src=saved.axes[name];Object.assign(base,src);
      base.position=clamp(finite(src.position,base.home),base.min,base.max);base.target=clamp(finite(src.target,base.position),base.min,base.max);
      base.velocity=finite(src.velocity,0);state.axes[name]=base;updateLimits(base);
    }
    if(saved.gripper)state.gripper={...state.gripper,...clone(saved.gripper)};
    if(saved.pallet){state.pallet={placed:Array.isArray(saved.pallet.placed)?clone(saved.pallet.placed):[],nextIndex:Math.max(0,Math.trunc(finite(saved.pallet.nextIndex,0)))};}
    if(saved.auto)state.auto={...state.auto,...clone(saved.auto),running:false,state:saved.auto.state==='FAULT'?'FAULT':'IDLE',timer:0};
    if(saved.memory?.D)for(const key of WRITABLE_D)if(saved.memory.D[key]!=null)state.memory.D[key]=finite(saved.memory.D[key],state.memory.D[key]);
    state.elapsed=Math.max(0,finite(saved.elapsed,0));state.events=Array.isArray(saved.events)?clone(saved.events).slice(-80):[];
    refreshMemory(state);return state;
  }

  return {
    version:VERSION,AXIS_DEFAULTS:clone(AXIS_DEFAULTS),DEFAULT_CELL:clone(DEFAULT_CELL),AUTO_STEPS:{...AUTO_STEPS},DEVICE_MAP:clone(DEVICE_MAP),
    createAxis,createState,create:createState,tick,commandAxis,homeAxis,homeAll,jogAxis,stopAxis,stopAll,setServo,resetAlarms,
    startAuto,resetCell,setGripper,configurePallet,palletCapacity,palletSlot,allHomed,readDevice,writeDevice,refreshMemory,
    exportState,importState
  };
});
