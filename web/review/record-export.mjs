import {expect} from '@playwright/test';
import fs from 'node:fs/promises';
import {root,sleep,upload} from './record-support.mjs';
export async function exportAndInspect(page,mark,waitReady,videoID,name){
  await page.getByRole('combobox',{name:/Qualité/}).selectOption('high');
  const projectID=new URL(page.url()).pathname.split('/')[2];
  const result=await page.request.get('/api/projects/'+projectID);
  if(!result.ok())throw Error('Cannot verify final transcript');
  const {project}=await result.json();
  const transcript={source:project.url,duration_ms:project.duration_ms,segments:project.segments};
  const transcriptName=`transcription-${name}.json`;
  await fs.writeFile(root+'/'+transcriptName,JSON.stringify(transcript,null,2));
  await upload(root+'/'+transcriptName,transcriptName);
  const indexes=[0,1,Math.floor(project.segments.length/2),project.segments.length-2,project.segments.length-1];
  console.log('TRANSLATION_SAMPLE '+JSON.stringify({duration_ms:project.duration_ms,segments:indexes.map(i=>project.segments[i])}));
  for(const [track,label] of [['fr','français']]) {
   await mark('export-'+track);
   await page.getByRole('button',{name:'Créer la vidéo',exact:true}).click();
   const link=page.getByRole('link',{name:`Télécharger · High · ${label}`,exact:true});
   await waitReady(link);
   const pending=page.waitForEvent('download',{timeout:60000});await link.click();const download=await pending;
   const filename=`tarjama-${videoID}-${name}-${track}-high.mp4`;
   const path=root+'/'+filename;await download.saveAs(path);await upload(path,filename);await fs.unlink(path);await download.delete();
   await mark('downloaded-'+track);
  }
  for (const track of ['fr']) {
   const filename=`tarjama-${videoID}-${name}-${track}-high.mp4`;
   await page.goto('/review-artifacts/'+filename);
   const rendered=page.locator('video');
   await expect(rendered).toBeVisible();
   await rendered.evaluate(async v=>{v.muted=true;await v.play();});
   await sleep(4000);
   await rendered.evaluate(v=>v.pause());
   const decoded=await rendered.evaluate(v=>({duration:v.duration,width:v.videoWidth,height:v.videoHeight,frames:v.getVideoPlaybackQuality().totalVideoFrames}));
   if(Math.abs(decoded.duration-project.duration_ms/1000)>.5||decoded.width<=0||decoded.height<=0||decoded.frames<=0)throw Error('Export duration or video decoding mismatch');
   await mark('rendered-'+track);
   await rendered.evaluate(async v=>{v.currentTime=v.duration*.5;await v.play();});
   await sleep(4000);await rendered.evaluate(v=>v.pause());
   await mark('rendered-middle-'+track);
  }
}
