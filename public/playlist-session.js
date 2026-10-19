import {recoveryProof,recoverySegments,combinedRecoveryStatus} from './section-recovery.js';
import {rejectPreparedSignIn} from './prepared-response.js';
import {checkSpeechCredit} from './speech-credit.js';
const retryDelay=(ms,signal)=>new Promise(resolve=>{
  if(signal?.aborted)return resolve();
  const done=()=>{clearTimeout(timer);signal?.removeEventListener('abort',done);resolve();};
  const timer=setTimeout(done,ms);signal?.addEventListener('abort',done,{once:true});
});
// One paid job per part. Persist IDs before POST so an uncertain acknowledgement
// can be checked, never silently replaced with another chargeable request.
export class PlaylistSession {
  constructor(parts, voice, {fetcher = (...args) => fetch(...args), save = () => {}, records = [], changed = () => {}, statusChanged = () => {}, preflight = false, createOptions = {delivery: 'complete'}, retryStatus = false, sectionRecovery = false, connectionChanged = () => {}, sleep = retryDelay} = {}) {
    Object.assign(this, {parts, voice, fetcher, save, changed, statusChanged, preflight, createOptions, retryStatus, connectionChanged, sleep});
    this.sectionRecovery=sectionRecovery;this.recoverySessions=new WeakMap();this.prefixStatuses=new Map();
    this.records = parts.map((_, i) => records[i] || {});
    this.stopped = false;
  }
  recoverySession(index){
    const record=this.records[index];let nested=this.recoverySessions.get(record);if(nested)return nested;
    const segments=recoverySegments(record,this.parts[index].chunks),parts=segments.map(s=>({chunks:this.parts[index].chunks.slice(s.start,s.end)})),statuses=[];
    nested=new PlaylistSession(parts,this.voice,{records:segments,fetcher:this.fetcher,preflight:this.preflight,retryStatus:this.retryStatus,sectionRecovery:true,sleep:this.sleep,createOptions:{delivery:'complete'},connectionChanged:this.connectionChanged,save:records=>{record.recovery.segments=records;this.persist();},statusChanged:(i,status)=>{statuses[i]=status;this.statusChanged(index,combinedRecoveryStatus(record.id,parts,statuses));}});nested.recoverySource=new Map(segments.filter(s=>s.reusePrefix!==undefined).map(s=>[s.id,this.parts[index].chunks.slice(s.start)]));this.recoverySessions.set(record,nested);return nested;
  }
  cancellationRecords(){return this.records.flatMap(r=>r.recovery?r.recovery.segments.filter(s=>s.reusePrefix===undefined):r.reusePrefix===undefined?[r]:[]);}
  persist() { this.save(this.records); this.changed(this); }
  async status(id, signal) {
    const index=this.records.findIndex(r=>r.id===id),record=this.records[index];
    if(record?.recovery){if(!this.sectionRecovery)throw Error('Open this recovered reading with Play before exporting it. Saved audio is kept; no speech was regenerated.');const nested=this.recoverySession(index),statuses=[];for(const r of nested.records){if(!r.id||['refused','credit-paused'].includes(r.state))break;statuses.push(await nested.status(r.id,signal));}return combinedRecoveryStatus(id,nested.parts,statuses);}
    if(record?.reusePrefix!==undefined){if(!this.sectionRecovery)throw Error('Saved section recovery is unavailable.');let proof=this.prefixStatuses.get(id);if(!proof){proof=await recoveryProof(this.fetcher,id,this.recoverySource?.get(id)||this.parts[index].chunks,this.voice,signal);this.prefixStatuses.set(id,proof);}if(proof.reusedSections!==record.reusePrefix)throw Error('Saved recovery prefix changed. No speech was regenerated.');return proof.prefix;}
    let r;
    try { r = await this.fetcher(`/api/readings/${id}`, {signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000)}); }
    catch (error) { error.statusUnavailable = true; throw error; }
    rejectPreparedSignIn(r);
    if (!r.ok) {
      const error = Error(`Cannot check a prepared part (${r.status}). Try checking again; speech will not be regenerated.`);
      error.statusUnavailable = r.status >= 500 || [408, 409, 429].includes(r.status);
      throw error;
    }
    try { return await r.json(); }
    catch { const error=new SyntaxError('The saved preparation status could not be read. No speech was regenerated.');error.statusUnavailable=false;throw error; }
  }
  async readStatus(id) {
    if (!this.retryStatus) return this.status(id);
    for (let attempt = 0; !this.stopped; attempt++) {
      try {
        const status = await this.status(id, this.statusController.signal);
        if (this.stopped) return;
        this.connectionChanged(null); return status;
      } catch (error) {
        if (this.stopped) return;
        if (!error.statusUnavailable) throw error;
        this.connectionChanged(error);
        // Retry only this saved ID's GET. Creation/terminal failures retain their
        // existing reconciliation and explicit paid-retry protections.
        const delayController = new AbortController();
        const wake = new Promise(resolve => { this.wakeStatusRetry = () => { delayController.abort(); resolve(); }; });
        const online = this.wakeStatusRetry;globalThis.window?.addEventListener('online', online, {once:true});
        try { await Promise.race([this.sleep(Math.min(8000, 1000 * 2 ** Math.min(attempt, 3)), delayController.signal), wake]); }
        finally { delayController.abort();globalThis.window?.removeEventListener('online', online);this.wakeStatusRetry = null; }
      }
    }
  }
  prepare() {
    if (this.preparing) return this.preparing;
    this.preparing = this.runPreparation().finally(() => {this.preparing = null;});
    return this.preparing;
  }
  async runPreparation() {
    this.stopped = false; this.statusController = new AbortController();
    if (this.preflight) {
      // Reconcile saved admissions first. A lost acknowledgement or missing job
      // must never be treated as permission to buy replacement speech.
      for (let i = 0; i < this.records.length && !this.stopped; i++) {
        const record = this.records[i];
        if (!record.id || ['refused', 'credit-paused'].includes(record.state)) continue;
        this.active = i;
        const status = await this.readStatus(record.id);
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
      if(record.recovery){const nested=this.recoverySession(i);await nested.prepare();if(this.stopped)break;const status=await this.status(record.id);this.statusChanged(i,status);Object.assign(record,{state:status.state,duration:status.duration,completed:status.completed});this.persist();continue;}
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
        const status = await this.readStatus(record.id);
        if (this.stopped) return;
        if (status.state === 'ready' && (status.total != null && (status.total !== this.parts[i].chunks.length || status.completed !== status.total || Array.isArray(status.starts) && status.starts.length !== status.total))) {
          throw Error('Audio preparation is incomplete. Video conversion has not started.');
        }
        this.statusChanged(i, status);
        Object.assign(record, {state: status.state, duration: status.duration, completed: status.completed}); this.persist();
        if (status.state === 'ready') break;
        if (['failed', 'cancelled', 'expired'].includes(status.state)) throw Error(status.error || `Part ${i + 1} ${status.state}. Completed parts remain available. No speech was retried.`);
        await this.sleep(1500);
      }
    }
    this.persist();
  }
  // Stop scheduling immediately. An in-flight create is reconciled by prepare()
  // before its finally block calls cancelPending, including a late POST reply.
  stop() { this.stopped = true;for(const r of this.records){const nested=this.recoverySessions.get(r);if(nested)nested.stop();} this.statusController?.abort(); this.wakeStatusRetry?.(); }
  async cancelPending() {
    for (const record of this.records.filter(r => r.id && r.state !== 'ready')) {
      const response = await this.fetcher(`/api/readings/${record.id}`, {method: 'DELETE', signal: AbortSignal.timeout(15000)});
      if (!response.ok) throw Error('Cancellation could not be confirmed. Check your account before starting another playlist.');
      record.state = 'cancelled'; this.persist();
    }
  }
}
