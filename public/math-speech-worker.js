// Worker-only DOM adapter: no live document, HTML rendering, external entities,
// remote rules, font loading, TeX autoload, or speech/provider access.
import {DOMImplementation,DOMParser,XMLSerializer} from '@xmldom/xmldom';
import * as Wgxpath from 'wicked-good-xpath';
import baseRules from 'speech-rule-engine/lib/mathmaps/base.json';
import englishRules from 'speech-rule-engine/lib/mathmaps/en.json';
import {mathjax} from '@mathjax/src/js/mathjax.js';
import {TeX} from '@mathjax/src/js/input/tex.js';
import {liteAdaptor} from '@mathjax/src/js/adaptors/liteAdaptor.js';
import {RegisterHTMLHandler} from '@mathjax/src/js/handlers/html.js';
import {STATE} from '@mathjax/src/js/core/MathItem.js';
import {SerializedMmlVisitor} from '@mathjax/src/js/core/MmlTree/SerializedMmlVisitor.js';
import '@mathjax/src/js/input/tex/ams/AmsConfiguration.js';
import {MATH_PREVIEW_LIMITS as LIMITS} from './math-speech-spans.js';
const dom={document:new DOMImplementation().createDocument(null,'html',null),DOMParser,XMLSerializer,XPathResult:{}};Wgxpath.install(dom);dom.document.XPathResult=dom.XPathResult;
dom.document.documentElement.querySelectorAll=()=>[];
self.window=dom;self.document=dom.document;
self.SREfeature={delay:true,domain:'clearspeak',locale:'en',style:'Roots_RootEnd',mode:'async',custom:async locale=>{if(locale==='base')return JSON.stringify(baseRules);if(locale==='en')return JSON.stringify(englishRules);throw Error('Only bundled English rules are available.');}};
RegisterHTMLHandler(liteAdaptor());
const input=new TeX({packages:['base','ams'],maxBuffer:LIMITS.tex,maxMacros:200,maxTemplateSubtitutions:200,formatError:()=>{throw Error('Unsupported or malformed TeX.');}});
const html=mathjax.document('',{InputJax:input}),visitor=new SerializedMmlVisitor();
const commands=new Set('frac dfrac tfrac sqrt cdot times div pm mp approx neq le ge leq geq lt gt infty left right quad qquad begin end downarrow uparrow over text mathrm mathbf alpha beta gamma delta theta pi sigma omega'.split(' '));
const tags=new Set('math mrow mi mn mo mfrac msup msub msubsup msqrt mroot mfenced mtable mtr mtd mspace mmultiscripts mprescripts none'.split(' '));
const attrs=new Set('xmlns display mathvariant stretchy fence separator form open close separators columnalign rowalign columnspacing rowspacing width'.split(' '));
function checkMathML(xml){
 if(xml.length>LIMITS.mathml||/<!|<\?|&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9a-f]+;)/i.test(xml))throw Error('Unsupported MathML markup.');
 const doc=new DOMParser({onError:()=>{throw Error('Malformed MathML.');}}).parseFromString(xml,'application/xml');let count=0;
 function walk(node,depth){if(++count>LIMITS.nodes||depth>LIMITS.depth)throw Error('Math expression exceeds preview limits.');if(node.nodeType===1){if(!tags.has(node.localName)||node.prefix||node.namespaceURI&&node.namespaceURI!=='http://www.w3.org/1998/Math/MathML')throw Error('Unsupported MathML element.');for(const a of Array.from(node.attributes)){if(!attrs.has(a.name)||a.value.length>80||a.name==='xmlns'&&a.value!=='http://www.w3.org/1998/Math/MathML')throw Error('Unsupported MathML attribute.');}}else if(node.nodeType!==3&&node.nodeType!==9)throw Error('Unsupported XML node.');for(let child=node.firstChild;child;child=child.nextSibling)walk(child,depth+1);}
 if(doc.documentElement?.localName!=='math')throw Error('MathML needs a math root.');walk(doc.documentElement,0);doc.documentElement.setAttribute('xmlns','http://www.w3.org/1998/Math/MathML');return new XMLSerializer().serializeToString(doc.documentElement);
}
function checkGeneratedBudget(xml){if(xml.length>32768)throw Error('Compiled formula exceeds preview limits.');const doc=new DOMParser().parseFromString(xml,'application/xml');let count=0;function walk(n,depth){if(++count>LIMITS.nodes||depth>LIMITS.depth)throw Error('Compiled formula exceeds preview limits.');for(let c=n.firstChild;c;c=c.nextSibling)walk(c,depth+1);}walk(doc.documentElement,0);}
function checkTex(tex){
 if(tex.length>LIMITS.tex)throw Error('Formula exceeds the 2,048-character preview limit.');let depth=0;
 for(const match of tex.matchAll(/\\([A-Za-z]+)/g))if(!commands.has(match[1]))throw Error('This TeX command is outside the preview subset.');
 for(const match of tex.matchAll(/\\(?:begin|end)\{([^}]+)\}/g))if(!['array','aligned','align','align*','gathered','matrix','pmatrix','bmatrix','cases'].includes(match[1]))throw Error('Unsupported TeX environment.');
 for(let i=0;i<tex.length;i++){if(tex[i]==='\\'){i++;continue;}if(tex[i]==='{')depth++;if(tex[i]==='}')depth--;if(depth<0||depth>LIMITS.depth)throw Error('Invalid or deeply nested formula.');}if(depth)throw Error('Unbalanced formula.');
}
function speakMath(sre,xml){
 const doc=new DOMParser().parseFromString(xml,'application/xml'),root=doc.documentElement;let container=root;const elements=Array.from(root.childNodes).filter(n=>n.nodeType===1);if(elements.length===1&&elements[0].localName==='mrow')container=elements[0];
 const groups=[[]];for(const node of Array.from(container.childNodes)){if(node.nodeType===1&&node.localName==='mspace'&&/^\d+(?:\.\d+)?em$/.test(node.getAttribute('width')||'')&&parseFloat(node.getAttribute('width'))>=1){if(groups.at(-1).length)groups.push([]);}else groups.at(-1).push(node);}
 if(groups.length===1)return sre.toSpeech(xml);return groups.filter(g=>g.length).map(group=>{const m=doc.createElementNS('http://www.w3.org/1998/Math/MathML','math');for(const child of group)m.appendChild(child.cloneNode(true));return sre.toSpeech(new XMLSerializer().serializeToString(m));}).join('; ');
}
const started=performance.now();let startupMs=0;
const ready=import('speech-rule-engine/js/common/system.js').then(async module=>{const sre=module.default||module;self.SREfeature.delay=false;await sre.setupEngine({...self.SREfeature,delay:false});await sre.engineReady();startupMs=Math.round(performance.now()-started);return sre;});
self.onmessage=async event=>{
 const {id,formulas}=event.data||{};if(!Array.isArray(formulas)||formulas.length>LIMITS.formulas){self.postMessage({id,error:'Too many formulas.'});return;}
 try{const sre=await ready,results=[];
  for(const formula of formulas){try{let xml;if(formula.kind==='mathml')xml=checkMathML(formula.body);else{checkTex(formula.body);const node=await mathjax.handleRetriesFor(()=>html.convert(formula.body,{format:'TeX',end:STATE.COMPILED,display:formula.display}));xml=visitor.visitTree(node,html);if(/<merror\b/.test(xml))throw Error('MathJax could not parse this formula.');checkGeneratedBudget(xml);}
   const speech=speakMath(sre,xml);if(typeof speech!=='string'||!speech.trim()||speech.length>16000)throw Error('No usable math wording was returned.');results.push({speech});
  }catch(error){results.push({warning:error.message});}}
  self.postMessage({id,results,engine:'MathJax 4.1.3 · SRE 4.1.5 ClearSpeak English',startupMs});
 }catch{self.postMessage({id,error:'The local math speech engine could not start. Your original is unchanged.'});}
};
