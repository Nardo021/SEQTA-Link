import {expect,test} from "vitest";
import {minuteOfDay,placeLessons,timeWindow,weekStart,courseColor,assignCourseColors,dayCount} from "../src/schedule";
const row=(start:string,end:string,course_code="MUSIC")=>({starts_at_utc:start,ends_at_utc:end,course_code,title:"Music"});
test("Sydney calendar positioning uses DST and exact duration",()=>{
 expect(minuteOfDay("2026-11-23T22:00:00Z")).toBe(540);
 expect(minuteOfDay("2026-07-20T23:00:00Z")).toBe(540);
 const slots=placeLessons([row("2026-11-23T22:00:00Z","2026-11-23T22:50:00Z"),row("2026-11-23T23:00:00Z","2026-11-23T23:50:00Z")]);
 expect(slots.map(s=>[s.start,s.end,s.lane,s.lanes])).toEqual([[540,590,0,1],[600,650,0,1]]);
 expect(timeWindow(slots)).toEqual({start:480,end:960});
 expect(weekStart("2026-11-26")).toBe("2026-11-23");
 expect(dayCount("2026-11-23","2026-11-29")).toBe(7);
});
test("overlapping events occupy independent lanes, adjacent events reset lanes",()=>{
 const slots=placeLessons([row("2026-11-23T22:00:00Z","2026-11-23T23:00:00Z"),row("2026-11-23T22:20:00Z","2026-11-23T22:45:00Z"),row("2026-11-23T23:00:00Z","2026-11-23T23:30:00Z")]);
 expect(slots.map(s=>[s.lane,s.lanes])).toEqual([[0,2],[1,2],[0,1]]);
 expect(courseColor(slots[0].row)).toBe(courseColor(slots[2].row));
});
test("automatic colours stay pinned to a subject and avoid another subject in the same timetable",()=>{
 expect(courseColor({course_code:"MUSIC",ui_color:2,title:"Composition"})).toBe(2);
 const preferred=courseColor({course_code:"MAT"});
 let other="";
 for(let i=0;i<4000&&!other;i++){const code="X"+i;if(courseColor({course_code:code})===preferred)other=code;}
 expect(other).not.toBe("");
 const rows=[{course_code:"MAT",title:"Mathematics"},{course_code:other,title:"Other"}];
 const forward=assignCourseColors(rows),backward=assignCourseColors([...rows].reverse());
 expect(forward.get("MAT")).not.toBe(forward.get(other));
 expect([...forward.entries()].sort()).toEqual([...backward.entries()].sort());
 const keeper=["MAT",other].sort()[0];
 expect(forward.get(keeper)).toBe(preferred);
 const pinned=assignCourseColors([{course_code:"MAT",ui_color:4},{course_code:other}]);
 expect(pinned.get("MAT")).toBe(4);
 expect(pinned.get(other)).not.toBe(4);
});
