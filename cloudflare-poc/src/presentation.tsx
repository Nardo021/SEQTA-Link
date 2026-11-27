import React, {type ReactNode,type CSSProperties} from "react";
import { renderToStaticMarkup } from "react-dom/server.browser";
import { CalendarDays, CalendarRange, MonitorSmartphone, Settings, ShieldCheck, LogOut, Clock, RefreshCw, CalendarX, ChevronLeft, ChevronRight, SunMoon, Copy, ExternalLink, Info, Plus, Trash2 } from "lucide-react";
import { Button } from "./components/ui/button";
import { Card,CardContent,CardHeader,CardDescription } from "./components/ui/card";
import { Badge } from "./components/ui/badge";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { Table,TableHeader,TableBody,TableRow,TableHead,TableCell } from "./components/ui/table";
import { Alert, AlertDescription } from "./components/ui/alert";
import { ButtonGroup } from "./components/ui/button-group";
import { InputGroup,InputGroupInput,InputGroupAddon } from "./components/ui/input-group";
import type { SubscriptionLink } from "./subscription";
import { utcDate } from "./common";
import { isAdmin,type User } from "./auth";
import { todaySydney,shiftDate,weekStart,validDate,dateLabel,shortDate,weekday,dayCount,minuteOfDay,minuteLabel,courseColor,placeLessons,timeWindow,scheduleLink,type LessonRow } from "./schedule";
import css from "./generated-css";
import {clockLabel,lessonTime,lessonDetails} from "./school";
import {Empty,EmptyHeader,EmptyTitle,EmptyDescription,EmptyMedia} from "./components/ui/empty";
export {todaySydney,shiftDate,weekStart,validDate,dayCount,scheduleLink};
export const esc=(v:unknown)=>String(v??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
const html=(node:ReactNode)=>renderToStaticMarkup(node);
const fragment=(s:string)=>({__html:s});
const icons={timetable:CalendarRange,account:Settings,admin:ShieldCheck,clock:Clock,sync:RefreshCw,devices:MonitorSmartphone,empty:CalendarX};
function Icon({name,className}:{name:string;className?:string}){const I=icons[name as keyof typeof icons]||CalendarDays;return <I aria-hidden="true" className={className||"size-4"}/>;}
export const icon=(name:string)=>html(<Icon name={name}/>);
const danger=(label:string)=>/^(Revoke|Delete|Suspend|Reset|Rotate)/.test(label);
export const button=(label:string)=>html(<Button type="submit" variant={danger(label)?"destructive":"default"} className="w-fit" size="sm">{label}</Button>);
export const post=(path:string,body:string)=>html(<form method="post" action={path} className="flex max-w-xl flex-col gap-3" dangerouslySetInnerHTML={fragment(body)}/>);
export const hidden=(n:string,v:string)=>html(<input type="hidden" name={n} value={v}/>);
export const field=(n:string,label:string,value="",type="text")=>html(<Label className="grid gap-1.5 leading-normal"><span>{label}</span><Input name={n} type={type} defaultValue={value} autoComplete={type==="email"?"email":type==="password"?(n==="new_password"?"new-password":"current-password"):undefined}/></Label>);
export const check=(n:string,label:string,value:number)=>html(<Label className="flex items-center gap-2"><Input type="checkbox" name={n} defaultChecked={!!value} className="size-4 min-w-4 accent-primary p-0"/><span>{label}</span></Label>);
export const link=(path:string,name:string)=>html(<a className="font-medium underline-offset-4 hover:underline" href={path}>{name}</a>);
export const action=(path:string,name:string)=>html(<Button asChild variant="outline" size="sm"><a href={path}>{name}</a></Button>);
export const panel=(s:string)=>html(<Card className="gap-3 py-4 shadow-none"><CardContent className="flex min-w-0 flex-col gap-3 px-4" dangerouslySetInnerHTML={fragment(s)}/></Card>);
export const empty=(title:string,description:string)=>html(<Empty className="border-0 px-0 py-6"><EmptyHeader><EmptyMedia variant="icon"><Icon name="empty"/></EmptyMedia><EmptyTitle>{title}</EmptyTitle><EmptyDescription>{description}</EmptyDescription></EmptyHeader></Empty>);
export const chip=(value:string)=>html(<Badge variant="outline" className={["active","success","enabled","confirmed"].includes(value.toLowerCase())?"border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200": ["revoked","suspended","failed","disabled"].includes(value.toLowerCase())?"border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-200":"bg-muted text-muted-foreground"}>{value}</Badge>);
export const metric=(label:string,value:unknown,detail:string,symbol:string)=>html(<Card className="gap-2 py-3 shadow-none"><CardHeader className="flex items-center justify-between gap-3 px-4"><CardDescription>{label}</CardDescription><Icon name={symbol} className="size-4 text-muted-foreground"/></CardHeader><CardContent className="space-y-1 px-4"><p className="text-2xl font-semibold tracking-tight text-foreground tabular-nums">{String(value??"—")}</p><p className="text-xs">{detail}</p></CardContent></Card>);
export const panelHead=(title:string,detail:string,extra="")=>html(<div className="panel-head"><h2>{title}</h2>{extra&&<div dangerouslySetInnerHTML={fragment(extra)}/>}</div>);
export const notice=(message:string)=>html(<Alert><AlertDescription>{message}</AlertDescription></Alert>);
export const table=(cols:string[],rows:string[][])=>rows.length?html(<div className="rounded-lg border"><Table><TableHeader><TableRow>{cols.map((x,i)=><TableHead key={i} scope="col">{x}</TableHead>)}</TableRow></TableHeader><TableBody>{rows.map((row,i)=><TableRow key={i}>{row.map((x,j)=><TableCell key={j} className="max-w-96 whitespace-normal break-words" dangerouslySetInnerHTML={fragment(x)}/>)}</TableRow>)}</TableBody></Table></div>):empty("Nothing to display","New records will appear here.");
export const advancedTable=(cols:string[],rows:string[][])=>html(<div data-advanced-table="" className="min-w-0"><div data-table-fallback="" dangerouslySetInnerHTML={fragment(table(cols,rows))}/><div data-table-root=""/></div>);
export const fmt=(v:unknown)=>{if(!v)return "—";const d=utcDate(String(v));return Number.isFinite(d.getTime())?d.toLocaleString("en-AU",{timeZone:"Australia/Sydney",day:"numeric",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"}):"—";};
const headers={"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store","Referrer-Policy":"strict-origin","X-Content-Type-Options":"nosniff","Content-Security-Policy":"default-src 'none'; style-src 'unsafe-inline'; script-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"};
const adminTitles=new Set(["Administration","Users","All timetables","User timetable","Invitations","Audit","Invitation created","System health"]);
const settingsTitles=new Set(["Settings","Account","Calendar subscription","Devices","Sync history","Pairing code"]);
const ThemeToggle=()=> <Button variant="ghost" size="sm" type="button" data-theme-toggle="" aria-label="Change color theme"><SunMoon className="size-4"/><span data-theme-label="" className="hidden sm:inline">System</span></Button>;
const Logout=()=> <form method="post" action="/auth/logout"><Button variant="ghost" size="sm" type="submit">Sign out</Button></form>;
export function page(title:string,body:string,u?:User|null,status=200){
 const admin=!!u&&(adminTitles.has(title)||body.includes("aria-label='Administration'"));
 const heading=settingsTitles.has(title)?"Settings":title==="Dashboard"?"Timetable":title;
 const schedulePage=title==="Timetable"||title==="User timetable";
 const main=<main id="main" className="mx-auto w-full max-w-5xl space-y-3 px-3 py-3 sm:px-4">{schedulePage?<h1 className="sr-only">{title}</h1>:<h1 className="text-base font-semibold">{heading}</h1>}<div dangerouslySetInnerHTML={fragment(body)}/></main>;
 const content=u?<div data-workspace="" className="min-h-screen"><a href="#main" className="sr-only focus:not-sr-only">Skip to content</a><header className="no-print sticky top-0 z-20 flex h-12 items-center gap-2 border-b bg-background px-3 sm:px-4">{admin?<a href="/admin/dashboard" className="font-semibold tracking-tight">Admin</a>:<a href="/app/timetable" className="font-semibold tracking-tight">Seqta</a>}{!admin&&<nav aria-label="Main navigation" className="topnav"><a href="/app/timetable" aria-current={title==="Timetable"?"page":undefined}>Timetable</a><a href="/app/account" aria-current={heading==="Settings"?"page":undefined}>Settings</a></nav>}<div className="ml-auto flex items-center gap-1"><ThemeToggle/><Logout/></div></header>{main}<div id="interactive-workspace" data-admin={isAdmin(u)?"yes":"no"}/></div>:<div className="grid min-h-screen place-items-center p-5"><main className="w-full max-w-sm space-y-5"><div className="flex items-center justify-between"><a href="/" className="font-semibold tracking-tight">Seqta Link</a><ThemeToggle/></div><h1 className="text-base font-semibold">{heading}</h1><div className="space-y-3" dangerouslySetInnerHTML={fragment(body)}/><div className="flex justify-center gap-4 text-xs text-muted-foreground"><a href="/app/login">Student sign in</a><a href="/admin/login">Admin sign in</a></div></main></div>;
 return new Response("<!doctype html>"+html(<html lang="en"><head><meta charSet="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"/><title>{`${title} | Seqta Link`}</title><script src="/assets/ui-v4.js"/>{u&&<script defer src="/assets/interactive-v4.js"/>}<style dangerouslySetInnerHTML={fragment(css)}/></head><body>{content}</body></html>),{status,headers});
}
type Marked={row:LessonRow;cancelled:boolean;changed:boolean;start:number;end:number};
type DayEntry={kind:"break";start:number;end:number}|{kind:"lesson";item:Marked};
function DayItem({entry,hour,current}:{entry:DayEntry;hour:"12"|"24";current:boolean}){
 switch(entry.kind){
  case "break":return <div className="slot slot-break"><span className="slot-time">{clockLabel(entry.start,hour)}<small>{clockLabel(entry.end,hour)}</small></span><span className="slot-mark"/><span className="slot-body">Break</span></div>;
  case "lesson":return <LessonSlot item={entry.item} hour={hour} current={current}/>;
  default:{const exhaustive:never=entry;return exhaustive;}
 }
}
function markedRows(rows:LessonRow[],cancelled:boolean,changed:ReadonlySet<string>){
 const out:Marked[]=[];
 for(const row of rows){const start=minuteOfDay(row.starts_at_utc),end=minuteOfDay(row.ends_at_utc);if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start)continue;out.push({row,cancelled,changed:!cancelled&&changed.has(String(row.id||"")),start,end});}
 return out;
}
export function lessonList(rows:LessonRow[],cancelled:LessonRow[],changed:ReadonlySet<string>,today:string,hour:"12"|"24"="24",now=new Date()){
 const dates=[...new Set([...rows,...cancelled].map(r=>String(r.local_date||"")))].filter(Boolean).sort();
 if(!dates.length)return empty("No lessons","Nothing scheduled.");
 const nowMin=minuteOfDay(now.toISOString());
 return html(<div className="day-list">{dates.map(date=>{
  const marks=[...markedRows(rows.filter(r=>r.local_date===date),false,changed),...markedRows(cancelled.filter(r=>r.local_date===date),true,changed)].sort((a,b)=>a.start-b.start||a.end-b.end||String(a.row.title||"").localeCompare(String(b.row.title||"")));
  const items:DayEntry[]=[];
  let lastEnd=-1;
  for(const item of marks){if(lastEnd>=0&&item.start-lastEnd>=10)items.push({kind:"break",start:lastEnd,end:item.start});items.push({kind:"lesson",item});lastEnd=Math.max(lastEnd,item.end);}
  return <section key={date} className="day-block">{dates.length>1&&<h3>{dateLabel(date)}{date===today?" · Today":""}</h3>}{items.map((entry,i)=><DayItem key={date+"-"+entry.kind+"-"+i} entry={entry} hour={hour} current={entry.kind==="lesson"&&!entry.item.cancelled&&date===today&&entry.item.start<=nowMin&&nowMin<entry.item.end}/>)}</section>;
 })}</div>);
}
function LessonSlot({item,hour,current}:{item:Marked;hour:"12"|"24";current:boolean}){
 const title=String(item.row.title||"Lesson"),room=item.row.room?String(item.row.room):"";
 const label=[title,clockLabel(item.start,hour)+"–"+clockLabel(item.end,hour),room,item.cancelled?"Cancelled":item.changed?"Changed":""].filter(Boolean).join(", ");
 return <button type="button" className="slot" data-current={current?"true":"false"} data-cancelled={item.cancelled?"true":undefined} data-lesson={lessonDetails(item.row,hour)} data-event-start={item.cancelled?undefined:utcDate(String(item.row.starts_at_utc)).getTime()} data-event-end={item.cancelled?undefined:utcDate(String(item.row.ends_at_utc)).getTime()} data-course={String(item.row.course_code||item.row.title||"")} data-course-title={title} aria-label={label}><span className="slot-time">{lessonTime(item.row.starts_at_utc,hour)}<small>{lessonTime(item.row.ends_at_utc,hour)}</small></span><span className={"slot-mark c"+courseColor(item.row)}/><span className="slot-body"><strong>{title}</strong>{item.cancelled&&<span className="slot-note">Cancelled</span>}{item.changed&&<span className="slot-note">Changed</span>}</span>{room&&<span className="slot-room">{room}</span>}</button>;
}
export function timeline(rows:LessonRow[],from:string,until:string,view:"week"|"day",now=new Date(),base="/app/timetable",hour:"12"|"24"="24",free:Record<string,{start:number;end:number}[]>={},school:Record<string,{holiday:string|null;term:string|null}>={},locate=false){
 void free;
 const today=todaySydney(now),days=Array.from({length:Math.min(7,dayCount(from,until))},(_,i)=>shiftDate(from,i));
 const selected=days.filter(date=>view==="day"||new Date(date+"T00:00:00Z").getUTCDay()%6!==0||rows.some(r=>r.local_date===date));
 const display=selected.length?selected:days;
 const byDay=display.map(date=>({date,slots:placeLessons(rows.filter(r=>r.local_date===date))}));
 const {start,end}=timeWindow(byDay.flatMap(d=>d.slots));const hourHeight=60,scale=hourHeight/60,height=(end-start)*scale;
 const ticks=Array.from({length:(end-start)/60+1},(_,i)=>start+i*60);const current=minuteOfDay(now.toISOString());
 const props={"--days":display.length,"--hour-height":hourHeight+"px"} as CSSProperties;
 return html(<div className="calendar-scroll" role="region" aria-label="Time-grid timetable" tabIndex={0} data-autolocate={locate?"yes":"no"}><div className="calendar-grid calendar-head" data-view={view} style={props}><div/>{byDay.map(({date})=><div key={date} className="calendar-day-head"><a href={scheduleLink(date,date,"day",base)} aria-label={"Open "+dateLabel(date)}><span className="text-xs text-muted-foreground">{weekday(date)}</span><span className={date===today?"grid size-7 place-items-center rounded-full bg-foreground font-semibold text-background":"grid size-7 place-items-center font-semibold"}>{Number(date.slice(-2))}</span>{school[date]?.holiday&&<small className="max-w-28 truncate">{school[date].holiday}</small>}</a></div>)}</div><div className="calendar-grid" data-view={view} style={props}><div className="calendar-time-axis" style={{height}}>{ticks.map(t=><span key={t} className="calendar-time-label text-[11px] text-muted-foreground" style={{top:(t-start)*scale}}>{clockLabel(t,hour)}</span>)}</div>{byDay.map(({date,slots})=><div key={date} className="calendar-day" data-today={date===today} data-calendar-date={date} style={{height}}>{slots.map((s,i)=>{const duration=(s.end-s.start)*scale,title=String(s.row.title??"Lesson"),details=[title,minuteLabel(s.start)+"–"+minuteLabel(s.end),s.row.room,s.row.teacher].filter(Boolean).join(" · ");return <button type="button" key={i} aria-label={details} title={details} data-lesson={lessonDetails(s.row,hour)} data-event-start={utcDate(String(s.row.starts_at_utc)).getTime()} data-event-end={utcDate(String(s.row.ends_at_utc)).getTime()} className="calendar-event" data-course={String(s.row.course_code||s.row.title||"")} data-course-title={title} data-color={courseColor(s.row)} data-short={duration<32} data-start={minuteLabel(s.start)} data-end={minuteLabel(s.end)} style={{top:(s.start-start)*scale,height:Math.max(1,duration-1),left:"calc("+(s.lane/s.lanes*100)+"% + 3px)",width:"calc("+(100/s.lanes)+"% - 6px)"}}><strong>{title}</strong><span>{clockLabel(s.start,hour)}–{clockLabel(s.end,hour)}</span>{!!s.row.room&&<span>{String(s.row.room)}</span>}</button>;})}{<div className="calendar-now" data-time-start={start} data-time-end={end} data-time-scale={scale} hidden={date!==today||current<start||current>end} aria-label={"Current time "+minuteLabel(current)} style={{top:(current-start)*scale}}/>}</div>)}</div></div>);
}
export function timetableControls(from:string,until:string,view:"week"|"day",today:string,base="/app/timetable",mobileDefault=false,meta?:{week?:string|null;holiday?:string|null}){
 const navLink=(f:string,t:string,v:"week"|"day")=>scheduleLink(f,t,v,base);
 const start=weekStart(today),end=shiftDate(start,6),step=view==="day"?1:7;
 const spanLabel=from===until?dateLabel(from):shortDate(from)+" – "+shortDate(until);
 const weekView=view==="week",dayView=view==="day";
 const flag=[meta?.week?"Week "+meta.week:"",meta?.holiday||""].filter(Boolean).join(" · ");
 return html(<div className="no-print flex flex-wrap items-center gap-2" data-mobile-default-day={mobileDefault?navLink(today,today,"day"):undefined}><Button asChild variant="outline" size="icon-sm"><a aria-label="Previous week or day" href={navLink(shiftDate(from,-step),shiftDate(until,-step),view)}><ChevronLeft/></a></Button><Button asChild variant="outline" size="icon-sm"><a aria-label="Next week or day" href={navLink(shiftDate(from,step),shiftDate(until,step),view)}><ChevronRight/></a></Button><Button asChild variant="outline" size="sm"><a href={view==="day"?navLink(today,today,"day"):navLink(start,end,"week")}>Today</a></Button><h2 className="text-sm font-semibold">{spanLabel}</h2>{flag&&<span className="week-flag">{flag}</span>}<span data-date-picker="" data-from={from} data-today={today} data-base={base} data-view={view}/><ButtonGroup aria-label="Timetable views" className="ml-auto"><Button asChild size="sm" variant={weekView?"secondary":"ghost"}><a aria-current={weekView?"page":undefined} href={navLink(weekStart(from),shiftDate(weekStart(from),6),"week")}>Week</a></Button><Button asChild size="sm" variant={dayView?"secondary":"ghost"}><a aria-current={dayView?"page":undefined} href={navLink(from<=today&&today<=until?today:from,from<=today&&today<=until?today:from,"day")}>Day</a></Button></ButtonGroup></div>);
}
const clientNames:Record<string,string>={apple:"Apple Calendar",google:"Google Calendar",outlook:"Outlook",thunderbird:"Thunderbird",calendar:"Calendar client",browser:"Browser",other:"Other client",unknown:"Unknown client"};
function SubscriptionRow({origin,entry,index,enabled}:{origin:string;entry:SubscriptionLink;index:number;enabled:boolean}){
 const url=entry.raw?origin+"/calendar/"+entry.raw+".ics":"",webcal=url.replace(/^https?:\/\//,"webcal://"),inputId="calendar-url-"+index;
 const clients=entry.clients.map(c=>clientNames[c.client]||"Unknown client").join(", ");
 return <div className="sub-row" data-subscription-row="">
  <div className="flex flex-wrap items-baseline justify-between gap-2"><strong className="break-all">{entry.label}</strong><span className="text-xs text-muted-foreground">{[clients,entry.lastUsedAt?"Last fetched "+fmt(entry.lastUsedAt):"Not fetched yet"].filter(Boolean).join(" · ")}</span></div>
  {url?<div className="mt-2 flex min-w-0 flex-wrap items-center gap-2"><InputGroup className="min-w-0 flex-1 basis-56"><InputGroupInput id={inputId} aria-label={"Subscription URL for "+entry.label} readOnly value={url} className="font-mono text-xs" autoComplete="off"/><InputGroupAddon align="inline-end"><Button type="button" variant="ghost" size="sm" data-copy-input={inputId} aria-label={"Copy link for "+entry.label}><Copy className="size-3.5"/><span data-copy-label="">Copy link</span></Button></InputGroupAddon></InputGroup><Button asChild variant="outline" size="sm"><a href={webcal}><ExternalLink className="size-3.5"/>Subscribe</a></Button></div>:<p className="mt-2 font-mono text-xs text-muted-foreground">{entry.prefix}… {enabled?"Original URL cannot be recovered":"Feed disabled"}</p>}
  <p aria-live="polite" data-copy-feedback="" className="text-xs empty:hidden"></p>
  <div className="mt-2 flex flex-wrap items-center gap-2"><form method="post" action={"/app/calendar/subscriptions/"+encodeURIComponent(entry.id)+"/rename"} className="flex min-w-40 flex-1 items-center gap-2"><Input aria-label="Subscription name" name="label" defaultValue={entry.label} maxLength={80} required/><Button variant="outline" size="sm" type="submit">Rename</Button></form><form method="post" action={"/app/calendar/subscriptions/"+encodeURIComponent(entry.id)+"/revoke"} data-confirm="Revoke this subscription? Its URL will stop working."><input type="hidden" name="confirm" value="revoke"/><Button variant="ghost" size="sm" type="submit" className="text-destructive"><Trash2 className="size-3.5"/>Revoke</Button></form></div>
 </div>;
}
export function subscriptionPanel(origin:string,entries:SubscriptionLink[],enabled:boolean,lastSync:string){
 const staging=new URL(origin).hostname.endsWith(".workers.dev");
 return html(<div className="space-y-3">
  <p className="sync-meta">Last sync {lastSync}</p>
  {staging&&<Alert className="py-2"><Info className="size-4"/><AlertDescription>Staging requires Access login. External subscriptions work after production cutover.</AlertDescription></Alert>}
  {enabled&&<form method="post" action="/app/calendar/create" className="flex flex-wrap items-center gap-2"><InputGroup className="min-w-0 flex-1 basis-44"><InputGroupAddon><Plus className="size-4"/></InputGroupAddon><InputGroupInput name="label" aria-label="New subscription name" placeholder="Name" maxLength={80} required/></InputGroup><Button size="sm" type="submit">Add link</Button></form>}
  {enabled&&!entries.some(e=>e.raw)&&<form method="post" action="/app/calendar/create"><Button variant="outline" type="submit" size="sm">Create subscription link</Button></form>}
  {entries.length?entries.map((e,i)=><SubscriptionRow key={e.id} origin={origin} entry={e} index={i} enabled={enabled}/>):<p>No subscriptions</p>}
  <p className="text-xs">Anyone with a link can read this timetable.</p>
  {enabled&&entries.length>0&&<details><summary className="cursor-pointer text-xs text-destructive">Rotate all links</summary><form method="post" action="/app/calendar/rotate" className="mt-2 flex flex-wrap items-center gap-2"><Input name="confirm" aria-label="Type rotate to confirm" placeholder="Type rotate" className="max-w-56" required autoComplete="off"/><Button variant="destructive" size="sm" type="submit">Rotate</Button></form></details>}
 </div>);
}
