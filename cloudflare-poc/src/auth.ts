import { ApiError, nowIso } from "./common";
import { managedId, managedRaw } from "./subscription";
import { hashToken, verifyArgon2Phc, verifyLegacyScrypt, createPasswordHash } from "./compat";
export type User={id:string;display_name:string;email:string|null;password_hash:string|null;role:string;account_status:string;sync_enabled:number;feed_enabled:number;max_devices:number};
export type Calendar={id:string;owner_user_id:string;name:string;timezone:string;revision:number;last_synced_at:string|null};
export const err=(code:string,message:string,status=400):never=>{throw new ApiError(code,message,status);};
export const randomToken=(prefix="")=>prefix+btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");
const expires=(minutes:number)=>new Date(Date.now()+minutes*60000).toISOString();
export const isAdmin=(u:User)=>u.role==="owner"||u.role==="admin";
export const checkPassword=(p:string,h:string|null)=>!!h&&p.length<=1024&&(h.startsWith("scrypt$")?verifyLegacyScrypt(p,h):verifyArgon2Phc(p,h));
export function passwordHash(p:string){if(p.length<8||p.length>1024)return err("INVALID_REQUEST","Password must contain 8 to 1024 characters.");return createPasswordHash(p);}
export function cookie(request:Request){return request.headers.get("Cookie")?.match(/(?:^|;\s*)seqta_session=([A-Za-z0-9_-]{43})(?:;|$)/)?.[1]||null;}
export async function sessionHash(secret:Uint8Array,raw:string){
 const b=new TextEncoder().encode(raw),joined=new Uint8Array(secret.length+b.length);joined.set(secret);joined.set(b,secret.length);
 const digest=new Uint8Array(await crypto.subtle.digest("SHA-256",joined));return Array.from(digest,x=>x.toString(16).padStart(2,"0")).join("");
}
export const sessionCookie=(raw:string)=>"seqta_session="+raw+"; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800";
export const clearCookie="seqta_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0";
export async function currentUser(db:D1Database,secret:Uint8Array,request:Request){
 const raw=cookie(request);if(!raw)return null;
 return await db.prepare("SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.session_token_hash=? AND julianday(s.expires_at)>julianday('now') AND u.account_status='active'").bind(await sessionHash(secret,raw)).first<User>();
}
export async function revokeSession(db:D1Database,secret:Uint8Array,request:Request){const raw=cookie(request);if(raw)await db.prepare("DELETE FROM sessions WHERE session_token_hash=?").bind(await sessionHash(secret,raw)).run();}
export async function calendarFor(db:D1Database,user:User){const c=await db.prepare("SELECT * FROM calendars WHERE owner_user_id=?").bind(user.id).first<Calendar>();if(!c)return err("NOT_FOUND","Calendar not found.",404);return c;}
// Persistent fixed windows before expensive KDF; HMACed keys, no raw identity or IP storage.
export async function rateLimit(db:D1Database,pepper:Uint8Array,request:Request,kind:string,identity=""){
 const ip=request.headers.get("CF-Connecting-IP")||"unknown",minute=Math.floor(Date.now()/60000),window=Math.floor(minute/15);
 const keys=[{key:kind+":global:"+minute,max:10},{key:kind+":ip:"+ip+":"+window,max:kind==="pair"?10:5}];
 if(identity)keys.push({key:kind+":identity:"+identity+":"+window,max:5});
 const hashed=await Promise.all(keys.map(k=>hashToken(pepper,"rate",k.key)));
 const rows=await db.batch(keys.map((k,i)=>db.prepare("INSERT INTO worker_rate_limits(key,attempts,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=MIN(attempts+1,1000) RETURNING attempts").bind(hashed[i],expires(16))));
 await db.prepare("DELETE FROM worker_rate_limits WHERE julianday(expires_at)<julianday('now')").run();
 if(rows.some((x,i)=>Number((x.results[0] as {attempts:number}|undefined)?.attempts||1000)>keys[i].max))return err("RATE_LIMITED","Too many attempts. Try again later.",429);
}
export async function login(db:D1Database,secret:Uint8Array,pepper:Uint8Array,request:Request,emailRaw:string,password:string,admin:boolean){
 const email=emailRaw.trim().toLowerCase();await rateLimit(db,pepper,request,"login",email.slice(0,320));
 if(email.length>320||!email||!password)return err("UNAUTHORIZED","Invalid email or password.",401);
 const u=await db.prepare("SELECT * FROM users WHERE email=? AND account_status='active'").bind(email).first<User>();
 if(!u||!checkPassword(password,u.password_hash)||admin&&!isAdmin(u))return err("UNAUTHORIZED","Invalid email or password.",401);
 const raw=randomToken(),hash=await sessionHash(secret,raw),stamp=nowIso();
 const result=await db.prepare("INSERT INTO sessions(id,user_id,session_token_hash,expires_at,created_at,last_seen_at) SELECT ?,id,?,?,?,? FROM users WHERE id=? AND account_status='active' AND password_hash=? AND role=?").bind(crypto.randomUUID(),hash,expires(10080),stamp,stamp,u.id,u.password_hash,u.role).run();
 if(result.meta.changes!==1)return err("UNAUTHORIZED","Account changed. Sign in again.",401);
 return raw;
}
export function requireOrigin(request:Request){if(request.headers.get("Origin")!==new URL(request.url).origin)return err("FORBIDDEN","Invalid request origin.",403);}
export async function form(request:Request){
 requireOrigin(request);
 if(!request.headers.get("Content-Type")?.startsWith("application/x-www-form-urlencoded"))return err("INVALID_REQUEST","Invalid form encoding.");
 const reader=request.body?.getReader();if(!reader)return new URLSearchParams();
 let n=0;const decoder=new TextDecoder();let result="";
 try{for(;;){const {value,done}=await reader.read();if(done)break;n+=value.byteLength;if(n>16384){await reader.cancel();return err("INVALID_REQUEST","Form too large.",413);}result+=decoder.decode(value,{stream:true});}result+=decoder.decode();}finally{reader.releaseLock();}
 return new URLSearchParams(result);
}
export async function createPairing(db:D1Database,pepper:Uint8Array,u:User,c:Calendar){
 const chars="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";let plain="";while(plain.length<8){const b=crypto.getRandomValues(new Uint8Array(1))[0];if(b<Math.floor(256/chars.length)*chars.length)plain+=chars[b%chars.length];}
 const code=plain.slice(0,4)+"-"+plain.slice(4),id=crypto.randomUUID(),expiry=expires(10);
 const result=await db.prepare("INSERT INTO pairing_codes(id,owner_user_id,calendar_id,code_hash,expires_at,created_at) SELECT ?,u.id,c.id,?,?,? FROM users u JOIN calendars c ON c.owner_user_id=u.id WHERE u.id=? AND c.id=? AND u.account_status='active' AND u.sync_enabled=1 AND (SELECT count(*) FROM devices d WHERE d.owner_user_id=u.id AND d.status='active')<u.max_devices").bind(id,await hashToken(pepper,"invite",plain),expiry,nowIso(),u.id,c.id).run();
 if(result.meta.changes!==1)return err("DEVICE_LIMIT","Sync disabled or maximum number of devices reached.",409);return {code,expiresAt:expiry,id};
}
export async function pairDevice(db:D1Database,pepper:Uint8Array,request:Request,body:unknown){
 await rateLimit(db,pepper,request,"pair");const b=body as {code?:unknown;deviceName?:unknown}|null;
 if(!b||typeof b.code!=="string"||b.code.length>32)return err("INVALID_REQUEST","Invalid pairing code.");
 const code=b.code.replace(/-/g,"").toUpperCase(),name=typeof b.deviceName==="string"?b.deviceName.trim().slice(0,200)||"Browser":"Browser";
 if(!/^[A-Z2-9]{8}$/.test(code))return err("INVALID_REQUEST","Invalid pairing code.");
 const codeHash=await hashToken(pepper,"invite",code),raw=randomToken("sl_dvc_"),id=crypto.randomUUID(),stamp=nowIso();
 const [insert]=await db.batch([
  db.prepare("INSERT INTO devices(id,owner_user_id,calendar_id,name,token_hash,token_prefix,status,created_at) SELECT ?,p.owner_user_id,p.calendar_id,?,?,?,'active',? FROM pairing_codes p JOIN users u ON u.id=p.owner_user_id JOIN calendars c ON c.id=p.calendar_id AND c.owner_user_id=u.id WHERE p.code_hash=? AND p.used_at IS NULL AND julianday(p.expires_at)>julianday('now') AND u.account_status='active' AND u.sync_enabled=1 AND (SELECT count(*) FROM devices d WHERE d.owner_user_id=u.id AND d.status='active')<u.max_devices").bind(id,name,await hashToken(pepper,"device",raw),raw.slice(0,12),stamp,codeHash),
  db.prepare("UPDATE pairing_codes SET used_at=?,device_id=? WHERE code_hash=? AND used_at IS NULL AND EXISTS(SELECT 1 FROM devices WHERE id=?)").bind(stamp,id,codeHash,id)
 ]);
 if(insert.meta.changes!==1)return err("INVALID_REQUEST","Invalid, expired or unavailable pairing code.",404);return {deviceToken:raw};
}
export async function register(db:D1Database,pepper:Uint8Array,secret:Uint8Array,request:Request,token:string,f:URLSearchParams){
 await rateLimit(db,pepper,request,"invite");
 if(!/^[A-Za-z0-9_-]{43}$/.test(token))return err("INVALID_REQUEST","Invitation unavailable.",404);
 const hash=await hashToken(pepper,"invite",token);
 const inv=await db.prepare("SELECT * FROM invitations WHERE token_hash=? AND used_at IS NULL AND julianday(expires_at)>julianday('now')").bind(hash).first<{id:string;expected_name:string|null;sync_enabled:number;feed_enabled:number;max_devices:number}>();
 if(!inv)return err("INVALID_REQUEST","Invitation unavailable.",404);
 const email=(f.get("email")||"").trim().toLowerCase();if(email.length>320||!(/^[^\s@]+@[^\s@]+\.[^\s@]+$/).test(email))return err("INVALID_REQUEST","Invalid email.");
 const display=(f.get("display_name")?.trim()||inv.expected_name||email.split("@")[0]).slice(0,200);
 const password=passwordHash(f.get("password")||""),uid=crypto.randomUUID(),cid=crypto.randomUUID(),session=randomToken(),tokenId=managedId(),raw=await managedRaw(pepper,cid,tokenId),stamp=nowIso(),guard=crypto.randomUUID();
 try{await db.batch([
  db.prepare("INSERT INTO worker_sync_guard(id,ok) SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM invitations WHERE id=? AND token_hash=? AND used_at IS NULL AND julianday(expires_at)>julianday('now')) THEN 1 ELSE 0 END").bind(guard,inv.id,hash),
  db.prepare("INSERT INTO users(id,display_name,email,password_hash,role,sync_enabled,feed_enabled,max_devices,created_at,updated_at) VALUES (?,?,?,?,'user',?,?,?,?,?)").bind(uid,display,email,password,inv.sync_enabled,inv.feed_enabled,inv.max_devices,stamp,stamp),
  db.prepare("INSERT INTO calendars(id,owner_user_id,name,created_at,updated_at) VALUES (?,?,?,?,?)").bind(cid,uid,display+"'s Timetable",stamp,stamp),
  db.prepare("INSERT INTO calendar_tokens(id,calendar_id,token_hash,token_prefix,created_at) VALUES (?,?,?,?,?)").bind(tokenId,cid,await hashToken(pepper,"calendar",raw),raw.slice(0,12),stamp),
  db.prepare("INSERT INTO sessions(id,user_id,session_token_hash,expires_at,created_at,last_seen_at) VALUES (?,?,?,?,?,?)").bind(crypto.randomUUID(),uid,await sessionHash(secret,session),expires(10080),stamp,stamp),
  db.prepare("UPDATE invitations SET used_at=?,used_by=? WHERE id=?").bind(stamp,uid,inv.id),
  db.prepare("DELETE FROM worker_sync_guard WHERE id=?").bind(guard)
 ]);}catch(e){if(/constraint/i.test(String(e)))return err("INVALID_REQUEST","Invitation unavailable or email already registered.",409);throw e;}
 return session;
}
