import { ApiError, nowIso } from "./common";
import { dayCount, minuteOfDay, minuteLabel, shiftDate, validDate, weekStart, type LessonRow } from "./schedule";
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
export function canonicalPrefs(p:Prefs):Prefs{return p.view==="week"?p:{...p,view:"day"};}
export async function preferences(db:D1Database,calendarId:string):Promise<Prefs>{
 const r=await db.prepare("SELECT preferences_json FROM worker_calendar_preferences WHERE calendar_id=?").bind(calendarId).first<{preferences_json:string}>();
 return canonicalPrefs(r?JSON.parse(r.preferences_json) as Prefs:defaults());
}
export async function savePreferences(db:D1Database,calendarId:string,userId:string,p:Prefs){
 const r=await db.prepare("INSERT INTO worker_calendar_preferences(calendar_id,preferences_json,updated_at) SELECT c.id,?,? FROM calendars c JOIN users u ON u.id=c.owner_user_id WHERE c.id=? AND u.id=? AND u.account_status='active' ON CONFLICT(calendar_id) DO UPDATE SET preferences_json=excluded.preferences_json,updated_at=excluded.updated_at").bind(JSON.stringify(p),nowIso(),calendarId,userId).run();
 if(r.meta.changes!==1)throw new ApiError("FORBIDDEN","Preferences unavailable.",403);
}
export function updatePrefs(p:Prefs,f:URLSearchParams):Prefs{
 const view=f.get("view"),hour=f.get("hour");
 if(!["week","day","agenda"].includes(view||"")||!["12","24"].includes(hour||""))return invalid("Invalid display settings.");
 return {...p,view:view==="week"?"week":"day",hour:hour as Prefs["hour"],locate:f.get("locate")==="on",terms:parseTerms(f.get("terms")||"")};
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
export function lessonDetails(row:LessonRow,hour:"12"|"24"="24"){
 return JSON.stringify({title:String(row.title||"Lesson"),original:String(row.original_title||row.title||""),date:String(row.local_date||""),time:lessonTime(row.starts_at_utc,hour)+" – "+lessonTime(row.ends_at_utc,hour),room:String(row.room||"—"),teacher:String(row.teacher||"—"),course:String(row.course_code||"—"),period:String(row.period_key||"—"),notes:String(row.description||"")});
}
