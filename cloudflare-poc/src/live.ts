import { utcDate } from "./common";
import { shiftDate } from "./schedule";

export type LiveTrust="current"|"failed"|"incomplete"|"unchecked"|"stale";
export type LiveFocus=""|"current"|"next"|"first";
export type LiveLesson={title:string;room:string;date:string;start:number;end:number;clock:string;cancelled?:boolean};
export type LiveInput={now:number;today:string;lessons:readonly LiveLesson[];covered:readonly string[];holiday:string|null;trust:LiveTrust};
export type LiveView={kind:"unknown"|"holiday"|"empty"|"before"|"active"|"between"|"done";state:string;title:string;meta:string;next:string;progress:number|null;focus:LiveFocus;focusAt:number|null;stale:boolean;note:string};

const freshMs=36*60*60*1000;
function stampMs(value:string|null|undefined){if(!value)return NaN;const time=utcDate(value).getTime();return Number.isFinite(time)?time:NaN;}
export function scheduleTrust(check:{outcome?:string|null;checked_at?:string|null}|null,lastSynced:string|null,now=Date.now()):LiveTrust{
 const at=stampMs(check?.checked_at),recent=Number.isFinite(at)&&now-at<freshMs&&now-at>=0;
 if(check?.outcome==="failed"&&recent)return "failed";
 if(check?.outcome==="skipped"&&recent)return "incomplete";
 if((check?.outcome==="uploaded"||check?.outcome==="unchanged")&&recent)return "current";
 const uploaded=stampMs(lastSynced);
 if(Number.isFinite(uploaded)&&now-uploaded<freshMs&&now-uploaded>=0)return "current";
 if(check?.outcome==="failed")return "failed";
 if(check?.outcome==="skipped")return "incomplete";
 if(check?.outcome==="uploaded"||check?.outcome==="unchanged")return "stale";
 return "unchecked";
}
export function shouldLocate(enabled:boolean,from:string,until:string,today:string){return enabled&&from<=today&&today<=until;}

function noteFor(trust:LiveTrust){
 if(trust==="current")return "";
 if(trust==="failed")return "Saved timetable. The last school check did not succeed.";
 if(trust==="incomplete")return "Saved timetable. The last school check was incomplete.";
 if(trust==="stale")return "Saved timetable. The last school check is not recent.";
 return "No school check from the browser yet.";
}
function left(ms:number){const min=Math.max(1,Math.ceil(ms/60000));if(min<60)return min===1?"1 min":min+" min";const hour=Math.floor(min/60),rest=min%60;return rest?hour+" h "+rest+" min":hour===1?"1 h":hour+" h";}
function byStart(a:LiveLesson,b:LiveLesson){return a.start-b.start||a.end-b.end||a.title.localeCompare(b.title);}
function rooms(rows:readonly LiveLesson[]){return [...new Set(rows.map(row=>row.room.trim()).filter(Boolean))].join(" / ");}
function names(rows:readonly LiveLesson[]){return rows.map(row=>row.title).join(" / ");}
function upcoming(rows:readonly LiveLesson[],now:number){return rows.filter(row=>row.start>now).sort(byStart);}

export function liveState(input:LiveInput):LiveView{
 const covered=new Set(input.covered),trust=input.trust,note=noteFor(trust),stale=trust!=="current";
 const base={progress:null,focus:"" as LiveFocus,focusAt:null,stale,note,next:""};
 const holiday=input.holiday?.trim()||"";
 if(holiday)return {...base,kind:"holiday",state:"Holiday",title:holiday,meta:""};
 if(!covered.has(input.today))return {...base,kind:"unknown",state:"Schedule incomplete",title:"Not enough saved school data",meta:""};
 const lessons=input.lessons.filter(row=>!row.cancelled&&covered.has(row.date)&&Number.isFinite(row.start)&&row.end>row.start).sort(byStart);
 const today=lessons.filter(row=>row.date===input.today);
 if(!today.length)return {...base,kind:"empty",state:"No lessons",title:"Nothing scheduled today",meta:""};
 const first=today[0],last=Math.max(...today.map(row=>row.end));
 const current=today.filter(row=>row.start<=input.now&&input.now<row.end);
 const later=today.filter(row=>row.start>input.now);
 const future=()=>{
  const candidate=upcoming(lessons,input.now).find(row=>covered.has(row.date));
  if(!candidate)return "";
  let label:"Next"|"Next known"="Next";
  if(candidate.date!==input.today){for(let date=shiftDate(input.today,1);date<=candidate.date;date=shiftDate(date,1))if(!covered.has(date)){label="Next known";break;}}
  return label+" "+[candidate.title,candidate.clock,candidate.room,"in "+left(candidate.start-input.now)].filter(Boolean).join(" · ");
 };
 if(input.now<first.start)return {...base,kind:"before",state:"Before school",title:first.title,meta:["Starts in "+left(first.start-input.now),first.clock,first.room].filter(Boolean).join(" · "),focus:"first",focusAt:first.start};
 if(current.length){
  const ending=[...current].sort((a,b)=>a.end-b.end||a.start-b.start)[0];
  const primary=[...current].sort(byStart)[0];
  const span=ending.end-ending.start;
  const following=upcoming(lessons,input.now)[0];
  const next=following&&following.date===input.today?[following.title,following.clock,following.room,"in "+left(following.start-input.now)].filter(Boolean).join(" · "):future();
  return {...base,kind:"active",state:"Now",title:names(current),meta:[rooms(current),left(ending.end-input.now)+" left"].filter(Boolean).join(" · "),next:next&&!next.startsWith("Next")?"Next "+next:next,progress:span>0?Math.min(1,Math.max(0,(input.now-ending.start)/span)):0,focus:"current",focusAt:primary.start};
 }
 if(input.now<last&&later.length){const next=later[0];return {...base,kind:"between",state:"Between lessons",title:next.title,meta:["in "+left(next.start-input.now),next.clock,next.room].filter(Boolean).join(" · "),focus:"next",focusAt:next.start};}
 return {...base,kind:"done",state:"School day complete",title:"",meta:"",next:future()};
}
