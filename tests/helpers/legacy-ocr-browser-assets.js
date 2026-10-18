// Regression coverage of the retained inline OCR branch (still used publicly).
// Only a test server alters this build switch. The actual durable staging assets
// are tested unchanged by ocr-jobs-browser.mjs and the native lifecycle proof.
export function legacyOcrBrowserAsset(path,bytes){
 // Match the flag-off first-paint label as well as the JavaScript switches.
 if(path==='/'||path==='/index.html')return Buffer.from(bytes.toString().replace(/(<button id="paste-play"[^>]*>)Paste &amp; Play<\/button>/,'$1Clear, Paste &amp; Play</button>'));
 if(path!=='/app.js')return bytes;const source=bytes.toString(),marker='var OCR_DURABLE_JOBS = true;';
 if(!source.includes(marker))return bytes;
 if(source.split(marker).length!==2)throw Error('Unrecognized OCR build switch; refresh the legacy regression harness.');
 // The queue trial requires durable intake; this historical fixture has neither.
 return Buffer.from(source.replace(marker,'var OCR_DURABLE_JOBS = false;').replace('var INPUT_QUEUE_UI = true;','var INPUT_QUEUE_UI = false;'));
}
