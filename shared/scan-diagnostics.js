export function filenameBasename(name){const value=String(name||'');return (/^[A-Za-z]:\\/.test(value)?value.split('\\').at(-1):value.split('/').at(-1)).slice(0,1024);}
export function scanPlatform(navigator){
 const ua=navigator?.userAgent||'',browser=ua.match(/(Edg)\/([0-9.]+)/)||ua.match(/(Firefox)\/([0-9.]+)/)||ua.match(/(Chrome)\/([0-9.]+)/)||ua.match(/(Version)\/([0-9.]+)/);
 const os=ua.match(/Android [0-9.]+|(?:iPhone|CPU) OS [0-9_]+|Windows NT [0-9.]+|Mac OS X [0-9_]+/)?.[0]||(/Linux/.test(ua)?'Linux':'Other');
 return {browser:browser?browser[1]+' '+browser[2]:'Other',os};
}
export async function scanFileMetadata(file,navigator){
 let bytes=new Uint8Array();try{bytes=new Uint8Array(await file.slice(0,65536).arrayBuffer());}catch{}let width=null,height=null;
 const view=new DataView(bytes.buffer),at=(n,text)=>[...text].every((c,i)=>bytes[n+i]===c.charCodeAt(0));
 if(file.type==='image/png'&&bytes.length>=24&&bytes[0]===137&&at(1,'PNG\r\n\x1a\n')){width=view.getUint32(16);height=view.getUint32(20);}
 if(file.type==='image/jpeg'&&bytes[0]===255&&bytes[1]===216){let i=2;while(i+8<bytes.length){if(bytes[i++]!==255)break;while(bytes[i]===255)i++;if(i+7>=bytes.length)break;const marker=bytes[i++],length=view.getUint16(i);if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)){height=view.getUint16(i+3);width=view.getUint16(i+5);break;}if(length<2)break;i+=length;}}
 if(file.type==='image/webp'&&bytes.length>=30&&at(0,'RIFF')&&at(8,'WEBP')){if(at(12,'VP8X')){const u24=n=>bytes[n]+bytes[n+1]*256+bytes[n+2]*65536;width=1+u24(24);height=1+u24(27);}else if(at(12,'VP8 ')&&bytes[23]===157&&bytes[24]===1&&bytes[25]===42){width=view.getUint16(26,true)&16383;height=view.getUint16(28,true)&16383;}else if(at(12,'VP8L')&&bytes[20]===47){const bits=view.getUint32(21,true);width=(bits&16383)+1;height=((bits>>>14)&16383)+1;}}
 if(!width||!height||width>1000000||height>1000000)width=height=null;
 return {rawBasename:filenameBasename(file.name),filenameTruncated:String(file.name).length>1024,mime:String(file.type||'').slice(0,120),bytes:file.size,width,height,...scanPlatform(navigator)};
}
