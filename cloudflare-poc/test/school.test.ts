import {expect,test} from "vitest";
import {canonicalPrefs,defaults,parseTerms,schoolContext,clockLabel,updateCourse,updatePrefs,displayLesson} from "../src/school";
const row=(date:string,period:string,start:string,end:string,course:string)=>({local_date:date,period_key:period,starts_at_utc:date+"T"+start+":00+11:00",ends_at_utc:date+"T"+end+":00+11:00",course_code:course,title:course});
test("school labels use explicit markers or verified term anchors; missing dates not holidays",()=>{
 const p={...defaults(),terms:parseTerms("Term 4 | 2026-11-23 | 2026-12-10 | A\nHoliday | 2026-12-11 | 2026-12-31")};
 expect(schoolContext("2026-11-30",p,[]).week).toBe("B");expect(schoolContext("2026-12-14",p,[]).holiday).toBe("Holiday");
 expect(schoolContext("2027-01-04",p,[]).holiday).toBeNull();expect(schoolContext("2026-11-24",p,[{local_date:"2026-11-24",week_label:"B",term_label:null,holiday_label:null,checked_at:""}]).week).toBe("B");
 expect(()=>parseTerms("Term | 2026-02-30 | 2026-03-04")).toThrow();
});
test("personal display preferences do not change source course data",()=>{
 const r=row("2026-11-24","period-1","09:00","09:50","MUSIC"),p=updateCourse(defaults(),new URLSearchParams({name:"Composition",color:"2",hidden:"on"}),"code:MUSIC");
 expect(displayLesson(p,r)).toMatchObject({title:"Composition",ui_color:2,ui_hidden:true});expect(r.title).toBe("MUSIC");expect(clockLabel(540,"12")).toBe("9:00 AM");
 expect(updatePrefs(defaults(),new URLSearchParams({view:"agenda",hour:"24",terms:""})).view).toBe("day");
 expect(canonicalPrefs({...defaults(),view:"agenda"}).view).toBe("day");
 expect(canonicalPrefs(defaults()).courses).toEqual([]);
});
