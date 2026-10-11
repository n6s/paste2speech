// A section scale, not a duration estimate. The existing seek limits are kept.
export function setupSectionProgress(root=document.getElementById('section-progress')) {
 if(!root)return null;
 const seek=root.querySelector('#seek'),saved=root.querySelector('.section-saved'),played=root.querySelector('.section-played'),legend=root.querySelector('.section-saved-key'),help=root.querySelector('#section-progress-help'),status=root.querySelector('#offline-progress');
 let previous='';
 return ({total,available,index,natural,retained=[],info=null,offline=false})=>{
  total=Math.max(0,total);index=Math.max(0,Math.min(total-1,index||0));
  const extent=total>1?Math.max(0,available-1)/(total-1):available?1:0;
  seek.style.width=`calc(${extent*100}% + ${(1-extent)*18}px)`;
  root.dataset.total=String(total);root.dataset.available=String(available);
  played.style.width=`${total>1?index/(total-1)*100:0}%`;
  const indices=natural?[...new Set(retained)].filter(i=>Number.isInteger(i)&&i>=0&&i<total).sort((a,b)=>a-b):[];
  const key=JSON.stringify([total,indices]);
  if(key!==previous){
   previous=key;saved.replaceChildren();
   const ranges=[];for(const i of indices){const last=ranges.at(-1);if(last&&i===last[1]+1)last[1]=i;else ranges.push([i,i]);}
   for(const [first,last] of ranges){
    const span=document.createElement('span'),start=total>1?Math.max(0,(first-.5)/(total-1)):0,end=total>1?Math.min(1,(last+.5)/(total-1)):1;
    span.dataset.first=String(first);span.dataset.last=String(last);span.style.left=`${start*100}%`;span.style.width=`${(end-start)*100}%`;saved.append(span);
   }
   root.dataset.retained=String(indices.length);
  }
  legend.hidden=!natural||!total;
  help.textContent=`Each step is a section, not a duration estimate. ${available} of ${total} sections are available for seeking. ${natural?`${indices.length} sections have verified audio saved in this tab.${available?` Audio for the selected section is ${indices.includes(Number(seek.value))?'saved':'not saved'} in this tab.`:''}`:'Browser voices do not create downloaded audio files.'}`;
  const statusTotal=total||info?.total||0;
  status.hidden=!natural||!statusTotal;
  if(!status.hidden){
   const count=`${total?indices.length:info?.downloaded||0} / ${statusTotal} sections`;
   const message=info?.ready?`Ready for offline listening in this tab · ${count} saved. Keep this page open; reloading clears downloaded audio.`
    :info?.error?`${info.error} ${count} saved in this tab.`
    :offline?`Offline · ${count} saved. Remaining downloads will retry when connected.`
    :available?`Downloading for offline listening: ${count}. Keep this page open; downloads may pause when your device suspends the browser.`
    :`Waiting for audio · ${count} saved. Keep this page open while preparation continues.`;
   if(status.textContent!==message)status.textContent=message;
  }else status.textContent='';
 };
}
