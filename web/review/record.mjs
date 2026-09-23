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
 console.log('ARTIFACT '+JSON.stringify(artifacts.at(-1)));
}
const devices=[
 {name:'macbook-air15-m4',viewport:{width:1440,height:932},deviceScaleFactor:2,isMobile:false,hasTouch:false},
 {name:'pixel6',viewport:{width:412,height:915},deviceScaleFactor:2.625,isMobile:true,hasTouch:true},
 {name:'iphone15',viewport:{width:393,height:852},deviceScaleFactor:3,isMobile:true,hasTouch:true},
];
for(const device of devices){
 const {name,...options}=device;
 const context=await browser.newContext({...options,baseURL:'http://127.0.0.1:8090',acceptDownloads:true,recordVideo:{dir:root,size:device.viewport}});
 const page=await context.newPage();page.setDefaultTimeout(20000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 let step='start'; const started=Date.now();
 const mark=async label=>{
   step=label;console.log('STEP '+name+' '+label+' '+new Date().toISOString());
   await sleep(800);
   if(!await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))throw Error('Horizontal overflow at '+label);
   const path=`${root}/${name}-${label}.png`;await page.screenshot({path});await upload(path,`${name}-${label}.png`);await fs.unlink(path);
 };
 try {
  await page.goto('/');
  await page.getByRole('button',{name:'Compte test alice'}).click();
  await expect(page.getByRole('heading',{name:'Mes projets'})).toBeVisible();
  await mark('library');
  await page.getByRole('button',{name:'+ Nouvelle vidéo'}).click();
  const title=`France 24 · ${name} · ${new Date().toISOString().slice(11,19)}`;
  await page.getByLabel('Titre',{exact:true}).fill(title);
  await page.getByLabel('Lien YouTube').fill('https://www.youtube.com/watch?v=b1MKJ5gHig0');
  await mark('youtube');
  await page.getByRole('button',{name:'Commencer',exact:true}).click();
  await mark('preparing');
  // Observe actual persistent queue; never fake success or bypass provider cooldown.
  await expect(page.getByRole('button',{name:'Terminer la correction arabe · Traduire',exact:true})).toBeVisible({timeout:18*60000});
  await page.getByRole('heading',{name:'Correction arabe',exact:true}).scrollIntoViewIfNeeded();
  await mark('arabic');
  const follow=page.getByRole('button',{name:'Suivi activé',exact:true});
  await expect(follow).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:'Lecture',exact:true}).click();await sleep(7000);
  await page.mouse.wheel(0,700);await sleep(1000);
  await expect(follow).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:'Pause',exact:true}).click();
  const slider=page.getByRole('slider',{name:'Position de lecture'});
  const duration=Number(await slider.getAttribute('max'));
  await slider.fill(String(Math.round(duration*.45*10)/10));await sleep(1500);
  await expect(page.locator('.segment.active')).toBeVisible();
  await mark('seek-follow');
  await follow.click();await expect(page.getByRole('button',{name:'Suivi désactivé'})).toHaveAttribute('aria-pressed','false');
  await page.getByRole('button',{name:'Suivi désactivé'}).click();
  const arabic=page.locator('textarea[lang="ar"]').first();
  const editedArabic=(await arabic.inputValue()).trim().replace(/[.،؟。]+$/u,'')+'.';
  await arabic.fill(editedArabic);await arabic.blur();
  await expect(page.locator('.page-title [role="status"]')).toContainText('Enregistré');
  await page.reload();await page.getByRole('button',{name:new RegExp(title.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'))}).click();
  await expect(page.locator('textarea[lang="ar"]').first()).toHaveValue(editedArabic);
  await mark('saved');
  await page.getByRole('button',{name:'Terminer la correction arabe · Traduire',exact:true}).click();
  await expect(page.getByRole('button',{name:'Terminer la relecture',exact:true})).toBeVisible({timeout:18*60000});
  await page.getByRole('heading',{name:'Relire arabe et français'}).scrollIntoViewIfNeeded();
  await mark('translation');
  const french=page.locator('textarea[lang="fr"]').first();
  const editedFrench=(await french.inputValue()).trim().replace(/[.!?]+$/,'')+'.';
  await french.fill(editedFrench);
  // Advancing must flush the focused edit before exporting.
  await page.getByRole('button',{name:'Terminer la relecture',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Votre vidéo sous-titrée'})).toBeVisible();
  await page.getByLabel('Qualité',{exact:true}).selectOption('high');
  for(const [track,label] of [['fr','français'],['ar','arabe']]) {
   await page.getByLabel('Sous-titres',{exact:true}).selectOption(track);
   await mark('export-'+track);
   await page.getByRole('button',{name:'Créer la vidéo',exact:true}).click();
   const link=page.getByRole('link',{name:`Télécharger · High · ${label}`,exact:true});
   await expect(link).toBeVisible({timeout:12*60000});
   const pending=page.waitForEvent('download',{timeout:60000});await link.click();const download=await pending;
   const filename=`tarjama-b1MKJ5gHig0-${name}-${track}-high.mp4`;
   const path=root+'/'+filename;await download.saveAs(path);await upload(path,filename);await fs.unlink(path);await download.delete();
   await mark('downloaded-'+track);
  }
  for (const track of ['fr','ar']) {
   const filename=`tarjama-b1MKJ5gHig0-${name}-${track}-high.mp4`;
   await page.goto('/review-artifacts/'+filename);
   const rendered=page.locator('video');
   await expect(rendered).toBeVisible();
   await rendered.evaluate(async v=>{v.muted=true;await v.play();});
   await sleep(4000);
   await rendered.evaluate(v=>v.pause());
   await mark('rendered-'+track);
   // Small review frame in bounded job logs; no credentials or user data.
   const jpeg=await page.screenshot({type:'jpeg',quality:25,scale:'css'});
   console.log('REVIEW_FRAME '+name+' '+track+' '+jpeg.toString('base64'));
   await rendered.evaluate(async v=>{v.currentTime=v.duration*.5;await v.play();});
   await sleep(4000);await rendered.evaluate(v=>v.pause());
   await mark('rendered-middle-'+track);
  }
  if(errors.length)throw Error('Browser errors: '+errors.join('; '));
  outcomes.push({device:name,viewport:device.viewport,engine:'Chromium',status:'passed',elapsedSeconds:Math.round((Date.now()-started)/1000)});
 }catch(e){
  outcomes.push({device:name,status:'failed',step,error:String(e),elapsedSeconds:Math.round((Date.now()-started)/1000)});
  console.log('FAIL '+JSON.stringify(outcomes.at(-1)));
  await mark('failure').catch(()=>{});
 }finally{
  const video=page.video();await context.close();
  if(video){const path=await video.path();await upload(path,`parcours-${name}.webm`);await fs.unlink(path);}
 }
 console.log('OUTCOME '+JSON.stringify(outcomes.at(-1)));
 if(outcomes.at(-1).status==='failed')break;
}
const manifest={sourceVideo:'https://www.youtube.com/watch?v=b1MKJ5gHig0',identity:'isolated test account; production MFA confirmed separately by owner',providers:'real Gemini and Groq',media:'administered isolated jobs, WARP for download',emulation:'CSS viewports, Chromium; not physical devices or Safari qualification',outcomes,artifacts};
await fs.writeFile(root+'/manifest.json',JSON.stringify(manifest,null,2));await upload(root+'/manifest.json','manifest.json');
console.log('RESULT '+JSON.stringify(manifest));
await browser.close();proxy.close();
process.exitCode=outcomes.length===3&&outcomes.every(x=>x.status==='passed')?0:1;
