import {inputActionCopy} from './input-copy.js';
import {OCR_DURABLE_JOBS,OCR_PICKER_AUTOSCAN,INPUT_QUEUE_UI,INPUT_QUEUE_REFINEMENTS} from './config.js';
import {attachReaderPopover,createReaderInfo} from './reader-popover.js';
// Staging layout only. Keep reading controls together and secondary tools separate.
export function setupStagingReaderLayout(){
 const inputCopy=inputActionCopy({refined:INPUT_QUEUE_REFINEMENTS,queue:INPUT_QUEUE_UI});
 const modes=document.querySelector('.mode-controls'),card=modes?.closest('section'),scan=document.querySelector('.pdf-import'),player=document.querySelector('.player');
 if(!card||!scan||!player||document.getElementById('document-tools'))return;
 document.querySelector('main').classList.add('staging-reader-layout');
 const bar=document.getElementById('section-progress');if(bar){const info=document.createElement('button');info.type='button';info.id='playback-info';info.textContent='ⓘ';info.setAttribute('aria-label','Playback information');info.setAttribute('aria-controls','playback-info-details');info.setAttribute('aria-expanded','false');const details=document.createElement('div');details.id='playback-info-details';details.hidden=true;for(const node of [bar.querySelector('.section-legend'),document.getElementById('playback-note')])if(node)details.append(node);attachReaderPopover(info,details,{label:info.getAttribute('aria-label')});const heading=document.createElement('div');heading.className='timeline-heading';const label=bar.querySelector('label');label.before(heading);heading.append(label,info);}
 const voiceNote=document.getElementById('voice-note'),voiceLabel=document.getElementById('voice')?.closest('label');if(voiceNote&&voiceLabel){const info=document.createElement('button');info.type='button';info.id='voice-info';info.textContent='ⓘ';info.setAttribute('aria-label','Voice and provider information');info.setAttribute('aria-expanded','false');info.setAttribute('aria-controls','voice-info-details');const details=document.createElement('div');details.id='voice-info-details';details.hidden=true;details.append(voiceNote);const field=document.createElement('div');field.className='voice-info-field';voiceLabel.before(field);field.append(voiceLabel,info);attachReaderPopover(info,details,{label:info.getAttribute('aria-label')});}
 const downloadTitle=document.querySelector('#recording-download>summary,#video-download>summary');if(downloadTitle)downloadTitle.textContent='Download text-to-speech recording';
 const guide=document.createElement('aside');guide.id='reader-start-guide';guide.setAttribute('aria-label','Basic usage');guide.innerHTML='<strong>Listen to text</strong><ol><li>Copy the text you want to listen to.</li><li>Click <b></b>.</li></ol>';guide.querySelector('b').textContent=inputCopy.playLabel;
 const dismissGuide=document.createElement('button');dismissGuide.type='button';dismissGuide.textContent='Dismiss guide';guide.append(dismissGuide);card.prepend(guide);
 const help=document.createElement('button');help.type='button';help.id='reader-help';help.className='quiet';help.textContent='Help';help.setAttribute('aria-controls',guide.id);const title=document.querySelector('header h1'),titleRow=document.createElement('div');titleRow.className='reader-title-row';title.before(titleRow);titleRow.append(title,help);
 const showGuide=value=>{guide.hidden=!value;help.setAttribute('aria-expanded',String(value));document.getElementById('paste-play')?.classList.toggle('guide-highlight',value);};
 help.onclick=()=>{showGuide(guide.hidden);if(!guide.hidden)guide.scrollIntoView({block:'nearest'});};dismissGuide.onclick=()=>{showGuide(false);help.focus({preventScroll:true});};
 let firstVisit=true;try{firstVisit=localStorage.getItem('paste2speech.basic-guide.v1')!=='seen';localStorage.setItem('paste2speech.basic-guide.v1','seen');}catch{}showGuide(firstVisit);
 const oldBalanceHelp=document.getElementById('balance-help'),balanceText=document.getElementById('account-summary');
 if(oldBalanceHelp&&balanceText){const popup=document.createElement('div');popup.id='balance-help';for(const child of [...oldBalanceHelp.children])if(child.tagName!=='SUMMARY')popup.append(child);const info=document.createElement('button');info.id='balance-info';info.hidden=true;info.textContent='ⓘ';info.setAttribute('aria-label','Remaining balance information');const line=document.createElement('div');line.className='balance-capacity-line';balanceText.before(line);line.append(balanceText,info);oldBalanceHelp.remove();attachReaderPopover(info,popup,{label:'Remaining balance information'});}
 const readHint=document.querySelector('#read-view>p.hint');if(readHint)readHint.textContent='Tap text to read from there.';
 let tools;
 if(OCR_DURABLE_JOBS){
  tools=document.createElement('div');tools.id='document-context';tools.className='document-context';tools.hidden=true;tools.setAttribute('role','group');tools.setAttribute('aria-label','Selected file');
  for(const child of [...scan.children])if(child.tagName!=='SUMMARY')tools.append(child);
  modes.before(tools);scan.remove();
 }else{tools=document.createElement('section');tools.id='document-tools';tools.className='reader-tool-section';tools.setAttribute('aria-label','Images and PDFs');player.after(tools);tools.append(scan);}
 const status=document.getElementById('pdf-status');
 const visible=document.createElement('p');visible.id='document-visible-status';visible.className='sr-only';visible.setAttribute('aria-hidden','true');visible.textContent=status.textContent;(OCR_DURABLE_JOBS?tools:scan).append(visible);status.classList.add('sr-only');(OCR_DURABLE_JOBS?card:tools).append(status);
 new MutationObserver(()=>{visible.textContent=status.textContent;}).observe(status,{childList:true,subtree:true,characterData:true});
 const cancel=document.getElementById('cancel-pdf');if(cancel)(OCR_DURABLE_JOBS?tools:scan).append(cancel);
 const inputText=document.createElement('p');inputText.textContent=inputCopy.editing+' '+(OCR_PICKER_AUTOSCAN?'Choosing an image or scanned PDF starts upload and scanning; File processing information explains privacy, pricing and limits.':'Opening a file does not upload it.');
 createReaderInfo({id:'input-info',label:'Pasting and editing',nodes:[inputText],mount:document.getElementById('text-title')});
 const speechText=document.createElement('p');speechText.textContent='Prepared WaveNet text and audio expire after 24 hours. WaveNet sends the cleaned reading text to Google Cloud. Browser voices use your device’s speech service, which may connect to the internet.';document.getElementById('voice-info-details')?.append(speechText);
 for(const paragraph of document.querySelectorAll('p'))if(paragraph.textContent.startsWith('Formatted paste keeps headings and lists when available.')){if(paragraph!==inputText)paragraph.remove();}
 const settings=document.createElement('section');settings.id='reader-settings';settings.className='reader-tool-section';settings.hidden=true;settings.setAttribute('aria-label','Online processing preferences');
 const mount=document.createElement('div');mount.id='online-processing';settings.append(mount);
 const cleanup=document.querySelector('.cleanup-card'),savings=document.getElementById('character-savings');
 if(cleanup){const original=cleanup.querySelector('details'),options=cleanup.querySelector('#options');const row=document.createElement('div');row.id='text-cleanup';row.className='input-cleanup-row';row.setAttribute('role','group');row.setAttribute('aria-label','Text cleanup');const heading=document.createElement('span');heading.className='cleanup-row-heading';const title=document.createElement('strong');title.textContent='Text cleanup';heading.append(title);row.append(heading,options);createReaderInfo({id:'cleanup-info',label:'Text cleanup information',nodes:[...original.querySelectorAll('p'),...(savings?[savings]:[])],mount:heading});modes.before(row);row.after(settings);cleanup.remove();}else document.querySelector('footer').before(settings);

}
