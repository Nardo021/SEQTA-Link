  /** @typedef {{ from: string; until: string; complete: boolean }} CoverageWeek */
  function assertConfig(config) {
    const current=loadConfig();
    if(current.backendUrl!==config.backendUrl||current.profileId!==config.profileId||current.deviceToken!==config.deviceToken||current.studentRefOverride!==config.studentRefOverride||current.weeksAhead!==config.weeksAhead)throw new Error('Profile changed during sync; retry.');
  }
  function sourceMarkers(items,range) {
    const days=new Map();
    for(const item of items){
      if(!item||typeof item.date!=='string'||item.date<range.from||item.date>range.until||!/^\d{4}-\d{2}-\d{2}$/.test(item.date))continue;
      const type=String(item.type||'').toLowerCase(),title=String(item.description||'').trim();
      if(!['note','holiday','assembly-note'].includes(type))continue;
      const week=title.match(/^week\s*([AB])$/i),term=title.match(/^term\s+([1-4])$/i);
      if(!week&&!term&&type!=='holiday')continue;
      const entry=days.get(item.date)||{date:item.date};
      if(week){const label=week[1].toUpperCase();if(entry.week&&entry.week!==label)throw new Error('Conflicting source week labels.');entry.week=label;}
      if(term)entry.term='Term '+term[1];
      if(type==='holiday')entry.holiday=(title||'School holiday').slice(0,80);
      days.set(item.date,entry);
    }
    return [...days.values()];
  }
  async function freshStudentRef(config){
    assertConfig(config);cachedLogin=null;
    const student=await resolveStudentRef();assertConfig(config);return student;
  }
  async function buildSyncPayload(onProgress,config=loadConfig()) {
    const studentRef=await freshStudentRef(config);
    const weekRanges=buildWeekRanges(config.weeksAhead),coverage=[],allLessons=[],schoolDays=[];
    let weeksOk=0,weeksFailed=0,emptyWeeks=0;
    for(let i=0;i<weekRanges.length;i++){
      assertConfig(config);
      const range=weekRanges[i];onProgress('Fetching week '+(i+1)+'/'+weekRanges.length+'…');
      try{
        const items=await withTransientRetry(()=>fetchTimetableWeek(range),{attempts:2});
        if(!Array.isArray(items))throw new Error('Missing timetable array.');
        if(items.some(x=>!x||typeof x!=='object'||Array.isArray(x)))throw new Error('Malformed timetable item.');
        const lessons=dedupeLessons(items);
        if(lessons.some(l=>l.date<range.from||l.date>range.until))throw new Error('Timetable response is outside requested week.');
        const markers=sourceMarkers(items,range);
        const weekdays=Array.from({length:5},(_,j)=>{const d=parseLocalDate(range.from);d.setDate(d.getDate()+j);return toISODate(d);});
        const holidayWeek=weekdays.every(day=>markers.some(m=>m.date===day&&m.holiday));
        const invalidItems=items.some(x=>!SKIP_LESSON_TYPES.has(String(x.type||'').toLowerCase())&&(!shouldIncludeLesson(x)||!mapLessonToPayload(x)));
        const complete=!invalidItems&&(lessons.length>0||holidayWeek);
        allLessons.push(...lessons);
        coverage.push({...range,complete});
        if(complete){schoolDays.push(...markers);weeksOk++;}else if(invalidItems){weeksFailed++;}else{emptyWeeks++;}
      }catch(error){if(failureKind(error)==="session")throw error;coverage.push({...range,complete:false});weeksFailed++;}
    }
    if(!allLessons.length&&weeksFailed>0){
      onProgress('SEQTA API unavailable — reading visible page without deletion authority…');
      const visible=weekRangeContaining(new Date()),dom=dedupeLessons(extractLessonsFromDom());
      if(dom.length&&dom.every(l=>l.date>=visible.from&&l.date<=visible.until)){
        allLessons.push(...dom);
        if(!coverage.some(r=>r.from<=visible.from&&r.until>=visible.until))coverage.push({...visible,complete:false});
      }
    }
    const seen=new Set(),lessons=allLessons.filter(l=>!seen.has(l.sourceKey)&&seen.add(l.sourceKey));
    if(lessons.length>DEFAULTS.maxLessons)throw new Error('Snapshot exceeds lesson limit. Reduce weeks to sync.');
    if(await freshStudentRef(config)!==studentRef)throw new Error('SEQTA identity changed during sync; retry.');
    return {payload:{schemaVersion:1,schoolHost:location.hostname,studentRef,timezone:DEFAULTS.timezone,generatedAt:formatGeneratedAt(),coverage,lessons,schoolDays},stats:{weeksOk,weeksFailed,emptyWeeks,lessonCount:lessons.length}};
  }
  function snapshotJson(payload){
    const {generatedAt,...stable}=payload;
    return JSON.stringify({...stable,coverage:[...stable.coverage].sort((a,b)=>a.from.localeCompare(b.from)),lessons:[...stable.lessons].sort((a,b)=>a.sourceKey.localeCompare(b.sourceKey)),schoolDays:[...(stable.schoolDays||[])].sort((a,b)=>a.date.localeCompare(b.date))});
  }
  async function snapshotDigest(payload){
    const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(snapshotJson(payload))));
    return Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('');
  }
  function autoKey(config){return STORAGE.autoPrefix+JSON.stringify([config.profileId,location.hostname,config.backendUrl]);}
  function autoEnabled(config){return !!config.profileId&&getSetting(autoKey(config)+'.enabled')===true}
  function setAutoEnabled(config,value){if(config.profileId)setSetting(autoKey(config)+'.enabled',!!value)}
  let syncBusy=false;
  async function withSyncLock(auto,callback){
    if(syncBusy)throw new Error('Sync already running.');
    if(auto&&!navigator.locks?.request)throw new Error('Browser does not support safe multi-tab auto sync.');
    syncBusy=true;
    try{
      if(navigator.locks?.request)return await navigator.locks.request('seqta-link-timetable-sync',{ifAvailable:true},lock=>{if(!lock)throw new Error('Sync already running in another tab.');return callback();});
      return await callback();
    }finally{syncBusy=false;}
  }
  const AUTO_INTERVAL_MS=15*60000;
  function failureKind(error){
    const code=String(error?.code||""),status=Number(error?.status||0),message=String(error?.message||"");
    if(code==="SOURCE_IDENTITY_MISMATCH"||/identity|student changed|profile changed/i.test(message))return "identity";
    if(code==="INVALID_TOKEN")return "token";
    if(code==="SYNC_ALREADY_RUNNING"||/already running/i.test(message))return "busy";
    if(status===429||code==="RATE_LIMITED")return "rate";
    if(/SEQTA request failed \((401|403)\)|Could not determine student|Could not verify the current SEQTA student/i.test(message))return "session";
    if(status===401)return "token";
    if(status===500||status===502||status===503||status===504||/SEQTA request failed \(5\d\d\)/.test(message))return "backend";
    if(status>=400)return "request";
    if(/network|timed out|failed to fetch/i.test(message))return "network";
    return "request";
  }
  function retryAfterMs(headers){const match=/retry-after:\s*(\d+)/i.exec(String(headers||""));return match?Number(match[1])*1000:null;}
  function retryWaitMs(kind,attempt,retryAfter){if(kind==="busy")return 2000;if(kind==="rate"&&retryAfter!=null)return retryAfter;return Math.min(15000,1000*4**(attempt-1));}
  async function withTransientRetry(operation,options={}){
    const attempts=options.attempts||3,sleep=options.sleep||(ms=>new Promise(resolve=>setTimeout(resolve,ms)));
    let last;
    for(let attempt=1;attempt<=attempts;attempt++){
      try{return await operation(attempt);}
      catch(error){
        last=error;const kind=failureKind(error);error.kind=kind;
        const after=retryAfterMs(error.headers||error.responseHeaders);
        if(kind==="rate"&&after!=null&&after>60000){error.holdMs=after;throw error;}
        const again=(kind==="network"||kind==="backend"||kind==="rate"||(kind==="busy"&&attempt<2))&&attempt<attempts;
        if(!again)throw error;
        await sleep(retryWaitMs(kind,attempt,after));
      }
    }
    throw last;
  }
  function syncState(outcome){
    if(!outcome?.skipped)return "uploaded";
    if(outcome.reason==="Timetable unchanged.")return "unchanged";
    if(/Incomplete|Empty snapshot|No authoritative|nothing uploaded/i.test(String(outcome.reason||"")))return "incomplete";
    return "skipped";
  }
  function reportReason(kind){return ["identity","token","session","rate","backend","network","busy"].includes(kind)?kind:"backend";}
  function readFresh(config){const value=getSetting(autoKey(config)+".fresh");return value&&typeof value==="object"?value:{};}
  function rememberFresh(config,state){
    const now=Date.now(),prev=readFresh(config),next={...prev,attemptedAt:now,state};
    if(state==="unchanged"||state==="uploaded")next.succeededAt=now;
    if(state==="uploaded")next.uploadedAt=now;
    setSetting(autoKey(config)+".fresh",next);
    return next;
  }
  function freshnessLine(record,now=Date.now()){
    const ago=t=>{if(!t)return "unavailable";const min=Math.max(0,Math.round((now-t)/60000));if(min<1)return "just now";if(min<60)return min+" min ago";return Math.round(min/60)+" h ago";};
    if(!record?.attemptedAt)return {text:"Not checked yet.",kind:"info"};
    if(record.state==="unchanged")return {text:"Up to date · checked "+ago(record.succeededAt||record.attemptedAt),kind:"success"};
    if(record.state==="uploaded")return {text:"Uploaded · "+ago(record.uploadedAt),kind:"success"};
    if(record.state==="incomplete")return {text:"Incomplete source data · existing lessons kept",kind:"info"};
    if(record.state==="session")return {text:"SEQTA session expired · sign in again",kind:"error"};
    if(record.state==="token")return {text:"Device token invalid · pair again",kind:"error"};
    if(record.state==="identity")return {text:"Student does not match this profile",kind:"error"};
    if(record.state==="skipped")return {text:"Complete one manual sync first.",kind:"info"};
    return {text:"Temporarily stale · last good check "+ago(record.succeededAt),kind:"error"};
  }
  function normalizeAutoState(state,now){
    let attempt=Number(state.attempt||0),hold=Number(state.hold||0);
    if(attempt>now+1000){hold=Math.max(hold,attempt);attempt=Math.max(0,attempt-AUTO_INTERVAL_MS);}
    return {attempt,hold,reason:String(state.reason||""),recovered:!!state.recovered};
  }
  function checkDue(state,now,trigger){
    const hold=Math.max(Number(state.attempt||0)+AUTO_INTERVAL_MS,Number(state.hold||0));
    if(now>=hold)return true;
    return trigger==="online"&&(state.reason==="network"||state.reason==="backend")&&!state.recovered&&now-Number(state.attempt||0)>=120000;
  }
  function loadAutoState(config,now){
    const base=autoKey(config),normalized=normalizeAutoState({attempt:getSetting(base+".attempt"),hold:getSetting(base+".hold"),reason:getSetting(base+".reason"),recovered:getSetting(base+".recovered")===true},now);
    if(normalized.attempt!==Number(getSetting(base+".attempt")||0)){setSetting(base+".attempt",normalized.attempt);setSetting(base+".hold",normalized.hold);}
    return normalized;
  }
  async function runSync(onProgress,options={}){
    const config=options.config||loadConfig(),auto=!!options.auto;
    if(!auto)setSetting(autoKey(config)+".blocked","");
    const finish=outcome=>{rememberFresh(config,syncState(outcome));return outcome;};
    try{return await withSyncLock(auto,async()=>{
      assertConfig(config);
      const status=await withTransientRetry(()=>fetchDeviceStatus(config),{attempts:2});
      if(auto&&!status.sync?.sourceBound){await reportAutoCheck(config,'skipped','unbound');return finish({skipped:true,reason:'Complete one manual sync first.'});}
      onProgress('Building timetable snapshot…');
      const {payload,stats}=await buildSyncPayload(onProgress,config);
      if(options.expectedStudentRef&&payload.studentRef!==options.expectedStudentRef)throw new Error('SEQTA student changed after confirmation.');
      if(auto&&(stats.weeksFailed||!stats.weeksOk||!stats.lessonCount)){
        await reportAutoCheck(config,'skipped',stats.weeksFailed?'partial':'empty');
        return finish({skipped:true,reason:'Incomplete or empty source snapshot; existing timetable retained.'});
      }
      let allowEmptySnapshot=false;
      if(needsEmptySnapshotConfirmation(payload)){
        if(auto||!window.confirm('No lessons in the confirmed source ranges. Remove existing lessons in those verified ranges?'))return finish({skipped:true,reason:'Empty snapshot not confirmed.'});
        allowEmptySnapshot=true;
      }
      if(!payload.lessons.length&&!payload.coverage.some(r=>r.complete))return finish({skipped:true,reason:'No authoritative lessons or holiday coverage; nothing uploaded.'});
      const digest=await snapshotDigest(payload),key=autoKey(config)+'.snapshot',previous=getSetting(key);
      if(auto&&previous?.digest===digest&&previous?.revision===status.feed.revision){
        await reportAutoCheck(config,'unchanged','ok');return finish({skipped:true,reason:'Timetable unchanged.'});
      }
      assertConfig(config);
      const idempotencyKey=crypto.randomUUID();
      onProgress('Uploading '+stats.lessonCount+' lessons…');
      const result=await postSyncPayload(JSON.stringify(payload),idempotencyKey,allowEmptySnapshot,config);
      if(stats.weeksFailed===0&&stats.weeksOk>0)setSetting(key,{digest,revision:result.revision});
      if(auto)await reportAutoCheck(config,'uploaded','ok');
      return finish({result,stats,idempotencyKey,emptySnapshotConfirmed:allowEmptySnapshot});
    });}catch(error){
      const kind=failureKind(error);
      if(kind==="identity"||kind==="token"||kind==="session")setSetting(autoKey(config)+".blocked",kind);
      rememberFresh(config,kind==="identity"||kind==="token"||kind==="session"?kind:"stale");
      await reportAutoCheck(config,"failed",reportReason(kind));
      throw error;
    }
  }
  function autoReady(config){
    if(typeof document==="undefined"||document.visibilityState!=="visible"||!navigator.locks?.request)return false;
    if(!autoEnabled(config)||!config.deviceToken.startsWith("sl_dvc_")||config.studentRefOverride||isParentContext())return false;
    if(getSetting(autoKey(config)+".blocked"))return false;
    try{return new URL(config.backendUrl).protocol==="https:";}catch(_){return false;}
  }
  function startAutoSync(onStatus){
    let running=false,timer=0,pending="load";
    const tick=async trigger=>{
      if(running||syncBusy){pending=trigger;return;}
      const config=loadConfig();
      if(!autoReady(config))return;
      const now=Date.now(),state=loadAutoState(config,now);
      if(!checkDue(state,now,trigger))return;
      running=true;const base=autoKey(config);setSetting(base+".attempt",now);
      const early=now<Math.max(state.attempt+AUTO_INTERVAL_MS,state.hold);
      try{
        const outcome=await runSync(()=>{},{auto:true,config});
        setSetting(base+".hold",now+AUTO_INTERVAL_MS);setSetting(base+".reason","");setSetting(base+".recovered",false);
        const line=freshnessLine(readFresh(config));onStatus(line.text,line.kind);
        return outcome;
      }catch(error){
        const kind=failureKind(error);
        const wait=kind==="rate"&&Number(error.holdMs)>0?Math.min(Number(error.holdMs),60*60000):AUTO_INTERVAL_MS;
        setSetting(base+".hold",now+wait);setSetting(base+".reason",kind==="network"||kind==="backend"?kind:"");setSetting(base+".recovered",!!(early&&trigger==="online"));
        const line=freshnessLine(readFresh(config));
        onStatus(line.text,"error");
      }finally{
        running=false;
        if(pending!==trigger)schedule(pending);
      }
    };
    const schedule=trigger=>{
      pending=trigger;
      if(timer)return;
      timer=window.setTimeout(()=>{timer=0;const chosen=pending;void tick(chosen);},trigger==="load"?8000:400);
    };
    schedule("load");
    window.setInterval(()=>schedule("interval"),60000);
    document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")schedule("visible");});
    window.addEventListener("online",()=>schedule("online"));
  }
