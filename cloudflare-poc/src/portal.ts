import { preferences, savePreferences, updatePrefs, updateCourse, courseKey, displayLesson, schoolContext, type SchoolDay } from "./school";
import { nowLine, lessonSheet, appearanceForm, termsForm, courseEditor } from "./daily-ui";
import { ApiError, nowIso } from "./common";
import { hashToken } from "./compat";
import { managedId, managedRaw, managedSubscription, ensureSubscription, subscriptions, createNamedSubscription, renameSubscription, revokeSubscription } from "./subscription";
import { calendarFor, checkPassword, clearCookie, createPairing, currentUser, err, form, isAdmin, login, passwordHash, randomToken, register, requireOrigin, revokeSession, sessionCookie, rateLimit, type Calendar, type User } from "./auth";
import { esc, button, post, hidden, field, check, link, panel, page, table, advancedTable, fmt, action, chip, metric, panelHead, todaySydney, shiftDate, weekStart, validDate, timeline, timetableControls, dayCount, notice, scheduleLink, subscriptionPanel, lessonList } from "./ui";
const redirect=(path:string,cookie?:string)=>new Response(null,{status:303,headers:{Location:path,"Cache-Control":"no-store",...(cookie?{"Set-Cookie":cookie}:{})}});
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"no-store","Referrer-Policy":"no-referrer"}});
const rowValue=(r:Record<string,unknown>,k:string)=>esc(r[k]);
const int=(v:string|null,min:number,max:number,fallback:number)=>{if(v===null||v==="")return fallback;const n=Number(v);if(!Number.isInteger(n)||n<min||n>max)return err("INVALID_REQUEST","Invalid numeric value.");return n;};
const runTable=(rows:Record<string,unknown>[])=>table(["Started","Status","Received","Inserted","Updated","Removed","Restored"],rows.map(r=>[esc(fmt(r.started_at)),chip(String(r.status)),...["received_count","inserted_count","updated_count","removed_count","restored_count"].map(k=>rowValue(r,k))]));
function audit(db:D1Database,actor:User,action:string,target:string|null){return db.prepare("INSERT INTO audit_logs(id,actor_user_id,actor_type,target_user_id,action,metadata,created_at) VALUES (?,?,?,?,?,'{}',?)").bind(crypto.randomUUID(),actor.id,actor.role,target,action,nowIso());}
const scheduleColumns="id,local_date,period_key,course_code,title,starts_at_utc,ends_at_utc,teacher,room,description,event_type";
const eventsBetween=(db:D1Database,cid:string,from:string,until:string,limit=501)=>db.prepare("SELECT "+scheduleColumns+" FROM events WHERE calendar_id=? AND active=1 AND status='confirmed' AND local_date BETWEEN ? AND ? ORDER BY local_date,starts_at_utc,title LIMIT "+limit).bind(cid,from,until).all<Record<string,unknown>>();
async function timetablePage(db:D1Database,url:URL,calendarId:string,user:User,title:string,prefix="",base="/app/timetable"){
 const own=base==="/app/timetable",p=await preferences(db,calendarId),today=todaySydney(),requestedView=url.searchParams.get("view")||(own?p.view:"week");
 const defaultFrom=requestedView==="day"?today:weekStart(today),from=url.searchParams.get("from")||defaultFrom;
 if(!validDate(from))return err("INVALID_DATE_RANGE","Invalid dates.");
 const until=url.searchParams.get("until")||(requestedView==="day"?from:shiftDate(from,requestedView==="biweek"?13:6));
 if(!validDate(until)||from>until||dayCount(from,until)>120)return err("INVALID_DATE_RANGE","Choose up to 120 days.");
 const span=dayCount(from,until),view:"week"|"day"|"agenda"|"biweek"=requestedView==="biweek"&&span===14?"biweek":requestedView==="agenda"||span>7?"agenda":span===1?"day":"week";
 const list=view==="day"||view==="agenda",mon=weekStart(from),last=shiftDate(mon,6);
 const [r,days,todayRows,cancelledRes,changeRes]=await Promise.all([
  eventsBetween(db,calendarId,from,until),
  db.prepare("SELECT local_date,week_label,term_label,holiday_label,checked_at FROM worker_school_days WHERE calendar_id=? AND local_date BETWEEN ? AND ? ORDER BY local_date").bind(calendarId,from<mon?from:mon,until>last?until:last).all<SchoolDay>(),
  own?eventsBetween(db,calendarId,today,shiftDate(today,7),301):Promise.resolve(null),
  list?db.prepare("SELECT "+scheduleColumns+" FROM events WHERE calendar_id=? AND status='cancelled' AND local_date BETWEEN ? AND ? ORDER BY local_date,starts_at_utc LIMIT 200").bind(calendarId,from,until).all<Record<string,unknown>>():Promise.resolve({results:[] as Record<string,unknown>[]}),
  list?db.prepare("SELECT event_id,kind FROM worker_event_changes WHERE calendar_id=? ORDER BY changed_at DESC LIMIT 80").bind(calendarId).all<{event_id:string;kind:string}>():Promise.resolve({results:[] as {event_id:string;kind:string}[]})
 ]);
 const raw=r.results.slice(0,500),display=own?raw.map(x=>displayLesson(p,x)).filter(x=>!x.ui_hidden):raw;
 const cancelled=own?cancelledRes.results.map(x=>displayLesson(p,x)).filter(x=>!x.ui_hidden):cancelledRes.results;
 const latest=new Map<string,string>();
 for(const c of changeRes.results)if(!latest.has(c.event_id))latest.set(c.event_id,c.kind);
 const changed=new Set<string>();
 for(const [id,kind] of latest)if(kind==="updated"||kind==="restored")changed.add(id);
 const calendarDays=Object.fromEntries(Array.from({length:Math.min(span,120)},(_,i)=>shiftDate(from,i)).map(date=>[date,schoolContext(date,p,days.results)]));
 const ctx=schoolContext(from,p,days.results),hour=own?p.hour:"24" as const;
 const showNow=!!(own&&todayRows&&!((view==="day"&&from===today)||(view==="agenda"&&from<=today&&today<=until)));
 const schedule=list?lessonList(display,cancelled,changed,today,hour):view==="biweek"?timeline(display,from,shiftDate(from,6),"week",new Date(),base,hour,{},calendarDays,own&&p.locate)+timeline(display,shiftDate(from,7),until,"week",new Date(),base,hour,{},calendarDays,own&&p.locate):timeline(display,from,until,"week",new Date(),base,hour,{},calendarDays,own&&p.locate);
 return page(title,prefix+timetableControls(from,until,view,today,base,own&&p.view==="week"&&!url.search,{week:ctx.week,holiday:ctx.holiday})+(showNow&&todayRows?nowLine(todayRows.results,p):"")+(r.results.length>500?notice("Showing the first 500 lessons. Choose a shorter date range."):"")+schedule+lessonSheet(),user);
}
const section=(id:string,title:string,body:string)=>"<section id=\""+id+"\" class=\"settings-section\"><h2>"+title+"</h2>"+body+"</section>";
async function settingsPage(db:D1Database,pepper:Uint8Array,user:User,cal:Calendar,origin:string){
 const [p,courses,links,devices,codes,runs,changes]=await Promise.all([
  preferences(db,cal.id),
  db.prepare("SELECT course_code,min(title) AS title FROM events WHERE calendar_id=? AND active=1 AND status='confirmed' GROUP BY COALESCE(NULLIF(course_code,''),title),course_code ORDER BY title LIMIT 100").bind(cal.id).all<Record<string,unknown>>(),
  subscriptions(db,pepper,cal.id,!!user.feed_enabled),
  db.prepare("SELECT id,name,status,last_synced_at FROM devices WHERE owner_user_id=? ORDER BY created_at DESC").bind(user.id).all<Record<string,unknown>>(),
  db.prepare("SELECT id,expires_at FROM pairing_codes WHERE owner_user_id=? AND used_at IS NULL AND julianday(expires_at)>julianday('now')").bind(user.id).all<Record<string,unknown>>(),
  db.prepare("SELECT * FROM sync_runs WHERE calendar_id=? ORDER BY started_at DESC LIMIT 50").bind(cal.id).all<Record<string,unknown>>(),
  db.prepare("SELECT kind,before_json,after_json,changed_at FROM worker_event_changes WHERE calendar_id=? ORDER BY changed_at DESC,event_id LIMIT 100").bind(cal.id).all<{kind:string;before_json:string|null;after_json:string;changed_at:string}>()
 ]);
 const fields=["title","local_date","starts_at_utc","ends_at_utc","teacher","room","period_key","course_code","description","event_type"];
 const changeRows=changes.results.map(c=>{const after=JSON.parse(c.after_json) as Record<string,unknown>,before=c.before_json?JSON.parse(c.before_json) as Record<string,unknown>:null;const diff=before?fields.filter(k=>before[k]!==after[k]).map(k=>esc(k.replaceAll("_"," "))+": "+esc(before[k]??"—")+" → "+esc(after[k]??"—")).join("<br>"):"";return [esc(fmt(c.changed_at)),chip(c.kind),esc(after.title),esc(after.local_date),diff||"—"];});
 const devicesBody=post("/app/devices/pairing-codes",button("Generate pairing code"))+table(["Device","Status","Last sync","Action"],devices.results.map(x=>[rowValue(x,"name"),rowValue(x,"status"),esc(fmt(x.last_synced_at)),x.status==="active"?post("/app/devices/"+encodeURIComponent(String(x.id))+"/revoke",button("Revoke")):""]))+(codes.results.length?table(["Pending code expires","Action"],codes.results.map(x=>[esc(fmt(x.expires_at)),post("/app/devices/pairing-codes/"+encodeURIComponent(String(x.id))+"/delete",button("Delete"))])):"");
 const body=section("appearance","Appearance",appearanceForm(p))+section("calendar","Calendar & Sync",subscriptionPanel(origin,links,!!user.feed_enabled,fmt(cal.last_synced_at))+termsForm(p)+"<h3 class=\"settings-sub\">Sync history</h3>"+table(["When","Change","Course","Date","Details"],changeRows)+runTable(runs.results))+section("account","Account & Devices",post("/app/account",hidden("action","preferences")+field("calendar_name","Calendar name",cal.name)+button("Save"))+post("/app/account",hidden("action","password")+field("current_password","Current password","","password")+field("new_password","New password","","password")+button("Change password"))+devicesBody)+section("advanced","Advanced",courseEditor(p,courses.results)+"<div class=\"mt-3 flex flex-wrap gap-2\">"+action("/app/account/export","Download JSON")+(isAdmin(user)?action("/admin/dashboard","Administration"):"")+"</div>");
 return page("Settings",body,user);
}
export async function portal(request:Request,db:D1Database,pepper:Uint8Array,secret:Uint8Array):Promise<Response>{
 const url=new URL(request.url),path=url.pathname,method=request.method,stamp=nowIso(),get=method==="GET",mut=method==="POST";
 const user=await currentUser(db,secret,request);
 if(path==="/")return get?redirect(user?"/app/timetable":"/app/login"):new Response(null,{status:405});
 if(path==="/app/login"||path==="/admin/login"){
  const admin=path.startsWith("/admin"),dest=admin?"/admin/dashboard":"/app/timetable";
  if(get&&user&&(!admin||isAdmin(user)))return redirect(dest);
  const fields=field("email","Email","","email")+field("password","Password","","password")+button("Sign in");
  if(mut){const f=await form(request);try{return redirect(dest,sessionCookie(await login(db,secret,pepper,request,f.get("email")||"",f.get("password")||"",admin)));}catch(e){if(e instanceof ApiError)return page("Sign in",panel("<p>"+esc(e.message)+"</p>"+post(path,fields)),null,e.status);throw e;}}
  if(get)return page(admin?"Admin sign in":"Sign in",panel(post(path,fields)));
 }
 if(path==="/invite"){
  const token=url.searchParams.get("token")||"";
  if(!/^[A-Za-z0-9_-]{43}$/.test(token))return page("Invitation unavailable","",null,404);
  if(mut){const f=await form(request);return redirect("/app/timetable",sessionCookie(await register(db,pepper,secret,request,token,f)));}
  if(get){const inv=await db.prepare("SELECT expected_name FROM invitations WHERE token_hash=? AND used_at IS NULL AND julianday(expires_at)>julianday('now')").bind(await hashToken(pepper,"invite",token)).first<{expected_name:string|null}>();if(!inv)return page("Invitation unavailable","",null,404);
   return page("Accept invitation",panel(post("/invite?token="+token,field("display_name","Name",inv.expected_name||"")+field("email","Email","","email")+field("password","Password","","password")+button("Create account"))));}
 }
 if(path==="/auth/logout"&&mut){requireOrigin(request);await revokeSession(db,secret,request);return redirect("/app/login",clearCookie);}
 if(!path.startsWith("/app/")&&!path.startsWith("/admin/")&&!path.startsWith("/api/v2/me/"))return new Response(null,{status:404});
 if(!user)return path.startsWith("/api/")?json({error:{code:"UNAUTHORIZED",message:"Sign in required."}},401):redirect(path.startsWith("/admin/")?"/admin/login":"/app/login");
 if(path.startsWith("/admin/")&&!isAdmin(user))return page("Forbidden","",user,403);
 if(path.startsWith("/admin/")){
  const nav="<nav class='subnav' aria-label='Administration'>"+link("/admin/dashboard","Overview")+link("/admin/users","Users")+link("/admin/timetables","Timetables")+link("/admin/health","Health")+link("/admin/invitations","Invitations")+link("/admin/audit","Audit")+"</nav>";
  if(path==="/admin/"&&get)return redirect("/admin/dashboard");
  if(path==="/admin/dashboard"&&get){const r=await db.prepare("SELECT account_status,count(*) AS count FROM users GROUP BY account_status").all<Record<string,unknown>>();return page("Administration",nav+"<div class='grid grid-cols-1 sm:grid-cols-3'>"+metric("Total accounts",r.results.reduce((n,x)=>n+Number(x.count),0),"All account states","account")+metric("Active accounts",Number(r.results.find(x=>x.account_status==="active")?.count||0),"Can sign in","admin")+metric("Suspended accounts",Number(r.results.find(x=>x.account_status==="suspended")?.count||0),"Access restricted","account")+"</div>"+panel(panelHead("Account status","Current account distribution",action("/admin/users","Manage users"))+table(["Status","Accounts"],r.results.map(x=>[chip(String(x.account_status)),rowValue(x,"count")]))),user);}
  if(path==="/admin/health"&&get){
   const start=performance.now();
   const [counts,runs,devices,accounts]=await db.batch([
    db.prepare("SELECT (SELECT count(*) FROM users WHERE account_status='active') AS accounts,(SELECT count(*) FROM calendars) AS calendars,(SELECT count(*) FROM events WHERE active=1 AND status='confirmed') AS lessons,(SELECT count(*) FROM devices WHERE status='active') AS devices,(SELECT count(*) FROM calendar_tokens WHERE status='active') AS feeds,(SELECT count(*) FROM calendars c JOIN users u ON u.id=c.owner_user_id WHERE u.account_status='active' AND u.sync_enabled=1 AND (c.last_synced_at IS NULL OR julianday(c.last_synced_at)<julianday('now','-1 day'))) AS stale"),
    db.prepare("SELECT status,count(*) AS n FROM sync_runs WHERE julianday(started_at)>=julianday('now','-1 day') GROUP BY status"),
    db.prepare("SELECT u.display_name,d.name,d.last_synced_at,dc.outcome,dc.reason,dc.checked_at FROM devices d JOIN users u ON u.id=d.owner_user_id LEFT JOIN worker_device_checks dc ON dc.device_id=d.id WHERE d.status='active' AND u.account_status='active' ORDER BY dc.checked_at DESC,d.last_synced_at DESC LIMIT 100"),
    db.prepare("SELECT u.display_name,c.last_synced_at,c.revision,(SELECT max(t.last_used_at) FROM calendar_tokens t WHERE t.calendar_id=c.id AND t.status='active') AS last_fetch FROM calendars c JOIN users u ON u.id=c.owner_user_id WHERE u.account_status='active' ORDER BY c.last_synced_at ASC LIMIT 100")
   ]);
   const c=counts.results[0] as Record<string,unknown>,latency=Math.round(performance.now()-start);
   const metrics="<div class='grid grid-cols-2 sm:grid-cols-4'>"+metric("Database","Ready",latency+" ms query batch","sync")+metric("Active accounts",c.accounts,"Calendars: "+c.calendars,"account")+metric("Devices",c.devices,"Feeds: "+c.feeds,"devices")+metric("Stale sync",c.stale,"No sync in 24h","clock")+"</div>";
   return page("System health",nav+metrics+panel(panelHead("Sync runs · last 24h","")+table(["Status","Runs"],(runs.results as Record<string,unknown>[]).map(x=>[chip(String(x.status)),rowValue(x,"n")])))+panel(panelHead("Browser checks","")+table(["User","Device","Last sync","Last check","Outcome"],(devices.results as Record<string,unknown>[]).map(x=>[rowValue(x,"display_name"),rowValue(x,"name"),esc(fmt(x.last_synced_at)),esc(fmt(x.checked_at)),x.outcome?chip(String(x.outcome))+" "+esc(x.reason):"—"])))+panel(panelHead("Calendars","")+table(["User","Revision","Last sync","Last subscription fetch"],(accounts.results as Record<string,unknown>[]).map(x=>[rowValue(x,"display_name"),rowValue(x,"revision"),esc(fmt(x.last_synced_at)),esc(fmt(x.last_fetch))])))+"<p class='text-xs text-muted-foreground'>Live application/database check; not Cloudflare platform uptime. Browser errors appear when a paired device can report them.</p>",user);
  }
  if(path==="/admin/users"&&get){const r=await db.prepare("SELECT id,display_name,email,role,account_status FROM users WHERE account_status<>'deleted' ORDER BY created_at DESC").all<Record<string,unknown>>();return page("Users",nav+panel(advancedTable(["Name","Email","Role","Status","Timetable"],r.results.map(x=>[link("/admin/users/"+encodeURIComponent(String(x.id)),String(x.display_name)),rowValue(x,"email"),rowValue(x,"role"),chip(String(x.account_status)),action("/admin/timetables?user="+encodeURIComponent(String(x.id)),"View timetable")]))),user);}
  if(path==="/admin/timetables"&&get){
   const selected=url.searchParams.get("user");
   const rows=await db.prepare("SELECT u.id AS user_id,u.display_name,u.account_status,c.id AS calendar_id,c.name,c.last_synced_at,(SELECT count(*) FROM events e WHERE e.calendar_id=c.id AND e.active=1 AND e.status='confirmed') AS lessons FROM users u LEFT JOIN calendars c ON c.owner_user_id=u.id WHERE u.account_status<>'deleted' AND (? IS NULL OR u.id=?) ORDER BY u.display_name,c.name").bind(selected,selected).all<Record<string,unknown>>();
   return page("All timetables",nav+panel(panelHead("User timetables","Read-only access to every non-deleted user's timetable.")+advancedTable(["User","Calendar","Status","Active lessons","Last sync",""],rows.results.map(x=>[rowValue(x,"display_name"),rowValue(x,"name"),chip(String(x.account_status)),rowValue(x,"lessons"),esc(fmt(x.last_synced_at)),x.calendar_id?action("/admin/timetables/"+encodeURIComponent(String(x.calendar_id)),"Open timetable"):"—"]))),user);
  }
  const calendarMatch=path.match(/^\/admin\/timetables\/([A-Za-z0-9_-]+)$/);
  if(calendarMatch&&get){
   const c=await db.prepare("SELECT c.id,c.name,u.display_name FROM calendars c JOIN users u ON u.id=c.owner_user_id WHERE c.id=? AND u.account_status<>'deleted'").bind(calendarMatch[1]).first<{id:string;name:string;display_name:string}>();
   if(!c)return page("Not found",nav,user,404);
   return timetablePage(db,url,c.id,user,"User timetable",nav+panel(panelHead(c.display_name,c.name+" · Read only",action("/admin/timetables","All timetables"))),path);
  }
  const targetMatch=path.match(/^\/admin\/users\/([A-Za-z0-9_-]+)$/);
  if(targetMatch){const target=await db.prepare("SELECT * FROM users WHERE id=?").bind(targetMatch[1]).first<User>();if(!target)return page("Not found","",user,404);
   const canManage=target.account_status!=="deleted"&&(target.role==="user"||(user.role==="owner"&&target.role!=="owner"));
   if(mut){
    const f=await form(request),action=f.get("action");
    if(!canManage)return err("FORBIDDEN","Cannot modify this account.",403);
    let statements:D1PreparedStatement[];
    if(action==="update")statements=[db.prepare("UPDATE users SET display_name=?,max_devices=?,sync_enabled=?,feed_enabled=?,updated_at=? WHERE id=?").bind((f.get("display_name")||target.display_name).trim().slice(0,200)||target.display_name,int(f.get("max_devices"),1,50,target.max_devices),f.has("sync_enabled")?1:0,f.has("feed_enabled")?1:0,stamp,target.id)];
    else if(action==="suspend"||action==="activate"){if(user.id===target.id)return err("FORBIDDEN","Cannot change your own account status.",403);statements=[db.prepare("UPDATE users SET account_status=?,suspended_at=?,updated_at=? WHERE id=? AND account_status<>'deleted'").bind(action==="suspend"?"suspended":"active",action==="suspend"?stamp:null,stamp,target.id),db.prepare("DELETE FROM sessions WHERE user_id=?").bind(target.id)];}
    else if(action==="reset_identity"){if(f.get("confirm_name")!==target.display_name)return err("INVALID_REQUEST","Confirmation does not match.");statements=[db.prepare("DELETE FROM source_identities WHERE calendar_id IN (SELECT id FROM calendars WHERE owner_user_id=?)").bind(target.id),db.prepare("UPDATE devices SET status='revoked',revoked_at=? WHERE owner_user_id=? AND status='active'").bind(stamp,target.id),db.prepare("DELETE FROM pairing_codes WHERE owner_user_id=? AND used_at IS NULL").bind(target.id),db.prepare("INSERT INTO worker_sync_versions(calendar_id,generation) SELECT id,1 FROM calendars WHERE owner_user_id=? ON CONFLICT(calendar_id) DO UPDATE SET generation=generation+1").bind(target.id)];}
    else return err("INVALID_REQUEST","Unknown action.");
    await db.batch([...statements,audit(db,user,"user."+action,target.id)]);return redirect(path);
   }
   if(get){const c=await db.prepare("SELECT id,name,revision FROM calendars WHERE owner_user_id=?").bind(target.id).first<{id:string;name:string;revision:number}>();const d=await db.prepare("SELECT name,status,last_synced_at FROM devices WHERE owner_user_id=?").bind(target.id).all<Record<string,unknown>>();
    const controls=canManage?post(path,hidden("action","update")+field("display_name","Name",target.display_name)+field("max_devices","Device limit",String(target.max_devices),"number")+check("sync_enabled","Sync enabled",target.sync_enabled)+check("feed_enabled","Feed enabled",target.feed_enabled)+button("Save"))+post(path,hidden("action",target.account_status==="active"?"suspend":"activate")+button(target.account_status==="active"?"Suspend":"Activate"))+post(path,hidden("action","reset_identity")+field("confirm_name","Confirm name to reset source")+button("Reset source and revoke devices")):"";
    return page(target.display_name,nav+panel("<p>"+esc(target.role)+" · "+esc(target.account_status)+"</p><p>"+esc(c?.name)+"</p>"+controls)+panel(table(["Device","Status","Last sync"],d.results.map(x=>[rowValue(x,"name"),chip(String(x.status)),esc(fmt(x.last_synced_at))]))),user);}
  }
  if(path==="/admin/invitations"){
   if(mut){const f=await form(request),raw=randomToken(),id=crypto.randomUUID(),expiry=new Date(Date.now()+int(f.get("expires_hours"),1,720,72)*3600000).toISOString();await db.batch([db.prepare("INSERT INTO invitations(id,token_hash,created_by,expected_name,note,max_devices,expires_at,created_at) VALUES (?,?,?,?,?,?,?,?)").bind(id,await hashToken(pepper,"invite",raw),user.id,(f.get("expected_name")||"").slice(0,200)||null,(f.get("note")||"").slice(0,1000)||null,int(f.get("max_devices"),1,50,3),expiry,stamp),audit(db,user,"invitation.create",null)]);return page("Invitation created",nav+panel("<p>Copy now:</p><code>"+esc(url.origin+"/invite?token="+raw)+"</code>"),user);}
   if(get){const r=await db.prepare("SELECT id,expected_name,expires_at,used_at FROM invitations ORDER BY created_at DESC LIMIT 100").all<Record<string,unknown>>();return page("Invitations",nav+panel(post(path,field("expected_name","Name")+field("note","Note")+field("expires_hours","Expiry hours","72","number")+field("max_devices","Device limit","3","number")+button("Create invitation")))+panel(table(["Name","Expires","Used","Action"],r.results.map(x=>[rowValue(x,"expected_name"),esc(fmt(x.expires_at)),esc(fmt(x.used_at)),x.used_at?"":post("/admin/invitations/"+encodeURIComponent(String(x.id))+"/delete",button("Delete"))]))),user);}
  }
  const del=path.match(/^\/admin\/invitations\/([A-Za-z0-9_-]+)\/delete$/);if(mut&&del){requireOrigin(request);await db.batch([db.prepare("DELETE FROM invitations WHERE id=? AND used_at IS NULL").bind(del[1]),audit(db,user,"invitation.delete",null)]);return redirect("/admin/invitations");}
  if(path==="/admin/audit"&&get){const r=await db.prepare("SELECT actor_type,action,created_at FROM audit_logs ORDER BY created_at DESC LIMIT 100").all<Record<string,unknown>>();return page("Audit",nav+panel(table(["When","Actor","Action"],r.results.map(x=>[esc(fmt(x.created_at)),rowValue(x,"actor_type"),rowValue(x,"action")]))),user);}
  return new Response(null,{status:404});
 }
 const cal=await calendarFor(db,user);
 if(path==="/api/v2/me/search"&&get){
  const q=(url.searchParams.get("q")||"").trim().slice(0,100);
  if(q.length<2)return json({results:[]});
  const pref=await preferences(db,cal.id),needle=q.toLowerCase();
  const aliases=pref.courses.filter(r=>r.name.toLowerCase().includes(needle)).map(r=>r.key);
  const r=await db.prepare("SELECT "+scheduleColumns+" FROM events WHERE calendar_id=? AND active=1 AND status='confirmed' AND (instr(lower(title||' '||coalesce(course_code,'')||' '||coalesce(teacher,'')||' '||coalesce(room,'')||' '||local_date),lower(?))>0 OR (CASE WHEN coalesce(course_code,'')<>'' THEN 'code:'||course_code ELSE 'title:'||title END) IN (SELECT value FROM json_each(?))) ORDER BY CASE WHEN local_date>=? THEN 0 ELSE 1 END,local_date,starts_at_utc LIMIT 60").bind(cal.id,q,JSON.stringify(aliases),todaySydney()).all<Record<string,unknown>>();
  return json({results:r.results.map(x=>displayLesson(pref,x)).filter(x=>!x.ui_hidden).slice(0,30).map(x=>({title:x.title,room:x.room,teacher:x.teacher,date:x.local_date,href:scheduleLink(String(x.local_date),String(x.local_date),"day")}))});
 }
 if(path==="/app/account/export"&&get){
  const r=await db.prepare("SELECT "+scheduleColumns+",status,active,sequence FROM events WHERE calendar_id=? ORDER BY local_date,starts_at_utc LIMIT 10001").bind(cal.id).all<Record<string,unknown>>();
  if(r.results.length>10000)return err("EXPORT_TOO_LARGE","Export exceeds 10000 events; contact the administrator.",413);
  return new Response(JSON.stringify({version:1,exportedAt:stamp,calendar:{name:cal.name,revision:cal.revision},preferences:await preferences(db,cal.id),events:r.results},null,2),{headers:{"Content-Type":"application/json; charset=utf-8","Content-Disposition":"attachment; filename=seqta-timetable.json","Cache-Control":"no-store","X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer"}});
 }
 if((path==="/app/"||path==="/app/dashboard")&&get)return redirect("/app/timetable");
 if(path==="/app/timetable"&&get)return timetablePage(db,url,cal.id,user,"Timetable");
 if(path==="/app/calendar"&&get)return settingsPage(db,pepper,user,cal,url.origin);
 if(path==="/app/calendar/create"&&mut){
  const f=await form(request),name=f.get("label");
  if(name===null)await ensureSubscription(db,pepper,user,cal);else await createNamedSubscription(db,pepper,user,cal,name);
  return redirect("/app/calendar");
 }
 const subscriptionMatch=path.match(/^\/app\/calendar\/subscriptions\/([A-Za-z0-9_-]+)\/(rename|revoke)$/);
 if(subscriptionMatch&&mut){
  const f=await form(request),id=subscriptionMatch[1];
  if(subscriptionMatch[2]==="rename")await renameSubscription(db,user,cal,id,f.get("label")||"");
  else{if(f.get("confirm")!=="revoke")return err("INVALID_REQUEST","Explicit revoke confirmation required.");await revokeSubscription(db,user,cal,id);}
  return redirect("/app/calendar");
 }
 if((path==="/app/calendar/rotate"||path==="/app/calendar")&&mut){const f=await form(request);if(f.get("confirm")!=="rotate"||!user.feed_enabled)return err("FORBIDDEN","Explicit rotation confirmation required.",403);const tokenId=managedId(),raw=await managedRaw(pepper,cal.id,tokenId),guard=crypto.randomUUID();await db.batch([
  db.prepare("INSERT INTO worker_sync_guard(id,ok) SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM users WHERE id=? AND account_status='active' AND feed_enabled=1) THEN 1 ELSE 0 END").bind(guard,user.id),
  db.prepare("UPDATE calendar_tokens SET status='revoked',revoked_at=? WHERE calendar_id=? AND status='active'").bind(stamp,cal.id),
  db.prepare("INSERT INTO calendar_tokens(id,calendar_id,token_hash,token_prefix,created_at) VALUES (?,?,?,?,?)").bind(tokenId,cal.id,await hashToken(pepper,"calendar",raw),raw.slice(0,12),stamp),
  db.prepare("DELETE FROM worker_sync_guard WHERE id=?").bind(guard)
 ]);return redirect("/app/calendar");}
 if(path==="/app/devices"&&get)return settingsPage(db,pepper,user,cal,url.origin);
 if((path==="/app/devices/pairing-codes"||path==="/api/v2/me/pairing-codes")&&mut){requireOrigin(request);const result=await createPairing(db,pepper,user,cal);return path.startsWith("/api/")?json(result):page("Pairing code",panel("<div class='secret-box'>"+esc(result.code)+"</div><p>Expires in 10 minutes. Do not share this code.</p>"+action("/app/account#account","Back to settings")),user);}
 const revoke=path.match(/^\/app\/devices\/([A-Za-z0-9_-]+)\/revoke$/),apiRevoke=path.match(/^\/api\/v2\/me\/devices\/([A-Za-z0-9_-]+)$/);
 if((mut&&revoke)||(method==="DELETE"&&apiRevoke)){requireOrigin(request);const id=(revoke||apiRevoke)![1];const result=await db.prepare("UPDATE devices SET status='revoked',revoked_at=? WHERE id=? AND owner_user_id=?").bind(stamp,id,user.id).run();if(result.meta.changes!==1)return err("NOT_FOUND","Device not found.",404);return apiRevoke?json({ok:true}):redirect("/app/devices");}
 const codeDel=path.match(/^\/app\/devices\/pairing-codes\/([A-Za-z0-9_-]+)\/delete$/);if(mut&&codeDel){requireOrigin(request);await db.prepare("DELETE FROM pairing_codes WHERE id=? AND owner_user_id=? AND used_at IS NULL").bind(codeDel[1],user.id).run();return redirect("/app/devices");}
 if(path==="/app/sync-history"&&get)return settingsPage(db,pepper,user,cal,url.origin);
 if(path==="/app/account"){
  if(get)return settingsPage(db,pepper,user,cal,url.origin);
  if(mut){const f=await form(request);if(f.get("action")==="display"){await savePreferences(db,cal.id,user.id,updatePrefs(await preferences(db,cal.id),f));return redirect(path+"?notice=saved");}if(f.get("action")==="course"){const key=f.get("course")||"";const rows=await db.prepare("SELECT course_code,title FROM events WHERE calendar_id=? AND active=1 AND status='confirmed' AND (CASE WHEN course_code IS NOT NULL AND course_code<>'' THEN 'code:'||course_code ELSE 'title:'||title END)=? LIMIT 1").bind(cal.id,key).first<Record<string,unknown>>();if(!rows)return err("NOT_FOUND","Course not found.",404);await savePreferences(db,cal.id,user.id,updateCourse(await preferences(db,cal.id),f,courseKey(rows)));return redirect(path+"?notice=saved");}if(f.get("action")==="preferences"){const name=(f.get("calendar_name")||"").trim().slice(0,200);if(!name)return err("INVALID_REQUEST","Calendar name required.");await db.prepare("UPDATE calendars SET name=?,revision=revision+1,last_changed_at=?,updated_at=? WHERE id=? AND name<>?").bind(name,stamp,stamp,cal.id,name).run();return redirect(path);}
   if(f.get("action")==="password"){await rateLimit(db,pepper,request,"password",user.id);if(!checkPassword(f.get("current_password")||"",user.password_hash))return err("UNAUTHORIZED","Current password incorrect.",401);const hash=passwordHash(f.get("new_password")||"");await db.batch([db.prepare("UPDATE users SET password_hash=?,updated_at=? WHERE id=? AND password_hash=? AND account_status='active'").bind(hash,stamp,user.id,user.password_hash),db.prepare("DELETE FROM sessions WHERE user_id=?").bind(user.id)]);return redirect("/app/login",clearCookie);}
  }
 }
 return new Response(null,{status:404});
}
