import { sydneyParts, utcDate } from "./common";
export type LessonRow=Record<string,unknown>;
export const todaySydney=(now=new Date())=>{const p=sydneyParts(now);return p.year+"-"+p.month+"-"+p.day;};
export function validDate(v:string){if(!/^\d{4}-\d{2}-\d{2}$/.test(v))return false;const d=new Date(v+"T00:00:00Z");return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===v;}
export function shiftDate(v:string,n:number){const d=new Date(v+"T00:00:00Z");d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);}
export function weekStart(v:string){return shiftDate(v,-((new Date(v+"T00:00:00Z").getUTCDay()+6)%7));}
export const dayCount=(from:string,until:string)=>Math.floor((Date.parse(until+"T00:00:00Z")-Date.parse(from+"T00:00:00Z"))/86400000)+1;
export const dateLabel=(v:string)=>new Date(v+"T00:00:00Z").toLocaleDateString("en-AU",{weekday:"long",day:"numeric",month:"short",timeZone:"UTC"});
export const shortDate=(v:string)=>new Date(v+"T00:00:00Z").toLocaleDateString("en-AU",{day:"numeric",month:"short",timeZone:"UTC"});
export const weekday=(v:string)=>new Date(v+"T00:00:00Z").toLocaleDateString("en-AU",{weekday:"short",timeZone:"UTC"});
export function minuteOfDay(v:unknown){const d=utcDate(String(v));if(!Number.isFinite(d.getTime()))return NaN;const p=sydneyParts(d);return Number(p.hour)*60+Number(p.minute)+Number(p.second)/60;}
export function minuteLabel(min:number){return String(Math.floor(min/60)).padStart(2,"0")+":"+String(Math.floor(min%60)).padStart(2,"0");}
export const timeLabel=(v:unknown)=>{const min=minuteOfDay(v);return Number.isFinite(min)?minuteLabel(min):"—";};
export const subjectPaletteSize=16;
function subjectKey(r:LessonRow){return String(r.course_code||r.original_title||r.title||"");}
function hashSubject(key:string){let hash=2166136261;for(const ch of key)hash=Math.imul(hash^ch.charCodeAt(0),16777619);return (hash>>>0)%subjectPaletteSize;}
function chosenColor(value:unknown){return typeof value==="number"&&Number.isInteger(value)&&value>=0&&value<=5?value:null;}
export function courseColor(r:LessonRow){if(typeof r.resolved_color==="number"&&Number.isInteger(r.resolved_color)&&r.resolved_color>=0&&r.resolved_color<subjectPaletteSize)return r.resolved_color;const chosen=chosenColor(r.ui_color);return chosen===null?hashSubject(subjectKey(r)):chosen;}
export function assignCourseColors(rows:LessonRow[]){
 const byKey=new Map<string,LessonRow>();
 for(const row of rows){const key=subjectKey(row);if(!key)continue;const prev=byKey.get(key);if(!prev||chosenColor(row.ui_color)!==null)byKey.set(key,row);}
 const assigned=new Map<string,number>(),used=new Set<number>(),auto:string[]=[];
 for(const [key,row] of byKey){const chosen=chosenColor(row.ui_color);if(chosen!==null){assigned.set(key,chosen);used.add(chosen);}else auto.push(key);}
 const groups=new Map<number,string[]>();
 for(const key of auto){const pref=hashSubject(key),list=groups.get(pref)??[];list.push(key);groups.set(pref,list);}
 const pending:string[]=[];
 for(const [pref,keys] of groups){keys.sort();if(!used.has(pref)){assigned.set(keys[0],pref);used.add(pref);pending.push(...keys.slice(1));}else pending.push(...keys);}
 pending.sort();
 for(const key of pending){const pref=hashSubject(key);let color=pref;for(let step=1;step<subjectPaletteSize;step++){const candidate=(pref+step)%subjectPaletteSize;if(!used.has(candidate)){color=candidate;break;}}used.add(color);assigned.set(key,color);}
 return assigned;
}
export function paintCourseColors(catalog:LessonRow[],rows:LessonRow[]=catalog){const assigned=assignCourseColors(catalog.length?catalog:rows);return rows.map(row=>{const color=assigned.get(subjectKey(row));return color===undefined?row:{...row,resolved_color:color};});}
export type Slot={row:LessonRow;start:number;end:number;lane:number;lanes:number};
export function placeLessons(rows:LessonRow[]):Slot[]{
 const ordered=rows.map(row=>({row,start:minuteOfDay(row.starts_at_utc),end:minuteOfDay(row.ends_at_utc),lane:0,lanes:1})).filter(x=>Number.isFinite(x.start)&&Number.isFinite(x.end)&&x.end>x.start).sort((a,b)=>a.start-b.start||a.end-b.end);
 const output:Slot[]=[];let group:Slot[]=[],ends:number[]=[],groupEnd=-1;
 function flush(){for(const s of group){s.lanes=ends.length;output.push(s);}group=[];ends=[];groupEnd=-1;}
 for(const slot of ordered){if(group.length&&slot.start>=groupEnd)flush();let lane=ends.findIndex(end=>end<=slot.start);if(lane<0){lane=ends.length;ends.push(slot.end);}else ends[lane]=slot.end;slot.lane=lane;group.push(slot);groupEnd=Math.max(groupEnd,slot.end);}
 if(group.length)flush();return output;
}
export function timeWindow(slots:Slot[]){return {start:Math.min(480,...slots.map(s=>Math.floor(s.start/60)*60)),end:Math.max(960,...slots.map(s=>Math.ceil(s.end/60)*60))};}
export const scheduleLink=(from:string,until:string,view:"week"|"day",base="/app/timetable")=>base+"?from="+encodeURIComponent(from)+"&until="+encodeURIComponent(until)+"&view="+view;
