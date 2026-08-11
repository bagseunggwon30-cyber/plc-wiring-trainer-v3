(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.PLCTrainerPalletizerRuntime=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  const VERSION='3.1.0';
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
  // 교육용 기본 주소 이미지다. 실제 PLC 전송이나 제조사 프로젝트 신원 증명에는 사용하지 않는다.
  // 한 상태에는 아래 프로필 중 하나만 활성화되며 프로필을 바꾸면 모든 출력 명령을 안전 해제한다.
  const PROFILES={
    ls:{
      id:'ls',vendor:'LS ELECTRIC',family:'XGB / XG5000',addressStyle:'M / D',aliases:['ls','xgb','xg5000'],simulationOnly:true,transport:null,
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
    },
    mitsubishi:{
      id:'mitsubishi',vendor:'Mitsubishi Electric',family:'QnU / MELSOFT',addressStyle:'X / Y / M / D',aliases:['mitsubishi','melsec','qnu','q-series','qseries'],simulationOnly:true,transport:null,
      commands:{
        autoStart:'M1000',stop:'M1001',reset:'M1002',home:'M1010',grip:'Y100',release:'Y101',servoOn:'Y102',
        moveX:'M1040',moveY:'M1041',moveZ:'M1042',jogXPlus:'M1050',jogXMinus:'M1051',jogYPlus:'M1052',
        jogYMinus:'M1053',jogZPlus:'M1054',jogZMinus:'M1055'
      },
      setpoints:{x:'D1000',y:'D1002',z:'D1004',speed:'D1010'},
      status:{
        autoRunning:'M1200',autoComplete:'M1201',fault:'M1202',
        xBusy:'X100',yBusy:'X101',zBusy:'X102',xHomed:'X110',yHomed:'X111',zHomed:'X112',
        xInPosition:'X120',yInPosition:'X121',zInPosition:'X122',gripperClosed:'X130',holding:'X131',
        xNegLimit:'X140',xPosLimit:'X141',yNegLimit:'X142',yPosLimit:'X143',zNegLimit:'X144',zPosLimit:'X145'
      },
      actual:{x:'D1200',y:'D1202',z:'D1204',placed:'D1210',step:'D1211',cycle:'D1212'}
    }
  };
  const DEVICE_MAP=PROFILES.ls;
  const BIT_BANKS=new Set(['P','M','X','Y']);

  function finite(value,fallback=0){const n=Number(value);return Number.isFinite(n)?n:fallback;}
  function clamp(value,min,max){return Math.max(min,Math.min(max,value));}
  function approach(value,target,amount){return value<target?Math.min(target,value+amount):Math.max(target,value-amount);}
  function clone(value){return JSON.parse(JSON.stringify(value));}
  function address(value){return String(value||'').trim().toUpperCase().replace(/\s+/g,'');}
  function bool(value){return value===true||value===1||value==='1'||String(value).toLowerCase()==='true'||String(value).toUpperCase()==='ON';}
  function resolveProfile(value){
    if(value&&typeof value==='object')value=value.id;
    const key=String(value==null?'ls':value).trim().toLowerCase();
    for(const profile of Object.values(PROFILES))if(profile.id===key||profile.aliases.includes(key))return profile.id;
    return null;
  }
  function getProfile(stateOrId){
    const raw=stateOrId&&typeof stateOrId==='object'?(stateOrId.profileId||stateOrId.profile):stateOrId;
    return PROFILES[resolveProfile(raw)||'ls'];
  }
  function emptyMemory(){return {P:{},M:{},X:{},Y:{},D:{}};}
  function bankForAddress(key){const prefix=String(key||'')[0];return prefix==='D'?'D':BIT_BANKS.has(prefix)?prefix:null;}
  function memorySet(state,raw,value){const key=address(raw),bank=bankForAddress(key);if(bank)state.memory[bank][key]=value;return value;}
  function memoryGet(state,raw){const key=address(raw),bank=bankForAddress(key);return bank?state.memory[bank][key]:undefined;}
  function flattenAddresses(value,result=[]){
    if(typeof value==='string')result.push(address(value));
    else if(value&&typeof value==='object')Object.values(value).forEach(item=>flattenAddresses(item,result));
    return result;
  }
  function mappedAddresses(profile){return new Set(flattenAddresses({commands:profile.commands,setpoints:profile.setpoints,status:profile.status,actual:profile.actual}));}
  function roleAt(mapping,raw){const key=address(raw);return Object.entries(mapping).find(([,mapped])=>address(mapped)===key)?.[0]||null;}

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
    const requestedProfile=options.profileId||options.profile||options.saved?.profileId||options.saved?.profile;
    const profileId=resolveProfile(requestedProfile)||'ls';
    const state={
      version:VERSION,elapsed:0,
      profileId,profile:profileId,
      axes:{
        X:createAxis('X',options.axes?.X),Y:createAxis('Y',options.axes?.Y),Z:createAxis('Z',options.axes?.Z)
      },
      cell,
      gripper:{closed:false,holding:false,workpieceId:null},
      pallet:{placed:[],nextIndex:0},
      auto:{running:false,state:'IDLE',previous:'IDLE',timer:0,cycle:0,message:'대기',fault:null},
      memory:emptyMemory(),
      events:[]
    };
    initializeMemory(state);
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
    const p=getProfile(state),s=p.status,d=p.actual,a=state.axes;
    memorySet(state,s.autoRunning,!!state.auto.running);memorySet(state,s.autoComplete,state.auto.state==='COMPLETE');memorySet(state,s.fault,state.auto.state==='FAULT'||!!state.auto.fault||Object.values(a).some(x=>x.alarm));
    memorySet(state,s.xBusy,a.X.busy);memorySet(state,s.yBusy,a.Y.busy);memorySet(state,s.zBusy,a.Z.busy);
    memorySet(state,s.xHomed,a.X.homed);memorySet(state,s.yHomed,a.Y.homed);memorySet(state,s.zHomed,a.Z.homed);
    memorySet(state,s.xInPosition,a.X.inPosition);memorySet(state,s.yInPosition,a.Y.inPosition);memorySet(state,s.zInPosition,a.Z.inPosition);
    memorySet(state,s.gripperClosed,state.gripper.closed);memorySet(state,s.holding,state.gripper.holding);
    memorySet(state,s.xNegLimit,a.X.negLimit);memorySet(state,s.xPosLimit,a.X.posLimit);memorySet(state,s.yNegLimit,a.Y.negLimit);memorySet(state,s.yPosLimit,a.Y.posLimit);memorySet(state,s.zNegLimit,a.Z.negLimit);memorySet(state,s.zPosLimit,a.Z.posLimit);
    memorySet(state,d.x,Number(a.X.position.toFixed(2)));memorySet(state,d.y,Number(a.Y.position.toFixed(2)));memorySet(state,d.z,Number(a.Z.position.toFixed(2)));
    memorySet(state,d.placed,state.pallet.placed.length);memorySet(state,d.step,AUTO_STEPS[state.auto.state]??-1);memorySet(state,d.cycle,state.auto.cycle);
  }
  function initializeMemory(state){
    state.memory=emptyMemory();const p=getProfile(state);
    for(const mapped of Object.values(p.commands))memorySet(state,mapped,false);
    memorySet(state,p.setpoints.x,state.cell.pick.x);memorySet(state,p.setpoints.y,state.cell.pick.y);memorySet(state,p.setpoints.z,state.cell.safeZ);memorySet(state,p.setpoints.speed,140);
    refreshMemory(state);return state.memory;
  }
  function readDevice(state,rawAddress){
    const key=address(rawAddress),profile=getProfile(state);if(!mappedAddresses(profile).has(key))return undefined;refreshMemory(state);
    const value=memoryGet(state,key);return key.startsWith('D')?finite(value,0):!!value;
  }
  function writeDevice(state,rawAddress,value){
    const key=address(rawAddress),profile=getProfile(state),setpoint=roleAt(profile.setpoints,key);
    if(setpoint){
      const n=finite(value,NaN);if(!Number.isFinite(n))return {ok:false,error:'숫자 설정값이 필요합니다'};
      memorySet(state,key,n);refreshMemory(state);return {ok:true,address:key,value:n};
    }
    const command=roleAt(profile.commands,key);
    if(!command){
      if(mappedAddresses(profile).has(key))return {ok:false,error:`${key}는 읽기 전용 상태 주소입니다`};
      return {ok:false,error:`${key||'(빈 주소)'}는 선택한 ${profile.vendor} 프로필에 정의되지 않았습니다`};
    }
    const on=bool(value);memorySet(state,key,on);let accepted=true;
    if(command==='autoStart'&&on)accepted=startAuto(state);
    else if(command==='stop'&&on)stopAll(state,'PLC 정지 지령');
    else if(command==='reset'&&on)accepted=resetCell(state,{clearPallet:false});
    else if(command==='home'&&on)accepted=homeAll(state);
    else if(command==='grip'&&on)setGripper(state,true);
    else if(command==='release'&&on)setGripper(state,false);
    else if(command==='servoOn')accepted=setServo(state,null,on);
    else if(['moveX','moveY','moveZ'].includes(command)&&on){
      const axis={moveX:'X',moveY:'Y',moveZ:'Z'}[command],targetKey={X:'x',Y:'y',Z:'z'}[axis];
      accepted=commandAxis(state,axis,memoryGet(state,profile.setpoints[targetKey]),{speed:memoryGet(state,profile.setpoints.speed)});
    }else if(/^jog[XYZ](Plus|Minus)$/.test(command)){
      const axis=command[3],dir=command.endsWith('Plus')?1:-1;
      accepted=on?jogAxis(state,axis,dir,memoryGet(state,profile.setpoints.speed)):(state.axes[axis].mode==='jog'&&state.axes[axis].jogDirection===dir?stopAxis(state,axis):true);
    }
    refreshMemory(state);return {ok:true,address:key,value:on,...(accepted===false?{accepted:false}:{})};
  }

  function setProfile(state,profileName){
    const profileId=resolveProfile(profileName);if(!profileId)return false;if(profileId===state.profileId)return true;
    stopAll(state,'PLC 제조사 프로필 전환');setServo(state,null,false);setGripper(state,false);
    state.profileId=profileId;state.profile=profileId;initializeMemory(state);
    addEvent(state,'profile',`${getProfile(state).vendor} 주소 프로필 선택 · 이전 출력 안전 해제`);return true;
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
      version:VERSION,elapsed:state.elapsed,profileId:state.profileId,profile:state.profileId,axes:state.axes,cell:state.cell,gripper:state.gripper,
      pallet:state.pallet,auto:state.auto,memory:state.memory,events:state.events
    });
  }
  function importState(state,saved={}){
    if(!saved||typeof saved!=='object')return state;
    state.profileId=resolveProfile(saved.profileId||saved.profile)||state.profileId||'ls';state.profile=state.profileId;
    if(saved.cell){
      state.cell={...state.cell,...clone(saved.cell)};
      state.cell.pick={...DEFAULT_CELL.pick,...(saved.cell.pick||{})};
      state.cell.pallet={...clone(DEFAULT_CELL.pallet),...(saved.cell.pallet||{})};
      state.cell.pallet.origin={...DEFAULT_CELL.pallet.origin,...(saved.cell.pallet?.origin||{})};
      state.cell.dwell={...DEFAULT_CELL.dwell,...(saved.cell.dwell||{})};
    }
    for(const name of ['X','Y','Z'])if(saved.axes?.[name]){
      const base=createAxis(name),src=saved.axes[name];Object.assign(base,src);
      base.position=clamp(finite(src.position,base.home),base.min,base.max);base.target=base.position;
      base.servoOn=false;base.mode='idle';base.velocity=0;base.jogDirection=0;base.busy=false;base.inPosition=false;state.axes[name]=base;updateLimits(base);
    }
    if(saved.gripper)state.gripper={...state.gripper,...clone(saved.gripper),closed:false,holding:false,workpieceId:null};
    if(saved.pallet){state.pallet={placed:Array.isArray(saved.pallet.placed)?clone(saved.pallet.placed):[],nextIndex:Math.max(0,Math.trunc(finite(saved.pallet.nextIndex,0)))};}
    if(saved.auto){const faulted=saved.auto.state==='FAULT';state.auto={...state.auto,...clone(saved.auto),running:false,state:faulted?'FAULT':'IDLE',timer:0,message:faulted?saved.auto.message:'복원 후 안전 정지'};}
    state.elapsed=Math.max(0,finite(saved.elapsed,0));state.events=Array.isArray(saved.events)?clone(saved.events).slice(-80):[];
    initializeMemory(state);const profile=getProfile(state);
    for(const mapped of Object.values(profile.setpoints))if(saved.memory?.D?.[mapped]!=null)memorySet(state,mapped,finite(saved.memory.D[mapped],memoryGet(state,mapped)));
    refreshMemory(state);return state;
  }

  return {
    version:VERSION,AXIS_DEFAULTS:clone(AXIS_DEFAULTS),DEFAULT_CELL:clone(DEFAULT_CELL),AUTO_STEPS:{...AUTO_STEPS},DEVICE_MAP:clone(DEVICE_MAP),PROFILES:clone(PROFILES),
    createAxis,createState,create:createState,tick,commandAxis,homeAxis,homeAll,jogAxis,stopAxis,stopAll,setServo,resetAlarms,
    startAuto,resetCell,setGripper,configurePallet,palletCapacity,palletSlot,allHomed,getProfile,setProfile,readDevice,writeDevice,refreshMemory,
    exportState,importState
  };
});
