// Xref rows contain bytes, not rendered content. Keep decoding within the
// structural stream's existing 2 MiB bound and validated xref entry width.
export function decodeXrefPredictor(data,{predictor=1,columns=1,colors=1,bits=8,width}){
 if(!(data instanceof Uint8Array)||data.length>2*1024*1024||!Number.isSafeInteger(width)||width<1||width>24)throw Error('Invalid PDF predictor bounds');
 if(colors!==1||bits!==8||!Number.isSafeInteger(columns)||columns<1||columns>24)throw Error('Unsupported PDF predictor parameters');
 if(predictor===1)return data;
 if(!Number.isInteger(predictor)||predictor<10||predictor>15||columns!==width||data.length%(columns+1))throw Error('Invalid PDF predictor rows');
 const output=new Uint8Array(data.length/(columns+1)*columns);
 const paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;};
 for(let src=0,dst=0;src<data.length;){
  const filter=data[src++];if(filter>4||(predictor!==15&&filter!==predictor-10))throw Error('Invalid PDF predictor filter');
  for(let x=0;x<columns;x++,dst++){
   const left=x?output[dst-1]:0,up=dst>=columns?output[dst-columns]:0,upperLeft=x&&dst>=columns?output[dst-columns-1]:0;
   const predicted=filter===0?0:filter===1?left:filter===2?up:filter===3?Math.floor((left+up)/2):paeth(left,up,upperLeft);
   output[dst]=(data[src++]+predicted)&255;
  }
 }
 return output;
}
