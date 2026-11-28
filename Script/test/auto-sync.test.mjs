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
test("a failed check waits fifteen minutes, not thirty",()=>{
 const c=context(),now=1_000_000_000_000,interval=15*60000;
 const legacy=c.normalizeAutoState({attempt:now+interval,hold:0,reason:"",recovered:false},now);
 assert.equal(legacy.attempt,now);
 assert.equal(legacy.hold,now+interval);
 assert.equal(c.checkDue(legacy,now+interval-1,"interval"),false);
 assert.equal(c.checkDue(legacy,now+interval,"interval"),true);
 assert.equal(c.checkDue({attempt:now,hold:now+interval,reason:"network",recovered:false},now+120000,"online"),true);
 assert.equal(c.checkDue({attempt:now,hold:now+interval,reason:"network",recovered:false},now+119999,"online"),false);
 assert.equal(c.checkDue({attempt:now,hold:now+interval,reason:"identity",recovered:false},now+120000,"online"),false);
 assert.equal(c.checkDue({attempt:now,hold:now+interval,reason:"network",recovered:true},now+120000,"online"),false);
});
test("retries transient failures once per upload and stops on identity, token, and session",async()=>{
 const c=context();
 assert.equal(c.failureKind({code:"SOURCE_IDENTITY_MISMATCH",message:"blocked"}), "identity");
 assert.equal(c.failureKind({code:"INVALID_TOKEN",status:401,message:"Invalid or revoked device token."}), "token");
 assert.equal(c.failureKind({status:401,message:"SEQTA request failed (401) for /seqta/student/login"}), "session");
 assert.equal(c.failureKind({code:"SYNC_ALREADY_RUNNING",status:409,message:"Concurrent update or conflicting snapshot; retry."}), "busy");
 assert.equal(c.failureKind({status:429,message:"Too many attempts.",headers:"Retry-After: 90"}), "rate");
 assert.equal(c.failureKind({message:"Request timed out"}), "network");
 assert.equal(c.syncState({skipped:true,reason:"Timetable unchanged."}), "unchanged");
 assert.equal(c.syncState({skipped:true,reason:"Incomplete or empty source snapshot; existing timetable retained."}), "incomplete");
 assert.equal(c.freshnessLine({attemptedAt:1,state:"unchanged",succeededAt:1},60001).kind, "success");
 let identityCalls=0;
 await assert.rejects(()=>c.withTransientRetry(()=>{identityCalls++;const error=new Error("student");error.code="SOURCE_IDENTITY_MISMATCH";throw error;},{attempts:3,sleep:async()=>{}}));
 assert.equal(identityCalls,1);
 const seen=[];
 const ok=await c.withTransientRetry(attempt=>{seen.push(attempt);if(attempt<3)throw new Error("Request timed out");return "same-payload";},{attempts:3,sleep:async()=>{}});
 assert.equal(ok,"same-payload");
 assert.deepEqual(seen,[1,2,3]);
 let busyCalls=0;
 await assert.rejects(()=>c.withTransientRetry(()=>{busyCalls++;const error=new Error("Sync already running in another tab.");throw error;},{attempts:3,sleep:async()=>{}}));
 assert.equal(busyCalls,2);
 const rate=new Error("Too many attempts.");rate.status=429;rate.headers="Retry-After: 90";
 await assert.rejects(()=>c.withTransientRetry(()=>{throw rate;},{attempts:3,sleep:async()=>{}}),error=>error.holdMs===90000);
});
