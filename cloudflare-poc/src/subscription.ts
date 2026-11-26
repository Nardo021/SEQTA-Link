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
