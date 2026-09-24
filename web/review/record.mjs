import {exportAndInspect} from './record-export.mjs';
import {expect} from '@playwright/test';
import fs from 'node:fs/promises';
import {browser,root,proxy,sleep,artifacts,outcomes,upload,devices,openReviewProject} from './record-support.mjs';
const sourceVideo=process.env.REVIEW_VIDEO;
if(!sourceVideo||!/^https:\/\/www.youtube.com\/watch\?v=[A-Za-z0-9_-]{11}$/.test(sourceVideo))throw Error('Explicit canonical YouTube URL required');
const selectedDevices=devices.filter(d=>d.name===process.env.REVIEW_DEVICE);
if(selectedDevices.length!==1)throw Error('One device per isolated review run required');
const videoID=new URL(sourceVideo).searchParams.get('v');
const waitMinutes=Number(process.env.REVIEW_WAIT_MINUTES||30);
if(!Number.isInteger(waitMinutes)||waitMinutes<1||waitMinutes>50)throw Error('Wait must be 1–50 minutes');
for(const device of selectedDevices){
 const {name,...options}=device;
 const context=await browser.newContext({...options,baseURL:'http://127.0.0.1:8090',acceptDownloads:true,recordVideo:{dir:root,size:device.viewport} });
 const page=await context.newPage();page.setDefaultTimeout(20000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 let previousStatus='',terminalFailure='';
 const waitReady=async locator=>{
  // Reserve five minutes to persist the recording before the one-hour job limit.
  const deadline=Math.min(Date.now()+waitMinutes*60000,started+55*60000);
  while(Date.now()<deadline){
   if(terminalFailure)throw Error(terminalFailure);
   if(await locator.isVisible())return;
   await sleep(2000);
  }
  throw Error('Bounded wait exhausted at '+step);
 };
 page.on('response',async response=>{
  if(response.request().method()!=='GET'||! /\/api\/projects\/[^/]+$/.test(response.url())||response.status()!==200)return;
  try{
   const data=await response.json();
   const failure=data.jobs.find(j=>j.state==='failed');
   terminalFailure=failure?'Real job failed: '+failure.kind+' at '+failure.progress+'%':'';
   const status=JSON.stringify({stage:data.project.stage,duration_ms:data.project.duration_ms,segments:data.project.segments.length,jobs:data.jobs.filter(j=>j.state!=='succeeded').map(j=>({kind:j.kind,state:j.state,progress:j.progress}))});
   if(status!==previousStatus){console.log('PROGRESS '+name+' '+data.project.stage+' '+data.jobs.filter(j=>j.state!=='succeeded').map(j=>j.kind+':'+j.state+':'+j.progress).join(' '));previousStatus=status;}
  }catch{}
 });
 let step='start'; const started=Date.now();
 const mark=async label=>{
   step=label;console.log('STEP '+name+' '+label+' '+new Date().toISOString());
   await sleep(800);
   if(!await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))throw Error('Horizontal overflow at '+label);
   const path=`${root}/${name}-${label}.png`;await page.screenshot({path});await upload(path,`${name}-${label}.png`);await fs.unlink(path);
 };
 try {
  const resumedStage=await openReviewProject(page,mark,sourceVideo,name);
  console.log('RESUME_STAGE '+resumedStage);
  if(!['translating','review','ready'].includes(resumedStage)){
  await waitReady(page.getByRole('button',{name:'Valider et traduire',exact:true}).first());
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
  const originalArabic=await arabic.inputValue();
  const editedArabic=originalArabic.endsWith('.')?originalArabic.slice(0,-1):originalArabic+'.';
  if(editedArabic===originalArabic)throw Error('Arabic edit must change the text');
  await arabic.fill(editedArabic);await arabic.blur();
  await expect(page.locator('.page-title [role="status"]')).toContainText('Enregistré');
  await page.reload();
  await expect(page.locator('textarea[lang="ar"]').first()).toHaveValue(editedArabic);
  await mark('saved');
  await page.getByRole('button',{name:'Valider et traduire',exact:true}).first().click();
  await expect(page).toHaveURL(/\/traduire$/);
  await expect(page.locator('textarea[lang="ar"],textarea[lang="fr"]')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'4. Exporter',exact:true})).toBeDisabled();
  await expect(page.getByRole('button',{name:'2. Corriger',exact:true})).toBeEnabled();
  await expect.poll(()=>page.evaluate(()=>scrollY)).toBe(0);
  await mark('translating');
  }
  if(resumedStage!=='ready'){
  await waitReady(page.getByRole('button',{name:'Valider et exporter',exact:true}).first());
  await page.getByRole('heading',{name:'Relire arabe et français'}).scrollIntoViewIfNeeded();
  await mark('translation');
  const french=page.locator('textarea[lang="fr"]').first();
  const originalFrench=await french.inputValue();
  const editedFrench=originalFrench.endsWith('.')?originalFrench.slice(0,-1):originalFrench+'.';
  if(editedFrench===originalFrench)throw Error('French edit must change the text');
  await french.fill(editedFrench);
  await page.getByRole('button',{name:'Valider et exporter',exact:true}).first().click();
  await expect(page.getByRole('heading',{name:'Votre vidéo sous-titrée'})).toBeVisible();
  await page.reload();
  await page.getByRole('button',{name:'3. Traduire',exact:true}).click();
  await expect(page.locator('textarea[lang="fr"]').first()).toHaveValue(editedFrench);
  await page.getByRole('button',{name:'4. Exporter',exact:true}).click();
  }
  await exportAndInspect(page,mark,waitReady,videoID,name);
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
const manifest={sourceVideo,resumed:process.env.REVIEW_RESUME==='1',identity:'isolated test account; production MFA confirmed separately by owner',providers:'real OpenRouter/DeepSeek with Parallel and Groq',media:'administered isolated jobs, WARP for download',emulation:'CSS viewports, Chromium; not physical devices or Safari qualification',outcomes,artifacts};
await fs.writeFile(root+'/manifest.json',JSON.stringify(manifest,null,2));await upload(root+'/manifest.json','manifest.json');
console.log('RESULT '+JSON.stringify({outcomes,artifacts:artifacts.filter(x=>/\.(mp4|webm)$/.test(x.name))}));
await browser.close();proxy.close();
process.exitCode=outcomes.length===selectedDevices.length&&outcomes.every(x=>x.status==='passed')?0:1;
