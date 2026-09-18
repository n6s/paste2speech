const small=['zero','one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen'];
const words=n=>n<20?small[n]:['','','twenty','thirty','forty','fifty','sixty','seventy','eighty','ninety'][Math.floor(n/10)]+(n%10?' '+small[n%10]:'');
const clock='(0?[1-9]|1[0-2]):([0-5]\\d)(?:[ \\t]*([ap])\\.?m)?';
const left='(?<![\\w:./])',right='(?![\\w:/]|\\.\\w)';
function say(hour,minute,period,sharedPeriod=false) {
 const h=words(Number(hour)),m=Number(minute);
 return h+(m?' '+(m<10?'oh '+words(m):words(m)):period||sharedPeriod?'':" o'clock")+(period?' '+period.toUpperCase()+' M':'');
}
export function timeSpeech(text) {
 text=text.replace(/\bratio(?: of)?[ \t]+(\d{1,2}):(\d{1,2})(?![\w:/]|\.\w)/gi,(match,a,b)=>match.slice(0,match.indexOf(a+':'))+words(Number(a))+' to '+words(Number(b)));
 text=text.replace(/(?<![\w:./])(\d{1,2}):(\d{1,2})(?=[ \t]+ratio\b)/gi,(_,a,b)=>words(Number(a))+' to '+words(Number(b)));
 text=text.replace(new RegExp(left+clock+'[ \\t]*[-–—→][ \\t]*'+clock+right,'gi'),(_,h,m,p,h2,m2,p2)=>say(h,m,p,Boolean(p2))+' to '+say(h2,m2,p2));
 text=text.replace(new RegExp(left+clock+right,'gi'),(_,h,m,p)=>say(h,m,p));
 return text.replace(/(?<![\w:./])([1-9]):([1-9])(?![\w:/]|\.\w)/g,(_,a,b)=>small[a]+' to '+small[b]);
}
