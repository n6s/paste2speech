// Persist only allowlisted categories, never provider messages, source or tokens.
const categories=new Set(['configuration','prompt_bound','provider_timeout','response_invalid','provider_response','output_empty','output_limit','output_invalid','usage_invalid','usage_missing','result_deadline','dispatch_unconfirmed','provider_unclassified','settlement_unconfirmed']);
export function summaryFailure(category,flags={}){return Object.assign(Error('Summary did not return a confirmed usable result.'),{summaryFailure:category,...flags});}
export function summaryFailureCategory(error,phase='provider'){
 const value=error?.summaryFailure;if(categories.has(value)||typeof value==='string'&&/^provider_http_[45]\d{2}$/.test(value))return value;
 return phase==='dispatch'?'dispatch_unconfirmed':phase==='settlement'?'settlement_unconfirmed':phase==='output'?'output_invalid':'provider_unclassified';
}
export function summaryFailureDiagnostic(reason){
 if(!categories.has(reason)&&!(typeof reason==='string'&&/^provider_http_[45]\d{2}$/.test(reason)))return{category:'unclassified',phase:'unknown'};
 return{category:reason,phase:reason==='dispatch_unconfirmed'?'dispatch':reason==='settlement_unconfirmed'?'settlement':/^(output_|usage_)/.test(reason)?'validation':'provider'};
}
