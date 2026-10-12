// Staging layout only. Keep reading controls together and secondary tools separate.
export function setupStagingReaderLayout(){
 const modes=document.querySelector('.mode-controls'),card=modes?.closest('section'),scan=document.querySelector('.pdf-import'),player=document.querySelector('.player');
 if(!card||!scan||!player||document.getElementById('document-tools'))return;
 document.querySelector('main').classList.add('staging-reader-layout');
 const readHint=document.querySelector('#read-view>p.hint');if(readHint)readHint.textContent='Tap text to read from there.';
 const tools=document.createElement('section');tools.id='document-tools';tools.className='reader-tool-section';tools.setAttribute('aria-label','Images and PDFs');player.after(tools);tools.append(scan);
 const status=document.getElementById('pdf-status');
 // Keep the existing live region outside collapsed content so updates announce.
 const visible=document.createElement('p');visible.id='document-visible-status';visible.className='hint';visible.setAttribute('aria-hidden','true');visible.textContent=status.textContent;scan.append(visible);status.classList.add('sr-only');tools.append(status);
 new MutationObserver(()=>{visible.textContent=status.textContent;}).observe(status,{childList:true,subtree:true,characterData:true});
 const cancel=document.getElementById('cancel-pdf');if(cancel)scan.append(cancel);
 const settings=document.createElement('section');settings.id='reader-settings';settings.className='reader-tool-section';settings.hidden=true;settings.setAttribute('aria-label','Online processing preferences');
 const mount=document.createElement('div');mount.id='online-processing';settings.append(mount);
 const cleanup=document.querySelector('.cleanup-card'),savings=document.getElementById('character-savings');if(cleanup&&savings)cleanup.querySelector('details').append(savings);if(cleanup)cleanup.after(settings);else document.querySelector('footer').before(settings);
}
