import {expect,test} from "vitest";
import {localToUtc} from "../src/common";
import {liveState,scheduleTrust,shouldLocate,type LiveLesson} from "../src/live";
import {todaySydney} from "../src/schedule";

const day="2026-11-28";
const at=(hour:number,minute=0)=>Date.parse("2026-11-27T13:00:00Z")+((hour-0)*60+minute)*60000;
function lesson(title:string,start:number,end:number,extra:Partial<LiveLesson>={}):LiveLesson{
 return {title,room:"R1",date:day,start,end,clock:"09:00",...extra};
}
function view(now:number,lessons:LiveLesson[],covered:string[]=[day],holiday:string|null=null){
 return liveState({now,today:day,lessons,covered,holiday,trust:"current"});
}

test("timetable states stay inside authoritative coverage",()=>{
 const first=lesson("Music",at(9),at(9,50),{clock:"09:00"});
 const second=lesson("Business",at(10),at(10,50),{clock:"10:00",room:"R2"});
 expect(view(at(8,20),[first,second])).toMatchObject({kind:"before",title:"Music",focus:"first",focusAt:first.start,meta:"Starts in 40 min · 09:00 · R1"});
 const active=view(at(9,20),[first,second]);
 expect(active).toMatchObject({kind:"active",state:"Now",title:"Music",meta:"R1 · 30 min left",next:"Next Business · 10:00 · R2 · in 40 min",focus:"current"});
 expect(active.progress).toBeCloseTo(20/50);
 const between=view(at(9,55),[first,second]);
 expect(between.kind).toBe("between");
 expect(between.state).toBe("Between lessons");
 expect(between.meta).not.toMatch(/recess|lunch|break/i);
 expect(view(at(11),[first,second]).kind).toBe("done");
 expect(view(at(9),[],[day]).kind).toBe("empty");
 expect(view(at(9),[first],[]).kind).toBe("unknown");
 expect(view(at(9),[],[],"Holiday").kind).toBe("holiday");
 expect(view(at(9),[first],[day],"Holiday").title).toBe("Holiday");
});

test("cancelled and overlapping lessons do not invent the next class",()=>{
 const cancelled=lesson("Music",at(9),at(9,50),{cancelled:true});
 const replacement=lesson("Composition",at(9),at(9,50),{room:"Studio"});
 const overlap=lesson("Ensemble",at(9,10),at(9,40),{room:"Hall"});
 const active=view(at(9,20),[cancelled,replacement,overlap]);
 expect(active.title).toBe("Composition / Ensemble");
 expect(active.meta).toBe("Studio / Hall · 20 min left");
 expect(active.focusAt).toBe(replacement.start);
 expect(view(at(8),[cancelled]).kind).toBe("empty");
});

test("the next lesson is guaranteed only when the days before it are covered",()=>{
 const monday=lesson("Music",Date.parse("2026-11-30T22:00:00Z"),Date.parse("2026-11-30T22:50:00Z"),{date:"2026-11-30",clock:"09:00"});
 const friday=lesson("Business",at(9),at(9,50));
 const open=view(at(16),[friday,monday],["2026-11-28","2026-11-29","2026-11-30"]);
 expect(open.next.startsWith("Next Music")).toBe(true);
 const gap=view(at(16),[friday,monday],["2026-11-28","2026-11-30"]);
 expect(gap.next.startsWith("Next known Music")).toBe(true);
 expect(view(at(16),[friday,monday],["2026-11-28"]).next).toBe("");
});

test("Sydney midnight and daylight saving use the zone, not the machine zone",()=>{
 expect(todaySydney(new Date("2026-11-27T12:30:00Z"))).toBe("2026-11-27");
 expect(todaySydney(new Date("2026-11-27T13:30:00Z"))).toBe("2026-11-28");
 expect(todaySydney(new Date("2026-07-19T14:30:00Z"))).toBe("2026-07-20");
 expect(todaySydney(new Date("2026-07-19T13:30:00Z"))).toBe("2026-07-19");
 expect(()=>localToUtc("2026-10-04","02:30:00")).toThrow(/Nonexistent/);
 const now=Date.parse("2026-11-27T13:30:00Z");
 const early=liveState({now,today:todaySydney(new Date(now)),lessons:[lesson("Music",Date.parse("2026-11-27T22:00:00Z"),Date.parse("2026-11-27T22:50:00Z"))],covered:[day],holiday:null,trust:"current"});
 expect(early.kind).toBe("before");
});

test("focus stays on the opened day and stale checks are not described as current",()=>{
 expect(shouldLocate(true,"2026-11-23","2026-11-29",day)).toBe(true);
 expect(shouldLocate(true,"2026-11-30","2026-12-06",day)).toBe(false);
 expect(shouldLocate(false,"2026-11-23","2026-11-29",day)).toBe(false);
 const now=Date.parse("2026-11-28T00:00:00Z");
 expect(scheduleTrust({outcome:"unchanged",checked_at:new Date(now-60*60000).toISOString()},null,now)).toBe("current");
 expect(scheduleTrust({outcome:"failed",checked_at:new Date(now-60*60000).toISOString()},new Date(now-2*60*60000).toISOString(),now)).toBe("failed");
 expect(scheduleTrust({outcome:"skipped",checked_at:new Date(now-60*60000).toISOString()},null,now)).toBe("incomplete");
 expect(scheduleTrust(null,new Date(now-60*60000).toISOString(),now)).toBe("current");
 expect(scheduleTrust({outcome:"unchanged",checked_at:new Date(now-48*3600000).toISOString()},new Date(now-48*3600000).toISOString(),now)).toBe("stale");
 expect(scheduleTrust(null,null,now)).toBe("unchecked");
 const stale=liveState({now:at(9,20),today:day,lessons:[lesson("Music",at(9),at(9,50))],covered:[day],holiday:null,trust:"failed"});
 expect(stale.kind).toBe("active");
 expect(stale.stale).toBe(true);
 expect(stale.note).toMatch(/did not succeed/);
 expect(stale.note).not.toMatch(/confirmed/i);
});
