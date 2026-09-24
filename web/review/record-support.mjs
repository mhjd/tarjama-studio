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
const artifactPrefix=process.env.REVIEW_ARTIFACT_PREFIX||'';
if(!/^[a-z0-9-]{0,30}$/.test(artifactPrefix))throw Error('Invalid artifact prefix');
if(process.env.REVIEW_RESUME==='1'&&!artifactPrefix)throw Error('Resume requires a new artifact prefix');
async function upload(path,name) {
 name=artifactPrefix+name;
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

export async function openReviewProject(page,mark,sourceVideo,name){
 await page.goto('/');
 await page.getByRole('button',{name:'Compte test alice'}).click();
 await expect(page.getByRole('heading',{name:'Mes projets'})).toBeVisible();
 await mark('library');
 if(process.env.REVIEW_RESUME==='1'){
  const response=await page.request.get('/api/projects');
  if(!response.ok())throw Error('Cannot list review projects');
  const projects=await response.json();
  if(projects.length!==1||projects[0].url!==sourceVideo)throw Error('Resume requires exactly one matching review project');
  if(!['preparing','transcribing','cleaning','arabic','translating','review','ready'].includes(projects[0].stage))throw Error('Unsupported review stage');
  await page.locator('button.project').click();
  await mark('resumed');
  if(process.env.REVIEW_RETRY_FAILED==='1'){
   const response=await page.request.get('/api/projects/'+projects[0].id);
   if(!response.ok())throw Error('Cannot inspect failed review job');
   const data=await response.json();
   const failed=data.jobs.filter(j=>j.state==='failed');
   if(failed.length!==1)throw Error('Explicit retry requires exactly one failed job');
   const retry=page.getByRole('button',{name:'Réessayer',exact:true});
   await retry.click();await expect(retry).toBeHidden();
   await mark('retried');
  }
  return projects[0].stage;
 }
 await page.getByRole('button',{name:'+ Nouvelle vidéo'}).click();
 await page.getByLabel('Titre',{exact:true}).fill(`Qualification · ${name} · ${new Date().toISOString().slice(11,19)}`);
 await page.getByLabel('Lien YouTube').fill(sourceVideo);
 await mark('youtube');
 await page.getByRole('button',{name:'Commencer',exact:true}).click();
 await mark('preparing');
 await expect(page.getByRole('button',{name:'3. Traduire',exact:true})).toBeDisabled();
 await expect(page.getByRole('button',{name:'4. Exporter',exact:true})).toBeDisabled();
 await expect(page.locator('textarea[lang="ar"]')).toHaveCount(0);
 return 'preparing';
}
export {artifactPrefix};
