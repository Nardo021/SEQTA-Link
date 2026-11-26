import { preferences, savePreferences, updatePrefs, updateCourse, courseKey, displayLesson, schoolContext, potentialFree, type SchoolDay } from "./school";
import { liveDay, schoolBadge, statsPanel, lessonSheet, preferencesPanel } from "./daily-ui";
import { ApiError, nowIso } from "./common";
import { hashToken } from "./compat";
import { managedId, managedRaw, managedSubscription, ensureSubscription, subscriptions, createNamedSubscription, renameSubscription, revokeSubscription } from "./subscription";
import { calendarFor, checkPassword, clearCookie, createPairing, currentUser, err, form, isAdmin, login, passwordHash, randomToken, register, requireOrigin, revokeSession, sessionCookie, rateLimit, type User } from "./auth";
import { esc, button, post, hidden, field, check, link, panel, page, table, fmt, action, chip, metric, panelHead, empty, todaySydney, shiftDate, weekStart, validDate, agenda, timeline, timetableControls, dayCount, notice, scheduleLink, subscriptionPanel } from "./ui";
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
 const until=url.searchParams.get("until")||(requestedView==="day"?from:shiftDate(from,6));
 if(!validDate(until)||from>until||dayCount(from,until)>120)return err("INVALID_DATE_RANGE","Choose up to 120 days.");
 const span=dayCount(from,until),view:"week"|"day"|"agenda"=requestedView==="agenda"||span>7?"agenda":span===1?"day":"week";
 const mon=weekStart(from),last=shiftDate(mon,6),histFrom=shiftDate(mon,-21),histUntil=shiftDate(mon,27);
 const [r,history,days,todayRows]=await Promise.all([
  eventsBetween(db,calendarId,from,until),
  eventsBetween(db,calendarId,histFrom,histUntil,2501),
  db.prepare("SELECT local_date,week_label,term_label,holiday_label,checked_at FROM worker_school_days WHERE calendar_id=? AND local_date BETWEEN ? AND ? ORDER BY local_date").bind(calendarId,from<mon?from:mon,until>last?until:last).all<SchoolDay>(),
  own?eventsBetween(db,calendarId,today,shiftDate(today,7),301):Promise.resolve(null)
 ]);
 const raw=r.results.slice(0,500),hist=history.results.slice(0,2500),weekRows=hist.filter(x=>String(x.local_date)>=mon&&String(x.local_date)<=last),display=own?raw.map(x=>displayLesson(p,x)).filter(x=>!x.ui_hidden):raw;
 const free=Object.fromEntries(Array.from({length:Math.min(span,7)},(_,i)=>shiftDate(from,i)).map(date=>[date,potentialFree(hist,date,p,days.results)]));
 const calendarDays=Object.fromEntries(Array.from({length:Math.min(span,120)},(_,i)=>shiftDate(from,i)).map(date=>[date,schoolContext(date,p,days.results)]));
 return page(title,prefix+(own&&todayRows?liveDay(todayRows.results,p,base):"")+timetableControls(from,until,view,today,base)+schoolBadge(from,p,days.results,hist)+(r.results.length>500?notice("Showing the first 500 lessons. Choose a shorter date range."):"")+(view==="agenda"?agenda(display,today,own?p.hour:"24"):timeline(display,from,until,view,new Date(),base,own?p.hour:"24",free,calendarDays,own&&p.locate))+statsPanel(weekRows,own?p:{...p,courses:[]},from)+lessonSheet(),user);
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
  if(mut){const f=await form(request);return redirect("/app/dashboard",sessionCookie(await register(db,pepper,secret,request,token,f)));}
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
   return page("System health",nav+metrics+panel(panelHead("Sync runs · last 24h","")+table(["Status","Runs"],runs.results.map(x=>[chip(String(x.status)),rowValue(x,"n")])))+panel(panelHead("Browser checks","")+table(["User","Device","Last sync","Last check","Outcome"],devices.results.map(x=>[rowValue(x,"display_name"),rowValue(x,"name"),esc(fmt(x.last_synced_at)),esc(fmt(x.checked_at)),x.outcome?chip(String(x.outcome))+" "+esc(x.reason):"—"])))+panel(panelHead("Calendars","")+table(["User","Revision","Last sync","Last subscription fetch"],accounts.results.map(x=>[rowValue(x,"display_name"),rowValue(x,"revision"),esc(fmt(x.last_synced_at)),esc(fmt(x.last_fetch))])))+"<p class='text-xs text-muted-foreground'>Live application/database check; not Cloudflare platform uptime. Browser errors appear when a paired device can report them.</p>",user);
  }
  if(path==="/admin/users"&&get){const r=await db.prepare("SELECT id,display_name,email,role,account_status FROM users WHERE account_status<>'deleted' ORDER BY created_at DESC").all<Record<string,unknown>>();return page("Users",nav+panel(table(["Name","Email","Role","Status","Timetable"],r.results.map(x=>[link("/admin/users/"+encodeURIComponent(String(x.id)),String(x.display_name)),rowValue(x,"email"),rowValue(x,"role"),chip(String(x.account_status)),action("/admin/timetables?user="+encodeURIComponent(String(x.id)),"View timetable")]))),user);}
  if(path==="/admin/timetables"&&get){
   const selected=url.searchParams.get("user");
   const rows=await db.prepare("SELECT u.id AS user_id,u.display_name,u.account_status,c.id AS calendar_id,c.name,c.last_synced_at,(SELECT count(*) FROM events e WHERE e.calendar_id=c.id AND e.active=1 AND e.status='confirmed') AS lessons FROM users u LEFT JOIN calendars c ON c.owner_user_id=u.id WHERE u.account_status<>'deleted' AND (? IS NULL OR u.id=?) ORDER BY u.display_name,c.name").bind(selected,selected).all<Record<string,unknown>>();
   return page("All timetables",nav+panel(panelHead("User timetables","Read-only access to every non-deleted user's timetable.")+table(["User","Calendar","Status","Active lessons","Last sync",""],rows.results.map(x=>[rowValue(x,"display_name"),rowValue(x,"name"),chip(String(x.account_status)),rowValue(x,"lessons"),esc(fmt(x.last_synced_at)),x.calendar_id?action("/admin/timetables/"+encodeURIComponent(String(x.calendar_id)),"Open timetable"):"—"]))),user);
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
 if((path==="/app/"||path==="/app/dashboard")&&get){
  const today=todaySydney(),start=weekStart(today),end=shiftDate(start,6);
  const [totals,week,next,devices]=await db.batch([
   db.prepare("SELECT count(*) AS n FROM events WHERE calendar_id=? AND active=1 AND status='confirmed'").bind(cal.id),
   db.prepare("SELECT count(*) AS n FROM events WHERE calendar_id=? AND active=1 AND status='confirmed' AND local_date BETWEEN ? AND ?").bind(cal.id,start,end),
   db.prepare("SELECT id,local_date,period_key,course_code,title,starts_at_utc,ends_at_utc,teacher,room,description FROM events WHERE calendar_id=? AND active=1 AND status='confirmed' AND starts_at_utc>=? ORDER BY starts_at_utc LIMIT 8").bind(cal.id,stamp),
   db.prepare("SELECT count(*) AS n FROM devices WHERE owner_user_id=? AND status='active'").bind(user.id)
  ]);
  const value=(x:D1Result)=>Number((x.results[0] as {n:number}|undefined)?.n||0);
  const cards="<div class='grid grid-cols-1 sm:grid-cols-3'>"+metric("This week",value(week),"Scheduled lessons","timetable")+metric("Connected devices",value(devices),"of "+user.max_devices+" allowed","devices")+metric("Calendar revision",cal.revision,value(totals)+" active events","sync")+"</div>";
  const connection=panel(panelHead(cal.name,"Calendar connection and last sync",action("/app/calendar","Manage calendar"))+"<div class='panel-head'><div>"+chip(user.sync_enabled?"enabled":"disabled")+"<small>Sync permission</small></div><div>"+chip(user.feed_enabled?"enabled":"disabled")+"<small>Calendar feed</small></div><div><strong>"+esc(fmt(cal.last_synced_at))+"</strong><small>Last successful sync</small></div></div>");
  const pref=await preferences(db,cal.id),todayRows=await eventsBetween(db,cal.id,today,shiftDate(today,7),301);
  return page("Dashboard",liveDay(todayRows.results,pref)+cards+connection+panelHead("Upcoming lessons","Your next scheduled classes",action("/app/timetable","Open timetable"))+agenda(next.results.map(r=>displayLesson(pref,r as Record<string,unknown>)).filter(r=>!r.ui_hidden),today,pref.hour)+lessonSheet(),user);
 }
 if(path==="/app/timetable"&&get)return timetablePage(db,url,cal.id,user,"Timetable");
 if(path==="/app/calendar"&&get){
  const links=await subscriptions(db,pepper,cal.id,!!user.feed_enabled);
  return page("Calendar subscription",subscriptionPanel(url.origin,links,!!user.feed_enabled,fmt(cal.last_synced_at)),user);
 }
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
 if(path==="/app/devices"&&get){const r=await db.prepare("SELECT id,name,status,last_synced_at FROM devices WHERE owner_user_id=? ORDER BY created_at DESC").bind(user.id).all<Record<string,unknown>>(),codes=await db.prepare("SELECT id,expires_at FROM pairing_codes WHERE owner_user_id=? AND used_at IS NULL AND julianday(expires_at)>julianday('now')").bind(user.id).all<Record<string,unknown>>();return page("Devices",panel(panelHead("Connected browsers","Pair a new browser or revoke an existing device.")+post("/app/devices/pairing-codes",button("Generate pairing code"))+table(["Device","Status","Last sync","Action"],r.results.map(x=>[rowValue(x,"name"),rowValue(x,"status"),esc(fmt(x.last_synced_at)),x.status==="active"?post("/app/devices/"+encodeURIComponent(String(x.id))+"/revoke",button("Revoke")):""])))+panel(panelHead("Pending pairing codes","Single-use codes expire after 10 minutes.")+table(["Pending code expires","Action"],codes.results.map(x=>[esc(fmt(x.expires_at)),post("/app/devices/pairing-codes/"+encodeURIComponent(String(x.id))+"/delete",button("Delete"))]))),user);}
 if((path==="/app/devices/pairing-codes"||path==="/api/v2/me/pairing-codes")&&mut){requireOrigin(request);const result=await createPairing(db,pepper,user,cal);return path.startsWith("/api/")?json(result):page("Pairing code",panel(panelHead("Connect a browser","Enter this single-use code in the SEQTA userscript.")+"<div class='secret-box'>"+esc(result.code)+"</div><p>Expires in 10 minutes. Do not share this code.</p>"+action("/app/devices","Back to devices")),user);}
 const revoke=path.match(/^\/app\/devices\/([A-Za-z0-9_-]+)\/revoke$/),apiRevoke=path.match(/^\/api\/v2\/me\/devices\/([A-Za-z0-9_-]+)$/);
 if((mut&&revoke)||(method==="DELETE"&&apiRevoke)){requireOrigin(request);const id=(revoke||apiRevoke)![1];const result=await db.prepare("UPDATE devices SET status='revoked',revoked_at=? WHERE id=? AND owner_user_id=?").bind(stamp,id,user.id).run();if(result.meta.changes!==1)return err("NOT_FOUND","Device not found.",404);return apiRevoke?json({ok:true}):redirect("/app/devices");}
 const codeDel=path.match(/^\/app\/devices\/pairing-codes\/([A-Za-z0-9_-]+)\/delete$/);if(mut&&codeDel){requireOrigin(request);await db.prepare("DELETE FROM pairing_codes WHERE id=? AND owner_user_id=? AND used_at IS NULL").bind(codeDel[1],user.id).run();return redirect("/app/devices");}
 if(path==="/app/sync-history"&&get){const r=await db.prepare("SELECT * FROM sync_runs WHERE calendar_id=? ORDER BY started_at DESC LIMIT 50").bind(cal.id).all<Record<string,unknown>>();return page("Sync history",panel(panelHead("Recent sync runs","Showing the latest 50 runs.")+runTable(r.results)),user);}
 if(path==="/app/account"){
  if(get){const p=await preferences(db,cal.id),courses=await db.prepare("SELECT course_code,min(title) AS title FROM events WHERE calendar_id=? AND active=1 AND status='confirmed' GROUP BY COALESCE(NULLIF(course_code,''),title),course_code ORDER BY title LIMIT 100").bind(cal.id).all<Record<string,unknown>>();return page("Account",preferencesPanel(p,courses.results)+panel(panelHead("Calendar preferences","Choose the display name of your timetable.")+post(path,hidden("action","preferences")+field("calendar_name","Calendar name",cal.name)+button("Save")))+panel(panelHead("Password","Change your password. Other sessions will be signed out.")+post(path,hidden("action","password")+field("current_password","Current password","","password")+field("new_password","New password","","password")+button("Change password"))),user);}
  if(mut){const f=await form(request);if(f.get("action")==="display"){await savePreferences(db,cal.id,user.id,updatePrefs(await preferences(db,cal.id),f));return redirect(path);}if(f.get("action")==="course"){const key=f.get("course")||"";const rows=await db.prepare("SELECT course_code,title FROM events WHERE calendar_id=? AND active=1 AND status='confirmed' AND (CASE WHEN course_code IS NOT NULL AND course_code<>'' THEN 'code:'||course_code ELSE 'title:'||title END)=? LIMIT 1").bind(cal.id,key).first<Record<string,unknown>>();if(!rows)return err("NOT_FOUND","Course not found.",404);await savePreferences(db,cal.id,user.id,updateCourse(await preferences(db,cal.id),f,courseKey(rows)));return redirect(path);}if(f.get("action")==="preferences"){const name=(f.get("calendar_name")||"").trim().slice(0,200);if(!name)return err("INVALID_REQUEST","Calendar name required.");await db.prepare("UPDATE calendars SET name=?,revision=revision+1,last_changed_at=?,updated_at=? WHERE id=? AND name<>?").bind(name,stamp,stamp,cal.id,name).run();return redirect(path);}
   if(f.get("action")==="password"){await rateLimit(db,pepper,request,"password",user.id);if(!checkPassword(f.get("current_password")||"",user.password_hash))return err("UNAUTHORIZED","Current password incorrect.",401);const hash=passwordHash(f.get("new_password")||"");await db.batch([db.prepare("UPDATE users SET password_hash=?,updated_at=? WHERE id=? AND password_hash=? AND account_status='active'").bind(hash,stamp,user.id,user.password_hash),db.prepare("DELETE FROM sessions WHERE user_id=?").bind(user.id)]);return redirect("/app/login",clearCookie);}
  }
 }
 return new Response(null,{status:404});
}
