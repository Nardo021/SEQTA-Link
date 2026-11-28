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
function live(){
 var t=Date.now();
 document.querySelectorAll("[data-live-day]").forEach(function(el){
  var rows;try{rows=JSON.parse(el.getAttribute("data-live-day"));}catch(_){return;}
  var current=rows.filter(function(r){return r.start<=t&&t<r.end;}),active=current[0],next=rows.find(function(r){return r.start>t;});
  function set(name,value){var node=el.querySelector("[data-live-"+name+"]");if(node)node.textContent=value;}
  var focus=active||next;
  set("state",active?"Now":next?"Next":"");
  set("current",active?current.map(function(r){return r.title;}).join(" / "):next?next.title:"");
  set("meta",focus?[focus.time,focus.room].filter(Boolean).join(" · "):"");
  el.hidden=!focus;
 });
 document.querySelectorAll("[data-event-start]").forEach(function(el){var start=Number(el.dataset.eventStart),end=Number(el.dataset.eventEnd);el.setAttribute("data-current",String(start<=t&&t<end));el.setAttribute("data-past",String(end<=t));});
}
function locateCurrent(auto){
 var grid=Array.from(document.querySelectorAll(".calendar-scroll")).find(function(g){return g.querySelector("[data-today=true]");})||document.querySelector(".calendar-scroll");if(!grid||auto&&grid.dataset.autolocate!=="yes")return;
 var target=grid.querySelector("[data-current=true]")||grid.querySelector("[data-today=true] .calendar-now:not([hidden])")||grid.querySelector("[data-today=true]");
 if(target)target.scrollIntoView({block:"nearest",inline:"center",behavior:auto?"auto":"smooth"});
}
function now(){live();
 var f=new Intl.DateTimeFormat("en-CA",{timeZone:"Australia/Sydney",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"});
 var p={};f.formatToParts(new Date()).forEach(function(x){p[x.type]=x.value;});
 var date=p.year+"-"+p.month+"-"+p.day,m=Number(p.hour)*60+Number(p.minute);
 document.querySelectorAll("[data-calendar-date]").forEach(function(el){
  var today=el.getAttribute("data-calendar-date")===date;el.setAttribute("data-today",String(today));
  var line=el.querySelector("[data-time-start]");if(!line)return;
  var start=Number(line.getAttribute("data-time-start")),end=Number(line.getAttribute("data-time-end")),scale=Number(line.getAttribute("data-time-scale"));
  line.hidden=!today||m<start||m>end;
  if(!line.hidden){line.style.top=((m-start)*scale)+"px";line.setAttribute("aria-label","Current time "+p.hour+":"+p.minute);}
 });
}
function placeIndicator(nav,animate){var mark=nav.querySelector(".nav-indicator");if(!mark){mark=document.createElement("span");mark.className="nav-indicator";mark.setAttribute("aria-hidden","true");nav.appendChild(mark);}var link=nav.querySelector("[aria-current=page]");if(!(link instanceof HTMLElement)||!(mark instanceof HTMLElement))return;var navBox=nav.getBoundingClientRect(),box=link.getBoundingClientRect();if(!animate)mark.style.transition="none";mark.style.width=box.width+"px";mark.style.height=box.height+"px";mark.style.transform="translate("+(box.left-navBox.left+nav.scrollLeft)+"px,"+(box.top-navBox.top+nav.scrollTop)+"px)";if(!animate){mark.getBoundingClientRect();mark.style.transition="";}}
function settingsSection(animate){var shell=document.querySelector(".settings-shell");if(!(shell instanceof HTMLElement))return;var hash=location.hash.slice(1),current=document.getElementById(hash)?hash:(shell.getAttribute("data-section")||"");shell.querySelectorAll(".settings-nav a").forEach(function(a){if(a.getAttribute("data-settings-link")===current)a.setAttribute("aria-current","page");else a.removeAttribute("aria-current");});var nav=shell.querySelector(".settings-nav");if(nav instanceof HTMLElement)placeIndicator(nav,animate);shell.querySelectorAll(".settings-section").forEach(function(el){el.classList.remove("is-entering");});var shown=document.getElementById(current);if(animate&&shown)shown.classList.add("is-entering");}
document.addEventListener("DOMContentLoaded",function(){apply();now();settingsSection(false);requestAnimationFrame(function(){requestAnimationFrame(function(){document.documentElement.classList.add("theme-ready");});});if(document.querySelector("[data-calendar-date],[data-live-day]"))setInterval(now,1000);locateCurrent(true);});
window.addEventListener("hashchange",function(){settingsSection(true);});
document.addEventListener("visibilitychange",function(){if(!document.hidden)now();});
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
