// Fixed, synthetic, one-page fixture. Never accepts arbitrary uploads in proof mode.
export const OCR_PROOF_HASH='f5e0a56614b0d7ddd7384bf367bf658f4dc20d3cb71e16be82b6cd8d4333850e';
export const syntheticOcr=()=>({model:'mistral-ocr-4-1',usage_info:{pages_processed:1},pages:[{index:0,markdown:'Synthetic OCR billing proof. No file was sent to Mistral.'}],p2s_synthetic:true});
