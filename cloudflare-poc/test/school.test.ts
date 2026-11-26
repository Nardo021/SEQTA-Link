import {expect,test} from "vitest";
import {defaults,parseTerms,schoolContext,clockLabel,weeklyStats,potentialFree,updateCourse,displayLesson,inferredCycle} from "../src/school";
import {shiftDate} from "../src/schedule";
const row=(date:string,period:string,start:string,end:string,course:string)=>({local_date:date,period_key:period,starts_at_utc:date+"T"+start+":00+11:00",ends_at_utc:date+"T"+end+":00+11:00",course_code:course,title:course});
test("school labels use explicit markers or verified term anchors; missing dates not holidays",()=>{
 const p={...defaults(),terms:parseTerms("Term 4 | 2026-11-23 | 2026-12-10 | A\nHoliday | 2026-12-11 | 2026-12-31")};
 expect(schoolContext("2026-11-30",p,[]).week).toBe("B");expect(schoolContext("2026-12-14",p,[]).holiday).toBe("Holiday");
 expect(schoolContext("2027-01-04",p,[]).holiday).toBeNull();expect(schoolContext("2026-11-24",p,[{local_date:"2026-11-24",week_label:"B",term_label:null,holiday_label:null,checked_at:""}]).week).toBe("B");
 expect(()=>parseTerms("Term | 2026-02-30 | 2026-03-04")).toThrow();
});
test("personal display preferences do not change source course data; real scheduled minutes",()=>{
 const r=row("2026-11-24","period-1","09:00","09:50","MUSIC"),p=updateCourse(defaults(),new URLSearchParams({name:"Composition",color:"2",hidden:"on"}),"code:MUSIC");
 expect(displayLesson(p,r)).toMatchObject({title:"Composition",ui_color:2,ui_hidden:true});expect(r.title).toBe("MUSIC");expect(clockLabel(540,"12")).toBe("9:00 AM");expect(weeklyStats([r],p)[0].minutes).toBe(50);
});
test("free periods require complete day and repeated period slots",()=>{
 const date="2026-11-24",rows=[row(date,"period-1","09:00","09:50","M"),row(date,"period-3","11:00","11:50","E"),row("2026-11-23","period-2","10:00","10:50","X"),row("2026-11-25","period-2","10:00","10:50","X")];
 expect(potentialFree(rows,date,defaults(),[])).toEqual([]);
 expect(potentialFree(rows,date,defaults(),[{local_date:date,week_label:null,term_label:null,holiday_label:null,checked_at:""}])).toEqual([{start:600,end:650}]);
});
test("alternating patterns are not named A/B without confirmed school label",()=>{
 const rows=[];for(let w=0;w<4;w++)for(let d=0;d<5;d++)for(let n=0;n<3;n++){const date=shiftDate("2026-11-02",w*7+d);rows.push(row(date,"period-"+n,"09:00","09:50",w%2?"B":"A"));}
 expect(inferredCycle(rows,"2026-11-02")?.cycle).toBe(1);expect(inferredCycle(rows.slice(0,10),"2026-11-02")).toBeNull();
});
