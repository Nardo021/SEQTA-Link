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
        const items=await fetchTimetableWeek(range);
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
      }catch(_){coverage.push({...range,complete:false});weeksFailed++;}
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
  async function runSync(onProgress,options={}){
    const config=options.config||loadConfig(),auto=!!options.auto;
    return withSyncLock(auto,async()=>{
      assertConfig(config);
      const status=await fetchDeviceStatus(config);
      if(auto&&!status.sync?.sourceBound){await reportAutoCheck(config,'skipped','unbound');return {skipped:true,reason:'Complete one manual sync first.'};}
      onProgress('Building timetable snapshot…');
      const {payload,stats}=await buildSyncPayload(onProgress,config);
      if(options.expectedStudentRef&&payload.studentRef!==options.expectedStudentRef)throw new Error('SEQTA student changed after confirmation.');
      if(auto&&(stats.weeksFailed||!stats.weeksOk||!stats.lessonCount)){
        await reportAutoCheck(config,'skipped',stats.weeksFailed?'partial':'empty');
        return {skipped:true,reason:'Incomplete or empty source snapshot; existing timetable retained.'};
      }
      let allowEmptySnapshot=false;
      if(needsEmptySnapshotConfirmation(payload)){
        if(auto||!window.confirm('No lessons in the confirmed source ranges. Remove existing lessons in those verified ranges?'))return {skipped:true,reason:'Empty snapshot not confirmed.'};
        allowEmptySnapshot=true;
      }
      if(!payload.lessons.length&&!payload.coverage.some(r=>r.complete))return {skipped:true,reason:'No authoritative lessons or holiday coverage; nothing uploaded.'};
      const digest=await snapshotDigest(payload),key=autoKey(config)+'.snapshot',previous=getSetting(key);
      if(auto&&previous?.digest===digest&&previous?.revision===status.feed.revision){
        await reportAutoCheck(config,'unchanged','ok');return {skipped:true,reason:'Timetable unchanged.'};
      }
      assertConfig(config);
      const idempotencyKey=crypto.randomUUID();
      onProgress('Uploading '+stats.lessonCount+' lessons…');
      const result=await postSyncPayload(JSON.stringify(payload),idempotencyKey,allowEmptySnapshot,config);
      if(stats.weeksFailed===0&&stats.weeksOk>0)setSetting(key,{digest,revision:result.revision});
      if(auto)await reportAutoCheck(config,'uploaded','ok');
      return {result,stats,idempotencyKey,emptySnapshotConfirmed:allowEmptySnapshot};
    });
  }
  function startAutoSync(onStatus){
    let running=false;
    const tick=async()=>{
      if(running||syncBusy||document.visibilityState!=='visible'||!navigator.locks?.request)return;
      const config=loadConfig();
      if(!autoEnabled(config)||!config.deviceToken.startsWith('sl_dvc_')||config.studentRefOverride||isParentContext())return;
      try{if(new URL(config.backendUrl).protocol!=='https:')return;}catch(_){return;}
      const key=autoKey(config)+'.attempt',previous=Number(getSetting(key)||0);
      if(Date.now()-previous<15*60000)return;
      running=true;setSetting(key,Date.now());
      try{
        const outcome=await runSync(()=>{}, {auto:true,config});
        onStatus(outcome.skipped?'Auto sync: '+outcome.reason:'Auto sync: '+outcome.stats.lessonCount+' lessons checked.','success');
      }catch(error){
        const reason=error?.code==='SOURCE_IDENTITY_MISMATCH'||/identity|student|profile changed/i.test(String(error?.message))?'identity':/already running/i.test(String(error?.message))?'busy':error?.status?'backend':'network';
        await reportAutoCheck(config,'failed',reason);
        onStatus('Auto sync paused until next check ('+reason+').','error');
        setSetting(key,Date.now()+15*60000);
      }finally{running=false;}
    };
    window.setTimeout(tick,8000);
    window.setInterval(tick,60000);
    document.addEventListener('visibilitychange',tick);
  }
