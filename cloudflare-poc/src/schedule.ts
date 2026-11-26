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
export function courseColor(r:LessonRow){if(typeof r.ui_color==="number"&&Number.isInteger(r.ui_color)&&r.ui_color>=0&&r.ui_color<=5)return r.ui_color;let hash=2166136261;for(const ch of String(r.course_code||r.title||"")){hash=Math.imul(hash^ch.charCodeAt(0),16777619);}return (hash>>>0)%6;}
export type Slot={row:LessonRow;start:number;end:number;lane:number;lanes:number};
export function placeLessons(rows:LessonRow[]):Slot[]{
 const ordered=rows.map(row=>({row,start:minuteOfDay(row.starts_at_utc),end:minuteOfDay(row.ends_at_utc),lane:0,lanes:1})).filter(x=>Number.isFinite(x.start)&&Number.isFinite(x.end)&&x.end>x.start).sort((a,b)=>a.start-b.start||a.end-b.end);
 const output:Slot[]=[];let group:Slot[]=[],ends:number[]=[],groupEnd=-1;
 function flush(){for(const s of group){s.lanes=ends.length;output.push(s);}group=[];ends=[];groupEnd=-1;}
 for(const slot of ordered){if(group.length&&slot.start>=groupEnd)flush();let lane=ends.findIndex(end=>end<=slot.start);if(lane<0){lane=ends.length;ends.push(slot.end);}else ends[lane]=slot.end;slot.lane=lane;group.push(slot);groupEnd=Math.max(groupEnd,slot.end);}
 if(group.length)flush();return output;
}
export function timeWindow(slots:Slot[]){return {start:Math.min(480,...slots.map(s=>Math.floor(s.start/60)*60)),end:Math.max(960,...slots.map(s=>Math.ceil(s.end/60)*60))};}
export const scheduleLink=(from:string,until:string,view:"week"|"day"|"agenda",base="/app/timetable")=>base+"?from="+encodeURIComponent(from)+"&until="+encodeURIComponent(until)+"&view="+view;
