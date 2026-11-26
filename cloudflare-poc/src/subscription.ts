import { hashToken } from "./compat";
import { nowIso, ApiError } from "./common";
import type { Calendar, User } from "./auth";
const err=(code:string,message:string,status=400):never=>{throw new ApiError(code,message,status);};
// Domain-separated HMAC with random token row ID. Raw token is never stored.
export const managedId=()=> "ui-v1-"+crypto.randomUUID();
export const managedRaw=async(pepper:Uint8Array,calendarId:string,id:string)=>"sl_cal_"+await hashToken(pepper,"calendar","copyable:v1:"+JSON.stringify([calendarId,id]));
export async function managedSubscription(db:D1Database,pepper:Uint8Array,calendarId:string){
 const t=await db.prepare("SELECT id,token_hash FROM calendar_tokens WHERE calendar_id=? AND status='active' AND id LIKE 'ui-v1-%' ORDER BY created_at DESC,id DESC LIMIT 1").bind(calendarId).first<{id:string;token_hash:string}>();
 if(!t)return null;
 const raw=await managedRaw(pepper,calendarId,t.id);
 if(await hashToken(pepper,"calendar",raw)!==t.token_hash)return err("UNAVAILABLE","Subscription configuration does not match.",503);
 return raw;
}
export async function ensureSubscription(db:D1Database,pepper:Uint8Array,user:User,calendar:Calendar){
 if(!user.feed_enabled)return err("FORBIDDEN","Calendar feed is disabled.",403);
 const existing=await managedSubscription(db,pepper,calendar.id);if(existing)return existing;
 const id=managedId(),raw=await managedRaw(pepper,calendar.id,id);
 await db.prepare("INSERT INTO calendar_tokens(id,calendar_id,token_hash,token_prefix,created_at) SELECT ?,c.id,?,?,? FROM calendars c JOIN users u ON u.id=c.owner_user_id WHERE c.id=? AND u.id=? AND u.account_status='active' AND u.feed_enabled=1 AND NOT EXISTS(SELECT 1 FROM calendar_tokens t WHERE t.calendar_id=c.id AND t.status='active' AND t.id LIKE 'ui-v1-%')").bind(id,await hashToken(pepper,"calendar",raw),raw.slice(0,12),nowIso(),calendar.id,user.id).run();
 const result=await managedSubscription(db,pepper,calendar.id);if(!result)return err("FORBIDDEN","Calendar feed is disabled.",403);
 return result;
}

export type SubscriptionClient={client:string;first_seen_at:string;last_seen_at:string;fetch_count:number};
export type SubscriptionLink={id:string;label:string;raw:string|null;prefix:string;createdAt:string;lastUsedAt:string|null;clients:SubscriptionClient[]};
export function classifyClient(userAgent:string|null){
 const ua=(userAgent||"").slice(0,512);
 if(!ua)return "unknown";
 if(/google(calendar| calendar|bot)|google-ical/i.test(ua))return "google";
 if(/outlook|microsoft office|exchange|microsoft.*calendar/i.test(ua))return "outlook";
 if(/apple.*calendar|calendaragent|dataaccessd|ical\/|calendarstore|calendar\/[0-9]|apple.*ical/i.test(ua))return "apple";
 if(/thunderbird|lightning/i.test(ua))return "thunderbird";
 if(/caldav|icalendar|calendar/i.test(ua))return "calendar";
 if(/mozilla\/|chrome\/|safari\/|firefox\/|edg\//i.test(ua))return "browser";
 return "other";
}
export async function subscriptions(db:D1Database,pepper:Uint8Array,calendarId:string,enabled:boolean):Promise<SubscriptionLink[]>{
 const [links,clients]=await db.batch([
  db.prepare("SELECT t.id,t.token_hash,t.token_prefix,t.created_at,t.last_used_at,m.label FROM calendar_tokens t LEFT JOIN calendar_subscription_meta m ON m.token_id=t.id WHERE t.calendar_id=? AND t.status='active' ORDER BY CASE WHEN t.id LIKE 'ui-v1-%' THEN 0 ELSE 1 END,t.created_at DESC,t.id DESC").bind(calendarId),
  db.prepare("SELECT a.token_id,a.client,a.first_seen_at,a.last_seen_at,a.fetch_count FROM calendar_subscription_clients a JOIN calendar_tokens t ON t.id=a.token_id WHERE t.calendar_id=? AND t.status='active' ORDER BY a.last_seen_at DESC").bind(calendarId)
 ]);
 const byToken=new Map<string,SubscriptionClient[]>();
 for(const c of clients.results as (SubscriptionClient&{token_id:string})[]){const list=byToken.get(c.token_id)||[];list.push({client:c.client,first_seen_at:c.first_seen_at,last_seen_at:c.last_seen_at,fetch_count:c.fetch_count});byToken.set(c.token_id,list);}
 return Promise.all((links.results as {id:string;token_hash:string;token_prefix:string;created_at:string;last_used_at:string|null;label:string|null}[]).map(async t=>{
  const managed=t.id.startsWith("ui-v1-"),raw=managed&&enabled?await managedRaw(pepper,calendarId,t.id):null;
  if(raw&&await hashToken(pepper,"calendar",raw)!==t.token_hash)return err("UNAVAILABLE","Subscription configuration does not match.",503);
  return {id:t.id,label:t.label||(managed?"Calendar subscription":"Legacy subscription"),raw,prefix:t.token_prefix,createdAt:t.created_at,lastUsedAt:t.last_used_at,clients:byToken.get(t.id)||[]};
 }));
}
export async function createNamedSubscription(db:D1Database,pepper:Uint8Array,user:User,calendar:Calendar,name:string){
 const label=name.trim();if(!label||label.length>80)return err("INVALID_REQUEST","Enter a name of 1–80 characters.");
 if(!user.feed_enabled)return err("FORBIDDEN","Calendar feed is disabled.",403);
 const id=managedId(),raw=await managedRaw(pepper,calendar.id,id);
 const results=await db.batch([
  db.prepare("INSERT INTO calendar_tokens(id,calendar_id,token_hash,token_prefix,created_at) SELECT ?,c.id,?,?,? FROM calendars c JOIN users u ON u.id=c.owner_user_id WHERE c.id=? AND u.id=? AND u.account_status='active' AND u.feed_enabled=1 AND (SELECT count(*) FROM calendar_tokens t WHERE t.calendar_id=c.id AND t.status='active' AND t.id LIKE 'ui-v1-%')<20").bind(id,await hashToken(pepper,"calendar",raw),raw.slice(0,12),nowIso(),calendar.id,user.id),
  db.prepare("INSERT INTO calendar_subscription_meta(token_id,label) SELECT id,? FROM calendar_tokens WHERE id=? AND calendar_id=?").bind(label,id,calendar.id)
 ]);
 if(results[0].meta.changes!==1||results[1].meta.changes!==1)return err("FORBIDDEN","Subscription limit reached or feed disabled.",403);
}
export async function renameSubscription(db:D1Database,user:User,calendar:Calendar,id:string,name:string){
 const label=name.trim();if(!label||label.length>80)return err("INVALID_REQUEST","Enter a name of 1–80 characters.");
 const r=await db.prepare("INSERT INTO calendar_subscription_meta(token_id,label) SELECT t.id,? FROM calendar_tokens t JOIN calendars c ON c.id=t.calendar_id WHERE t.id=? AND t.calendar_id=? AND t.status='active' AND c.owner_user_id=? ON CONFLICT(token_id) DO UPDATE SET label=excluded.label").bind(label,id,calendar.id,user.id).run();
 if(r.meta.changes!==1)return err("NOT_FOUND","Subscription not found.",404);
}
export async function revokeSubscription(db:D1Database,user:User,calendar:Calendar,id:string){
 const r=await db.prepare("UPDATE calendar_tokens SET status='revoked',revoked_at=? WHERE id=? AND calendar_id=? AND status='active' AND EXISTS(SELECT 1 FROM calendars WHERE id=calendar_tokens.calendar_id AND owner_user_id=?)").bind(nowIso(),id,calendar.id,user.id).run();
 if(r.meta.changes!==1)return err("NOT_FOUND","Subscription not found.",404);
}
