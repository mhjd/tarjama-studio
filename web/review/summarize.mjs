// Read qualification results and preserve audit copies; no application credentials.
import {createHash} from 'node:crypto';
const prefix=process.env.REVIEW_ARTIFACT_PREFIX||'';
if(!/^[a-z0-9-]{0,30}$/.test(prefix))throw Error('Invalid artifact prefix');
const base='http://pv-review:8095/review-artifacts/';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
for(let attempt=0;;attempt++){
 try{if((await fetch('http://pv-review:8095/readyz',{signal:AbortSignal.timeout(2000)})).status===204)break;}catch{}
 if(attempt>=24)throw Error('Review unavailable');await sleep(1000);
}
for(const name of ['manifest.json','playback-manifest-validation.json']){
 const response=await fetch(base+prefix+name,{signal:AbortSignal.timeout(10000)});
 if(!response.ok){console.log(JSON.stringify({manifest:name,status:response.status}));continue;}
 const data=await response.json();
 console.log(JSON.stringify({manifest:name,outcomes:data.outcomes.map(x=>({...x,error:x.error?.slice(0,700)})),videos:data.artifacts.filter(x=>/\.(webm|mp4)$/.test(x.name))}));
}
// These private endpoints expose only test-run metadata, never API keys or text.
for(const name of ['review-budget','review-diagnostics']){
 const response=await fetch('http://pv-review:8095/'+name,{signal:AbortSignal.timeout(10000)});
 if(!response.ok)throw Error(`${name}: ${response.status}`);
 const data=await response.json();
 const body=JSON.stringify(data);
 const artifact=prefix+name+'-'+Date.now()+'.json';
 const saved=await fetch(base+artifact,{method:'PUT',body,signal:AbortSignal.timeout(10000)});
 if(saved.status!==204)throw Error(`Cannot preserve ${name}: ${saved.status}`);
 console.log(JSON.stringify({artifact,bytes:Buffer.byteLength(body),sha256:createHash('sha256').update(body).digest('hex')}));
 // The broker bounds logs. Keep the complete audit in its immutable artifact,
 // and print a compact summary that remains parseable for long campaigns.
 const summary=name==='review-budget'?{
  deadline:data.deadline,limit_usd:data.limit_usd,calls:data.calls.length,
  reported_usd:data.calls.reduce((sum,c)=>sum+(c.reported_cost_usd??0),0),
  retained_reservations_usd:data.calls.reduce((sum,c)=>sum+(c.reported_cost_usd==null?c.reserved_usd:0),0)
 }:data.map(x=>({kind:x.kind,ordinal:x.ordinal,code:x.code,
  requests:x.diagnostics.model_calls,local:x.diagnostics.local_calls,
  ms:x.diagnostics.elapsed_ms,cost:x.diagnostics.usage?.reduce((sum,u)=>sum+(u.cost??0),0)}));
 console.log(JSON.stringify({report:name,data:summary}));
}
