export function formatCredits(units){
 if(!Number.isSafeInteger(units)||units<0)throw Error('Invalid credit balance');
 return (units/1000).toLocaleString(undefined,{maximumFractionDigits:3});
}
export const sharedCredits=account=>account?.walletVersion==='unified-v1';
