export const SUMMARY_SOURCE_BYTES=24000;
export const SUMMARY_ENCODED_SOURCE_BYTES=30000;
export const summarySourceBytes=text=>new TextEncoder().encode(text).length;
export const summaryEncodedBytes=text=>summarySourceBytes(JSON.stringify({source_text:text}));
export const summarySourceFits=text=>summarySourceBytes(text)<=SUMMARY_SOURCE_BYTES&&summaryEncodedBytes(text)<=SUMMARY_ENCODED_SOURCE_BYTES;
