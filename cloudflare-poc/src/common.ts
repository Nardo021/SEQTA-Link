export class ApiError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}
export const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
// SQLite source stores naive UTC datetimes. Never interpret those in the host timezone.
export const utcDate = (s: string) => new Date(/(?:Z|[+-]\d\d:\d\d)$/.test(s) ? s.replace(" ","T") : s.replace(" ","T")+"Z");
export async function sha256(value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return Array.from(bytes, x => x.toString(16).padStart(2,"0")).join("");
}
// Python json.dumps(sort_keys=True, ensure_ascii=True), with its two separator variants.
export function pyJson(value: unknown, compact = false): string {
  const sep = compact ? "," : ", ", colon = compact ? ":" : ": ";
  if (typeof value === "string") return JSON.stringify(value).replace(/[\u007f-\uffff]/g, c=>"\\u"+c.charCodeAt(0).toString(16).padStart(4,"0"));
  if (Array.isArray(value)) return "["+value.map(x=>pyJson(x,compact)).join(sep)+"]";
  if (value && typeof value === "object") {
    const obj = value as Record<string,unknown>;
    return "{"+Object.keys(obj).sort().map(k=>pyJson(k,compact)+colon+pyJson(obj[k],compact)).join(sep)+"}";
  }
  const s=JSON.stringify(value); if(s===undefined) throw new ApiError("INVALID_REQUEST","Unsupported value.");
  return s;
}
export function sydneyParts(date: Date, tz = "Australia/Sydney"): Record<string,string> {
  return Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone:tz, year:"numeric",month:"2-digit",day:"2-digit",
    hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"
  }).formatToParts(date).map(p=>[p.type,p.value]));
}
export function localToUtc(date: string, time: string): string {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!/^\d{2}:\d{2}:\d{2}$/.test(time)) throw new ApiError("INVALID_LESSON","Invalid date/time.");
  const target = Date.parse(date+"T"+time+"Z");
  if(!Number.isFinite(target)||new Date(target).toISOString().slice(0,19)!==date+"T"+time) throw new ApiError("INVALID_LESSON","Invalid date/time.");
  let guess=target;
  for(let i=0;i<3;i++){
    const p=sydneyParts(new Date(guess));
    const represented=Date.parse(p.year+"-"+p.month+"-"+p.day+"T"+p.hour+":"+p.minute+":"+p.second+"Z");
    guess += target-represented;
  }
  const p=sydneyParts(new Date(guess));
  if(p.year+"-"+p.month+"-"+p.day+"T"+p.hour+":"+p.minute+":"+p.second!==date+"T"+time) throw new ApiError("INVALID_LESSON","Nonexistent local time.");
  return new Date(guess).toISOString().replace(".000Z","Z");
}
export function decodeSecret(s: string | undefined): Uint8Array | null {
  if(!s) return null;
  try { const bytes=Uint8Array.from(atob(s),x=>x.charCodeAt(0));return bytes.length>=32?bytes:null; } catch {return null;}
}
export async function readJson(request: Request): Promise<unknown> {
  if(!request.body) throw new ApiError("INVALID_REQUEST","JSON body required.");
  const reader=request.body.getReader(); const chunks:Uint8Array[]=[];let size=0;
  try{
    for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;
      if(size>2*1024*1024){await reader.cancel();throw new ApiError("INVALID_REQUEST","Payload too large.",413);}chunks.push(value);
    }
  }finally{reader.releaseLock();}
  const data=new Uint8Array(size);let offset=0;for(const c of chunks){data.set(c,offset);offset+=c.length;}
  try{return JSON.parse(new TextDecoder().decode(data));}catch{throw new ApiError("INVALID_REQUEST","Invalid JSON.");}
}
