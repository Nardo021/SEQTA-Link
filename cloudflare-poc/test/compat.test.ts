/// <reference types="vite/client" />
import { beforeAll, expect, test } from "vitest";
import { env } from "cloudflare:workers";
import { hashToken, stableUid } from "../src/compat";
import { handleRequest } from "../src/index";
import { SCRYPT_LEGACY, PASSWORD } from "./password-fixtures";
import { sessionHash } from "../src/auth";
import schema from "../migrations/0001_schema.sql?raw";
import subscriptionSchema from "../migrations/0002_subscription_clients.sql?raw";
import dailySchema from "../migrations/0003_daily_experience.sql?raw";
import workspaceSchema from "../migrations/0004_workspace_reliability.sql?raw";

const pepper=new Uint8Array(32).fill(120),uidSecret=new Uint8Array(32).fill(121);
const rawCalendar="sl_cal_fixture_please_do_not_use_as_secret",rawDevice="sl_dvc_fixture";
const stamp="2026-11-24T00:00:00Z",db=env.DATABASE;
const appEnv={DATABASE:db,TOKEN_PEPPER:btoa(String.fromCharCode(...pepper)),UID_SECRET:btoa(String.fromCharCode(...uidSecret)),SESSION_SECRET:btoa(String.fromCharCode(...uidSecret))};
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
  const statements=(schema+"\n"+subscriptionSchema+"\n"+dailySchema+"\n"+workspaceSchema).replace(/^\s*--.*$/gm,"").split(";").map(s=>s.trim()).filter(Boolean);
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
  expect(firstFeed.headers.get("ETag")).toBe('"calendar-v3-6"');
  expect((await call(feedPath,{headers:{"If-None-Match":'"calendar-6"'}})).status).toBe(200);
  expect((await call(feedPath,{headers:{"If-None-Match":'"calendar-v3-6"'}})).status).toBe(304);
  expect((await call(feedPath,{headers:{"If-None-Match":'W/"calendar-v3-6"'}})).status).toBe(304);
  expect((await call(feedPath,{headers:{"If-None-Match":'"calendar-v2-6"'}})).status).toBe(200);
  expect(await (await call(feedPath)).text()).toBe(body);
  // A partial upload must not cancel the second class.
  r=await send(key(2),makeBody([lesson(1,"Music")],false));expect(r.status).toBe(200);
  result=await responseJson(r);expect(result.result.removed).toBe(0);expect(result.revision).toBe(6);
  const suspicious={...makeBody([],true),coverage:[{from:"2026-11-23",until:"2026-12-02",complete:true}]};
  expect((await send(key(3),suspicious)).status).toBe(422);
  expect((await send(key(4),{...original,studentRef:"different"})).status).toBe(409);
  // A complete upload updates the first lesson and cancels the omitted one.
  r=await send(key(5),makeBody([lesson(1,"Updated Music")],true));expect(r.status).toBe(200);result=await responseJson(r);
  expect(result.result.updated).toBe(1);expect(result.result.removed).toBe(1);expect(result.revision).toBe(7);
  const diff=await db.prepare("SELECT kind,before_json,after_json FROM worker_event_changes WHERE sync_id=? ORDER BY kind").bind(result.syncId).all<{kind:string;before_json:string;after_json:string}>();expect(diff.results.map(x=>x.kind)).toEqual(["removed","updated"]);expect(JSON.parse(diff.results[1].before_json).title).toBe("Music");expect(JSON.parse(diff.results[1].after_json).title).toBe("Updated Music");
  const changed=await call(feedPath);
  expect(changed.headers.get("ETag")).toBe('"calendar-v3-7"');
  const changedBody=await changed.text();expect(changedBody).toContain("UID:"+firstUid);expect(changedBody).not.toContain("STATUS:CANCELLED");expect(changedBody.match(/BEGIN:VEVENT/g)?.length).toBe(1);
  expect((await db.prepare("SELECT count(*) AS n FROM events WHERE calendar_id='c1' AND active=0 AND status='cancelled'").first<{n:number}>())?.n).toBe(1);
  const cancelledUid=(await db.prepare("SELECT ical_uid FROM events WHERE calendar_id='c1' AND course_code='SUB2'").first<{ical_uid:string}>())!.ical_uid;
  expect(changedBody).not.toContain("UID:"+cancelledUid);
  const status=await call("/api/v2/status",{headers:auth});expect(status.status).toBe(200);expect((await responseJson(status)).events?.active).toBe(1);
  // Restoration retains the stored UID and advances sequence/revision.
  r=await send(key(6),makeBody([lesson(1,"Updated Music"),lesson(2,"Business")],true));expect(r.status).toBe(200);result=await responseJson(r);
  expect(result.result.restored).toBe(1);expect(result.revision).toBe(8);
  const restoredBody=await (await call(feedPath)).text();expect(restoredBody).toContain("UID:"+cancelledUid);expect(restoredBody).not.toContain("STATUS:CANCELLED");expect(restoredBody.match(/BEGIN:VEVENT/g)?.length).toBe(2);
  expect((await db.prepare("SELECT ical_uid FROM events WHERE calendar_id=? AND course_code=?").bind("c1","SUB1").first<{ical_uid:string}>())?.ical_uid).toBe(firstUid);
  const marked={...makeBody([lesson(1,"Updated Music"),lesson(2,"Business")],true),schoolDays:[{date:"2026-11-24",week:"B",term:"Term 4"}]};
  expect((await send(key(20),marked)).status).toBe(200);
  const day=await db.prepare("SELECT week_label,term_label FROM worker_school_days WHERE calendar_id='c1' AND local_date='2026-11-24'").first();expect(day).toEqual({week_label:"B",term_label:"Term 4"});
  expect((await call("/api/v2/device/check",{method:"POST",headers:{...auth,"Content-Type":"application/json"},body:JSON.stringify({outcome:"unchanged",reason:"ok"})})).status).toBe(200);
  expect((await db.prepare("SELECT outcome FROM worker_device_checks WHERE device_id='d1'").first<{outcome:string}>())?.outcome).toBe("unchanged");
  await db.prepare("UPDATE users SET feed_enabled=0 WHERE id=?").bind("u1").run();
  expect((await call(feedPath)).status).toBe(410);
  await db.prepare("UPDATE users SET feed_enabled=1 WHERE id=?").bind("u1").run();
  await db.prepare("UPDATE calendar_tokens SET status='revoked' WHERE id=?").bind("t1").run();
  expect((await call(feedPath)).status).toBe(404);
  await db.prepare("UPDATE devices SET status='revoked' WHERE id=?").bind("d1").run();
  expect((await send(key(7),original)).status).toBe(401);
});

test("portal login, invitation, pairing, access control and logout",async()=>{
 await db.prepare("UPDATE users SET email=?,password_hash=? WHERE id=?").bind("owner@example.invalid",SCRYPT_LEGACY,"u1").run();
 const postForm=(path:string,values:Record<string,string>,cookie="")=>call(path,{method:"POST",headers:{Origin:baseUrl,"Content-Type":"application/x-www-form-urlencoded",Cookie:cookie},body:new URLSearchParams(values).toString()});
 expect((await call("/app/dashboard")).status).toBe(303);
 const login=await postForm("/app/login",{email:"owner@example.invalid",password:PASSWORD});expect(login.status).toBe(303);
 const ownerCookie=login.headers.get("Set-Cookie")!.split(";")[0];expect(ownerCookie).toMatch(/^seqta_session=/);
 const overview=await call("/app/dashboard",{headers:{Cookie:ownerCookie}});expect(overview.status).toBe(303);expect(overview.headers.get("Location")).toBe("/app/timetable");
 const home=await call("/app/timetable",{headers:{Cookie:ownerCookie}});expect(home.status).toBe(200);
 const homeHtml=await home.text();expect(homeHtml).toContain('aria-current="page"');expect(homeHtml).toContain("data-theme-toggle");expect(homeHtml).toContain("/assets/ui-v4.js");expect(homeHtml).not.toContain("command-palette");expect(homeHtml).not.toContain("Mobile navigation");
 const timetable=await call("/app/timetable?from=2026-11-24&until=2026-11-24",{headers:{Cookie:ownerCookie}});expect(timetable.status).toBe(200);
 const schedule=await timetable.text();expect(schedule).toContain("Previous week or day");expect(schedule).toContain("Next week or day");expect(schedule).toContain("day-list");expect(schedule).toContain("Week B");
 expect((await call("/app/timetable?from=invalid",{headers:{Cookie:ownerCookie}})).status).toBe(400);
 expect(schedule).toContain("interactive-workspace");expect(schedule).toContain("data-date-picker");expect(schedule).toContain("lesson-sheet");expect(schedule).not.toContain("command-palette");expect(schedule).not.toContain("Weekly class time");expect(schedule).not.toContain("Live school day");
 expect((await postForm("/app/account",{action:"display",view:"day",hour:"12",locate:"on",terms:"Term 4 | 2026-11-23 | 2026-12-10 | A"},ownerCookie)).status).toBe(303);
 expect((await postForm("/app/account",{action:"course",course:"code:SUB1",name:"My Music",color:"2"},ownerCookie)).status).toBe(303);
 const personalized=await (await call("/app/timetable?from=2026-11-24&until=2026-11-24",{headers:{Cookie:ownerCookie}})).text();expect(personalized).toContain("My Music");expect(personalized).toContain("9:00 AM");
 expect((await call("/admin/health",{headers:{Cookie:ownerCookie}})).status).toBe(200);
 expect((await call("/api/v2/me/search?q=Music")).status).toBe(401);
 const search=await (await call("/api/v2/me/search?q=Music",{headers:{Cookie:ownerCookie}})).json() as {results:{title:string;href:string}[]};expect(search.results.some(x=>x.title==="My Music")).toBe(true);
 const exportResponse=await call("/app/account/export",{headers:{Cookie:ownerCookie}});expect(exportResponse.status).toBe(200);const exported=await exportResponse.text();expect(exported).toContain("Updated Music");expect(exported).not.toContain(rawCalendar);expect(exported).not.toContain("password_hash");
 const legacyWeek=await call("/app/timetable?from=2026-11-23&until=2026-12-06&view=biweek",{headers:{Cookie:ownerCookie}});expect(legacyWeek.status).toBe(303);expect(legacyWeek.headers.get("Location")).toBe("/app/timetable?from=2026-11-23&until=2026-11-29&view=week");
 const legacyDay=await call("/app/timetable?from=2026-11-24&until=2026-11-30&view=agenda",{headers:{Cookie:ownerCookie}});expect(legacyDay.status).toBe(303);expect(legacyDay.headers.get("Location")).toBe("/app/timetable?from=2026-11-24&until=2026-11-24&view=day");
 const oneWeek=await (await call("/app/timetable?from=2026-11-23&until=2026-11-29&view=week",{headers:{Cookie:ownerCookie}})).text();expect(oneWeek.match(/aria-label="Time-grid timetable"/g)?.length).toBe(1);

 for(const path of ["/app/calendar","/app/devices","/app/sync-history","/app/account","/admin/dashboard","/admin/users","/admin/invitations","/admin/audit"]){expect((await call(path,{headers:{Cookie:ownerCookie}})).status).toBe(200);}

 expect(homeHtml).toContain("data-theme-toggle");expect(homeHtml).toContain("/assets/ui-v4.js");
 expect((await call("/assets/ui.js")).status).toBe(200);
 const interactive=await call("/assets/interactive-v4.js");expect(interactive.status).toBe(200);expect(interactive.headers.get("Content-Type")).toContain("javascript");expect((await interactive.text()).length).toBeGreaterThan(10000);
 await db.prepare("UPDATE calendar_tokens SET status='active' WHERE id='t1'").run();
 expect((await call("/app/calendar/create",{method:"POST",headers:{Cookie:ownerCookie}})).status).toBe(403);
 expect((await postForm("/app/calendar/create",{},ownerCookie)).status).toBe(303);
 const calendarHtml=await (await call("/app/calendar",{headers:{Cookie:ownerCookie}})).text();
 const managedPath=calendarHtml.match(/\/calendar\/sl_cal_[0-9a-f]{64}\.ics/)?.[0];expect(managedPath).toBeTruthy();
 expect(calendarHtml).toContain("Copy link");expect(calendarHtml).toContain("webcal://");expect(calendarHtml).toContain("Appearance");expect(calendarHtml).toContain("Calendar & Sync");expect(calendarHtml).toContain("Account & Devices");expect(calendarHtml).toContain("Advanced");
 expect((await postForm("/app/calendar/create",{},ownerCookie)).status).toBe(303);
 expect(await (await call("/app/calendar",{headers:{Cookie:ownerCookie}})).text()).toContain(managedPath!);
 expect((await db.prepare("SELECT count(*) AS n FROM calendar_tokens WHERE calendar_id='c1' AND status='active' AND id LIKE 'ui-v1-%'").first<{n:number}>())?.n).toBe(1);
 const subscribed=await call(managedPath!,{headers:{"User-Agent":"CalendarAgent/1.0"}});expect(subscribed.status).toBe(200);const ics=await subscribed.text();expect(ics).toContain("REFRESH-INTERVAL;VALUE=DURATION:PT15M");expect(ics).toContain("BEGIN:VEVENT");
 expect((await call(managedPath!,{headers:{"If-None-Match":subscribed.headers.get("ETag")!,"User-Agent":"CalendarAgent/1.0"}})).status).toBe(304);
 expect((await call(feedPath)).status).toBe(200);
 const observed=await db.prepare("SELECT client,fetch_count FROM calendar_subscription_clients WHERE token_id IN (SELECT id FROM calendar_tokens WHERE calendar_id='c1' AND id LIKE 'ui-v1-%')").all<{client:string;fetch_count:number}>();
 expect(observed.results).toEqual([{client:"apple",fetch_count:2}]);
 expect((await postForm("/app/calendar/create",{label:"MacBook"},ownerCookie)).status).toBe(303);
 const listPage=await (await call("/app/calendar",{headers:{Cookie:ownerCookie}})).text();expect(listPage).toContain("MacBook");expect(listPage).toContain("Apple Calendar");expect(listPage).toContain("data-slot=\"input-group\"");
 const named=await db.prepare("SELECT t.id FROM calendar_tokens t JOIN calendar_subscription_meta m ON m.token_id=t.id WHERE m.label='MacBook'").first<{id:string}>();expect(named).toBeTruthy();
 expect((await postForm("/app/calendar/subscriptions/"+named!.id+"/rename",{label:"MacBook Pro"},ownerCookie)).status).toBe(303);
 expect((await postForm("/app/calendar/subscriptions/"+named!.id+"/revoke",{},ownerCookie)).status).toBe(400);
 expect((await postForm("/app/calendar/subscriptions/"+named!.id+"/revoke",{confirm:"revoke"},ownerCookie)).status).toBe(303);
 expect((await call(managedPath!)).status).toBe(200);
 expect((await call("/api/v2/me/pairing-codes",{method:"POST",headers:{Cookie:ownerCookie}})).status).toBe(403);
 const codeResponse=await call("/api/v2/me/pairing-codes",{method:"POST",headers:{Cookie:ownerCookie,Origin:baseUrl}});expect(codeResponse.status).toBe(200);
 const {code}=await codeResponse.json() as {code:string};
 const pair=()=>call("/api/v2/device/pair",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({code,deviceName:"New fixture"})});
 const paired=await pair();expect(paired.status).toBe(200);
 const {deviceToken}=await paired.json() as {deviceToken:string};expect(deviceToken).toMatch(/^sl_dvc_/);
 expect((await pair()).status).toBe(404);
 expect((await call("/api/v2/status",{headers:{Authorization:"Bearer "+deviceToken}})).status).toBe(200);
 const regularRaw="a".repeat(43),regularCookie="seqta_session="+regularRaw;
 await db.batch([
  db.prepare("INSERT INTO users(id,display_name,role,created_at,updated_at) VALUES (?,?,?,?,?)").bind("u2","Regular","user",stamp,stamp),
  db.prepare("INSERT INTO calendars(id,owner_user_id,name,created_at,updated_at) VALUES (?,?,?,?,?)").bind("c2","u2","Regular timetable",stamp,stamp),
  db.prepare("INSERT INTO sessions(id,user_id,session_token_hash,expires_at,created_at,last_seen_at) VALUES (?,?,?,?,?,?)").bind("s2","u2",await sessionHash(uidSecret,regularRaw),"2099-01-01T00:00:00Z",stamp,stamp)
 ]);

 expect((await call("/admin/users",{headers:{Cookie:regularCookie}})).status).toBe(403);
 expect(await (await call("/admin/users",{headers:{Cookie:ownerCookie}})).text()).toContain("data-advanced-table");
 expect((await call("/admin/health",{headers:{Cookie:regularCookie}})).status).toBe(403);
 expect((await call("/admin/timetables",{headers:{Cookie:regularCookie}})).status).toBe(403);
 expect((await call("/admin/timetables/c1",{headers:{Cookie:regularCookie}})).status).toBe(403);
 const all=await call("/admin/timetables",{headers:{Cookie:ownerCookie}});expect(all.status).toBe(200);const allHtml=await all.text();expect(allHtml).toContain("/admin/timetables/c1");expect(allHtml).toContain("/admin/timetables/c2");expect(allHtml).not.toContain(managedPath!);
 const adminView=await call("/admin/timetables/c1?from=2026-11-24&until=2026-11-24",{headers:{Cookie:ownerCookie}});expect(adminView.status).toBe(200);const adminHtml=await adminView.text();expect(adminHtml).toContain("Updated Music");expect(adminHtml).toContain("/admin/timetables/c1?from=");expect(adminHtml).not.toContain(managedPath!);
 expect((await call("/admin/timetables/c1",{method:"POST",headers:{Cookie:ownerCookie,Origin:baseUrl}})).status).toBe(404);
 expect((await call("/admin/timetables/c2",{headers:{Cookie:ownerCookie}})).status).toBe(200);
 expect((await call("/admin/timetables/unknown",{headers:{Cookie:ownerCookie}})).status).toBe(404);
 const regularCalendar=await call("/app/calendar",{headers:{Cookie:regularCookie}});expect(await regularCalendar.text()).not.toContain(managedPath!);
 expect((await postForm("/app/calendar/subscriptions/"+named!.id+"/rename",{label:"Not mine"},regularCookie)).status).toBe(404);
 const d=await db.prepare("SELECT id FROM devices WHERE token_hash=?").bind(await hashToken(pepper,"device",deviceToken)).first<{id:string}>();
 expect((await call("/api/v2/me/devices/"+d!.id,{method:"DELETE",headers:{Cookie:regularCookie,Origin:baseUrl}})).status).toBe(404);
 const invite=await postForm("/admin/invitations",{expected_name:"Invited fixture",max_devices:"2"},ownerCookie);expect(invite.status).toBe(200);
 const inviteUrl=(await invite.text()).match(/\/invite\?token=[A-Za-z0-9_-]{43}/)?.[0];expect(inviteUrl).toBeTruthy();
 expect((await call(inviteUrl!)).status).toBe(200);
 const registered=await postForm(inviteUrl!,{email:"invite@example.invalid",display_name:"Invited fixture",password:PASSWORD});expect(registered.status).toBe(303);
 expect((await call(inviteUrl!)).status).toBe(404);
 const newCookie=registered.headers.get("Set-Cookie")!.split(";")[0];
 expect((await call("/app/dashboard",{headers:{Cookie:newCookie}})).status).toBe(303);

 expect(await (await call("/app/calendar",{headers:{Cookie:newCookie}})).text()).toMatch(/\/calendar\/sl_cal_[0-9a-f]{64}\.ics/);
 expect((await postForm("/app/calendar/rotate",{confirm:"rotate"},ownerCookie)).status).toBe(303);
 expect((await call(managedPath!)).status).toBe(404);
 expect((await call(feedPath)).status).toBe(404);
 const replacement=(await (await call("/app/calendar",{headers:{Cookie:ownerCookie}})).text()).match(/\/calendar\/sl_cal_[0-9a-f]{64}\.ics/)?.[0];expect(replacement).toBeTruthy();expect(replacement).not.toBe(managedPath);
 expect((await call(replacement!)).status).toBe(200);
 expect((await postForm("/auth/logout",{},ownerCookie)).status).toBe(303);
 expect((await call("/app/dashboard",{headers:{Cookie:ownerCookie}})).status).toBe(303);
},30_000);
