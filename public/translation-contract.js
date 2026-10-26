// A bounded first release of Google's supported standard NMT target languages.
export const TRANSLATION_LANGUAGES = Object.freeze({en:'English',es:'Spanish',fr:'French',de:'German',it:'Italian',pt:'Portuguese',nl:'Dutch',pl:'Polish',uk:'Ukrainian',ru:'Russian',ar:'Arabic',he:'Hebrew',hi:'Hindi',bn:'Bengali',ur:'Urdu',ta:'Tamil',te:'Telugu',ja:'Japanese',ko:'Korean','zh-CN':'Chinese (Simplified)','zh-TW':'Chinese (Traditional)',vi:'Vietnamese',th:'Thai',id:'Indonesian',tr:'Turkish',el:'Greek',ro:'Romanian',hu:'Hungarian',cs:'Czech',sv:'Swedish',da:'Danish',fi:'Finnish',no:'Norwegian',sw:'Swahili'});
export const TRANSLATION_MAX_CHARACTERS=30000;
export function translationCharacters(text,limit=Infinity){let count=0;for(const character of text){if(++count>limit)return count;}return count;}
export function translationWellFormed(text){for(const character of text){const code=character.codePointAt(0);if(code>=0xD800&&code<=0xDFFF)return false;}return true;}
export function validateTranslation(text,target){
 const characters=typeof text==='string'?translationCharacters(text,TRANSLATION_MAX_CHARACTERS):0;
 if(typeof text!=='string'||characters>TRANSLATION_MAX_CHARACTERS||!text.trim()||!translationWellFormed(text)||!Object.hasOwn(TRANSLATION_LANGUAGES,target))throw Error('Choose a supported language and text of at most 30,000 characters. The source is never shortened.');
 return {text,target,characters};
}
export async function translationIdentity(text,target,scope){
 validateTranslation(text,target);
 const bytes=new TextEncoder().encode(JSON.stringify(['google-standard-nmt-v1',scope,target,text]));
 return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
}
// Conservative local hints only. No network/model download; uncertain text gets
// no suggestion. This is not a source-language declaration to Google.
export function foreignLanguageHint(text){
 if(typeof text!=='string'||text.length>2*TRANSLATION_MAX_CHARACTERS)return null;
 const words=text.slice(0,8192).toLowerCase().normalize('NFD').replace(/\p{M}/gu,'').match(/\p{L}+/gu)||[];
 if(words.length<30)return null;
 const sets={en:'the this that these those is are was were with from for and have has not your you they their will would can should',es:'el los las una unos unas esta este esto estan para pero porque tambien muy del texto idioma cuando como nuestros',fr:'les des une est sont dans pour avec mais cette ces nous vous notre texte langue aussi',pt:'os uma umas sao nao para com mas isto tambem muito texto idioma voce voces nosso'};
 const scores=Object.entries(sets).map(([code,list])=>{const hits=new Set(list.split(' '));const matched=words.filter(w=>hits.has(w));return {code,score:matched.length,unique:new Set(matched).size};}).sort((a,b)=>b.score-a.score);
 const best=scores[0];return best.code!=='en'&&best.unique>=4&&best.score>=8&&best.score>=2*(scores[1]?.score||0)?best.code:null;
}
