import { ApiError, localToUtc, nowIso, pyJson, sha256 } from "./common";
import { hashToken, stableUid } from "./compat";
import type { StoredEvent } from "./ics";
type Device={id:string;owner_user_id:string;calendar_id:string;name:string;feed_name:string;timezone:string;revision:number;last_synced_at:string|null;updated_at:string};
type Range={from:string;until:string;complete:boolean};
type Lesson={source_key:string;natural_key:string;local_date:string;period_key:string;course_code:string|null;title:string;starts_at_utc:string;ends_at_utc:string;teacher:string|null;room:string|null;description:string|null;event_type:string;content_hash:string};
type Counts={received:number;normalized:number;duplicatesRemoved:number;inserted:number;updated:number;removed:number;restored:number;unchanged:number};
type Run={id:string;payload_hash:string;snapshot_hash:string;status:string;received_count:number;normalized_count:number;duplicate_count:number;inserted_count:number;updated_count:number;removed_count:number;restored_count:number;unchanged_count:number};
const fail=(code:string,message:string,status=400):never=>{throw new ApiError(code,message,status);};
const obj=(v:unknown):Record<string,unknown>=>{if(!v||typeof v!=="object"||Array.isArray(v))return fail("INVALID_REQUEST","Expected object.");return v as Record<string,unknown>;};
const text=(v:unknown,max:number):string=>{if(typeof v!=="string"||v.length>max||!v.trim())return fail("INVALID_LESSON","Invalid string.");return v;};
const optional=(v:unknown,max:number):string|null=>{if(v===null||v===undefined||v==="")return null;if(typeof v!=="string"||v.length>max)return fail("INVALID_LESSON","Invalid string.");return v.trim().replace(/\s+/g," ")||null;};
const date=(v:unknown):string=>{if(typeof v!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(v).toISOString().slice(0,10)!==v)return fail("INVALID_DATE_RANGE","Invalid date.");return v;};
const days=(a:string,b:string)=>(Date.parse(b)-Date.parse(a))/86400000+1;
const inside=(d:string,r:Range)=>r.from<=d&&d<=r.until;
const authSql="SELECT d.id,d.owner_user_id,d.calendar_id,d.name,c.name AS feed_name,c.timezone,c.revision,c.last_synced_at,c.updated_at FROM devices d JOIN calendars c ON c.id=d.calendar_id AND c.owner_user_id=d.owner_user_id JOIN users u ON u.id=d.owner_user_id WHERE d.token_hash=? AND d.status='active' AND u.account_status='active' AND u.sync_enabled=1";
export async function getDevice(db:D1Database,pepper:Uint8Array,request:Request):Promise<{device:Device;hash:string}>{
  const raw=request.headers.get("Authorization")?.match(/^Bearer (sl_dvc_[A-Za-z0-9_-]+)$/)?.[1];
  if(!raw||raw.length>100)return fail("INVALID_TOKEN","Missing or invalid bearer token.",401);
  const hash=await hashToken(pepper,"device",raw);
  const device=await db.prepare(authSql).bind(hash).first<Device>();
  if(!device)return fail("INVALID_TOKEN","Invalid or revoked device token.",401);
  return {device,hash};
}
export async function deviceStatus(db:D1Database,pepper:Uint8Array,request:Request){
  const {device:d}=await getDevice(db,pepper,request);
  const [count,run]=await db.batch([db.prepare("SELECT count(*) AS n FROM events WHERE calendar_id=? AND active=1 AND status='confirmed'").bind(d.calendar_id),db.prepare("SELECT status FROM sync_runs WHERE calendar_id=? ORDER BY started_at DESC LIMIT 1").bind(d.calendar_id)]);
  return {feed:{name:d.feed_name,timezone:d.timezone,revision:d.revision},sync:{enabled:true,lastSyncedAt:d.last_synced_at,lastStatus:(run.results[0] as {status:string}|undefined)?.status||"unknown"},events:{active:(count.results[0] as {n:number}|undefined)?.n||0},device:{name:d.name,lastSeenAt:nowIso()}};
}
async function normalize(body:Record<string,unknown>,d:Device){
  if(body.schemaVersion!==1||body.timezone!==d.timezone||d.timezone!=="Australia/Sydney")return fail("INVALID_TIMEZONE","Unsupported schema or timezone.");
  const school=text(body.schoolHost,255),student=text(body.studentRef,64);
  if(!Array.isArray(body.coverage)||!body.coverage.length||body.coverage.length>120||!Array.isArray(body.lessons)||body.lessons.length>2000)return fail("INVALID_REQUEST","Invalid coverage or lessons.");
  const ranges:Range[]=body.coverage.map(v=>{const r=obj(v),from=date(r.from),until=date(r.until);if(typeof r.complete!=="boolean"||days(from,until)<1||days(from,until)>120)return fail("INVALID_DATE_RANGE","Invalid coverage range.");return {from,until,complete:r.complete};});
  if(!body.lessons.length&&ranges.filter(r=>r.complete).reduce((n,r)=>n+days(r.from,r.until),0)>7&&body.allowEmptySnapshot!==true)return fail("SUSPICIOUS_EMPTY_SNAPSHOT","An empty snapshot covering more than seven days requires explicit confirmation.",422);
  const bySource=new Map<string,Lesson>(),byNatural=new Map<string,Lesson>();let duplicates=0;
  for(const value of body.lessons){
    const l=obj(value),source=text(l.sourceKey,300).trim(),local_date=date(l.date);
    if(!ranges.some(r=>inside(local_date,r)))return fail("INVALID_DATE_RANGE","Lesson is outside coverage.");
    const title=optional(l.title,200);if(!title)return fail("INVALID_LESSON","Lesson title is required.");
    const period_key=text(l.periodKey,64).trim().toLowerCase().replace(/ /g,"-"),period_label=optional(l.periodLabel,200)||text(l.periodLabel,200).trim();
    const course_code=optional(l.courseCode,32)?.toUpperCase()||null,teacher=optional(l.teacher,200),room=optional(l.room,100),description=optional(l.description,8192),event_type=l.type===undefined?"class":text(l.type,32);
    const starts_at_utc=localToUtc(local_date,text(l.start,8)),ends_at_utc=localToUtc(local_date,text(l.end,8));
    const duration=Date.parse(ends_at_utc)-Date.parse(starts_at_utc);if(duration<=0||duration>28800000)return fail("INVALID_TIME_RANGE","Invalid lesson duration.");
    const natural_key=await sha256("v1:"+d.calendar_id+":"+local_date+":"+period_key+":"+(course_code||title.toLowerCase()));
    const content_hash=await sha256(pyJson({courseCode:course_code,date:local_date,description,endUtc:ends_at_utc,periodLabel:period_label,room,startUtc:starts_at_utc,status:"confirmed",teacher,title,type:event_type},true));
    const lesson={source_key:source,natural_key,local_date,period_key,course_code,title,starts_at_utc,ends_at_utc,teacher,room,description,event_type,content_hash};
    if(bySource.has(source)){duplicates++;continue;}bySource.set(source,lesson);
    const previous=byNatural.get(natural_key);if(previous){if(previous.content_hash!==content_hash)return fail("DUPLICATE_LESSON_CONFLICT","Conflicting lessons in the same slot.",409);duplicates++;continue;}byNatural.set(natural_key,lesson);
  }
  const lessons=[...byNatural.values()];
  const payloadHash=await sha256(pyJson(body));
  const snapshotHash=await sha256(pyJson({coverage:ranges,lessons:lessons.map(l=>({sourceKey:l.source_key,naturalKey:l.natural_key,contentHash:l.content_hash}))}));
  return {school,student,ranges,lessons,payloadHash,snapshotHash,duplicates,received:body.lessons.length};
}
// JSON rows are bound as data; columns and SQL fragments below are fixed application constants.
function chunks<T>(rows:T[]):string[]{const result:string[]=[];let batch:T[]=[],size=0;for(const row of rows){const n=JSON.stringify(row).length;if(batch.length&&(size+n>48000||batch.length>=80)){result.push(JSON.stringify(batch));batch=[];size=0;}batch.push(row);size+=n;}if(batch.length)result.push(JSON.stringify(batch));return result;}
const cols=["id","owner_user_id","calendar_id","natural_key","ical_uid","local_date","period_key","course_code","title","starts_at_utc","ends_at_utc","timezone","teacher","room","description","event_type","content_hash","sequence","status","active","created_at","updated_at","deleted_at"];
const mutable=cols.filter(c=>!["id","owner_user_id","calendar_id","natural_key","ical_uid","created_at"].includes(c));
export async function syncCalendar(db:D1Database,pepper:Uint8Array,uidSecret:Uint8Array,request:Request,bodyValue:unknown){
  const {device:d,hash}=await getDevice(db,pepper,request);
  const idem=request.headers.get("Idempotency-Key")||"";if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idem))return fail("INVALID_REQUEST","Idempotency-Key must be a valid UUID.");
  const n=await normalize(obj(bodyValue),d),cid=d.calendar_id;
  const [state,identity,events,aliases,oldRun]=await db.batch([
    db.prepare("SELECT c.revision,c.updated_at,COALESCE(v.generation,0) AS generation FROM calendars c LEFT JOIN worker_sync_versions v ON v.calendar_id=c.id WHERE c.id=?").bind(cid),
    db.prepare("SELECT school_host,student_ref FROM source_identities WHERE calendar_id=?").bind(cid),
    db.prepare("SELECT * FROM events WHERE calendar_id=?").bind(cid),
    db.prepare("SELECT source_key,event_id FROM event_aliases WHERE calendar_id=?").bind(cid),
    db.prepare("SELECT * FROM sync_runs WHERE device_id=? AND idempotency_key=?").bind(d.id,idem)
  ]);
  const st=state.results[0] as {revision:number;updated_at:string;generation:number}|undefined;if(!st)return fail("INVALID_TOKEN","Calendar unavailable.",401);
  const ident=identity.results[0] as {school_host:string;student_ref:string}|undefined;if(ident&&(ident.school_host!==n.school||ident.student_ref!==n.student))return fail("SOURCE_IDENTITY_MISMATCH","Device is paired with a different SEQTA student.",409);
  const replay=oldRun.results[0] as Run|undefined;
  if(replay){if(replay.payload_hash!==n.payloadHash||replay.snapshot_hash!==n.snapshotHash)return fail("IDEMPOTENCY_KEY_REUSED","Key used with different payload.",409);if(replay.status!=="success")return fail("SYNC_ALREADY_RUNNING","Previous sync is not successful.",409);
    const result={received:replay.received_count,normalized:replay.normalized_count,duplicatesRemoved:replay.duplicate_count,inserted:replay.inserted_count,updated:replay.updated_count,removed:replay.removed_count,restored:replay.restored_count,unchanged:replay.unchanged_count};
    return {syncId:replay.id,replayed:true,revision:st.revision,changed:!!(result.inserted+result.updated+result.removed+result.restored),result};
  }
  const byId=new Map((events.results as StoredEvent[]).map(e=>[e.id,e])),byNatural=new Map([...byId.values()].map(e=>[e.natural_key,e])),byAlias=new Map((aliases.results as {source_key:string;event_id:string}[]).map(x=>[x.source_key,x.event_id]));
  const counts:Counts={received:n.received,normalized:n.lessons.length,duplicatesRemoved:n.duplicates,inserted:0,updated:0,removed:0,restored:0,unchanged:0};
  const stamp=nowIso(),seen=new Set<string>(),writes:StoredEvent[]=[],aliasWrites:{source_key:string;event_id:string}[]=[];
  for(const l of n.lessons){
    let event=byId.get(byAlias.get(l.source_key)||"")||byNatural.get(l.natural_key);
    if(!event){const id=crypto.randomUUID();event={id,owner_user_id:d.owner_user_id,calendar_id:cid,natural_key:l.natural_key,ical_uid:await stableUid(uidSecret,cid,id),local_date:l.local_date,period_key:l.period_key,course_code:l.course_code,title:l.title,starts_at_utc:l.starts_at_utc,ends_at_utc:l.ends_at_utc,timezone:d.timezone,teacher:l.teacher,room:l.room,description:l.description,event_type:l.event_type,content_hash:l.content_hash,sequence:0,status:"confirmed",active:1,created_at:stamp,updated_at:stamp,deleted_at:null};byId.set(id,event);byNatural.set(l.natural_key,event);counts.inserted++;writes.push(event);
    }else{
      if(seen.has(event.id))return fail("DUPLICATE_LESSON_CONFLICT","Multiple lessons resolve to the same event.",409);
      const restore=event.status==="cancelled"||!event.active;
      if(restore||event.content_hash!==l.content_hash){const next={...event,local_date:l.local_date,period_key:l.period_key,course_code:l.course_code,title:l.title,starts_at_utc:l.starts_at_utc,ends_at_utc:l.ends_at_utc,teacher:l.teacher,room:l.room,description:l.description,event_type:l.event_type,content_hash:l.content_hash,sequence:event.sequence+1,status:"confirmed",active:1,updated_at:stamp,deleted_at:null};writes.push(next);byId.set(next.id,next);event=next;counts[restore?"restored":"updated"]++;}else counts.unchanged++;
    }
    seen.add(event.id);byAlias.set(l.source_key,event.id);aliasWrites.push({source_key:l.source_key,event_id:event.id});
  }
  for(const e of byId.values())if(e.active&&e.status==="confirmed"&&!seen.has(e.id)&&n.ranges.some(r=>r.complete&&inside(e.local_date,r))){writes.push({...e,status:"cancelled",active:0,sequence:e.sequence+1,updated_at:stamp,deleted_at:stamp});counts.removed++;}
  const changed=!!(counts.inserted+counts.updated+counts.removed+counts.restored),id=crypto.randomUUID(),revision=st.revision+(changed?1:0);
  // D1 batch is one transaction. A failed CHECK aborts the whole batch if another sync
  // changed the snapshot, the source identity changed, or authorization was revoked.
  const statements:D1PreparedStatement[]=[
    db.prepare("INSERT INTO worker_sync_guard(id,ok) SELECT ?, CASE WHEN EXISTS(SELECT 1 FROM calendars c JOIN devices d ON d.calendar_id=c.id AND d.owner_user_id=c.owner_user_id JOIN users u ON u.id=c.owner_user_id WHERE c.id=? AND c.revision=? AND c.updated_at=? AND d.id=? AND d.token_hash=? AND d.status='active' AND u.account_status='active' AND u.sync_enabled=1 AND COALESCE((SELECT generation FROM worker_sync_versions WHERE calendar_id=c.id),0)=? AND NOT EXISTS(SELECT 1 FROM source_identities s WHERE s.calendar_id=c.id AND (s.school_host<>? OR s.student_ref<>?))) THEN 1 ELSE 0 END").bind(id,cid,st.revision,st.updated_at,d.id,hash,st.generation,n.school,n.student),
    db.prepare("INSERT INTO worker_sync_versions(calendar_id,generation) VALUES (?,1) ON CONFLICT(calendar_id) DO UPDATE SET generation=generation+1").bind(cid),
    db.prepare("INSERT INTO source_identities(calendar_id,school_host,student_ref,locked_at) VALUES (?,?,?,?) ON CONFLICT(calendar_id) DO NOTHING").bind(cid,n.school,n.student,stamp),
  ];
  for(const data of chunks(writes))statements.push(db.prepare("INSERT INTO events("+cols.join(",")+") SELECT "+cols.map(c=>"json_extract(value,'$."+c+"')").join(",")+" FROM json_each(?) WHERE 1 ON CONFLICT(id) DO UPDATE SET "+mutable.map(c=>c+"=excluded."+c).join(",")).bind(data));
  for(const data of chunks(aliasWrites))statements.push(db.prepare("INSERT INTO event_aliases(calendar_id,source_key,event_id,first_seen_at,last_seen_at) SELECT ?,json_extract(value,'$.source_key'),json_extract(value,'$.event_id'),?,? FROM json_each(?) WHERE 1 ON CONFLICT(calendar_id,source_key) DO UPDATE SET event_id=excluded.event_id,last_seen_at=excluded.last_seen_at").bind(cid,stamp,stamp,data));
  const rangeFrom=n.ranges.map(r=>r.from).sort()[0],rangeUntil=n.ranges.map(r=>r.until).sort().at(-1)!;
  statements.push(
    db.prepare("UPDATE calendars SET revision=?,last_synced_at=?,updated_at=?,last_changed_at=CASE WHEN ?=1 THEN ? ELSE last_changed_at END WHERE id=?").bind(revision,stamp,stamp,changed?1:0,stamp,cid),
    db.prepare("UPDATE devices SET last_synced_at=?,last_seen_at=? WHERE id=?").bind(stamp,stamp,d.id),
    db.prepare("INSERT INTO sync_runs(id,owner_user_id,calendar_id,device_id,idempotency_key,payload_hash,snapshot_hash,range_from,range_until,received_count,normalized_count,duplicate_count,inserted_count,updated_count,removed_count,restored_count,unchanged_count,status,started_at,completed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'success',?,?)").bind(id,d.owner_user_id,cid,d.id,idem,n.payloadHash,n.snapshotHash,rangeFrom,rangeUntil,counts.received,counts.normalized,counts.duplicatesRemoved,counts.inserted,counts.updated,counts.removed,counts.restored,counts.unchanged,stamp,stamp),
    db.prepare("DELETE FROM worker_sync_guard WHERE id=?").bind(id)
  );
  try{await db.batch(statements);}catch(e){if(String(e).includes("CHECK constraint failed")||String(e).includes("UNIQUE constraint failed"))return fail("SYNC_ALREADY_RUNNING","Concurrent update or conflicting snapshot; retry.",409);throw e;}
  return {syncId:id,revision,changed,result:counts,lastSyncedAt:stamp};
}
