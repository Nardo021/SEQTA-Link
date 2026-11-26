import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFileSync} from "node:fs";
const source=readFileSync(new URL("../src/07-sync-orchestration.js",import.meta.url),"utf8");
function context(overrides={}){
 const config={profileId:"fixture",backendUrl:"https://example.invalid",deviceToken:"sl_dvc_fixture",studentRefOverride:"",weeksAhead:1};
 const c=vm.createContext({console,location:{hostname:"school.example.invalid"},navigator:{},loadConfig:()=>({...config}),SKIP_LESSON_TYPES:new Set(["note","holiday","assembly-note"]),...overrides});
 vm.runInContext(source,c);return c;
}
test("explicit school markers only; conflicting labels rejected",()=>{
 const c=context(),range={from:"2026-11-23",until:"2026-11-29"};
 const result=c.sourceMarkers([{date:"2026-11-23",type:"note",description:"Week B"},{date:"2026-11-24",type:"holiday",description:"School holiday"},{date:"2026-11-25",type:"class",description:"Week A"},{date:"2026-12-01",type:"note",description:"Term 4"}],range);
 assert.deepEqual(JSON.parse(JSON.stringify(result)),[{date:"2026-11-23",week:"B"},{date:"2026-11-24",holiday:"School holiday"}]);
 assert.throws(()=>c.sourceMarkers([{date:"2026-11-23",type:"note",description:"Week A"},{date:"2026-11-23",type:"note",description:"Week B"}],range));
});
test("unchanged comparison ignores generated time and order but detects source changes",()=>{
 const c=context(),a={generatedAt:"old",studentRef:"one",coverage:[{from:"2026-11-23"}],lessons:[{sourceKey:"b",title:"B"},{sourceKey:"a",title:"A"}],schoolDays:[]};
 assert.equal(c.snapshotJson(a),c.snapshotJson({...a,generatedAt:"new",lessons:[...a.lessons].reverse()}));
 assert.notEqual(c.snapshotJson(a),c.snapshotJson({...a,studentRef:"two"}));
 assert.notEqual(c.snapshotJson(a),c.snapshotJson({...a,lessons:[{sourceKey:"b",title:"changed"},{sourceKey:"a",title:"A"}]}));
});
test("automatic sync requires a safe cross-tab lock",async()=>{
 const c=context();await assert.rejects(()=>c.withSyncLock(true,()=>{throw Error("must not run")}),/multi-tab/);
});
