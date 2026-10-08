// Fixed, synthetic, one-page fixture. Never accepts arbitrary uploads in proof mode.
export const OCR_PROOF_HASH='89d350f1375f503173ed61fc341d95ec319d6f483d6a57c702a09469bcef72f2';
export const syntheticOcr=()=>({model:'mistral-ocr-4-1',usage_info:{pages_processed:1},pages:[{index:0,markdown:'Synthetic OCR billing proof. No file was sent to Mistral.'}],p2s_synthetic:true});
