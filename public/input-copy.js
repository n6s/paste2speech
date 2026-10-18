// The trial and flag-off readers must describe the controls they actually show.
export function inputActionCopy({queue=false,unified=false,fileLabel='Choose file'}={}) {
 const playLabel=queue?'Paste & Play':'Clear, Paste & Play',pasteLabel=queue?'Paste only':'Paste';
 const documentHint=queue
  ? 'Paste only inserts text without playback. Paste & Play replaces the current reading and starts text playback. For images, review the scanning options; Paste & Play starts playback after the complete text is ready, while Paste only loads it without autoplay. Use Open file for a saved screenshot. Play next and Add to queue keep your editor and current playback. Clear is a separate button.'
  : unified?'Paste inserts text without playing it. Clear, Paste & Play replaces the text and starts speech. Images open text-scanning options; nothing is uploaded until you agree. Use '+fileLabel+' if your phone does not provide the image.'
  :'Paste inserts text at the cursor without playing it. Clear, Paste & Play replaces the text and starts speech. Images open OCR options; nothing is uploaded until you agree. If your phone does not provide the image, use '+fileLabel+' for the saved screenshot.';
 return {playLabel,pasteLabel,fileActions:queue?'Open file loads the editor without playing. Open & Play starts after a complete result is loaded. Play next and Add to queue keep the current editor and playback; file processing can finish while an item waits, and paid speech is prepared only at its turn. File scanning keeps the consent, price and saved-result rules described here. There are no automatic paid retries.':null,guide:'Click '+playLabel+'.',documentHint,
  editing:'Formatted paste keeps headings and lists when available. Original editing text stays in this tab. '+pasteLabel+' inserts text without playback; '+playLabel+' replaces it and starts playback.',
  diagnosticGuide:'1. Copy the weather sentence from ChatGPT. 2. Start a check. 3. Use either your keyboard paste or '+playLabel+'. 4. Copy report. This check skips speech playback. The report contains counts, event timing and checks for the two known office labels. It never includes your document, clipboard HTML, other URLs or account details. Nothing is uploaded. Reload discards the report.',
  diagnosticStatus:'Checking locally. Playback is paused for this check. Paste into Edit, or use '+playLabel+'.'
 };
}
