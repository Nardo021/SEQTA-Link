import { utcDate, sydneyParts, nowIso } from "./common";
import { hashToken } from "./compat";
import { classifyClient } from "./subscription";
type Feed={id:string;name:string;timezone:string;revision:number;account_status:string;feed_enabled:number;last_changed_at:string|null;updated_at:string;token_status:string};
export type StoredEvent={id:string;owner_user_id:string;calendar_id:string;natural_key:string;ical_uid:string;local_date:string;period_key:string;course_code:string|null;title:string;starts_at_utc:string;ends_at_utc:string;timezone:string;teacher:string|null;room:string|null;description:string|null;event_type:string;content_hash:string;sequence:number;status:string;active:number;created_at:string;updated_at:string;deleted_at:string|null};
const esc=(s:string)=>s.replace(/\\/g,"\\\\").replace(/\r\n|\r|\n/g,"\\n").replace(/,/g,"\\,").replace(/;/g,"\\;");
const utc=(s:string)=>utcDate(s).toISOString().replace(/[-:]/g,"").replace(/\.\d{3}Z$/,"Z");
function local(s:string,tz:string){const p=sydneyParts(utcDate(s),tz);return p.year+p.month+p.day+"T"+p.hour+p.minute+p.second;}
function fold(line:string):string{
  const encoder=new TextEncoder();let out="",current="",size=0;
  for(const c of line){const n=encoder.encode(c).length;if(size+n>75){out+=current+"\r\n";current=" ";size=1;}current+=c;size+=n;}
  return out+current;
}
const tzlines=["BEGIN:VTIMEZONE","TZID:Australia/Sydney","BEGIN:STANDARD","TZOFFSETFROM:+1100","TZOFFSETTO:+1000","TZNAME:AEST","DTSTART:19700405T030000","RRULE:FREQ=YEARLY;BYMONTH=4;BYDAY=1SU","END:STANDARD","BEGIN:DAYLIGHT","TZOFFSETFROM:+1000","TZOFFSETTO:+1100","TZNAME:AEDT","DTSTART:19701004T020000","RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=1SU","END:DAYLIGHT","END:VTIMEZONE"];
export async function calendarFeed(db:D1Database,pepper:Uint8Array,raw:string,request:Request):Promise<Response>{
  if(!/^sl_cal_[A-Za-z0-9_-]+$/.test(raw)||raw.length>100)return new Response(null,{status:404});
  const hash=await hashToken(pepper,"calendar",raw);
  const stamp=nowIso(),client=classifyClient(request.headers.get("User-Agent"));
  const tags=(request.headers.get("If-None-Match")||"").slice(0,8192).split(",").map(v=>v.trim().replace(/^W\//,"")).filter(Boolean);
  const batch=await db.batch([
    db.prepare("SELECT c.*,u.account_status,u.feed_enabled,t.status AS token_status FROM calendar_tokens t JOIN calendars c ON c.id=t.calendar_id JOIN users u ON u.id=c.owner_user_id WHERE t.token_hash=? AND t.status='active'").bind(hash),
    db.prepare("UPDATE calendar_tokens SET last_used_at=? WHERE token_hash=? AND status='active' AND EXISTS(SELECT 1 FROM calendars c JOIN users u ON u.id=c.owner_user_id WHERE c.id=calendar_tokens.calendar_id AND u.account_status='active' AND u.feed_enabled=1)").bind(stamp,hash),
    db.prepare("SELECT e.* FROM events e JOIN calendar_tokens t ON t.calendar_id=e.calendar_id JOIN calendars c ON c.id=e.calendar_id JOIN users u ON u.id=c.owner_user_id WHERE t.token_hash=? AND t.status='active' AND u.account_status='active' AND u.feed_enabled=1 AND e.active=1 AND e.status='confirmed' AND NOT EXISTS(SELECT 1 FROM json_each(?) j WHERE j.value='*' OR j.value='\"calendar-v3-'||c.revision||'\"') ORDER BY e.starts_at_utc,e.ical_uid").bind(hash,JSON.stringify(tags)),
    db.prepare("INSERT INTO calendar_subscription_clients(token_id,client,first_seen_at,last_seen_at,fetch_count) SELECT t.id,?,?,?,1 FROM calendar_tokens t JOIN calendars c ON c.id=t.calendar_id JOIN users u ON u.id=c.owner_user_id WHERE t.token_hash=? AND t.status='active' AND u.account_status='active' AND u.feed_enabled=1 ON CONFLICT(token_id,client) DO UPDATE SET last_seen_at=excluded.last_seen_at,fetch_count=calendar_subscription_clients.fetch_count+1").bind(client,stamp,stamp,hash)
  ]);
  const f=batch[0].results[0] as Feed|undefined;
  if(!f)return new Response(null,{status:404});
  if(f.account_status!=="active"||f.feed_enabled!==1)return new Response("Calendar feed is disabled.",{status:410});
  // Version the representation: existing subscribers must fetch a fresh active-only snapshot even without a timetable revision change.
  const etag='"calendar-v3-'+f.revision+'"';
  const headers={"Cache-Control":"private, no-cache, max-age=0, must-revalidate","ETag":etag,"Last-Modified":utcDate(f.last_changed_at||f.updated_at).toUTCString()};
  if(tags.some(v=>v===etag||v==="*"))return new Response(null,{status:304,headers});
  const lines=["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//Leoze//Seqta Link//EN","CALSCALE:GREGORIAN","METHOD:PUBLISH","X-WR-CALNAME:"+esc(f.name),"X-WR-TIMEZONE:"+esc(f.timezone),"REFRESH-INTERVAL;VALUE=DURATION:PT15M","X-PUBLISHED-TTL:PT15M",...tzlines];
  for(const e of batch[2].results as StoredEvent[]){
    const period=e.period_key.split("-").map(x=>x.charAt(0).toUpperCase()+x.slice(1)).join("-");
    const description=[e.teacher?"Teacher: "+e.teacher:"","Period: "+period,e.course_code?"Class: "+e.course_code:"",e.description||""].filter(Boolean).join("\n");
    lines.push("BEGIN:VEVENT","UID:"+esc(e.ical_uid),"DTSTAMP:"+utc(e.updated_at),"CREATED:"+utc(e.created_at),"LAST-MODIFIED:"+utc(e.updated_at),"SEQUENCE:"+e.sequence,"DTSTART;TZID="+f.timezone+":"+local(e.starts_at_utc,f.timezone),"DTEND;TZID="+f.timezone+":"+local(e.ends_at_utc,f.timezone),"SUMMARY:"+esc(e.title+(e.room?.trim()?" "+e.room.trim():"")));
    if(e.room)lines.push("LOCATION:"+esc(e.room));
    lines.push("DESCRIPTION:"+esc(description),"STATUS:CONFIRMED","TRANSP:OPAQUE","END:VEVENT");
  }
  lines.push("END:VCALENDAR","");
  return new Response(lines.map(fold).join("\r\n"),{headers:{...headers,"Content-Type":"text/calendar; charset=utf-8"}});
}
