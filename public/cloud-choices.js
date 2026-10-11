// Remember authorization only; never store source text, files, or credentials.
export const CLOUD_POLICIES={
 ocr:{version:'mistral-inline-whole-file-2-credits-v1',label:'Scan files I paste or choose automatically',disclosure:'Whole chosen files go to Mistral at 2 credits per page, up to your available balance and the current file/page limits. Complete saved results use credits; failed scanning uses none. Results stay private for 24 hours. Speech is a separate action.'},
 summary:{version:'cloudflare-summary-free-editor-v1',label:'Create summaries with one tap',disclosure:'Tapping Summary sends the current editor text to Cloudflare AI. Creating a summary uses no credits. Source and summary stay in this tab; the free Summary size and availability limits still apply. Paid-voice playback is separate.'}
};
const key=(scope,operation)=>`paste2speech.cloud-choice.v1.${scope}.${operation}`;
export function cloudChoice(storage,scope,operation,version=CLOUD_POLICIES[operation]?.version){
 if(!scope||typeof scope!=='string'||scope.length>100||version!==CLOUD_POLICIES[operation]?.version)return false;
 try{const value=JSON.parse(storage?.getItem(key(scope,operation))||'null');return value?.version===version&&value.enabled===true;}catch{return false;}
}
export function saveCloudChoice(storage,scope,operation,enabled,version=CLOUD_POLICIES[operation]?.version){
 if(!scope||typeof scope!=='string'||scope.length>100||version!==CLOUD_POLICIES[operation]?.version)return false;
 try{if(enabled)storage.setItem(key(scope,operation),JSON.stringify({version,enabled:true}));else storage.removeItem(key(scope,operation));return !enabled||cloudChoice(storage,scope,operation,version);}catch{return false;}
}
let panel;const controls=new Map();
const storage=()=>{try{return localStorage;}catch{return null;}};
export function configureCloudChoice(operation,{consentScope,consentPolicy}={}){
 const policy=CLOUD_POLICIES[operation];if(!policy)return null;
 if(!panel){panel=document.createElement('details');panel.id='cloud-actions';const heading=document.createElement('summary');heading.textContent='Cloud actions';panel.append(heading);const note=document.createElement('p');note.className='hint';note.textContent='Optional choices for this account on this browser. Turn a choice off to ask each time. Nothing is read or sent in the background.';panel.append(note);(document.querySelector('.mode-controls')||document.querySelector('main')||document.body).after(panel);}
 let control=controls.get(operation);
 if(!control){const row=document.createElement('p'),label=document.createElement('label'),input=document.createElement('input'),description=document.createElement('p');input.type='checkbox';input.id=`cloud-choice-${operation}`;label.append(input,document.createTextNode(' '+policy.label));row.append(label);description.id=`cloud-choice-${operation}-disclosure`;description.className='hint';description.textContent=policy.disclosure;input.setAttribute('aria-describedby',description.id);panel.append(row,description);control={input,scope:null,version:null,allowed(){return cloudChoice(storage(),this.scope,operation,this.version);},remember(enabled){const saved=saveCloudChoice(storage(),this.scope,operation,enabled,this.version);this.input.checked=this.allowed();document.dispatchEvent(new CustomEvent('cloud-choice-change',{detail:{operation}}));return saved;}};input.onchange=()=>control.remember(input.checked);controls.set(operation,control);}
 control.scope=consentScope;control.version=consentPolicy;control.input.disabled=!consentScope||consentPolicy!==policy.version;control.input.checked=control.allowed();return control;
}
if(typeof window!=='undefined')window.addEventListener('storage',()=>{for(const control of controls.values())control.input.checked=control.allowed();document.dispatchEvent(new Event('cloud-choice-change'));});
