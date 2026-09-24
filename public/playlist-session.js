// One paid job per part. Persist IDs before POST so an uncertain acknowledgement
// can be checked, never silently replaced with another chargeable request.
export class PlaylistSession {
  constructor(parts, voice, {fetcher = (...args) => fetch(...args), save = () => {}, records = [], changed = () => {}, sleep = ms => new Promise(r => setTimeout(r, ms))} = {}) {
    Object.assign(this, {parts, voice, fetcher, save, changed, sleep});
    this.records = parts.map((_, i) => records[i] || {});
    this.stopped = false;
  }
  persist() { this.save(this.records); this.changed(this); }
  async status(id) {
    const r = await this.fetcher(`/api/readings/${id}`, {signal: AbortSignal.timeout(15000)});
    if (!r.ok) throw Error(`Cannot check a prepared part (${r.status}). Try checking again; speech will not be regenerated.`);
    return r.json();
  }
  async prepare() {
    this.stopped = false;
    for (let i = 0; i < this.parts.length && !this.stopped; i++) {
      const record = this.records[i]; this.active = i;
      if (!record.id) {
        const session = await this.fetcher('/api/billing/session', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{}'});
        if (!session.ok) throw Error('Sign in to your account before preparing playlist audio.');
        if (this.stopped) break;
        record.id = crypto.randomUUID(); record.state = 'checking'; this.persist();
        let response;
        try {
          response = await this.fetcher('/api/readings', {method: 'POST', signal: AbortSignal.timeout(20000),
            headers: {'Content-Type': 'application/json', 'Idempotency-Key': record.id},
            body: JSON.stringify({chunks: this.parts[i].chunks, voice: this.voice, delivery: 'complete'})});
        } catch { /* Recover only by checking the persisted ID below. */ }
        if (response && !response.ok && response.status < 500) {
          const message = (await response.json()).detail || `Preparation refused (${response.status}).`;
          // Retain the ID even on refusal: admission might already be recorded.
          record.state = 'refused'; this.persist(); throw Error(message);
        }
      }
      while (!this.stopped) {
        const status = await this.status(record.id);
        Object.assign(record, {state: status.state, duration: status.duration}); this.persist();
        if (status.state === 'ready') break;
        if (['failed', 'cancelled'].includes(status.state)) throw Error(status.error || `Part ${i + 1} ${status.state}. Completed parts remain available. No speech was retried.`);
        await this.sleep(1500);
      }
    }
    this.persist();
  }
  // Stop scheduling immediately. An in-flight create is reconciled by prepare()
  // before its finally block calls cancelPending, including a late POST reply.
  stop() { this.stopped = true; }
  async cancelPending() {
    for (const record of this.records.filter(r => r.id && r.state !== 'ready')) {
      const response = await this.fetcher(`/api/readings/${record.id}`, {method: 'DELETE', signal: AbortSignal.timeout(15000)});
      if (!response.ok) throw Error('Cancellation could not be confirmed. Check your account before starting another playlist.');
      record.state = 'cancelled'; this.persist();
    }
  }
}
