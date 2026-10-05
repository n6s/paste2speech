import {checkSpeechCredit} from './speech-credit.js';
// One paid job per part. Persist IDs before POST so an uncertain acknowledgement
// can be checked, never silently replaced with another chargeable request.
export class PlaylistSession {
  constructor(parts, voice, {fetcher = (...args) => fetch(...args), save = () => {}, records = [], changed = () => {}, statusChanged = () => {}, preflight = false, createOptions = {delivery: 'complete'}, sleep = ms => new Promise(r => setTimeout(r, ms))} = {}) {
    Object.assign(this, {parts, voice, fetcher, save, changed, statusChanged, preflight, createOptions, sleep});
    this.records = parts.map((_, i) => records[i] || {});
    this.stopped = false;
  }
  persist() { this.save(this.records); this.changed(this); }
  async status(id) {
    const r = await this.fetcher(`/api/readings/${id}`, {signal: AbortSignal.timeout(15000)});
    if (!r.ok) throw Error(`Cannot check a prepared part (${r.status}). Try checking again; speech will not be regenerated.`);
    return r.json();
  }
  prepare() {
    if (this.preparing) return this.preparing;
    this.preparing = this.runPreparation().finally(() => {this.preparing = null;});
    return this.preparing;
  }
  async runPreparation() {
    this.stopped = false;
    if (this.preflight) {
      // Reconcile saved admissions first. A lost acknowledgement or missing job
      // must never be treated as permission to buy replacement speech.
      for (let i = 0; i < this.records.length && !this.stopped; i++) {
        const record = this.records[i];
        if (!record.id || ['refused', 'credit-paused'].includes(record.state)) continue;
        this.active = i;
        const status = await this.status(record.id);
        if (this.stopped) return;
        this.statusChanged(i, status);
        Object.assign(record, {state: status.state, duration: status.duration, completed: status.completed}); this.persist();
        if (['failed', 'cancelled', 'expired'].includes(status.state)) throw Error(status.error || `Part ${i + 1} ${status.state}. Completed parts remain available. No speech was retried.`);
      }
      const needed = this.parts.reduce((n, part, i) => n + (!this.records[i].id || ['refused', 'credit-paused'].includes(this.records[i].state) ? part.chunks.reduce((sum, text) => sum + [...text].length, 0) : 0), 0);
      if (this.stopped) return;
      await checkSpeechCredit(this.fetcher, needed);
      if (this.stopped) return;
    }
    for (let i = 0; i < this.parts.length && !this.stopped; i++) {
      const record = this.records[i]; this.active = i;
      if (!record.id || record.state === 'refused' || record.state === 'credit-paused') {
        const session = await this.fetcher('/api/billing/session', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{}'});
        if (!session.ok) throw Error('Sign in to your account before preparing playlist audio.');
        if (this.stopped) break;
        record.createOptions ||= record.id ? {delivery: 'complete'} : this.createOptions;
        record.id ||= crypto.randomUUID(); record.state = 'checking'; this.persist();
        let response;
        try {
          response = await this.fetcher('/api/readings', {method: 'POST', signal: AbortSignal.timeout(20000),
            headers: {'Content-Type': 'application/json', 'Idempotency-Key': record.id},
            body: JSON.stringify({chunks: this.parts[i].chunks, voice: this.voice, ...record.createOptions})});
        } catch { /* Recover only by checking the persisted ID below. */ }
        if (response && !response.ok && response.status < 500) {
          const message = (await response.json()).detail || `Preparation refused (${response.status}).`;
          // Retain the ID even on refusal: admission might already be recorded.
          record.state = response.status === 402 ? 'credit-paused' : 'refused'; this.persist();
          const error = Error(response.status === 402 ? 'Preparation paused: insufficient speech credit. Already prepared audio remains available. Add credit, refresh your balance, then tap Resume.' : message);
          error.creditPaused = response.status === 402; throw error;
        }
      }
      while (!this.stopped) {
        const status = await this.status(record.id);
        if (status.state === 'ready' && (status.total != null && (status.total !== this.parts[i].chunks.length || status.completed !== status.total || Array.isArray(status.starts) && status.starts.length !== status.total))) {
          throw Error('Audio preparation is incomplete. Video conversion has not started.');
        }
        this.statusChanged(i, status);
        Object.assign(record, {state: status.state, duration: status.duration, completed: status.completed}); this.persist();
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
