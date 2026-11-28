export const clientScript=`(function(){
"use strict";
var key="seqta-ui-theme",motionKey="seqta-motion",media=matchMedia("(prefers-color-scheme: dark)"),mode="system",motion="enter";
try{var stored=sessionStorage.getItem(motionKey);if(stored==="back"||stored==="forward"||stored==="view")motion=stored;sessionStorage.removeItem(motionKey);}catch(_){}
document.documentElement.setAttribute("data-motion",motion);
try{var saved=localStorage.getItem(key);if(["light","dark","system"].includes(saved))mode=saved;}catch(_){}
function apply(){
 document.documentElement.classList.toggle("dark",mode==="dark"||(mode==="system"&&media.matches));
 document.querySelectorAll("[data-theme-label]").forEach(function(el){el.textContent=mode.charAt(0).toUpperCase()+mode.slice(1);});
 document.querySelectorAll("[data-theme-toggle]").forEach(function(el){el.setAttribute("aria-label","Theme: "+mode+". Click to switch.");});
}
apply();if(media.addEventListener)media.addEventListener("change",apply);else media.addListener(apply);
function nextDate(v){var d=new Date(v+"T00:00:00Z");d.setUTCDate(d.getUTCDate()+1);return d.toISOString().slice(0,10);}
function left(ms){var min=Math.max(1,Math.ceil(ms/60000));if(min<60)return min===1?"1 min":min+" min";var hour=Math.floor(min/60),rest=min%60;return rest?hour+" h "+rest+" min":hour===1?"1 h":hour+" h";}
function liveNote(trust){if(trust==="current")return "";if(trust==="failed")return "Saved timetable. The last school check did not succeed.";if(trust==="incomplete")return "Saved timetable. The last school check was incomplete.";if(trust==="stale")return "Saved timetable. The last school check is not recent.";return "No school check from the browser yet.";}
function liveView(data,now,today){
 var covered={};
 (data.covered||[]).forEach(function(date){covered[date]=true;});
 var lessons=(data.lessons||[]).filter(function(row){return row&&!row.cancelled&&covered[row.date]&&isFinite(row.start)&&row.end>row.start;}).sort(function(a,b){return a.start-b.start||a.end-b.end||String(a.title).localeCompare(String(b.title));});
 var trust=data.trust||"unchecked",note=liveNote(trust),holiday=String(data.holiday||"").trim();
 var view={state:"",title:"",meta:"",next:"",progress:null,focus:"",focusAt:null,stale:trust!=="current",note:note};
 if(holiday){view.state="Holiday";view.title=holiday;return view;}
 if(!covered[today]){view.state="Schedule incomplete";view.title="Not enough saved school data";return view;}
 var todayRows=lessons.filter(function(row){return row.date===today;});
 if(!todayRows.length){view.state="No lessons";view.title="Nothing scheduled today";return view;}
 function upcoming(after){return lessons.filter(function(row){return row.start>after;});}
 function future(){
  var candidate=upcoming(now)[0];if(!candidate)return "";
  var label="Next",date=nextDate(today);
  if(candidate.date!==today){while(date<=candidate.date){if(!covered[date]){label="Next known";break;}date=nextDate(date);}}
  return label+" "+[candidate.title,candidate.clock,candidate.room,"in "+left(candidate.start-now)].filter(Boolean).join(" · ");
 }
 var first=todayRows[0],last=todayRows.reduce(function(end,row){return Math.max(end,row.end);},0);
 var current=todayRows.filter(function(row){return row.start<=now&&now<row.end;});
 var later=todayRows.filter(function(row){return row.start>now;});
 if(now<first.start){view.state="Before school";view.title=first.title;view.meta=["Starts in "+left(first.start-now),first.clock,first.room].filter(Boolean).join(" · ");view.focus="first";view.focusAt=first.start;return view;}
 if(current.length){
  var ending=current.slice().sort(function(a,b){return a.end-b.end||a.start-b.start;})[0],primary=current[0],span=ending.end-ending.start,following=upcoming(now)[0];
  var rooms=[],names=current.map(function(row){var room=String(row.room||"").trim();if(room&&rooms.indexOf(room)<0)rooms.push(room);return row.title;});
  var next=following&&following.date===today?[following.title,following.clock,following.room,"in "+left(following.start-now)].filter(Boolean).join(" · "):future();
  view.state="Now";view.title=names.join(" / ");view.meta=[rooms.join(" / "),left(ending.end-now)+" left"].filter(Boolean).join(" · ");view.next=next&&next.indexOf("Next")!==0?"Next "+next:next;view.progress=span>0?Math.min(1,Math.max(0,(now-ending.start)/span)):0;view.focus="current";view.focusAt=primary.start;return view;
 }
 if(now<last&&later.length){var nextLesson=later[0];view.state="Between lessons";view.title=nextLesson.title;view.meta=["in "+left(nextLesson.start-now),nextLesson.clock,nextLesson.room].filter(Boolean).join(" · ");view.focus="next";view.focusAt=nextLesson.start;return view;}
 view.state="School day complete";view.next=future();return view;
}
function paintLive(el,view){
 function set(name,value){var node=el.querySelector("[data-live-"+name+"]");if(node)node.textContent=value||"";}
 set("state",view.state);set("current",view.title);set("meta",view.meta);set("next",view.next);set("note",view.note);
 var next=el.querySelector("[data-live-next]"),bar=el.querySelector("[data-live-progress]"),note=el.querySelector("[data-live-note]");
 if(next)next.hidden=!view.next;if(note)note.hidden=!view.note;
 if(bar){bar.hidden=view.progress==null;var fill=bar.firstElementChild;if(fill instanceof HTMLElement&&view.progress!=null)fill.style.width=(view.progress*100)+"%";}
 el.setAttribute("data-stale",view.stale?"true":"false");
 document.querySelectorAll("[data-event-start]").forEach(function(node){var start=Number(node.getAttribute("data-event-start"));if(view.focus&&start===view.focusAt)node.setAttribute("data-focus",view.focus);else node.removeAttribute("data-focus");});
}
function live(){
 var t=Date.now(),clock=sydneyClock();
 document.querySelectorAll("[data-live-day]").forEach(function(el){
  var data;try{data=JSON.parse(el.getAttribute("data-live-day"));}catch(_){return;}
  if(!data||!data.lessons)return;
  paintLive(el,liveView(data,t,clock.date));
 });
 document.querySelectorAll("[data-event-start]").forEach(function(el){var start=Number(el.dataset.eventStart),end=Number(el.dataset.eventEnd);el.setAttribute("data-current",String(start<=t&&t<end));el.setAttribute("data-past",String(end<=t));});
}
var didLocate=false;
function locateCurrent(auto){
 if(auto&&didLocate)return;
 var root=document.querySelector(".calendar-scroll[data-autolocate=yes],.day-list[data-autolocate=yes]");if(!root)return;
 var target=root.querySelector("[data-focus=current],[data-focus=next],[data-focus=first]")||root.querySelector("[data-today=true] .calendar-now:not([hidden])")||root.querySelector("[data-today=true]");
 if(target)target.scrollIntoView({block:"nearest",inline:"center",behavior:auto?"auto":"smooth"});
 if(auto)didLocate=true;
}
function sydneyClock(){
 var f=new Intl.DateTimeFormat("en-CA",{timeZone:"Australia/Sydney",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"});
 var p={};f.formatToParts(new Date()).forEach(function(x){p[x.type]=x.value;});
 return {date:p.year+"-"+p.month+"-"+p.day,minutes:Number(p.hour)*60+Number(p.minute),seconds:Number(p.second),hour:p.hour,minute:p.minute};
}
function now(){live();
 var clock=sydneyClock(),date=clock.date,m=clock.minutes;
 document.querySelectorAll("[data-calendar-date]").forEach(function(el){
  var today=el.getAttribute("data-calendar-date")===date;el.setAttribute("data-today",String(today));
  var line=el.querySelector("[data-time-start]");if(!line)return;
  var start=Number(line.getAttribute("data-time-start")),end=Number(line.getAttribute("data-time-end")),scale=Number(line.getAttribute("data-time-scale"));
  line.hidden=!today||m<start||m>end;
  if(!line.hidden){line.style.top=((m-start)*scale)+"px";line.setAttribute("aria-label","Current time "+clock.hour+":"+clock.minute);}
 });
}
var liveTimer=0;
function nextDelay(){
 var wait=60000,nowMs=Date.now(),clock=sydneyClock();
 function consider(at){if(at>nowMs)wait=Math.min(wait,at-nowMs);}
 document.querySelectorAll("[data-live-day]").forEach(function(el){var data;try{data=JSON.parse(el.getAttribute("data-live-day"));}catch(_){return;}(data.lessons||[]).forEach(function(row){consider(row.start);consider(row.end);});});
 var dayLeft=((24*60-clock.minutes)*60-clock.seconds)*1000,minuteLeft=(60-clock.seconds)*1000;
 if(dayLeft>0)wait=Math.min(wait,dayLeft);if(minuteLeft>0)wait=Math.min(wait,minuteLeft);
 return Math.max(250,wait+30);
}
function scheduleLive(){
 if(liveTimer){clearTimeout(liveTimer);liveTimer=0;}
 if(document.hidden||!document.querySelector("[data-calendar-date],[data-live-day]"))return;
 now();liveTimer=setTimeout(scheduleLive,nextDelay());
}
function placeIndicator(nav,animate){var mark=nav.querySelector(".nav-indicator");if(!mark){mark=document.createElement("span");mark.className="nav-indicator";mark.setAttribute("aria-hidden","true");nav.appendChild(mark);}var link=nav.querySelector("[aria-current=page]");if(!(link instanceof HTMLElement)||!(mark instanceof HTMLElement))return;var navBox=nav.getBoundingClientRect(),box=link.getBoundingClientRect();if(!animate)mark.style.transition="none";mark.style.width=box.width+"px";mark.style.height=box.height+"px";mark.style.transform="translate("+(box.left-navBox.left+nav.scrollLeft)+"px,"+(box.top-navBox.top+nav.scrollTop)+"px)";if(!animate){mark.getBoundingClientRect();mark.style.transition="";}}
function settingsSection(animate){var shell=document.querySelector(".settings-shell");if(!(shell instanceof HTMLElement))return;var hash=location.hash.slice(1),current=document.getElementById(hash)?hash:(shell.getAttribute("data-section")||"");shell.querySelectorAll(".settings-nav a").forEach(function(a){if(a.getAttribute("data-settings-link")===current)a.setAttribute("aria-current","page");else a.removeAttribute("aria-current");});var nav=shell.querySelector(".settings-nav");if(nav instanceof HTMLElement)placeIndicator(nav,animate);shell.querySelectorAll(".settings-section").forEach(function(el){el.classList.remove("is-entering");});var shown=document.getElementById(current);if(animate&&shown)shown.classList.add("is-entering");}
document.addEventListener("DOMContentLoaded",function(){apply();settingsSection(false);requestAnimationFrame(function(){requestAnimationFrame(function(){document.documentElement.classList.add("theme-ready");});});scheduleLive();locateCurrent(true);});
window.addEventListener("hashchange",function(){settingsSection(true);});
document.addEventListener("visibilitychange",function(){if(document.hidden){if(liveTimer){clearTimeout(liveTimer);liveTimer=0;}}else scheduleLive();});
document.addEventListener("submit",function(event){var f=event.target;if(f instanceof HTMLFormElement&&f.dataset.confirm&&f.dataset.confirmApproved!=="yes"&&document.documentElement.dataset.interactiveReady!=="yes"&&!window.confirm(f.dataset.confirm))event.preventDefault();});
document.addEventListener("click",async function(event){
 var target=event.target instanceof Element?event.target:null;if(!target)return;
 var anchor=target.closest("a[href]");
 if(anchor instanceof HTMLAnchorElement&&event.button===0&&!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&!event.altKey&&!anchor.closest(".settings-nav")){
  var kind="",label=anchor.getAttribute("aria-label")||"";
  if(label.indexOf("Previous")===0)kind="back";
  else if(label.indexOf("Next")===0)kind="forward";
  else if(anchor.closest("[aria-label='Timetable views']")||anchor.closest(".calendar-day-head"))kind="view";
  else if(anchor.closest(".schedule-toolbar")&&(anchor.textContent||"").trim()==="Today"){try{var nextFrom=new URL(anchor.href).searchParams.get("from")||"",currentFrom=new URL(location.href).searchParams.get("from")||"";kind=nextFrom&&currentFrom&&nextFrom!==currentFrom?(nextFrom<currentFrom?"back":"forward"):"view";}catch(_){kind="view";}}
  if(kind){try{sessionStorage.setItem(motionKey,kind);}catch(_){}}
 }
 if(target.closest("[data-theme-toggle]")){mode=mode==="system"?"light":mode==="light"?"dark":"system";try{localStorage.setItem(key,mode);}catch(_){}apply();return;}
 if(target.closest("[data-locate-current]")){locateCurrent(false);return;}
 var reveal=target.closest("[data-reveal-url]");
 if(reveal){var field=reveal.closest("[data-url-field]")?.querySelector("input");if(field instanceof HTMLInputElement){var open=field.getAttribute("data-revealed")==="yes",full=field.getAttribute("data-full-url")||field.value,mask=field.getAttribute("data-mask")||full;field.value=open?mask:full;field.setAttribute("data-revealed",open?"no":"yes");reveal.textContent=open?"Show":"Hide";}return;}
 var sheet=document.getElementById("lesson-sheet"),lesson=target.closest("[data-lesson]");
 if(lesson&&sheet instanceof HTMLDialogElement&&document.documentElement.dataset.interactiveReady!=="yes"){try{var d=JSON.parse(lesson.dataset.lesson);sheet.querySelectorAll("[data-detail]").forEach(function(node){node.textContent=d[node.dataset.detail]||"—";});var original=sheet.querySelector("[data-detail=original]");if(original)original.hidden=d.original===d.title;var notes=sheet.querySelector("[data-detail-row=notes]");if(notes)notes.hidden=!d.notes;if(!sheet.open)sheet.showModal();}catch(_){}return;}
 if(sheet instanceof HTMLDialogElement&&target.closest("[data-close-sheet]")){sheet.close();return;}
 var btn=target.closest("[data-copy-input]");if(!btn)return;
 var input=document.getElementById(btn.getAttribute("data-copy-input")),label=btn.querySelector("[data-copy-label]"),feedback=btn.closest("[data-subscription-row]")?.querySelector("[data-copy-feedback]")||document.querySelector("[data-copy-feedback]");
 if(!(input instanceof HTMLInputElement))return;
 var secret=input.getAttribute("data-full-url")||input.value;
 try{await navigator.clipboard.writeText(secret);if(label)label.textContent="Copied!";if(feedback)feedback.textContent="Subscription link copied.";document.dispatchEvent(new CustomEvent("seqta-toast",{detail:{message:"Subscription link copied"}}));setTimeout(function(){if(label)label.textContent="Copy link";if(feedback)feedback.textContent="";},2000);}
 catch(_){if(input.getAttribute("data-full-url"))input.value=secret;input.focus();input.select();if(feedback)feedback.textContent="Link selected. Press Ctrl+C or Command+C to copy.";document.dispatchEvent(new CustomEvent("seqta-toast",{detail:{message:"Clipboard unavailable; link selected.",kind:"error"}}));}
});
})();
`;
