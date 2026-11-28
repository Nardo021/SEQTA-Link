import React from "react";
import {renderToStaticMarkup} from "react-dom/server.browser";
import {Button} from "./components/ui/button";
import {Input} from "./components/ui/input";
import {Label} from "./components/ui/label";
import {Textarea} from "./components/ui/textarea";
import {NativeSelect,NativeSelectOption} from "./components/ui/native-select";
import {utcDate} from "./common";
import {courseColor,type LessonRow,todaySydney} from "./schedule";
import {type Prefs,courseRule,courseKey,displayLesson,formatTerms,lessonTime} from "./school";
const html=(n:React.ReactNode)=>renderToStaticMarkup(n);
export function nowLine(rows:LessonRow[],p:Prefs,nowMs=Date.now()){
 const now=nowMs,today=todaySydney(new Date(now));
 const lessons=rows.map(r=>displayLesson(p,r)).filter(r=>!r.ui_hidden).map(r=>({title:String(r.title||"Lesson"),start:utcDate(String(r.starts_at_utc)).getTime(),end:utcDate(String(r.ends_at_utc)).getTime(),date:String(r.local_date),time:lessonTime(r.starts_at_utc,p.hour)+" – "+lessonTime(r.ends_at_utc,p.hour),room:String(r.room||"")})).filter(r=>Number.isFinite(r.start)&&r.end>r.start).sort((a,b)=>a.start-b.start);
 const current=lessons.filter(r=>r.start<=now&&now<r.end),next=lessons.find(r=>r.start>now),active=current[0],focus=active||next;
 if(!focus)return "";
 return html(<p className="now-line" data-live-day={JSON.stringify(lessons)}><span data-live-state="">{active?"Now":"Next"}</span><strong data-live-current="">{active?current.map(r=>r.title).join(" / "):focus.title}</strong><span data-live-meta="">{[focus.time,focus.room].filter(Boolean).join(" · ")}</span></p>);
}
export function lessonSheet(){
 const fields=[["date","Date"],["time","Time"],["room","Room"],["teacher","Teacher"],["course","Course"],["period","Period"],["notes","Notes"]] as const;
 return html(<dialog id="lesson-sheet" className="lesson-sheet text-foreground" aria-labelledby="lesson-sheet-title"><div className="grid gap-3 p-4"><div className="flex items-start justify-between gap-3"><h2 id="lesson-sheet-title" data-detail="title" className="text-base font-semibold">Lesson</h2><button type="button" data-close-sheet="" className="text-sm text-muted-foreground" aria-label="Close lesson">Close</button></div><p data-detail="original" className="text-xs text-muted-foreground"></p><div className="grid gap-2">{fields.map(([k,label])=><div key={k} data-detail-row={k}><span className="text-xs text-muted-foreground">{label}</span><p data-detail={k} className="whitespace-pre-wrap break-words text-sm text-foreground">—</p></div>)}</div></div></dialog>);
}
export function appearanceForm(p:Prefs){
 return html(<form method="post" action="/app/account" className="settings-form"><input type="hidden" name="action" value="display"/><input type="hidden" name="settings_section" value="appearance"/><input type="hidden" name="terms" value={formatTerms(p)}/><div className="setting-row"><span>Default view</span><NativeSelect name="view" defaultValue={p.view} aria-label="Default view"><NativeSelectOption value="week">Week</NativeSelectOption><NativeSelectOption value="day">Day</NativeSelectOption></NativeSelect></div><div className="setting-row"><span>Time format</span><NativeSelect name="hour" defaultValue={p.hour} aria-label="Time format"><NativeSelectOption value="24">24-hour</NativeSelectOption><NativeSelectOption value="12">12-hour</NativeSelectOption></NativeSelect></div><Label className="setting-row"><span>Scroll to the current lesson</span><input data-enhance-switch="" name="locate" type="checkbox" defaultChecked={p.locate} className="size-4 accent-primary"/></Label><Button type="submit" size="sm" className="w-fit">Save</Button></form>);
}
export function termsForm(p:Prefs){
 return html(<form method="post" action="/app/account" className="settings-form"><input type="hidden" name="action" value="display"/><input type="hidden" name="settings_section" value="calendar"/><input type="hidden" name="view" value={p.view}/><input type="hidden" name="hour" value={p.hour}/>{p.locate&&<input type="hidden" name="locate" value="on"/>}<Label className="grid gap-1.5">School dates<Textarea name="terms" rows={4} defaultValue={formatTerms(p)} placeholder={"Term 4 | YYYY-MM-DD | YYYY-MM-DD | A\nHoliday | YYYY-MM-DD | YYYY-MM-DD"}/></Label><Button type="submit" size="sm" className="w-fit">Save dates</Button></form>);
}
export function courseEditor(p:Prefs,courses:LessonRow[]){
 if(!courses.length)return html(<p className="setting-empty">No courses synced yet.</p>);
 return html(<div className="course-list">{courses.map((r,i)=>{const key=courseKey(r),rule=courseRule(p,r),id="course-open-"+i;return <div className="course-item" key={key}><input className="course-open" type="radio" name="course-open" id={id}/><label htmlFor={id}><span className={"slot-mark c"+courseColor({...r,ui_color:rule?.color})}/><span className="min-w-0"><span className="block truncate font-medium text-foreground">{String(r.title||r.course_code)}</span>{!!r.course_code&&<small>{String(r.course_code)}</small>}</span></label><form method="post" action="/app/account"><input type="hidden" name="action" value="course"/><input type="hidden" name="course" value={key}/><Label className="grid gap-1">Name<Input name="name" defaultValue={rule?.name||""} placeholder="Original name" maxLength={100}/></Label><Label className="grid gap-1">Colour<NativeSelect name="color" defaultValue={String(rule?.color??-1)} size="sm">{["Auto","Blue","Green","Violet","Amber","Rose","Cyan"].map((name,j)=><NativeSelectOption key={name} value={String(j-1)}>{name}</NativeSelectOption>)}</NativeSelect></Label><div className="course-actions"><Label className="flex items-center gap-2"><input data-enhance-switch="" type="checkbox" name="hidden" defaultChecked={rule?.hidden||false} className="size-4 accent-primary"/>Hide</Label><Button type="submit" size="sm" variant="outline">Save</Button></div></form></div>;})}</div>);
}
