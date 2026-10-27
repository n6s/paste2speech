const credits=n=>`${Number((n||0).toFixed(3)).toLocaleString('en-US',{maximumFractionDigits:3})} ${n===1?'credit':'credits'}`;
export function summaryDocumentStatus(doc){
 if(!doc)return'Summary is unavailable. Saved work is kept.';
 const used=credits(doc.creditsUsed),done=Number.isSafeInteger(doc.next)?doc.next:doc.passes||0,total=doc.stages||0;
 if(doc.state==='ready')return`Summarized in ${doc.passes} ${doc.passes===1?'pass':'passes'} for ${used}.`;
 if(doc.state==='active')return`Summarizing · pass ${Math.min(done+1,total)} of ${total} · ${used} used…`;
 const progress=`${done} of ${total} passes complete · ${used} used.`;
 if(doc.state==='blocked')return`Summary incomplete · ${progress} ${doc.detail||'The next pass needs checking. Saved sections are kept; no automatic retry.'} Unused credits returned.`;
 if(doc.state==='paused')return`Summary paused · ${progress} ${doc.detail||'Click Summary to continue.'}`;
 if(doc.state==='pausing')return`Finishing this pass · ${progress} No new passes will start.`;
 return`${doc.detail||'Saved Summary expired.'} ${used} used.`;
}
