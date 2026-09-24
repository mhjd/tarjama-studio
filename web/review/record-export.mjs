import {expect} from '@playwright/test';
import fs from 'node:fs/promises';
import {root,sleep,upload} from './record-support.mjs';
export async function exportAndInspect(page,mark,waitReady,videoID,name){
  await page.getByRole('combobox',{name:/Qualité/}).selectOption('high');
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
   await mark('rendered-'+track);
   await rendered.evaluate(async v=>{v.currentTime=v.duration*.5;await v.play();});
   await sleep(4000);await rendered.evaluate(v=>v.pause());
   await mark('rendered-middle-'+track);
  }
}
