// Shared staging overlays. Native popovers use the top layer, outside clipped cards.
let active=null,swallowClick=false,installed=false;
function install(){
 if(installed)return;installed=true;
 document.addEventListener('pointerdown',event=>{
  swallowClick=false;if(!active||active.content.contains(event.target)||active.button.contains(event.target)||event.target.closest?.('.reader-info-button,.reader-popup-toggle'))return;
  const paidAction=event.target.closest?.('#summary-mode,#document-ocr,#play,#paste-play,#credit-resume');active.close(!!paidAction);if(paidAction){swallowClick=true;event.preventDefault();event.stopImmediatePropagation();}
 },true);
 document.addEventListener('click',event=>{if(swallowClick){swallowClick=false;event.preventDefault();event.stopImmediatePropagation();}},true);
 document.addEventListener('pointercancel',()=>{swallowClick=false;},true);
 document.addEventListener('keydown',event=>{swallowClick=false;if(active&&event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();active.close(true);}},true);
 document.addEventListener('focusin',event=>{if(active&&!active.content.contains(event.target)&&!active.button.contains(event.target))active.close(false);});
 window.addEventListener('resize',()=>active?.position());
 window.visualViewport?.addEventListener('resize',()=>active?.position());
 document.addEventListener('scroll',()=>active?.position(),true);
}
export function attachReaderPopover(button,content,{label=button.getAttribute('aria-label')||'Information',info=true,anchor=button,returnFocus=button}={}){
 install();button.type='button';button.classList.add(info?'reader-info-button':'reader-popup-toggle');
 content.classList.add('reader-popover');content.hidden=false;content.popover='auto';content.setAttribute('role','dialog');content.setAttribute('aria-label',label);content.tabIndex=-1;
 button.setAttribute('aria-haspopup','dialog');button.setAttribute('aria-controls',content.id);button.setAttribute('aria-expanded','false');button.setAttribute('popovertarget',content.id);if(!content.showPopover)content.hidden=true;
 const head=document.createElement('div');head.className='reader-popover-heading';const title=document.createElement('strong');title.textContent=label;
 const dismiss=document.createElement('button');dismiss.type='button';dismiss.className='reader-popover-close';dismiss.textContent='×';dismiss.setAttribute('aria-label','Close '+label);head.append(title,dismiss);content.prepend(head);document.body.append(content);
 let opened=false;
 const popup={button,content,
  position(){if(!opened)return;const v=window.visualViewport,x=v?.offsetLeft||0,y=v?.offsetTop||0,w=v?.width||innerWidth,h=v?.height||innerHeight,gap=10;
   content.style.maxWidth=Math.max(0,w-gap*2)+'px';content.style.maxHeight=Math.max(0,h-gap*2)+'px';const rect=anchor.getBoundingClientRect(),box=content.getBoundingClientRect();
   const left=Math.max(x+gap,Math.min(rect.left,x+w-box.width-gap));const below=rect.bottom+8,above=rect.top-box.height-8;
   const top=below+box.height<=y+h-gap?below:above>=y+gap?above:Math.max(y+gap,Math.min(below,y+h-box.height-gap));content.style.left=left+'px';content.style.top=top+'px';
  },
  close(restore=true){if(!opened)return;opened=false;if(content.hidePopover&&content.matches(':popover-open'))content.hidePopover();else content.hidden=true;button.setAttribute('aria-expanded','false');if(active===popup)active=null;if(restore&&returnFocus.isConnected&&!returnFocus.disabled)returnFocus.focus({preventScroll:true});},
  open(){if(opened)return;active?.close(false);opened=true;active=popup;content.hidden=false;button.setAttribute('aria-expanded','true');if(content.showPopover)content.showPopover();content.scrollTop=0;popup.position();content.focus({preventScroll:true});},
  get opened(){return opened;}
 };
 if(typeof ResizeObserver!=='undefined')new ResizeObserver(()=>{if(opened)popup.position();}).observe(content);
 dismiss.onclick=()=>popup.close(true);
 button.onclick=event=>{event.preventDefault();event.stopPropagation();if(opened)popup.close(true);else popup.open();};
 content.addEventListener('toggle',event=>{if(event.newState==='closed'&&opened){opened=false;button.setAttribute('aria-expanded','false');if(active===popup)active=null;}});
 return popup;
}
export function createReaderInfo({id,label,nodes=[],mount}){
 const button=document.createElement('button');button.id=id;button.textContent='ⓘ';button.setAttribute('aria-label',label);const content=document.createElement('div');content.id=id+'-details';content.append(...nodes);mount.append(button);attachReaderPopover(button,content,{label});return {button,content};
}
