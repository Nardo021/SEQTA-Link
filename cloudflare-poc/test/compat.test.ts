/// <reference types="vite/client" />
import { beforeAll, expect, test } from "vitest";
import { env } from "cloudflare:workers";
import { hashToken, stableUid } from "../src/compat";
import { handleRequest } from "../src/index";
import schema from "../migrations/0001_schema.sql?raw";

const pepper=new Uint8Array(32).fill(120),uidSecret=new Uint8Array(32).fill(121);
const rawCalendar="sl_cal_fixture_please_do_not_use_as_secret",rawDevice="sl_dvc_fixture";
const stamp="2026-11-24T00:00:00Z",db=env.DATABASE;
const appEnv={DATABASE:db,TOKEN_PEPPER:btoa(String.fromCharCode(...pepper)),UID_SECRET:btoa(String.fromCharCode(...uidSecret))};
const baseUrl="https://example.invalid";
const call=(path:string,init?:RequestInit)=>handleRequest(new Request(baseUrl+path,init),appEnv);
const feedPath="/calendar/"+rawCalendar+".ics";
const auth={Authorization:"Bearer "+rawDevice};
const lesson=(i:number,title:string)=>({sourceKey:"lesson-"+i,date:"2026-11-24",periodKey:"period-"+i,periodLabel:"Period "+i,courseCode:"SUB"+i,title,start:i===1?"09:00:00":"10:00:00",end:i===1?"09:50:00":"10:50:00",teacher:"Test Teacher",room:"R1",description:null,type:"class"});
const makeBody=(lessons:unknown[],complete:boolean)=>({schemaVersion:1,schoolHost:"school.example.invalid",studentRef:"fixture-student",timezone:"Australia/Sydney",generatedAt:stamp,allowEmptySnapshot:false,coverage:[{from:"2026-11-24",until:"2026-11-24",complete}],lessons});
const send=(key:string,body:unknown)=>call("/api/v2/sync",{method:"POST",headers:{...auth,"Content-Type":"application/json","Idempotency-Key":key},body:JSON.stringify(body)});
const key=(n:number)=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
async function responseJson(r:Response){return await r.json() as {revision:number;changed:boolean;replayed?:boolean;syncId:string;result:{inserted:number;updated:number;removed:number;restored:number;unchanged:number};error?:{code:string};events?:{active:number}};}

beforeAll(async()=>{
  const statements=schema.replace(/^\s*--.*$/gm,"").split(";").map(s=>s.trim()).filter(Boolean);
  await db.batch(statements.map(s=>db.prepare(s)));
  await db.batch([
    db.prepare("INSERT INTO users(id,display_name,role,created_at,updated_at) VALUES (?,?,?,?,?)").bind("u1","Fixture","owner",stamp,stamp),
    db.prepare("INSERT INTO calendars(id,owner_user_id,name,timezone,revision,created_at,updated_at) VALUES (?,?,?,?,?,?,?)").bind("c1","u1","Fixture Timetable","Australia/Sydney",5,stamp,stamp),
    db.prepare("INSERT INTO calendar_tokens(id,calendar_id,token_hash,token_prefix,created_at) VALUES (?,?,?,?,?)").bind("t1","c1",await hashToken(pepper,"calendar",rawCalendar),"sl_cal_",stamp),
    db.prepare("INSERT INTO devices(id,owner_user_id,calendar_id,name,token_hash,token_prefix,created_at) VALUES (?,?,?,?,?,?,?)").bind("d1","u1","c1","Fixture Browser",await hashToken(pepper,"device",rawDevice),"sl_dvc_",stamp),
  ]);
});

test("existing Flask HMAC/UID contracts remain unchanged",async()=>{
  expect(await hashToken(pepper,"calendar",rawCalendar)).toBe("6476eb6b120207962d91aca225a38bc4dc2efa68b2621f6c393494f7c4be63f0");
  expect(await hashToken(pepper,"device",rawDevice)).toBe("abe94f4d7ac51798148861957e78336b032bf6e85c7d85a8c9ff849c97080086");
  expect(await stableUid(uidSecret,"cal-fixed-01","evt-fixed-01")).toBe("TU3ivCe5WD3fTmf9vAprFaHSm5WszzJ_qOufOht6yPs@seqta.link");
});

test("integrated D1 sync, stable UID, replay, partial/empty protection, ICS and revocation",async()=>{
  expect((await call("/health/ready")).status).toBe(200);
  expect((await call("/api/v2/status")).status).toBe(401);
  const original=makeBody([lesson(1,"Music"),lesson(2,"Business")],true);
  let r=await send(key(1),original);expect(r.status).toBe(200);
  let result=await responseJson(r);expect(result.result.inserted).toBe(2);expect(result.revision).toBe(6);
  const firstRun=result.syncId;
  r=await send(key(1),original);expect(r.status).toBe(200);result=await responseJson(r);expect(result.replayed).toBe(true);expect(result.syncId).toBe(firstRun);
  expect((await send(key(1),makeBody([lesson(1,"Different")],true))).status).toBe(409);
  const firstFeed=await call(feedPath);expect(firstFeed.status).toBe(200);expect(firstFeed.headers.get("Content-Type")).toBe("text/calendar; charset=utf-8");
  const body=await firstFeed.text();expect(body).toContain("DTSTART;TZID=Australia/Sydney:20261124T090000");
  expect(body.match(/BEGIN:VEVENT/g)?.length).toBe(2);
  const firstUid=(await db.prepare("SELECT ical_uid FROM events WHERE calendar_id=? AND course_code=?").bind("c1","SUB1").first<{ical_uid:string}>())?.ical_uid;
  expect(firstUid).toBeTruthy();
  expect((await call(feedPath,{headers:{"If-None-Match":'"calendar-6"'}})).status).toBe(304);
  // A partial upload must not cancel the second class.
  r=await send(key(2),makeBody([lesson(1,"Music")],false));expect(r.status).toBe(200);
  result=await responseJson(r);expect(result.result.removed).toBe(0);expect(result.revision).toBe(6);
  const suspicious={...makeBody([],true),coverage:[{from:"2026-11-23",until:"2026-12-02",complete:true}]};
  expect((await send(key(3),suspicious)).status).toBe(422);
  expect((await send(key(4),{...original,studentRef:"different"})).status).toBe(409);
  // A complete upload updates the first lesson and cancels the omitted one.
  r=await send(key(5),makeBody([lesson(1,"Updated Music")],true));expect(r.status).toBe(200);result=await responseJson(r);
  expect(result.result.updated).toBe(1);expect(result.result.removed).toBe(1);expect(result.revision).toBe(7);
  const changed=await call(feedPath);
  expect(changed.headers.get("ETag")).toBe('"calendar-7"');
  const changedBody=await changed.text();expect(changedBody).toContain("UID:"+firstUid);expect(changedBody).toContain("STATUS:CANCELLED");
  const status=await call("/api/v2/status",{headers:auth});expect(status.status).toBe(200);expect((await responseJson(status)).events?.active).toBe(1);
  // Restoration retains the stored UID and advances sequence/revision.
  r=await send(key(6),makeBody([lesson(1,"Updated Music"),lesson(2,"Business")],true));expect(r.status).toBe(200);result=await responseJson(r);
  expect(result.result.restored).toBe(1);expect(result.revision).toBe(8);
  expect((await db.prepare("SELECT ical_uid FROM events WHERE calendar_id=? AND course_code=?").bind("c1","SUB1").first<{ical_uid:string}>())?.ical_uid).toBe(firstUid);
  await db.prepare("UPDATE users SET feed_enabled=0 WHERE id=?").bind("u1").run();
  expect((await call(feedPath)).status).toBe(410);
  await db.prepare("UPDATE users SET feed_enabled=1 WHERE id=?").bind("u1").run();
  await db.prepare("UPDATE calendar_tokens SET status='revoked' WHERE id=?").bind("t1").run();
  expect((await call(feedPath)).status).toBe(404);
  await db.prepare("UPDATE devices SET status='revoked' WHERE id=?").bind("d1").run();
  expect((await send(key(7),original)).status).toBe(401);
});
