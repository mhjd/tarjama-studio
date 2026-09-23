// Partial real-media qualification when an external provider blocks the full journey.
// This deliberately does not claim correction, translation or export succeeded.
import {chromium,expect} from '/src/frontend/node_modules/@playwright/test/index.mjs';
import http from 'node:http';
import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
const upstream='http://pv-review:8095',root='/tmp/playback';
await fs.mkdir(root,{recursive:true});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
for(let i=0;;i++){
 try{if((await fetch(upstream+'/readyz')).status===204)break;}catch{}
 if(i===59)throw Error('Review readiness deadline');await sleep(1000);
}
const proxy=http.createServer((req,res)=>{
 const target=http.request(upstream+req.url,{method:req.method,headers:req.headers},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res);});
 target.on('error',()=>{res.writeHead(502);res.end();});req.pipe(target);
});
await new Promise(resolve=>proxy.listen(8090,'127.0.0.1',resolve));
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage'],slowMo:200});
const artifacts=[],outcomes=[];
async function upload(path,name){
 const stat=await fs.stat(path),hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);
 const response=await fetch(upstream+'/review-artifacts/'+name,{method:'PUT',body:createReadStream(path),duplex:'half'});
 if(!response.ok)throw Error('Artifact persistence failed');
 artifacts.push({name,bytes:stat.size,sha256:hash.digest('hex')});console.log('ARTIFACT '+JSON.stringify(artifacts.at(-1)));
}
for(const [name,width,height,dpr,mobile] of [['macbook-air15-m4',1440,932,2,false],['pixel6',412,915,2.625,true],['iphone15',393,852,3,true]]){
 const context=await browser.newContext({baseURL:'http://127.0.0.1:8090',viewport:{width,height},deviceScaleFactor:dpr,isMobile:mobile,hasTouch:mobile,recordVideo:{dir:root,size:{width,height}}});
 const page=await context.newPage();page.setDefaultTimeout(20000);
 try{
  await page.goto('/');await page.getByRole('button',{name:'Compte test alice'}).click();
  await page.getByRole('button',{name:/France 24/}).first().click();
  const follow=page.getByRole('button',{name:'Suivi activé',exact:true});
  await expect(follow).toHaveAttribute('aria-pressed','true');
  const timestamps=page.locator('.timestamp');const target=timestamps.nth(Math.floor(await timestamps.count()/2));
  await target.click();await sleep(1200);
  await page.getByRole('button',{name:'Lecture',exact:true}).click();await sleep(5000);
  await page.mouse.wheel(0,700);await expect(follow).toHaveAttribute('aria-pressed','true');
  await sleep(8000);
  await page.getByRole('button',{name:'Pause',exact:true}).click();
  const position=await page.locator('video').evaluate(v=>v.currentTime);
  await page.mouse.wheel(0,2000);await sleep(1200);
  await page.getByRole('slider',{name:'Position de lecture'}).fill(String((Math.floor(position*10)+1)/10));
  await expect.poll(()=>page.locator('.segment.active').evaluate(el=>{
   const rect=el.getBoundingClientRect(),player=document.querySelector('.player').getBoundingClientRect();
   return rect.top>=player.bottom&&rect.top<innerHeight;
  })).toBeTruthy();
  await follow.click();await expect(page.getByRole('button',{name:'Suivi désactivé'})).toHaveAttribute('aria-pressed','false');
  await page.getByRole('button',{name:'Suivi désactivé'}).click();await sleep(1500);
  if(!await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))throw Error('Horizontal overflow');
  const screenshot=`${root}/${name}.png`;await page.screenshot({path:screenshot});await upload(screenshot,`lecture-suivi-validation-${name}.png`);
  await page.evaluate(()=>window.scrollTo(0,0));await sleep(3000);
  outcomes.push({device:name,status:'playback-and-follow-passed',viewport:{width,height},engine:'Chromium',fullJourney:'not-qualified-provider-waiting'});
 }catch(error){outcomes.push({device:name,status:'failed',error:String(error)});console.log('FAIL '+JSON.stringify(outcomes.at(-1)));}
 finally{const video=page.video();await context.close();await upload(await video.path(),`lecture-suivi-validation-${name}.webm`);}
 console.log('OUTCOME '+JSON.stringify(outcomes.at(-1)));await sleep(17000);
}
await fs.writeFile(root+'/playback-manifest-validation.json',JSON.stringify({sourceVideo:'https://www.youtube.com/watch?v=b1MKJ5gHig0',scope:'Partial real-media playback and follow only. No claim of successful correction, translation or export.',outcomes,artifacts},null,2));
await upload(root+'/playback-manifest-validation.json','playback-manifest-validation.json');
console.log('RESULT '+JSON.stringify({outcomes,artifacts}));await browser.close();proxy.close();
process.exitCode=outcomes.every(x=>x.status==='playback-and-follow-passed')?0:1;
