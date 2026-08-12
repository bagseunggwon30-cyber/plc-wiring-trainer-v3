(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.PLCTrainerPalletizerRuntime=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  const VERSION='3.2.0';
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
    COMPLETE:110,PAUSED:120,FAULT:900,
    PROD_SERVO:10,PROD_PREFLIGHT:20,PROD_Z_WAIT:30,PROD_X_WAIT:31,PROD_Y_WAIT:32,
    PROD_WAIT_PRODUCT:100,PROD_FEED_X:110,PROD_FEED_Y:111,PROD_FEED_WAIT:120,PROD_PICK_Z:130,
    PROD_VACUUM:140,PROD_LIFT:150,PROD_CALCULATE:160,PROD_PALLET_X:161,PROD_PALLET_Y:162,
    PROD_PALLET_WAIT:170,PROD_APPROACH:180,PROD_PLACE_Z:181,PROD_RELEASE:190,PROD_RETURN_Z:200,
    PROD_COUNT_RETURN_X:210,PROD_RETURN_Y:211,PROD_COMPLETE:212,PROD_FULL:220,PROD_NEW_PALLET:230,
    PROD_STOP:800,PROD_FAULT:900
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
    },
    // XBC-DN32UP production contract.  This is deliberately opt-in: the
    // existing LS/Mitsubishi profiles remain educational simulations.
    'xgb-production':{
      id:'xgb-production',vendor:'LS ELECTRIC',family:'XGB XBC-DN32UP / XG5000',addressStyle:'P / M / D',aliases:['xgb-production','xbc-dn32up'],simulationOnly:false,transport:null,
      commands:{autoStart:'M00123',stop:'M00124',newPallet:'M00125',reset:'M00126',manualOrg:'M00119',servoOn:'M00111',servoOff:'M00122'},
      inputs:{eStopLoopOk:'P00000',guardLoopOk:'P00001',startPb:'P00002',stopPb:'P00003',resetPb:'P00004',autoEnableKey:'P00005',workPresent:'P00006',palletPresent:'P00007',vacuumOk:'P00008',releaseOk:'P00009',airPressureOk:'P0000A',xDrivePowerOk:'P0000B',yDrivePowerOk:'P0000C',zDrivePowerOk:'P0000D',safetyRelayEdmOk:'P0000E',extStopLoopOk:'P0000F'},
      setpoints:{x:'D00500',y:'D00502',z:'D00520',speed:'D00540'},
      status:{
        // Rev.M2 Network 4: axis outcomes.  Keep the older in-position
        // names as aliases because the offline model exposes that concept.
        xHomed:'M00320',yHomed:'M00321',zHomed:'M00322',
        xBusy:'M00323',yBusy:'M00324',zBusy:'M00325',
        xDone:'M00326',yDone:'M00327',zDone:'M00328',
        xInPosition:'M00326',yInPosition:'M00327',zInPosition:'M00328',
        xError:'M00329',yError:'M00330',zError:'M00331',
        xDriveReady:'M00332',yDriveReady:'M00333',zDriveReady:'M00334',
        xServoOn:'M00335',yServoOn:'M00336',zServoOn:'M00337',
        xPosLimit:'M00338',yPosLimit:'M00339',zPosLimit:'M00340',
        xNegLimit:'M00341',yNegLimit:'M00342',zNegLimit:'M00343',
        xHomeSensor:'M00344',yHomeSensor:'M00345',zHomeSensor:'M00346',
        xDogSensor:'M00347',yDogSensor:'M00348',zDogSensor:'M00349',
        // Rev.M2 Network 27: PLC-to-HMI status.  autoComplete is retained
        // solely as a compatibility alias and means pallet-full here.
        xServoReadyStatus:'M00400',yServoReadyStatus:'M00401',zServoReadyStatus:'M00402',
        vacuumBreakStatus:'M00403',vacuumOnStatus:'M00404',palletFullStatus:'M00405',
        alarmStatus:'M00406',buzzerStatus:'M00407',autoRunningStatus:'M00408',
        autoReadyStatus:'M00409',xPowerPermitStatus:'M00410',yPowerPermitStatus:'M00411',
        zPowerPermitStatus:'M00412',safetyOkStatus:'M00413',allHomeStatus:'M00414',carryingStatus:'M00415',
        autoRunning:'M00408',autoComplete:'M00405',fault:'M00406',alarmLatch:'M00103',gripperClosed:'M00404',holding:'M00415'
      },
      actual:{x:'D00400',y:'D00430',z:'D00460',placed:'D00556',step:'D00000',cycle:'D00556'}
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
  function mappedAddresses(profile){return new Set(flattenAddresses({commands:profile.commands,inputs:profile.inputs,setpoints:profile.setpoints,status:profile.status,actual:profile.actual}));}
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
      gripper:{closed:false,holding:false,workpieceId:null},releasedWorkpieceId:null,
      pallet:{placed:[],nextIndex:0},
      auto:{running:false,state:'IDLE',previous:'IDLE',timer:0,cycle:0,message:'대기',fault:null},
      manualOrg:{step:0,previous:0,message:'대기'},
      memory:emptyMemory(),physicalInputEdges:{},observedStatus:{active:false,values:{}},plcAuthoritative:false,
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
    return {index,row,col,layer,x:p.origin.x+col*p.spacingX,y:p.origin.y+row*p.spacingY,z:p.origin.z-layer*p.layerHeight};
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
  function productionInput(state,name){return !!memoryGet(state,getProfile(state).inputs[name]);}
  function stoppedProduction(state){return Object.values(state.axes).every(axis=>!axis.busy);}
  function productionPreflightOk(state){return allHomed(state)&&['eStopLoopOk','guardLoopOk','autoEnableKey','airPressureOk','xDrivePowerOk','yDrivePowerOk','zDrivePowerOk','safetyRelayEdmOk','extStopLoopOk'].every(name=>productionInput(state,name));}
  function productionResetCauseClear(state){
    if(!stoppedProduction(state)||!productionPreflightOk(state))return false;
    const fault=state.auto.fault?.code;
    if(['VACUUM_TIMEOUT','VACUUM_LOST'].includes(fault)&&!productionInput(state,'vacuumOk'))return false;
    if(fault==='RELEASE_TIMEOUT'&&productionInput(state,'vacuumOk')&&!productionInput(state,'releaseOk'))return false;
    if(fault==='PRODUCT_LOST'&&!productionInput(state,'workPresent'))return false;
    if(fault==='PALLET_MISSING'&&!productionInput(state,'palletPresent'))return false;
    return true;
  }
  function productionFault(state,code,message){
    state.auto.running=false;state.auto.fault={code,message};Object.keys(state.axes).forEach(name=>stopAxis(state,name));
    transition(state,'PROD_FAULT',message||code);refreshMemory(state);return false;
  }
  function startProductionAuto(state){
    // Product and pallet are asynchronous process signals and are deliberately
    // waited for at STEP100; all motion/safety permits must already be true.
    if(state.auto.state!=='IDLE'||!productionPreflightOk(state))return false;
    if(!productionInput(state,'workPresent')||!productionInput(state,'palletPresent')){
      state.auto.running=true;state.auto.fault=null;transition(state,'PROD_WAIT_PRODUCT','제품/팔레트 대기');refreshMemory(state);return true;
    }
    state.auto.running=true;state.auto.fault=null;transition(state,'PROD_SERVO','드라이브/서보 확인');refreshMemory(state);return true;
  }
  function productionStop(state,reason='PLC 정지 지령'){
    Object.keys(state.axes).forEach(name=>stopAxis(state,name));state.auto.running=false;transition(state,'PROD_STOP',reason);
    // In-memory axes acknowledge XSTP synchronously, so XSVOFF follows the stopped state here.
    setServo(state,null,false);refreshMemory(state);return true;
  }
  function resetProduction(state){
    if(!['PROD_STOP','PROD_FAULT','FAULT'].includes(state.auto.state)||!productionResetCauseClear(state))return false;
    resetAlarms(state);setServo(state,null,false);state.auto.running=false;state.auto.fault=null;state.auto.timer=0;transition(state,'IDLE','대기');refreshMemory(state);return true;
  }
  function requestNewPallet(state){
    if(getProfile(state).id!=='xgb-production'||state.auto.state!=='PROD_FULL'||!productionInput(state,'palletPresent'))return false;
    state.auto.running=true;transition(state,'PROD_NEW_PALLET','신규 팔레트 초기화');refreshMemory(state);return true;
  }
  function startAuto(state){
    if(faultIfAny(state))return false;
    // The reviewed production ladder permits AUTO only after manual ORG; it
    // must not quietly energize servos or initiate homing from an unknown pose.
    if(getProfile(state).id==='xgb-production')return startProductionAuto(state);
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
  function placeReleasedWorkpiece(state){
    if(!state.releasedWorkpieceId)return false;
    const slot=palletSlot(state,state.pallet.nextIndex);
    const item={id:state.releasedWorkpieceId,placedAt:Number(state.elapsed.toFixed(3)),...slot};
    state.pallet.placed.push(item);state.pallet.nextIndex++;state.auto.cycle++;
    state.releasedWorkpieceId=null;
    addEvent(state,'placed',`${item.id} → ${item.row+1}행 ${item.col+1}열 ${item.layer+1}단`);return true;
  }

  function tickAuto(state,dt){
    const auto=state.auto;if(!auto.running)return;
    if(getProfile(state).id==='xgb-production')return tickProductionAuto(state,dt);
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
  function productionMove(state,axis,target,next,message){
    if(!commandAxis(state,axis,target))return productionFault(state,'MOTION_COMMAND_REJECTED',`${axis}축 위치결정 명령 거부`);
    transition(state,next,message);return true;
  }
  function productionWatch(state,vacuum=false,pallet=false){
    if(!productionPreflightOk(state))return productionFault(state,'PREFLIGHT_LOST','안전/드라이브 사전조건 상실');
    if(pallet&&!productionInput(state,'palletPresent'))return productionFault(state,'PALLET_MISSING','팔레트 검출 상실');
    if(vacuum&&!productionInput(state,'vacuumOk'))return productionFault(state,'VACUUM_LOST','진공 검출 상실');
    return true;
  }
  function tickProductionAuto(state,dt){
    const auto=state.auto;auto.timer+=dt;
    if(!productionWatch(state))return;
    const pick=state.cell.pick,slot=palletSlot(state,state.pallet.nextIndex);
    switch(auto.state){
      case 'PROD_SERVO':
        if(!Object.values(state.axes).every(axis=>axis.servoOn))setServo(state,null,true);
        else if(auto.timer>=.02)transition(state,'PROD_PREFLIGHT','사전 점검');
        break;
      case 'PROD_PREFLIGHT': if(auto.timer>=.02)productionMove(state,'Z',state.cell.safeZ,'PROD_Z_WAIT','Z 대기 높이 이동');break;
      case 'PROD_Z_WAIT': if(axesReady(state,['Z']))productionMove(state,'X',pick.x,'PROD_X_WAIT','X 대기 위치 이동');break;
      case 'PROD_X_WAIT': if(axesReady(state,['X']))productionMove(state,'Y',pick.y,'PROD_Y_WAIT','Y 대기 위치 이동');break;
      case 'PROD_Y_WAIT': if(axesReady(state,['Y']))transition(state,'PROD_WAIT_PRODUCT','제품/팔레트 대기');break;
      case 'PROD_WAIT_PRODUCT': if(productionInput(state,'workPresent')&&productionInput(state,'palletPresent'))productionMove(state,'X',pick.x,'PROD_FEED_X','X 픽업 이동');break;
      case 'PROD_FEED_X': if(axesReady(state,['X']))productionMove(state,'Y',pick.y,'PROD_FEED_Y','Y 픽업 이동');break;
      case 'PROD_FEED_Y': if(axesReady(state,['Y']))transition(state,'PROD_FEED_WAIT','픽업 XY 완료');break;
      case 'PROD_FEED_WAIT':
        if(!productionInput(state,'workPresent'))return productionFault(state,'PRODUCT_LOST','제품 검출 상실');
        if(axesReady(state,['X','Y']))productionMove(state,'Z',pick.z,'PROD_PICK_Z','픽업 높이 하강');break;
      case 'PROD_PICK_Z': if(axesReady(state,['Z'])){state.gripper.closed=true;transition(state,'PROD_VACUUM','흡착 확인');}break;
      case 'PROD_VACUUM':
        if(productionInput(state,'vacuumOk')&&auto.timer>=.1){state.gripper.holding=true;state.gripper.workpieceId=`BOX-${state.pallet.nextIndex+1}`;productionMove(state,'Z',state.cell.safeZ,'PROD_LIFT','제품 안전높이 상승');}
        else if(auto.timer>=3)return productionFault(state,'VACUUM_TIMEOUT','진공 확인 시간초과');break;
      case 'PROD_LIFT': if(productionWatch(state,true,true)&&axesReady(state,['Z']))transition(state,'PROD_CALCULATE','팔레트 좌표 계산');break;
      case 'PROD_CALCULATE': if(productionWatch(state,true,true))productionMove(state,'X',slot.x,'PROD_PALLET_X','X 팔레트 이동');break;
      case 'PROD_PALLET_X': if(productionWatch(state,true,true)&&axesReady(state,['X']))productionMove(state,'Y',slot.y,'PROD_PALLET_Y','Y 팔레트 이동');break;
      case 'PROD_PALLET_Y': if(productionWatch(state,true,true)&&axesReady(state,['Y']))transition(state,'PROD_PALLET_WAIT','팔레트 XY 완료');break;
      case 'PROD_PALLET_WAIT':
        if(productionWatch(state,true,true)&&axesReady(state,['X','Y','Z'])){
          const approachZ=Math.min(state.cell.safeZ,slot.z+Math.max(10,state.cell.pallet.layerHeight*.5));
          productionMove(state,'Z',approachZ,'PROD_APPROACH','팔레트 접근높이 하강');
        }
        break;
      case 'PROD_APPROACH': if(productionWatch(state,true,true)&&axesReady(state,['Z']))productionMove(state,'Z',slot.z,'PROD_PLACE_Z','최종 적재 높이 하강');break;
      case 'PROD_PLACE_Z':
        if(productionWatch(state,true,true)&&axesReady(state,['Z'])){
          state.releasedWorkpieceId=state.gripper.workpieceId;
          setGripper(state,false);transition(state,'PROD_RELEASE','해제 확인');
        }
        break;
      case 'PROD_RELEASE':
        if((productionInput(state,'releaseOk')||!productionInput(state,'vacuumOk'))&&auto.timer>=state.cell.dwell.release){
          productionMove(state,'Z',state.cell.safeZ,'PROD_RETURN_Z','안전높이 복귀');
        }else if(auto.timer>=3)return productionFault(state,'RELEASE_TIMEOUT','해제 확인 시간초과');
        break;
      case 'PROD_RETURN_Z': if(axesReady(state,['Z']))transition(state,'PROD_COUNT_RETURN_X','카운트 및 X 복귀');break;
      case 'PROD_COUNT_RETURN_X':
        placeReleasedWorkpiece(state);
        productionMove(state,'X',pick.x,'PROD_RETURN_Y','X 대기 위치 복귀');
        break;
      case 'PROD_RETURN_Y': if(axesReady(state,['X']))productionMove(state,'Y',pick.y,'PROD_COMPLETE','Y 대기 위치 복귀');break;
      case 'PROD_COMPLETE':
        if(axesReady(state,['X','Y','Z'])){
          if(state.pallet.nextIndex>=palletCapacity(state))transition(state,'PROD_FULL',`팔레트 가득 참 · ${state.pallet.placed.length}개`);
          else transition(state,'PROD_WAIT_PRODUCT','다음 제품 대기');
        }
        break;
      case 'PROD_FULL': break;
      case 'PROD_NEW_PALLET':
        if(productionInput(state,'palletPresent')&&auto.timer>=.1){
          state.pallet.placed=[];state.pallet.nextIndex=0;state.auto.cycle=0;state.releasedWorkpieceId=null;
          transition(state,'PROD_WAIT_PRODUCT','신규 팔레트 제품 대기');
        }
        break;
      default: productionFault(state,'STEP_INVALID','알 수 없는 생산 자동 STEP');
    }
  }

  function observedStatusValue(state,rawAddress,fallback){
    const addressKey=address(rawAddress),observed=state.observedStatus;
    if(observed?.active&&Object.prototype.hasOwnProperty.call(observed.values||{},addressKey))return bool(observed.values[addressKey]);
    return !!fallback;
  }
  function setStatusMemory(state,rawAddress,value){memorySet(state,rawAddress,observedStatusValue(state,rawAddress,value));}
  function axisAtHome(axis){return Math.abs(axis.position-axis.home)<=axis.tolerance;}
  function refreshMemory(state){
    const p=getProfile(state),s=p.status,d=p.actual,a=state.axes,production=p.id==='xgb-production';
    const alarm=state.auto.state==='FAULT'||state.auto.state==='PROD_FAULT'||!!state.auto.fault||Object.values(a).some(x=>x.alarm);
    const full=production?state.auto.state==='PROD_FULL':state.auto.state==='COMPLETE';
    const driveReady=axis=>axis.servoOn&&!axis.alarm;
    const productionPermit=name=>production&&productionInput(state,name);
    const autoReady=production?!alarm&&!state.auto.running&&productionPreflightOk(state):!alarm&&!state.auto.running&&allHomed(state);
    setStatusMemory(state,s.autoRunning,!!state.auto.running);setStatusMemory(state,s.autoComplete,full);setStatusMemory(state,s.fault,alarm);setStatusMemory(state,s.alarmLatch,alarm);
    setStatusMemory(state,s.xBusy,a.X.busy);setStatusMemory(state,s.yBusy,a.Y.busy);setStatusMemory(state,s.zBusy,a.Z.busy);
    setStatusMemory(state,s.xHomed,a.X.homed);setStatusMemory(state,s.yHomed,a.Y.homed);setStatusMemory(state,s.zHomed,a.Z.homed);
    setStatusMemory(state,s.xDone,a.X.inPosition&&!a.X.busy&&!a.X.alarm);setStatusMemory(state,s.yDone,a.Y.inPosition&&!a.Y.busy&&!a.Y.alarm);setStatusMemory(state,s.zDone,a.Z.inPosition&&!a.Z.busy&&!a.Z.alarm);
    setStatusMemory(state,s.xInPosition,a.X.inPosition);setStatusMemory(state,s.yInPosition,a.Y.inPosition);setStatusMemory(state,s.zInPosition,a.Z.inPosition);
    setStatusMemory(state,s.xError,!!a.X.alarm);setStatusMemory(state,s.yError,!!a.Y.alarm);setStatusMemory(state,s.zError,!!a.Z.alarm);
    setStatusMemory(state,s.xDriveReady,driveReady(a.X));setStatusMemory(state,s.yDriveReady,driveReady(a.Y));setStatusMemory(state,s.zDriveReady,driveReady(a.Z));
    setStatusMemory(state,s.xServoOn,a.X.servoOn);setStatusMemory(state,s.yServoOn,a.Y.servoOn);setStatusMemory(state,s.zServoOn,a.Z.servoOn);
    setStatusMemory(state,s.xNegLimit,a.X.negLimit);setStatusMemory(state,s.xPosLimit,a.X.posLimit);setStatusMemory(state,s.yNegLimit,a.Y.negLimit);setStatusMemory(state,s.yPosLimit,a.Y.posLimit);setStatusMemory(state,s.zNegLimit,a.Z.negLimit);setStatusMemory(state,s.zPosLimit,a.Z.posLimit);
    setStatusMemory(state,s.xHomeSensor,axisAtHome(a.X));setStatusMemory(state,s.yHomeSensor,axisAtHome(a.Y));setStatusMemory(state,s.zHomeSensor,axisAtHome(a.Z));
    setStatusMemory(state,s.xDogSensor,axisAtHome(a.X));setStatusMemory(state,s.yDogSensor,axisAtHome(a.Y));setStatusMemory(state,s.zDogSensor,axisAtHome(a.Z));
    setStatusMemory(state,s.xServoReadyStatus,driveReady(a.X));setStatusMemory(state,s.yServoReadyStatus,driveReady(a.Y));setStatusMemory(state,s.zServoReadyStatus,driveReady(a.Z));
    setStatusMemory(state,s.vacuumBreakStatus,production&&state.auto.state==='PROD_RELEASE');setStatusMemory(state,s.vacuumOnStatus,state.gripper.closed);
    setStatusMemory(state,s.palletFullStatus,full);setStatusMemory(state,s.alarmStatus,alarm);setStatusMemory(state,s.alarmLatch,alarm);setStatusMemory(state,s.buzzerStatus,alarm);
    setStatusMemory(state,s.autoRunningStatus,!!state.auto.running);setStatusMemory(state,s.autoReadyStatus,autoReady);
    setStatusMemory(state,s.xPowerPermitStatus,productionPermit('xDrivePowerOk'));setStatusMemory(state,s.yPowerPermitStatus,productionPermit('yDrivePowerOk'));setStatusMemory(state,s.zPowerPermitStatus,productionPermit('zDrivePowerOk'));
    setStatusMemory(state,s.safetyOkStatus,production&&['eStopLoopOk','guardLoopOk','safetyRelayEdmOk','extStopLoopOk'].every(productionPermit));
    setStatusMemory(state,s.allHomeStatus,allHomed(state));setStatusMemory(state,s.carryingStatus,state.gripper.holding);
    setStatusMemory(state,s.gripperClosed,state.gripper.closed);setStatusMemory(state,s.holding,state.gripper.holding);
    memorySet(state,d.x,Number(a.X.position.toFixed(2)));memorySet(state,d.y,Number(a.Y.position.toFixed(2)));memorySet(state,d.z,Number(a.Z.position.toFixed(2)));
    memorySet(state,d.placed,state.pallet.placed.length);memorySet(state,d.step,AUTO_STEPS[state.auto.state]??-1);memorySet(state,d.cycle,state.auto.cycle);
  }
  function setObservedStatus(state,values={}){
    const profile=getProfile(state);if(profile.id!=='xgb-production')return false;
    const allowed=new Set(Object.values(profile.status).map(address));const next={};
    for(const [rawAddress,value] of Object.entries(values)){
      const key=address(rawAddress);if(allowed.has(key))next[key]=bool(value);
    }
    state.observedStatus={active:true,values:next};refreshMemory(state);return true;
  }
  function clearObservedStatus(state){
    if(!state.observedStatus?.active)return false;
    state.observedStatus={active:false,values:{}};refreshMemory(state);return true;
  }
  function setPlcAuthoritative(state,active){
    if(getProfile(state).id!=='xgb-production')return false;
    const next=!!active;if(state.plcAuthoritative===next)return true;
    state.plcAuthoritative=next;
    if(next){
      stopAll(state,'PLC-authoritative XG-SIM 관측');setServo(state,null,false);state.manualOrg.step=0;
    }
    refreshMemory(state);return true;
  }
  function initializeMemory(state){
    state.memory=emptyMemory();const p=getProfile(state);
    for(const mapped of Object.values(p.commands))memorySet(state,mapped,false);
    for(const mapped of Object.values(p.inputs||{}))memorySet(state,mapped,false);
    memorySet(state,p.setpoints.x,state.cell.pick.x);memorySet(state,p.setpoints.y,state.cell.pick.y);memorySet(state,p.setpoints.z,state.cell.safeZ);memorySet(state,p.setpoints.speed,140);
    refreshMemory(state);return state.memory;
  }
  function readDevice(state,rawAddress){
    const key=address(rawAddress),profile=getProfile(state);if(!mappedAddresses(profile).has(key))return undefined;refreshMemory(state);
    const value=memoryGet(state,key);return key.startsWith('D')?finite(value,0):!!value;
  }
  function writeDevice(state,rawAddress,value){
    const key=address(rawAddress),profile=getProfile(state),setpoint=roleAt(profile.setpoints,key);
    if(key.startsWith('P'))return {ok:false,error:`${key} is a physical input; use setPhysicalInput`};
    if(setpoint){
      const n=finite(value,NaN);if(!Number.isFinite(n))return {ok:false,error:'숫자 설정값이 필요합니다'};
      memorySet(state,key,n);refreshMemory(state);return {ok:true,address:key,value:n};
    }
    const command=roleAt(profile.commands,key);
    if(!command){
      if(mappedAddresses(profile).has(key))return {ok:false,error:`${key}는 읽기 전용 상태 주소입니다`};
      return {ok:false,error:`${key||'(빈 주소)'}는 선택한 ${profile.vendor} 프로필에 정의되지 않았습니다`};
    }
    if(state.plcAuthoritative&&profile.id==='xgb-production')return {ok:false,error:'XG-SIM PLC 관측 중에는 로컬 명령을 실행할 수 없습니다'};
    const on=bool(value);memorySet(state,key,on);let accepted=true;
    if(command==='autoStart'&&on)accepted=startAuto(state);
    else if(command==='stop'&&on){if(profile.id==='xgb-production')accepted=productionStop(state);else stopAll(state,'PLC 정지 지령');}
    else if(command==='newPallet'&&on)accepted=requestNewPallet(state);
    else if(command==='reset'&&on)accepted=profile.id==='xgb-production'?resetProduction(state):resetCell(state,{clearPallet:false});
    else if(command==='manualOrg'&&on)accepted=requestManualOrg(state);
    else if(command==='grip'&&on)setGripper(state,true);
    else if(command==='release'&&on)setGripper(state,false);
    else if(command==='servoOn')accepted=setServo(state,null,on);
    else if(command==='servoOff'&&on)accepted=setServo(state,null,false);
    else if(['moveX','moveY','moveZ'].includes(command)&&on){
      const axis={moveX:'X',moveY:'Y',moveZ:'Z'}[command],targetKey={X:'x',Y:'y',Z:'z'}[axis];
      accepted=commandAxis(state,axis,memoryGet(state,profile.setpoints[targetKey]),{speed:memoryGet(state,profile.setpoints.speed)});
    }else if(/^jog[XYZ](Plus|Minus)$/.test(command)){
      const axis=command[3],dir=command.endsWith('Plus')?1:-1;
      accepted=on?jogAxis(state,axis,dir,memoryGet(state,profile.setpoints.speed)):(state.axes[axis].mode==='jog'&&state.axes[axis].jogDirection===dir?stopAxis(state,axis):true);
    }
    refreshMemory(state);return {ok:true,address:key,value:on,...(accepted===false?{accepted:false}:{})};
  }

  function setPhysicalInput(state,rawAddress,value){
    const key=address(rawAddress),profile=getProfile(state);
    if(!Object.values(profile.inputs||{}).map(address).includes(key))return false;
    const next=bool(value),previous=!!memoryGet(state,key);
    memorySet(state,key,next);
    if(next&&!previous)state.physicalInputEdges[key]=true;
    refreshMemory(state);return true;
  }
  function processPhysicalInputEdges(state){
    if(getProfile(state).id!=='xgb-production')return;
    const p=getProfile(state).inputs,edges=state.physicalInputEdges||{};
    if(edges[p.startPb])startAuto(state);
    if(edges[p.stopPb])productionStop(state,'물리 STOP PB');
    if(edges[p.resetPb])resetProduction(state);
    state.physicalInputEdges={};
  }
  function requestManualOrg(state){
    if(state.auto.running||state.auto.state!=='IDLE'||state.manualOrg.step!==0)return false;
    if(!Object.values(state.axes).every(axis=>!axis.busy&&!axis.alarm&&axis.servoOn))return false;
    state.manualOrg.step=10;state.manualOrg.previous=0;state.manualOrg.message='Z축 원점복귀';
    return homeAxis(state,'Z');
  }
  function tickManualOrg(state){
    const org=state.manualOrg;if(!org||org.step===0)return;
    if(state.auto.running||state.auto.state!=='IDLE'){org.step=0;org.message='자동운전 중단';return;}
    if(org.step===10&&state.axes.Z.homed&&!state.axes.Z.busy){org.previous=10;org.step=20;org.message='X축 원점복귀';homeAxis(state,'X');}
    else if(org.step===20&&state.axes.X.homed&&!state.axes.X.busy){org.previous=20;org.step=30;org.message='Y축 원점복귀';homeAxis(state,'Y');}
    else if(org.step===30&&state.axes.Y.homed&&!state.axes.Y.busy){org.previous=30;org.step=0;org.message='원점복귀 완료';}
  }

  function setProfile(state,profileName){
    const profileId=resolveProfile(profileName);if(!profileId)return false;if(profileId===state.profileId)return true;
    stopAll(state,'PLC 제조사 프로필 전환');setServo(state,null,false);setGripper(state,false);
    state.profileId=profileId;state.profile=profileId;state.plcAuthoritative=false;state.observedStatus={active:false,values:{}};initializeMemory(state);
    addEvent(state,'profile',`${getProfile(state).vendor} 주소 프로필 선택 · 이전 출력 안전 해제`);return true;
  }

  function tick(state,dt){
    dt=clamp(finite(dt,0),0,.1);if(dt<=0){refreshMemory(state);return state;}
    state.elapsed+=dt;
    if(state.plcAuthoritative&&getProfile(state).id==='xgb-production'){refreshMemory(state);return state;}
    tickAuto(state,dt);
    for(const axis of Object.values(state.axes))tickAxis(state,axis,dt);
    tickManualOrg(state);
    processPhysicalInputEdges(state);
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
    startAuto,resetCell,setGripper,configurePallet,palletCapacity,palletSlot,allHomed,getProfile,setProfile,readDevice,writeDevice,setPhysicalInput,requestManualOrg,refreshMemory,setObservedStatus,clearObservedStatus,setPlcAuthoritative,
    exportState,importState
  };
});
