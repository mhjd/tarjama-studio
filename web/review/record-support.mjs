// Real UI journeys. No provider/API fixtures, Kubernetes credentials or app secrets.
import { chromium, expect } from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
const upstream = 'http://pv-review:8095';
const root = '/tmp/recordings';
await fs.mkdir(root, {recursive:true});
const sleep = ms => new Promise(resolve => setTimeout(resolve,ms));
for(let attempt=0;;attempt++) {
  try { const response=await fetch(upstream+'/readyz'); if(response.status===204)break; } catch {}
  if(attempt===59)throw Error('Private review unavailable after bounded wait');
  await sleep(1000);
}
const proxy=http.createServer((req,res)=>{
  const target=http.request(upstream+req.url,{method:req.method,headers:req.headers},response=>{
    res.writeHead(response.statusCode,response.headers);response.pipe(res);
  });target.on('error',()=>{res.writeHead(502);res.end();});req.pipe(target);
});
await new Promise(resolve=>proxy.listen(8090,'127.0.0.1',resolve));
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage'],slowMo:180});
const artifacts=[];const outcomes=[];
async function upload(path,name) {
 const stat=await fs.stat(path);const hash=createHash('sha256');
 for await (const chunk of createReadStream(path))hash.update(chunk);
 const response=await fetch(upstream+'/review-artifacts/'+name,{method:'PUT',body:createReadStream(path),duplex:'half'});
 if(!response.ok)throw Error('Artifact persistence HTTP '+response.status);
 artifacts.push({name,bytes:stat.size,sha256:hash.digest('hex')});
 if(/\.(mp4|webm)$/.test(name))console.log('ARTIFACT '+JSON.stringify(artifacts.at(-1)));
}
const devices=[
 {name:'macbook-air15-m4',viewport:{width:1440,height:932},deviceScaleFactor:2,isMobile:false,hasTouch:false},
 {name:'pixel6',viewport:{width:412,height:915},deviceScaleFactor:2.625,isMobile:true,hasTouch:true},
 {name:'iphone15',viewport:{width:393,height:852},deviceScaleFactor:3,isMobile:true,hasTouch:true},
];

export {browser,root,proxy,sleep,artifacts,outcomes,upload,devices};
