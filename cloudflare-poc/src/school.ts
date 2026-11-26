import { ApiError, nowIso, utcDate } from "./common";
import { dayCount, minuteOfDay, minuteLabel, shiftDate, todaySydney, validDate, weekStart, type LessonRow } from "./schedule";
export type CourseRule={key:string;name:string;color:number;hidden:boolean};
export type TermRule={label:string;from:string;until:string;anchor:"A"|"B"|"";holiday:boolean};
export type Prefs={view:"week"|"day"|"agenda";hour:"12"|"24";locate:boolean;courses:CourseRule[];terms:TermRule[]};
export type SchoolDay={local_date:string;week_label:"A"|"B"|null;term_label:string|null;holiday_label:string|null;checked_at:string};
export const defaults=():Prefs=>({view:"week",hour:"24",locate:true,courses:[],terms:[]});
const invalid=(message:string):never=>{throw new ApiError("INVALID_REQUEST",message,400)};
export const courseKey=(r:LessonRow)=>r.course_code?"code:"+String(r.course_code):"title:"+String(r.title||"");
export function courseRule(p:Prefs,r:LessonRow){return p.courses.find(x=>x.key===courseKey(r))}
export function displayLesson(p:Prefs,r:LessonRow):LessonRow{const rule=courseRule(p,r);return {...r,original_title:r.title,title:rule?.name||r.title,ui_color:rule?.color,ui_hidden:!!rule?.hidden};}
export function clockLabel(min:number,hour:"12"|"24"="24"){if(!Number.isFinite(min))return "—";if(hour==="24")return minuteLabel(min);return (Math.floor(min/60)%12||12)+":"+String(Math.floor(min%60)).padStart(2,"0")+" "+(min>=720?"PM":"AM")}
export function lessonTime(value:unknown,hour:"12"|"24"="24"){return clockLabel(minuteOfDay(value),hour)}
export function parseTerms(input:string):TermRule[]{
 if(input.length>4000)invalid("School dates are too long.");
 const result:TermRule[]=[];
 for(const line of input.split(/\r?\n/).map(x=>x.trim()).filter(Boolean)){
  const [label,from,until,anchor="",...extra]=line.split("|").map(x=>x.trim());
  const holiday=/^holiday\b/i.test(label);
  if(extra.length||!label||label.length>80||!validDate(from||"")||!validDate(until||"")||from>until||dayCount(from,until)>366||!["","A","B"].includes(anchor)||holiday&&anchor)invalid("Each line: Term name | YYYY-MM-DD | YYYY-MM-DD | A or B (optional); Holiday name | dates.");
  if(result.some(t=>t.holiday===holiday&&t.from<=until&&from<=t.until))invalid("Overlapping term or holiday ranges.");
  result.push({label,from,until,anchor:anchor as TermRule["anchor"],holiday});
 }
 if(result.length>24)invalid("Maximum 24 school date ranges.");
 return result.sort((a,b)=>a.from.localeCompare(b.from));
}
export const formatTerms=(p:Prefs)=>p.terms.map(t=>[t.label,t.from,t.until,t.anchor].filter(Boolean).join(" | ")).join("\n");
export async function preferences(db:D1Database,calendarId:string):Promise<Prefs>{
 const r=await db.prepare("SELECT preferences_json FROM worker_calendar_preferences WHERE calendar_id=?").bind(calendarId).first<{preferences_json:string}>();
 return r?JSON.parse(r.preferences_json) as Prefs:defaults();
}
export async function savePreferences(db:D1Database,calendarId:string,userId:string,p:Prefs){
 const r=await db.prepare("INSERT INTO worker_calendar_preferences(calendar_id,preferences_json,updated_at) SELECT c.id,?,? FROM calendars c JOIN users u ON u.id=c.owner_user_id WHERE c.id=? AND u.id=? AND u.account_status='active' ON CONFLICT(calendar_id) DO UPDATE SET preferences_json=excluded.preferences_json,updated_at=excluded.updated_at").bind(JSON.stringify(p),nowIso(),calendarId,userId).run();
 if(r.meta.changes!==1)throw new ApiError("FORBIDDEN","Preferences unavailable.",403);
}
export function updatePrefs(p:Prefs,f:URLSearchParams):Prefs{
 const view=f.get("view"),hour=f.get("hour");
 if(!["week","day","agenda"].includes(view||"")||!["12","24"].includes(hour||""))return invalid("Invalid display settings.");
 return {...p,view:view as Prefs["view"],hour:hour as Prefs["hour"],locate:f.get("locate")==="on",terms:parseTerms(f.get("terms")||"")};
}
export function updateCourse(p:Prefs,f:URLSearchParams,key:string):Prefs{
 const name=(f.get("name")||"").trim(),color=Number(f.get("color"));
 if(name.length>100||!Number.isInteger(color)||color< -1||color>5)return invalid("Invalid course settings.");
 const rest=p.courses.filter(c=>c.key!==key);if(rest.length>=100)return invalid("Too many course preferences.");
 if(name||color>=0||f.get("hidden")==="on")rest.push({key,name,color,hidden:f.get("hidden")==="on"});
 return {...p,courses:rest};
}
export function schoolContext(date:string,p:Prefs,days:SchoolDay[]){
 const day=days.find(d=>d.local_date===date),holiday=p.terms.find(t=>t.holiday&&t.from<=date&&date<=t.until),term=p.terms.find(t=>!t.holiday&&t.from<=date&&date<=t.until);
 const holidayLabel=holiday?.label||day?.holiday_label||null,termLabel=term?.label||day?.term_label||null;
 const monday=weekStart(date),weekDays=days.filter(d=>d.local_date>=monday&&d.local_date<=shiftDate(monday,6));
 const explicit=[...new Set(weekDays.map(d=>d.week_label).filter(Boolean))];
 let week:string|null=null,weekSource:string|null=null;
 if(!holidayLabel&&explicit.length===1){week=explicit[0]!;weekSource="SEQTA";}
 else if(!holidayLabel&&explicit.length===0&&term?.anchor){
  const index=Math.floor((dayCount(weekStart(term.from),monday)-1)/7);
  week=index%2===0?term.anchor:term.anchor==="A"?"B":"A";weekSource="Term anchor";
 }
 return {holiday:holidayLabel,term:termLabel,week,weekSource,covered:!!day};
}
function signature(rows:LessonRow[],monday:string){
 const subset=rows.filter(r=>String(r.local_date)>=monday&&String(r.local_date)<=shiftDate(monday,4));
 if(new Set(subset.map(r=>r.local_date)).size<4||subset.length<12)return null;
 return new Set(subset.map(r=>String(new Date(String(r.local_date)+"T00:00:00Z").getUTCDay())+"|"+String(r.period_key||"")+"|"+courseKey(r)));
}
function similarity(a:Set<string>,b:Set<string>){let common=0;for(const x of a)if(b.has(x))common++;return common/(a.size+b.size-common||1)}
// Four consecutive well-populated weeks are required; never invent the school's A/B names.
export function inferredCycle(rows:LessonRow[],date:string){
 const target=weekStart(date);
 for(let offset=-3;offset<=0;offset++){
  const base=shiftDate(target,offset*7),s=[0,1,2,3].map(i=>signature(rows,shiftDate(base,i*7)));
  if(s.some(x=>!x))continue;
  const [a,b,c,d]=s as Set<string>[];
  const same=Math.min(similarity(a,c),similarity(b,d)),cross=Math.max(similarity(a,b),similarity(c,d));
  if(same>=.72&&same-cross>=.20)return {cycle:((Math.floor((Date.parse(target+"T00:00:00Z")-Date.parse("1970-01-05T00:00:00Z"))/604800000)%2+2)%2)+1,evidence:"Repeated four-week pattern"};
 }
 return null;
}
export function weeklyStats(rows:LessonRow[],p:Prefs){
 const totals=new Map<string,{key:string;name:string;minutes:number;color:number}>();
 for(const r of rows){const start=utcDate(String(r.starts_at_utc)).getTime(),end=utcDate(String(r.ends_at_utc)).getTime(),m=Math.round((end-start)/60000);if(!Number.isFinite(m)||m<=0)continue;
  const key=courseKey(r),rule=courseRule(p,r),item=totals.get(key)||{key,name:rule?.name||String(r.title||r.course_code||"Lesson"),minutes:0,color:rule?.color??-1};item.minutes+=m;totals.set(key,item);}
 return [...totals.values()].sort((a,b)=>b.minutes-a.minutes||a.name.localeCompare(b.name));
}
export function potentialFree(rows:LessonRow[],date:string,p:Prefs,days:SchoolDay[]){
 const context=schoolContext(date,p,days);
 if(!context.covered||context.holiday)return [];
 const dayRows=rows.filter(r=>r.local_date===date);
 const intervals=dayRows.map(r=>({start:minuteOfDay(r.starts_at_utc),end:minuteOfDay(r.ends_at_utc)})).filter(x=>x.end>x.start);
 if(intervals.length<2)return [];
 const first=Math.min(...intervals.map(x=>x.start)),last=Math.max(...intervals.map(x=>x.end)),monday=weekStart(date);
 const candidates=new Map<string,{start:number;end:number;dates:Set<string>}>();
 for(const r of rows){const day=String(r.local_date);if(day===date||day<monday||day>shiftDate(monday,4)||!/^period-\d+$/.test(String(r.period_key)))continue;const start=minuteOfDay(r.starts_at_utc),end=minuteOfDay(r.ends_at_utc);if(end-start<20||end-start>180||start<first||end>last)continue;const key=String(r.period_key)+"|"+start+"|"+end,item=candidates.get(key)||{start,end,dates:new Set<string>()};item.dates.add(day);candidates.set(key,item)}
 const unique=new Map<string,{start:number;end:number}>();
 for(const x of candidates.values())if(x.dates.size>=2&&!intervals.some(y=>x.start<y.end&&x.end>y.start))unique.set(x.start+"|"+x.end,{start:x.start,end:x.end});
 return [...unique.values()].sort((a,b)=>a.start-b.start).filter((x,i,a)=>!a.slice(0,i).some(y=>x.start<y.end&&x.end>y.start));
}
export const durationLabel=(m:number)=>Math.floor(m/60)+"h "+String(m%60).padStart(2,"0")+"m";
export function lessonDetails(row:LessonRow,hour:"12"|"24"="24"){
 return JSON.stringify({title:String(row.title||"Lesson"),original:String(row.original_title||row.title||""),date:String(row.local_date||""),time:lessonTime(row.starts_at_utc,hour)+" – "+lessonTime(row.ends_at_utc,hour),room:String(row.room||"—"),teacher:String(row.teacher||"—"),course:String(row.course_code||"—"),period:String(row.period_key||"—"),notes:String(row.description||"")});
}
