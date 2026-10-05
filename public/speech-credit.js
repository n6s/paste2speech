// Advisory whole-reading check. Server admission remains authoritative against
// stale balances and concurrent tabs; no speech or reservation happens here.
export async function checkSpeechCredit(fetcher, needed) {
  if (!needed) return;
  const response = await fetcher('/api/reader', {signal: AbortSignal.timeout(15000)});
  if (!response.ok) throw Error('Could not check speech credit. No new audio was started. Tap Resume to check again.');
  const config = await response.json(), account = config.account;
  if (!account) throw Error('Sign in to check speech credit before preparing this reading. No new audio was started.');
  if (account.creditRequired === false && !account.shortfall) return;
  const available = Number(account.balance);
  if (!Number.isSafeInteger(available) || available < 0) throw Error('Speech credit could not be confirmed. No new audio was started. Tap Resume to check again.');
  if (!account.shortfall && available >= needed) return;
  const error = Error(`Preparation paused: insufficient speech credit. Remaining preparation needs ${needed.toLocaleString()} credits; ${available.toLocaleString()} available${available < needed ? `; add ${ (needed - available).toLocaleString()} more` : ''}. Already prepared audio is kept. Top up, then tap Refresh credit & Resume, or use free browser voices.`);
  Object.assign(error, {creditPaused: true, needed, available});
  throw error;
}
