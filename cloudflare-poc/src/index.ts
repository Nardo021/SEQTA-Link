import { ApiError, decodeSecret, readJson } from "./common";
import { calendarFeed } from "./ics";
import { deviceStatus, syncCalendar, reportDeviceCheck } from "./sync";
import { portal } from "./portal";
import { pairDevice } from "./auth";
import { clientScript } from "./client-script";
type AppEnv={DATABASE:D1Database;TOKEN_PEPPER?:string;UID_SECRET?:string;SESSION_SECRET?:string};
function json(data:unknown,status=200){return Response.json(data,{status,headers:{"Cache-Control":"no-store"}});}
export async function handleRequest(request:Request,env:AppEnv):Promise<Response>{
  const path=new URL(request.url).pathname;
  if(request.method==="GET"&&path==="/assets/ui.js")return new Response(clientScript,{headers:{"Content-Type":"text/javascript; charset=utf-8","Cache-Control":"public, max-age=300","X-Content-Type-Options":"nosniff","Cross-Origin-Resource-Policy":"same-origin"}});
  if(request.method==="GET"&&(path==="/health/live"||path==="/health"))return json({status:"ok"});
  if(request.method==="GET"&&path==="/health/ready"){try{await env.DATABASE.batch(["calendars","worker_event_changes","worker_calendar_preferences","calendar_subscription_clients"].map(t=>env.DATABASE.prepare("SELECT 1 FROM "+t+" LIMIT 1")));if(!decodeSecret(env.TOKEN_PEPPER)||!decodeSecret(env.UID_SECRET)||!decodeSecret(env.SESSION_SECRET))return json({status:"unavailable"},503);return json({status:"ok"});}catch{return json({status:"unavailable"},503);}}
  const pepper=decodeSecret(env.TOKEN_PEPPER);
  // No production secrets or default credentials are bundled.
  if(!pepper)return new Response(null,{status:404});
  try{
    const match=path.match(/^\/calendar\/(sl_cal_[A-Za-z0-9_-]+)(?:\.ics)?$/);
    if(request.method==="GET"&&match)return await calendarFeed(env.DATABASE,pepper,match[1],request);
    if(request.method==="GET"&&path==="/api/v2/status")return json(await deviceStatus(env.DATABASE,pepper,request));
    if(request.method==="POST"&&path==="/api/v2/device/check")return json(await reportDeviceCheck(env.DATABASE,pepper,request,await readJson(request)));
    if(request.method==="POST"&&path==="/api/v2/sync"){
      const uid=decodeSecret(env.UID_SECRET);if(!uid)return json({error:{code:"UNAVAILABLE",message:"Sync unavailable."}},503);
      return json(await syncCalendar(env.DATABASE,pepper,uid,request,await readJson(request)));
    }
    if(request.method==="POST"&&path==="/api/v2/device/pair")return json(await pairDevice(env.DATABASE,pepper,request,await readJson(request)));
    const secret=decodeSecret(env.SESSION_SECRET);
    if(secret)return await portal(request,env.DATABASE,pepper,secret);
    return new Response(null,{status:404});
  }catch(e){if(e instanceof ApiError)return json({error:{code:e.code,message:e.message,details:{}}},e.status);const requestId=crypto.randomUUID();console.error(JSON.stringify({event:"request_failed",requestId,category:path.startsWith("/calendar/")?"feed":path.startsWith("/api/")?"api":path.startsWith("/admin/")?"admin":"portal",method:request.method}));return json({error:{code:"INTERNAL_ERROR",message:"Request failed.",details:{requestId}}},500);}
}
export default {fetch:handleRequest} satisfies ExportedHandler<AppEnv>;
