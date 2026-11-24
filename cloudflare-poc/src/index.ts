import { ApiError, decodeSecret, readJson } from "./common";
import { calendarFeed } from "./ics";
import { deviceStatus, syncCalendar } from "./sync";
type AppEnv={DATABASE:D1Database;TOKEN_PEPPER?:string;UID_SECRET?:string};
function json(data:unknown,status=200){return Response.json(data,{status,headers:{"Cache-Control":"no-store"}});}
export async function handleRequest(request:Request,env:AppEnv):Promise<Response>{
  const path=new URL(request.url).pathname;
  if(request.method==="GET"&&path==="/health/live")return json({status:"ok"});
  if(request.method==="GET"&&path==="/health/ready"){try{await env.DATABASE.prepare("SELECT 1 FROM calendars LIMIT 1").all();return json({status:"ok"});}catch{return json({status:"unavailable"},503);}}
  const pepper=decodeSecret(env.TOKEN_PEPPER);
  // No production secrets or default credentials are bundled.
  if(!pepper)return new Response(null,{status:404});
  try{
    const match=path.match(/^\/calendar\/(sl_cal_[A-Za-z0-9_-]+)(?:\.ics)?$/);
    if(request.method==="GET"&&match)return await calendarFeed(env.DATABASE,pepper,match[1],request);
    if(request.method==="GET"&&path==="/api/v2/status")return json(await deviceStatus(env.DATABASE,pepper,request));
    if(request.method==="POST"&&path==="/api/v2/sync"){
      const uid=decodeSecret(env.UID_SECRET);if(!uid)return json({error:{code:"UNAVAILABLE",message:"Sync unavailable."}},503);
      return json(await syncCalendar(env.DATABASE,pepper,uid,request,await readJson(request)));
    }
    return new Response(null,{status:404});
  }catch(e){if(e instanceof ApiError)return json({error:{code:e.code,message:e.message,details:{}}},e.status);return json({error:{code:"INTERNAL_ERROR",message:"Request failed.",details:{}}},500);}
}
export default {fetch:handleRequest} satisfies ExportedHandler<AppEnv>;
