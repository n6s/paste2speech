const text=document.querySelector('#text'), status=document.querySelector('#status');
const definitions=[['melo','MeloTTS',['en'],0],['aura1','Aura 1',['asteria','luna','orion','angus'],.015],['aura2','Aura 2',['luna','athena','orion','asteria'],.03]];
const cards=[];let busy=false;
function update(){
 document.querySelector('#count').textContent=`${text.value.length.toLocaleString()} characters`;
 for(const card of cards){card.button.disabled=busy||!text.value.trim();card.estimate.textContent=card.price?`Estimated generation: $${(text.value.length/1000*card.price).toFixed(4)}`:'Estimated generation: calculated from returned audio duration.';}
}
for(const [model,title,voices,price] of definitions){
 const section=document.createElement('section');
 const heading=document.createElement('h2');heading.textContent=title;section.append(heading);
 const label=document.createElement('label');label.textContent='Voice ';const voice=document.createElement('select');voice.setAttribute('aria-label',`${title} voice`);
 for(const name of voices){const option=document.createElement('option');option.value=name;option.textContent=name==='en'?'English':name[0].toUpperCase()+name.slice(1);voice.append(option);}label.append(voice);section.append(label);
 const button=document.createElement('button');button.textContent='Generate sample';section.append(button);
 const estimate=document.createElement('p');estimate.className='hint';section.append(estimate);
 const audio=document.createElement('audio');audio.controls=true;audio.hidden=true;section.append(audio);
 const download=document.createElement('a');download.hidden=true;download.textContent='Download sample';section.append(download);
 const detail=document.createElement('p');detail.className='hint';section.append(detail);
 let url;
 button.addEventListener('click',async()=>{
  if(busy)return;busy=true;update();const sample=text.value,selected=voice.value;status.textContent=`Generating ${title}…`;
  document.querySelectorAll('audio').forEach(a=>a.pause());
  try{
   const response=await fetch('./audition/speech',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model,voice:selected,text:sample}),signal:AbortSignal.timeout(100000)});
   if(!response.ok){const error=await response.json();throw Error(typeof error.detail==='string'?error.detail:'Could not generate this sample.');}
   const blob=await response.blob(),elapsed=Number(response.headers.get('X-Generation-Ms'))/1000;
   if(url)URL.revokeObjectURL(url);url=URL.createObjectURL(blob);audio.src=url;audio.hidden=false;download.href=url;download.download=`${model}-${selected}.${blob.type.includes('wav')?'wav':'mp3'}`;download.hidden=false;
   detail.textContent=`${selected} · ${sample.length} characters · ${elapsed.toFixed(2)} seconds to generate`;
   audio.onloadedmetadata=()=>{const seconds=audio.duration;if(!Number.isFinite(seconds))return;const cost=price?sample.length/1000*price:seconds/60*.000205;detail.textContent+=` · ${seconds.toFixed(1)} seconds of audio · estimated $${cost.toFixed(5)}`;audio.onloadedmetadata=null;};
   status.textContent=`${title} is ready. Press Play to listen. Changing the text or voice does not change this sample until you generate again.`;
  }catch(error){status.textContent=error.name==='TimeoutError'?'The audition timed out. Wait a moment before trying again.':error.message;}
  finally{busy=false;update();}
 });
 cards.push({button,estimate,price});document.querySelector('#models').append(section);
}
text.addEventListener('input',update);update();
