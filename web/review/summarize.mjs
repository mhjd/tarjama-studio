// Read only qualification artifacts; no application credentials or database access.
const base='http://pv-review:8095/review-artifacts/';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
for(let attempt=0;;attempt++){
 try{if((await fetch('http://pv-review:8095/readyz',{signal:AbortSignal.timeout(2000)})).status===204)break;}catch{}
 if(attempt>=24)throw Error('Review unavailable');await sleep(1000);
}
for(const name of ['manifest.json','playback-manifest-validation.json']){
 const response=await fetch(base+name,{signal:AbortSignal.timeout(10000)});
 if(!response.ok){console.log(JSON.stringify({manifest:name,status:response.status}));continue;}
 const data=await response.json();
 console.log(JSON.stringify({manifest:name,outcomes:data.outcomes.map(x=>({...x,error:x.error?.slice(0,700)})),videos:data.artifacts.filter(x=>/\.(webm|mp4)$/.test(x.name))}));
}
