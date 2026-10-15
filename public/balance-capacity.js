// Display estimate only: 150 words/minute × 6 characters/word including spaces.
// Shared billing remains 1 unit/character, 1,000 units/credit and 2,000 units/page.
export const NORMAL_SPEED_CHARACTERS_PER_HOUR=54000;
export const CAPACITY_ASSUMPTION='Listening estimates assume 150 words per minute and six characters per word including spaces (54,000 characters per hour). Actual length varies by text and voice. This is a fixed estimate, not based on your listening history.';
export const SHARED_BALANCE_EXPLANATION='One shared balance for paid cloud voices and scanning. Using either reduces both estimates. Browser voices are free.';
export function capacityEstimate(units){
 if(!Number.isSafeInteger(units)||units<0)throw Error('Invalid available balance');
 return {listeningHours:units/NORMAL_SPEED_CHARACTERS_PER_HOUR,scannedPages:Math.floor(units/2000)};
}
export function listeningHours(units){
 const hours=capacityEstimate(units).listeningHours;
 if(hours===0)return '0';
 return hours<0.1?'less than 0.1':hours.toLocaleString(undefined,{maximumFractionDigits:1});
}
export function balanceCapacity(units){
 const hours=listeningHours(units),pages=capacityEstimate(units).scannedPages;
 return `≈ ${hours} hours of speech or ${pages.toLocaleString()} scanned ${pages===1?'page':'pages'}`;
}
