import {migrateUnfinished,admitUnfinished,retireUnfinished,unfinishedTargets} from './podcast-playlist.js';
import {TemporaryPlaylist, playlistEntries, mergePending, queuedPreparationPending} from "./temporary-playlist.js";
import { DeviceAudioStore, digest } from "./device-audio-store.js";
import { splitReadingChunks } from "./playlist-plan.js";
import { removalReason, RetentionClock } from "./reading-retention.js";
import { ReadingProtection } from "./reading-protection.js";
function setupDeviceAudio({ podcast=false,getPlayer, getActive = getPlayer, getEngine = () => "google", getText, getChunks = () => [], prepare = async()=>{}, snapshot, apply, matches = () => true, refresh = () => {
}, getQueue = () => null, renderQueue = () => {}, playSaved = () => {}, loadQueued = () => {
}, regenerate = () => {
} }) {
  const natural = getPlayer(), transport = natural.longReadings, assets = transport?.assets;
  if (!assets?.setScope) return;
  const protection = new ReadingProtection();
  assets.protection = protection;
  const playlistChannel=globalThis.BroadcastChannel?new BroadcastChannel("paste2speech-temporary-playlist"):null;
  const preferenceKey = "paste2speech.device-audio.automatic", lastScopeKey = "paste2speech.device-audio.scope", anonymousKey = "paste2speech.browser-history.scope";
  let anonymousScope = localStorage.getItem(anonymousKey);
  if (!anonymousScope) {
    anonymousScope = "browser-profile:" + crypto.randomUUID();
    localStorage.setItem(anonymousKey, anonymousScope);
  }
  const anonymousStore = new DeviceAudioStore(anonymousScope), store = () => assets.store || anonymousStore, scope = () => store().scope, latestKey = () => "paste2speech.device-audio.latest." + scope();
  let playlist=null, playlistScope=null, playlistLoading=null, intent=null, removedCurrentText=null, knownPending=new Set();
  const entries=()=>playlistEntries(playlist?.state||{},[...records].sort((a,b)=>(a.createdAt||a.updated||0)-(b.createdAt||b.updated||0)),getQueue()?.items||[]);
  let renderedQueue="";
  function refreshQueue(){const signature=JSON.stringify([podcast?hideSinglePlaylist():null,selected?.id,selected?.engine,entries().map(item=>[item.id,item.title,item.state,item.error,item.engine,item.playbackEngine,item.offlineReady,item.records?.map(part=>[part.id,part.state]),shellReady])]);if(signature!==renderedQueue){renderedQueue=signature;renderQueue();}}
  const retireIds=()=>new Set(playlist?.state.retired||[]);
  function notifyPlaylist(){renderNavigation();refreshQueue();playlistChannel?.postMessage({scope:scope()});}
  async function persistPending(){if(!playlist)return;const pending=structuredClone(getQueue()?.items||[]);await playlist.edit(state=>{state.pending=mergePending(state.pending,pending,knownPending,state.retired,records.filter(record=>!record.queueIntent||record.queueStartedAt).map(record=>record.id));knownPending=new Set(pending.map(item=>item.id));});playlistChannel?.postMessage({scope:scope()});}
  async function ensurePlaylist(){
    if(playlistScope===scope())return playlistLoading;
    playlistScope=scope();const target=store(),next=new TemporaryPlaylist(target,{key:podcast?'podcast-playlist':'temporary-playlist'});playlist=next;
    playlistLoading=(async()=>{await next.load();if(target!==store())return;const model=getQueue();if(podcast&&next.state.version!==2){
        // Old open tabs keep their legacy membership journal. They must not
        // interpret new completed membership as a request to delete cached audio.
        const existing=await target.readings();if(target!==store())return;records=existing;
        const legacy=await target.get('usage','temporary-playlist');if(legacy)next.state=legacy;
        await next.edit(state=>{migrateUnfinished(state,records,(model?.items||[]).filter(item=>!item.snapshot?.libraryScope||item.snapshot.libraryScope===target.scope));const previous=localStorage.getItem(latestKey());if(state.order.includes(previous))state.currentId=previous;});
        for(const record of records.filter(record=>record.finishedAt))await target.setLifecycle(record.id,{playedAt:record.finishedAt,finishedAt:null},{valid:()=>target===store()});
      }
      if(model){model.stop();model.items=(next.state.pending||[]).filter(item=>!next.state.retired.includes(item.id));knownPending=new Set(model.items.map(item=>item.id));
        model.playlist={clearPending:items=>{void next.edit(state=>{const ids=items.map(item=>item.id);state.retired=[...new Set([...state.retired,...ids])];state.pending=state.pending.filter(item=>!ids.includes(item.id));}).then(notifyPlaylist).catch(error=>message(error.message));},entries,selected:()=>selected?.id, status:record=>(record.id===selected?.id?selected.engine:record.playbackEngine||record.engine)==='browser'?'Browser voice':record.offlineReady&&shellReady?'Ready offline':'',
          open:async(item,{autoplay=false}={})=>{try{if(item.saved){await openReading(item);if(autoplay&&selected?.id===item.id&&selected.engine==='google'&&queuedPreparationPending(item)){if(!model.has(item.id))model.items.unshift({id:item.id,title:item.title,text:item.text,snapshot:structuredClone(item.queueIntent),createdAt:item.createdAt,updatedAt:Date.now(),state:'ready',queuedReplay:true});model.changed();model.advance();return;}if(autoplay&&selected?.id===item.id&&!selected.voiceUnavailable&&(selected.engine==='browser'||!item.audioMissing&&item.records?.length&&item.records.every(part=>part.id&&part.state==='ready')))playSaved();return;}if(item.state==='error'&&item.text?.trim()){recoveredId=item.id;recoveredItem=item;model.stop();recoveryChecking=true;refresh();try{await loadQueued(item,{recovering:true});}finally{recoveryChecking=false;refresh();}message(getEngine()==='google'?'Text restored. Retry Play checks your account once and starts speech using normal credits.':'Text restored. Press Play to use this browser voice.');refresh();return;}if(item.state!=='ready'){message(item.error||'Text is not ready. If file processing was interrupted, open the file again to recover its saved result.');return;}await loadQueued(item);await list();}catch(error){message(error.message);refresh();}},
          next:()=>{const all=entries(),index=all.findIndex(item=>item.id===selected?.id);return all[index+1];},
          added:(item,placement)=>{void next.edit(state=>{const all=entries().map(entry=>entry.id).filter(id=>id!==item.id),index=all.indexOf(selected?.id);all.splice(placement==='next'?index+1:all.length,0,item.id);state.order=all;state.pending=mergePending(state.pending,structuredClone(model.items),new Set(model.items.map(item=>item.id)),state.retired);}).then(notifyPlaylist).catch(error=>message(error.message));},
          remove:async id=>{if(recoveredId===id){recoveredId=null;recoveredItem=null;}await next.edit(state=>{state.retired=[...new Set([...state.retired,id])];state.pending=state.pending.filter(item=>item.id!==id);});model.removePending(id);if(selected?.id===id){removedCurrentText=getText();model.stop();intent=null;nativeBlocked={chunks:getActive()?.chunks,voice:getActive()?.settings?.voice?.voiceURI||""};suppressed.add(id);getActive()?.pause();selectedRelease?.();selectedRelease=null;selected=null;}message("Removed from playlist.");notifyPlaylist();void cleanup();},
          move:async(id,delta)=>{const all=entries().map(item=>item.id),index=all.indexOf(id),other=index+delta;if(index<0||other<0||other>=all.length)return;[all[index],all[other]]=[all[other],all[index]];await next.edit(state=>state.order=all);notifyPlaylist();}
        };
      }
      if(podcast&&model)installPodcast(model,next);
      notifyPlaylist();
    })();return playlistLoading;
  }
  // A single controller owns membership and forward intent. Storage is a cache.
  let playlistTransition=0,waitingEntry=null,handoffBusy=false,finishedText=null;
  const finishingEntries=new Set();
  async function joinPlaylist(record){
    if(!podcast||record.scope!==scope())return;if(!records.some(item=>item.id===record.id))records=[...records,record];await ensurePlaylist();const owner=scope(),target=playlist;
    await target.edit(state=>{if(owner===scope())admitUnfinished(state,record.id);});
    notifyPlaylist();
  }
  function queueOutcome(id,outcome,text,{autoplay}={}){
    const target=playlist,owner=scope(),revision=playlistTransition;
    const change=state=>{if(target===playlist&&owner===scope()&&revision===playlistTransition&&state.order.includes(id)){state.currentId=id;state.handoff=outcome;if(autoplay!==undefined)state.playIntent=autoplay?'playing':'paused';else if(['playing','paused'].includes(outcome))state.playIntent=outcome;}};
    if(target?.state.version===2){change(target.state);void target.edit(change).catch(error=>message(error.message));}
    if(text)message(text);return {id,outcome};
  }
  function setPlayIntent(value,{nativeChunks}={}){
    if(!podcast||!playlist)return;
    if(value==='playing'&&selected?.text===getText()){selected.runRequested=true;if(selected.engine==='browser')selected.nativeChunks=nativeChunks||(getActive()?.state==='paused'?getActive().chunks:getChunks());}
    if(value!=='playing'){if(selected)selected.runRequested=false;playlistTransition++;waitingEntry=null;handoffBusy=false;}
    const target=playlist,owner=scope(),revision=playlistTransition;
    target.state.playIntent=value;target.state.handoff=value==='playing'?'starting':value;
    void target.edit(state=>{if(target===playlist&&owner===scope()&&revision===playlistTransition){state.playIntent=value;state.handoff=value==='playing'?'starting':value;}}).catch(error=>message(error.message));
  }
  async function goToEntry(item,{autoplay=true}={}){
    const id=typeof item==='string'?item:item?.id,request=++playlistTransition,owner=scope();
    waitingEntry=null;const model=getQueue();model.stop();capture();handoffBusy=true;refresh();
    try{
      await flush();
      if(request!==playlistTransition||owner!==scope())return {outcome:'cancelled'};
      item=entries().find(entry=>entry.id===id);if(!item)return {outcome:'removed'};
      queueOutcome(id,'opening','',{autoplay});getActive()?.pause();
      if(item.damaged)return queueOutcome(id,'needs-action','This saved reading needs verification. Remove it or add the source again.');
      if(!item.saved){
        if(item.state==='preparing'){waitingEntry={id,autoplay,owner};return queueOutcome(id,'waiting','Waiting for this reading’s text.');}
        if(item.state==='error'){
          if(item.text?.trim()){recoveredId=id;recoveredItem=item;await loadQueued(item,{recovering:true});}
          return queueOutcome(id,'needs-action',item.error||'This reading needs attention.');
        }
        if(!autoplay){await loadQueued(item);await list();return queueOutcome(id,'paused');}
        waitingEntry={id,autoplay,owner};return queueOutcome(id,'waiting');
      }
      await openReading(item);
      if(request!==playlistTransition||owner!==scope()||selected?.id!==id)return {outcome:'cancelled'};
      if(!autoplay)return queueOutcome(id,'paused');
      if(selected.voiceUnavailable)return queueOutcome(id,'needs-action');
      if(selected.engine==='google'&&item.records?.length&&item.records.every(part=>!part.id)&&!queuedPreparationPending(item))return queueOutcome(id,'needs-action','Press Play to prepare this reading.');
      if(item.records?.some(part=>['failed','uncertain','expired'].includes(part.state)))return queueOutcome(id,'needs-action','Audio needs recovery. Your saved parts are kept.');
      if(selected.engine==='google'&&queuedPreparationPending(item)){
        if(!model.has(id))model.items.unshift({id,title:item.title,text:item.text,snapshot:structuredClone(item.queueIntent),createdAt:item.createdAt,updatedAt:Date.now(),state:'ready',queuedReplay:true});
        waitingEntry={id,autoplay,owner};return queueOutcome(id,'waiting');
      }
      // Play uses verified parts, ordinary continuation and bounded free retrieval.
      // Existing failed/expired parts retain the explicit paid-recovery guard.
      handoffBusy=false;playSaved();return queueOutcome(id,['failed','disconnected'].includes(getActive()?.state)?'needs-action':'playing');
    }catch(error){return request===playlistTransition&&owner===scope()?queueOutcome(id,'needs-action',error.message):{outcome:'cancelled'};}finally{if(request===playlistTransition){handoffBusy=false;refresh();resumeWaiting();}}
  }
  let waitingScheduled=false;
  function resumeWaiting(){
    if(!podcast||!waitingEntry||handoffBusy||getQueue()?.starting||waitingScheduled)return;
    waitingScheduled=true;queueMicrotask(()=>{
      waitingScheduled=false;const waiting=waitingEntry;if(!waiting||waiting.owner!==scope())return;
      const item=getQueue()?.items.find(item=>item.id===waiting.id);
      if(!item||item.state==='preparing')return;
      waitingEntry=null;
      if(item.state==='error'){void goToEntry(item,{autoplay:false});return;}
      if(waiting.autoplay)getQueue().retry(item.id);else void goToEntry(item,{autoplay:false});
    });
  }
  async function finishEntry(id,{reason='read',autoplay=true,advance=true}={}){
    if(!podcast||finishingEntries.has(id)||!entries().some(item=>item.id===id))return;
    if(selected?.id!==id&&playlist?.state.currentId!==id){const owner=scope(),target=playlist;await target.edit(state=>{if(owner===scope()&&target===playlist)retireUnfinished(state,[id]);});if(owner===scope()&&target===playlist){getQueue()?.removePending(id);notifyPlaylist();}return;}
    finishingEntries.add(id);const request=++playlistTransition,owner=scope(),stateStore=playlist,audioStore=store(),model=getQueue(),record=selected?.id===id?selected:null;
    const ordered=entries(),index=ordered.findIndex(item=>item.id===id),nextId=ordered[index+1]?.id;
    waitingEntry=null;handoffBusy=false;model.stop();const version=model.version;capture();
    try{
      if(record){await flush();if(reason!=='natural')getActive()?.stop();}
      if(owner!==scope()||stateStore!==playlist)return;
      if(reason!=='remove'&&record)await audioStore.setLifecycle(id,{playedAt:clock.now()},{valid:()=>owner===scope()&&stateStore===playlist});
      const ownsSelection=(record?selected===record:stateStore.state.currentId===id)&&request===playlistTransition;
      await stateStore.edit(state=>{if(owner!==scope()||stateStore!==playlist)return;if(ownsSelection){state.currentId=id;state.playIntent=autoplay?'playing':'paused';}retireUnfinished(state,[id]);});
      if(owner!==scope()||stateStore!==playlist)return;
      model.removePending(id);suppressed.add(id);
      if(record&&ownsSelection&&selected===record){finishedText=record.text;nativeBlocked={chunks:getActive()?.chunks,voice:getActive()?.settings?.voice?.voiceURI||''};selectedRelease?.();selectedRelease=null;selected=null;intent=null;transport.nextLogicalReading=null;}
      notifyPlaylist();
      if(advance&&ownsSelection&&nextId&&entries().some(item=>item.id===nextId))await goToEntry(nextId,{autoplay:autoplay&&model.version===version});
      else if(ownsSelection)message(entries().length?'No more readings ahead. Choose an unfinished reading.':'Playlist finished.');
    }catch(error){message(error.message);}finally{finishingEntries.delete(id);refresh();}
  }
  function hideSinglePlaylist(){
    if(!podcast||!selected||selected.voiceUnavailable||getActive()?.starting)return false;
    const all=entries(),active=getActive();
    if(all.length!==1||all[0].id!==selected.id||['error','preparing'].includes(all[0].state))return false;
    const same=selected.engine==='browser'?active?.chunks===selected.nativeChunks:natural.id===selected.groupId&&matches();
    if(active?.state==='playing'&&selected.engine!=='browser'&&(active.audio?.paused||active.audio?.ended))return false;
    return same&&!!(selected.podcastStarted||playlist?.state.started?.[selected.id])&&['playing','paused'].includes(active?.state);
  }
  function installPodcast(model,next){
    const legacyAdded=model.playlist.added,legacyStatus=model.playlist.status;
    Object.assign(model.playlist,{
      clearPending:items=>{void next.edit(state=>retireUnfinished(state,items.map(item=>item.id))).then(notifyPlaylist).catch(error=>message(error.message));},
      status:record=>record.damaged?'Needs verification':legacyStatus(record),
      managedCompletion:true,hideSingle:hideSinglePlaylist,
      selected:()=>next.state.currentId||selected?.id,
      added(item,placement){
        admitUnfinished(next.state,item.id,{after:selected?.id,last:placement!=='next'});
        legacyAdded(item,placement);
        if(!next.state.currentId&&next.state.anchor)void next.edit(state=>{if(!state.currentId&&state.anchor&&!state.anchor.after.includes(item.id))state.anchor.after.push(item.id);}).then(notifyPlaylist).catch(error=>message(error.message));
      },
      open:(item,options)=>goToEntry(item,options),
      markRead:id=>finishEntry(id,{reason:'manual',autoplay:['playing','buffering'].includes(getActive()?.state)}),
      remove:(id,{advance=true}={})=>finishEntry(id,{reason:'remove',autoplay:advance&&next.state.playIntent==='playing',advance}),
    });
  }
  const nav = document.createElement("div");
  nav.id = "reading-navigation";
  nav.className = "controls";
  nav.hidden = true;
  nav.style.cssText = "grid-template-columns:minmax(0,1fr) minmax(0,1.4fr) minmax(0,1fr);align-items:center;gap:8px;margin-block:12px";
  nav.innerHTML = '<button id="previous-reading" type="button" class="quiet" aria-label="Previous reading">Previous</button><span id="reading-order" role="status"></span><button id="next-reading" type="button" class="quiet" aria-label="Next reading">Next</button>';
  for(const button of nav.querySelectorAll("button"))button.style.cssText="padding-inline:4px;min-width:0;font-size:.8rem";
  const panel = document.createElement("div");
  panel.id = "device-readings";
  panel.innerHTML = '<p class="hint">Unfinished readings expire 24 hours after adding. Finished readings leave the playlist. Download an MP4 to keep one longer.</p><p id="device-audio-status" class="hint" role="status"></p><div class="controls"><button id="retry-device-reading" type="button" hidden>Retry offline saving</button><button id="regenerate-device-reading" type="button" hidden>Generate missing audio again…</button><button id="keep-device-reading" type="button" hidden>Keep current reading again</button></div><input id="automatic-device-audio" type="checkbox" checked hidden><ul id="device-audio-list" hidden></ul>';
  document.getElementById("section-progress").after(nav, panel);
  const $ = (id) => panel.querySelector("#" + id), message = (text) => { const warning="The saved browser voice is unavailable. Your text and place are kept. Choose an available browser voice, then Play.";
    const node=$("device-audio-status"),next=selected?.voiceUnavailable&&text!==warning?warning+(text?" "+text:""):text;if(node.textContent!==next)node.textContent=next; };
  const clock=new RetentionClock();
  let cleaning=null,lastCleanup=0,expiredSource=null,pendingAddedAt=null,shellError=false,currentAdmission=null;
  const rekeep=new Set();
  $("automatic-device-audio").checked = localStorage.getItem(preferenceKey) !== "false";
  assets.writesEnabled = $("automatic-device-audio").checked;
  let replacement=null,recoveredId=null,recoveredItem=null,recoveryChecking=false;
  const releaseReplacement=()=>{replacement?.release?.();replacement=null;};
  let selected = null, selectedRelease = null, records = [], opening = false, saving = false, attaching = false, timer = null, checking = 0, serial = 0, restoreScope = null, nativeBlocked = null, shellReady = false, persistent = false, flushing = Promise.resolve(), suppressed = /* @__PURE__ */ new Set();
  const storedEngine=record=>getEngine()==="google"&&record.engine==="google"?"google":record.playbackEngine||record.engine||"google";
  const enabled = () => $("automatic-device-audio").checked;
  const selectionKey=()=>latestKey()+".active";
  const blankKey="paste2speech.editor-cleared";
  let editorCleared=sessionStorage.getItem(blankKey)==="true";
  const rememberSelection=id=>{if(recoveredId&&recoveredId!==id){recoveredId=null;recoveredItem=null;}if(getText().trim()){editorCleared=false;sessionStorage.removeItem(blankKey);}localStorage.setItem(latestKey(),id);localStorage.setItem(selectionKey(),id);if(podcast)message('');if(podcast&&playlist){const target=playlist,owner=scope(),revision=playlistTransition;void target.edit(state=>{if(target===playlist&&owner===scope()&&revision===playlistTransition&&state.order.includes(id)){if(state.currentId!==id)state.playIntent="paused";state.currentId=id;}}).catch(error=>message(error.message));}};
  const activeStore = (record) => record?.scope === scope() ? store() : null;
  function capture() {
    if (!selected||podcast&&selected.awaitingRun) return;
    const player = getActive();
    if (selected.engine === "browser") {
      if (getEngine() === "browser" && player?.state !== "idle" && player?.chunks === selected.nativeChunks) selected.lastPlace = { index: player.index || 0, offset: player.offset || 0, rate: player.settings?.rate || 1 };
    } else if (player === natural && natural.id === selected.groupId) selected.lastPlace = { position: Math.max(0, natural.pendingTime ?? natural.audio.currentTime ?? 0), rate: natural.rate || 1 };
  }
  async function flush() {
    capture();
    if (!selected || !enabled()) return;
    const record = selected, target = activeStore(record);
    if (!target) return;
    const valid = () => selected===record && target === activeStore(record), place = { ...record.lastPlace || {}, id: record.id, generation: record.generation, playbackEngine:record.engine,playbackVoice:record.voice,updated: Date.now() };
    const group = record.engine === "browser" ? null : transport.groups.get(record.groupId);
    const copy = { ...record };
    if(podcast){if(copy.finishedAt)copy.playedAt=copy.finishedAt;delete copy.finishedAt;}
    for (const key of ["groupId", "lastPlace", "nativeChunks", "storedRevision", "storedReady", "lifecycleSave", "sourceRecord", "voiceUnavailable"]) delete copy[key];
    if (group) {
      copy.manifestRevision = group.deviceRevision || 0;
      copy.records = structuredClone(group.session.records);
      copy.statuses = structuredClone(group.statuses);
      copy.offlineReady = group.session.records.length === group.parts.length && group.session.records.every((part) => part.id && assets.complete(part.id)) && shellReady;
    }
    const revision = group?.deviceRevision || 0, writeManifest = !!group && !group.continuationElsewhere && (record.storedRevision !== revision || record.storedReady !== copy.offlineReady);
    const operation = async () => {
      if (!valid()) return;
      try {
        await record.lifecycleSave;
        if (writeManifest) {
          await target.save("readings", record.id, copy, { valid, updateOnly: true });
          records=records.map(item=>item.id===record.id?{...item,...copy}:item);
          renderNavigation();
          record.storedRevision = revision;
          record.storedReady = copy.offlineReady;
        }
        const previous=await target.get("positions",record.id);
        await target.save("positions", record.id, {...(previous?.generation===record.generation?previous:{}),...place}, { valid });
        if (group && selected === record) {
          assets.manifestReady = true;
          if (copy.offlineReady && record.audioMissing) {
            await target.setLifecycle(record.id, { audioMissing: false }, { valid });
            record.audioMissing = false;
          }
        }
      } catch (error) {
        if (selected === record) {
          assets.manifestReady = false;
          message(error.message);
        }
      }
    };
    const current = flushing.catch(() => {
    }).then(operation);
    flushing = current;
    await current;
  }
  async function syncBackground(record, group) {
    const target = assets.store;
    if (!target || record.scope !== target.scope || !group.localSave||group.continuationElsewhere) return;
    group.manifestPending = true;
    if (group.manifestSync) return group.manifestSync;
    group.manifestSync = (async () => {
      while (group.manifestPending && group.localSave && target === assets.store) {
        group.manifestPending = false;
        const next = { ...record, records: structuredClone(group.session.records), statuses: structuredClone(group.statuses), manifestRevision: group.deviceRevision || 0, offlineReady: group.session.records.length === group.parts.length && group.session.records.every((part) => part.id && assets.complete(part.id)) && shellReady, updated: Date.now() };
        await target.save("readings", record.id, next, { updateOnly: true, valid: () => target === assets.store && group.localSave && group.ownerScope === target.scope });
        group.savedReady = next.offlineReady;
        if(target===store()){records=records.map(item=>item.id===record.id?{...item,...next}:item);renderNavigation();}
      }
    })().catch((error) => {
      if (target === assets.store && group.localSave) message(error.message);
    }).finally(() => group.manifestSync = null);
    return group.manifestSync;
  }
  async function holdSelected(record,{valid=()=>true}={}) {
    const release = await protection.hold(record.scope, record.id);
    if(record.scope!==scope()||podcast&&retireIds().has(record.id)||!valid()){release();return false;}
    selectedRelease?.();
    selectedRelease = release;return true;
  }
  async function shell() {
    try {
    if (!navigator.serviceWorker) throw Error("Offline reopening is unavailable in this browser.");
    const registration = await navigator.serviceWorker.register("/local-audio-sw.js", { scope: "/" });
    await navigator.serviceWorker.ready;
    const worker = registration.active || registration.waiting || registration.installing;
    await new Promise((resolve, reject) => {
      const channel = new MessageChannel(), timeout = setTimeout(() => reject(Error("Offline app download interrupted. Retry offline saving.")), 6e4);
      channel.port1.onmessage = (e) => {
        clearTimeout(timeout);
        channel.port1.close();
        e.data.ok ? resolve() : reject(Error(e.data.error || "Offline app download failed."));
      };
      worker.postMessage({ type: "SAVE_OFFLINE_SHELL" }, [channel.port2]);
    });
    shellReady = assets.shellReady = true;shellError=false;
    refresh();
    }catch(error){shellError=true;throw error;}
  }
  async function openReading(record, { automatic = false } = {}) {
    if(automatic&&editorCleared)return;
    const request = ++serial, editor = getText();
    opening = true;
    refresh();
    try {
      await flush();
      const target = activeStore(record);
      if (!target) throw Error("The account changed.");
      const current = retireIds().has(record.id)?null:await target.reading(record.id);
      if (current) current.engine ||= "google";
      if (request !== serial) return;
      if (getText() !== editor) throw Error("The editor changed while opening; your text is kept.");
      if (!current || target !== store()) throw Error("The reading was removed or the account changed.");
      if (automatic && storedEngine(current) !== getEngine()) return;
      const release = await protection.hold(current.scope, current.id);
      if (request !== serial || target !== store()) {
        release();
        return;
      }
      try {
        getActive()?.pause();
        const playback=await apply(current)||{};
        const engine=playback.engine||current.engine,voice=playback.voice??current.voice;
        if (request !== serial || target !== store()) {
          release();
          return;
        }
        let group = null;
        if (engine !== "browser" && current.records?.some((part) => part.id)) group = await transport.restoreLocal(current, { valid: () => request === serial && target === store() && getText() === current.text });
        if (request !== serial || target !== store()) {
          release();
          return;
        }
        selectedRelease?.();
        selectedRelease = release;
        selected = { ...current, engine, voice,voiceUnavailable:playback.voiceUnavailable, sourceRecord:current, groupId: group?.id, nativeChunks: engine === "browser" ? getActive().chunks : null, lastPlace: engine === "browser" ? { index: current.nativeIndex || 0, offset: current.nativeOffset || 0, rate: current.options?.rate || 1 } : { position: current.position || 0, rate: current.options?.rate || 1 } };
        if (group) {
          group.historyRecord = current;
          group.deviceChanged = () => {
            void syncBackground(current, group);
            update();
          };
          assets.manifestReady = true;
          natural.deviceRestoreTime = Math.max(0, current.position || 0);
          natural.deviceRestoreIndex = Math.max(0, transport.status(group).starts.findLastIndex((time) => time <= natural.deviceRestoreTime));
        }
        intent={id:current.id,createdAt:current.createdAt,text:current.text};
        // A saved selection owns the next transport start, even if another file
        // was loaded as metadata without ever starting its audio.
        transport.nextLogicalReading={...intent};transport.nextAddedAt=current.createdAt;
        rememberSelection(current.id);
        message(playback.voiceUnavailable ? "The saved browser voice is unavailable. Your text and place are kept. Choose an available browser voice, then Play." : engine === "browser" ? "Browser voice · place restored." : current.audioMissing ? "Text and place restored. Audio is not kept on this device; Play retrieves existing audio online. Expired audio requires an explicit new generation." : "Place restored. Press Play.");
      } catch (error) {
        release();
        throw error;
      }
    } catch (error) {
      if (request === serial) message(error.message);
    } finally {
      if (request === serial) {
        opening = false;
        await cleanup();
        await list();
        refresh();
      }
    }
  }
  async function rememberCurrent({createdAt,id:entryId,activate=true,valid=()=>true,queueIntent=null,consume=true}={}) {
    const request=serial,callerValid=valid,text=getText();valid=()=>request===serial&&getText()===text&&callerValid();
    await flush();
    await prepare();if(!valid())return;
    const options = snapshot(), engine = getEngine(), chunks = [...getChunks()], voice = options.voice, target = store();
    if (!["browser", "google"].includes(engine) || !chunks.length) throw Error("This reading has no text to bookmark.");
    if (engine === "google" && !assets.scope) throw Error("Confirm your account before loading a queued Natural reading. No speech was started.");
    const parts = engine === "google" ? splitReadingChunks(chunks, options.paragraphStarts || [], transport.limit()) : [];
    const audioKey = engine === "google" ? "paste2speech.video." + await digest(JSON.stringify({ parts, voice })) : "paste2speech.browser." + await digest(JSON.stringify({ chunks, voice }));
    const id=entryId||crypto.randomUUID();
    const old = await target.reading(id);
    const replacing=replacement;
    let reusable=engine==='google'&&enabled()&&replacing?.record?.scope===scope()&&replacing.record.key===audioKey?replacing.record:null;
    if(podcast&&engine==='google'&&enabled()&&!old)reusable||=(await target.readings()).find(item=>!item.damaged&&item.key===audioKey&&item.engine===engine&&clock.now()-item.createdAt<86400000&&item.records?.some(part=>part.id));
    if(!valid())return;
    if(old&&activate){await openReading(old);return;}
    const record = old || { version: 2, engine, id, key: audioKey, scope: scope(), generation: crypto.randomUUID(), text, voice, chunks, parts, records: parts.map(() => ({ state: "unprepared" })), statuses: [], position: 0, nativeIndex: 0, nativeOffset: 0, options, createdAt: createdAt||Date.now(), updated: Date.now() };
    if(reusable&&!old){if(podcast)record.createdAt=reusable.createdAt;record.records=structuredClone(reusable.records);record.statuses=structuredClone(reusable.statuses);record.offlineReady=false;}
    if(queueIntent&&!record.queueStartedAt)record.queueIntent=structuredClone(queueIntent);
    await target.save("readings", id, record, { automatic: true, valid: () => target === store()&&valid() });
    if(!valid())return;
    await joinPlaylist(record);
    let reusedGroup=null;
    // Publish the replacement’s references before releasing the old reading’s
    // cleanup lock. Audio identity can be shared; bookmark/generation cannot.
    if(reusable&&!old){
      const reference={readingId:id,generation:record.generation,automatic:true};
      for(const part of record.records){if(!part.id)continue;assets.allow(part.id,reference);const meta=await target.get('jobs',part.id);if(meta)await target.save('jobs',part.id,meta,{reference,valid:()=>target===store()&&valid()});}
      sessionStorage.setItem(audioKey,JSON.stringify(record.records));
      const live=[...transport.groups.values()].some(group=>!group.localOnly&&!group.cancelled&&group.key===audioKey&&group.ownerScope===scope());
      if(live||record.records.length&&record.records.every(part=>part.id&&part.state==='ready')){
        reusedGroup=await transport.restoreLocal(record,{valid:()=>target===store()&&valid()});
        reusedGroup.logicalReading={id,createdAt:record.createdAt};reusedGroup.historyRecord=record;
        reusedGroup.deviceChanged=()=>{void syncBackground(record,reusedGroup);update();};
      }
    }
    if(replacing===replacement)releaseReplacement();
    if(activate)await openReading(record);else{if(!await holdSelected(record,{valid})||!valid())return;selected={...record,groupId:podcast?undefined:reusedGroup?.id,lastPlace:{position:record.position||0,index:record.nativeIndex||0,offset:record.nativeOffset||0,rate:options.rate},nativeChunks:!podcast&&engine==="browser"?getActive()?.chunks:null,awaitingRun:podcast||undefined};rememberSelection(id);}
    if(reusedGroup)void shell().catch(error=>message(error.message));
    await list();
    if(consume)getQueue()?.removePending(id,{consumed:true});await persistPending();await cleanup();await list();notifyPlaylist();
  }
  function renderNavigation() {
    const ordered=entries(),index=ordered.findIndex(record=>record.id===(podcast?playlist?.state.currentId||selected?.id:selected?.id)),total=ordered.length;
    const targets=podcast?unfinishedTargets(playlist?.state||{},playlist?.state.currentId||selected?.id):null;
    nav.hidden=podcast?!total||hideSinglePlaylist()||!targets.previous&&!targets.next:total<2||index<0;
    nav.querySelector("#reading-order").textContent=index>=0?`Reading ${index+1} of ${total}`:`${total} unfinished ${total===1?'reading':'readings'}`;
    for(const [button,offset]of [["previous-reading",-1],["next-reading",1]]){
      const target=podcast?entries().find(item=>item.id===(offset<0?targets.previous:targets.next)):ordered[index+offset];
      const control=nav.querySelector('#'+button);control.disabled=opening||handoffBusy||!target;
      control.onclick=()=>void getQueue()?.playlist?.open(target,podcast?{autoplay:["playing","preparing","buffering"].includes(getActive()?.state)||index<0&&playlist?.state.anchor?.autoplay===true}:undefined);
    }
    refreshQueue();
  }

  async function cleanup(){
    if(cleaning)return cleaning;
    if(!protection.supported&&!podcast)return 0;
    cleaning=(async()=>{
      const target=store(),now=clock.now();let count=0;
      const active=getActive(),same=selected&&(selected.engine==='browser'?getEngine()==='browser'&&active?.chunks===selected.nativeChunks:natural.id===selected.groupId&&matches());
      const busy=same&&['playing','preparing','buffering'].includes(active?.state);
      const stored=await target.readings(),latest=localStorage.getItem(latestKey()),candidate=stored.find(r=>r.id===latest&&storedEngine(r)===getEngine())||stored.find(r=>storedEngine(r)===getEngine());
      const restoring=!editorCleared&&!selected&&!active?.chunks?.length&&candidate&&(!getText().trim()||getText()===candidate.text);
      const moved=localStorage.getItem(selectionKey());
      const selectedText=selected&&getText()===selected.text&&(opening||!active?.chunks?.length);
      const currentId=selectedText?selected.id:same?selected.finishedAt&&moved&&moved!==selected.id?null:selected.id:restoring?candidate.id:null;
      if(selected&&((!podcast&&retireIds().has(selected.id))||(podcast?(now-selected.createdAt>=86400000?"expired":null):removalReason(selected,{now,currentId})))&&!busy){selectedRelease?.();selectedRelease=null;}
      const retiring=stored.filter(record=>!(busy&&record.id===selected?.id)&&(podcast?(now-record.createdAt>=86400000?"expired":null):removalReason(record,{now,currentId}))&&!retireIds().has(record.id)).map(record=>record.id);
      if(retiring.length&&playlist&&!podcast){await playlist.edit(state=>{if(podcast)retireUnfinished(state,retiring);else state.retired=[...new Set([...state.retired,...retiring])];});notifyPlaylist();}
      const queue=getQueue();for(const item of [...queue?.items||[]])if(!queue.starting&&now-(item.createdAt||now)>=86400000)queue.remove(item.id);
      for(const record of stored){
        if(target!==store())break;
        if(!Number.isFinite(record.createdAt)||record.createdAt<=0){record.createdAt=now;await target.save("readings",record.id,record,{updateOnly:true,valid:()=>target===store()});continue;}
        if(!((!podcast&&retireIds().has(record.id))||(podcast?(now-record.createdAt>=86400000?"expired":null):removalReason(record,{now,currentId})))||busy&&record.id===selected?.id)continue;
        const result=await protection.exclusive(record.scope,record.id,async()=>{
          const fresh=await target.reading(record.id);
          if(!fresh||fresh.generation!==record.generation||!((!podcast&&retireIds().has(record.id))||(podcast?clock.now()-fresh.createdAt>=86400000:removalReason(fresh,{now:clock.now(),currentId}))))return false;
          if(podcast&&playlist)await playlist.edit(state=>retireUnfinished(state,[record.id]));
          const ids=await target.removeReading(record.id,{valid:()=>target===store()&&!(selected?.id===record.id&&["playing","preparing","buffering"].includes(getActive()?.state))});
          if(await target.reading(record.id))return false;
          suppressed.add(record.id);sessionStorage.removeItem(record.key||record.id);
          for(const group of transport.groups.values())if(group.deviceReference?.readingId===record.id||group.key===record.id){group.localSave=false;group.forgotten=true;}
          assets.forgetLocal(ids);
          if(localStorage.getItem(latestKey())===record.id)localStorage.removeItem(latestKey());
          if(selected?.id===record.id){if(same&&getText()===record.text){expiredSource={text:record.text,id:record.id,engine:record.engine};if(transport.localRestore?.key===record.id)transport.localRestore=null;if(record.engine==="browser")getActive()?.stop();else natural.invalidate({preservePreparation:true});}selected=null;selectedRelease?.();selectedRelease=null;assets.manifestReady=false;}
          return true;
        });
        if(result===true)count++;
      }
      if(count){records=await target.readings();notifyPlaylist();}
      lastCleanup=performance.now();return count;
    })().catch(error=>{message(error.message);return 0;}).finally(()=>cleaning=null);
    return cleaning;
  }
  async function list({ restore = false } = {}) {
    const target = store(), currentScope = scope(), found = await target.readings();
    if (target !== store()) return;
    records = found;
    await ensurePlaylist();
    if(getQueue()?.items.some(item=>records.some(record=>record.id===item.id)&&!item.queuedReplay)){getQueue().items=getQueue().items.filter(item=>item.queuedReplay||!records.some(record=>record.id===item.id));await persistPending();}
    if(playlist&&!podcast){const ids=entries().map(item=>item.id);if(ids.some(id=>!playlist.state.order.includes(id)))await playlist.edit(state=>state.order=[...new Set([...state.order,...ids])]);}
    renderNavigation();
    if (restore && restoreScope !== currentScope && !editorCleared) {
      restoreScope = currentScope;
      const available=records.filter(record=>!retireIds().has(record.id)&&(!podcast||playlist.state.order.includes(record.id)));
      const latest=podcast?playlist.state.currentId:localStorage.getItem(latestKey()), candidate = available.find((record) => record.id === latest && storedEngine(record) === getEngine()) || (!podcast&&available.find((record) => storedEngine(record) === getEngine()));
      if (candidate && !candidate.damaged && !getActive()?.chunks?.length && (!getText().trim() || getText() === candidate.text)) void openReading(candidate, { automatic: true });
    }
  }
  async function account({restore=true}={}) {
    const request = ++checking;
    let next;
    try {
      if (navigator.onLine === false) next = assets.scope || localStorage.getItem(lastScopeKey) || null;
      else {
        const response = await fetch("/api/ocr/jobs/config", { cache: "no-store" });
        if ([401, 403].includes(response.status)) next = null;
        else {
          if (!response.ok) throw Error();
          next = (await response.json()).consentScope;
          if (typeof next !== "string" || !next) throw Error();
        }
      }
      if (request !== checking) return;
      if (next !== assets.scope) {
        await flush();releaseReplacement();
        if (assets.scope || selected?.engine === "browser") {
          if (getEngine() === "browser") getActive()?.stop();
          else natural.invalidate({ preservePreparation: true });
        }
        selectedRelease?.();
        selectedRelease = null;
        selected = null;records=[];intent=null;
        assets.setScope(next);
        suppressed = /* @__PURE__ */ new Set();
      }
      if (next) localStorage.setItem(lastScopeKey, next);
      else localStorage.removeItem(lastScopeKey);
      await ensurePlaylist();
      await cleanup();
      await list({ restore });
      refresh();
    } catch {
      await list({ restore }).catch(() => {
      });
      if (!assets.scope && getEngine() === "google") message("Confirm your account online before keeping Natural audio. Browser voices remain available.");
    }
  }
  function naturalLogicalId(group){return group.logicalReading?.id||(intent&&(!intent.text||intent.text===getText())?intent.id:group.deviceReference?.readingId||group.historyRecord?.id||(group.pendingLogicalId||=crypto.randomUUID()));}
  async function saveNatural(group, { explicit = false } = {}) {
    const logicalId=naturalLogicalId(group);
    explicit ||= rekeep.has(logicalId);
    if (!assets.store || group.ownerScope && group.ownerScope !== assets.scope) return;
    saving = true;
    const request=serial;
    const target = assets.store, text = getText(), currentScope = scope(), valid = () => request===serial && target === store() && enabled() && getText() === text && natural.id===group.id && !group.cancelled && (!podcast||!retireIds().has(logicalId));
    try {
      await flush();
      if (!valid()) return;
      if (!group.ownerScope) {
        const ids = group.session.records.filter((part) => part.id).map((part) => part.id);
        if (!ids.length) return;
        for (const id of ids) {
          const response = await transport.rawFetch(`/api/readings/${id}`);
          if (!response.ok || !valid()) return;
        }
        group.ownerScope = currentScope;
      }
      if(retireIds().has(logicalId))return;
      const old = await target.reading(logicalId);
      if (!valid()) return;
      const revision = group.deviceRevision || 0;
      const record = { version: 2, engine: "google", manifestRevision: revision, generation: explicit ? crypto.randomUUID() : old?.generation || crypto.randomUUID(), id: logicalId, finishedAt:podcast?undefined:natural.state==="done"&&natural.id===group.id?clock.now():old?.finishedAt, queueIntent:old?.queueIntent,queueStartedAt:old?.queueStartedAt, key: group.key, scope: currentScope, parts: structuredClone(group.parts), voice: group.session.voice, text, options: snapshot(), records: structuredClone(group.session.records), statuses: structuredClone(group.statuses), position: natural.audio.currentTime || 0, updated: Date.now(), createdAt: old?.createdAt || old?.updated || group.logicalReading?.createdAt || group.createdAt || Date.now() };
      await target.save("readings", record.id, record, { valid, automatic: true, rekeep: explicit });
      if(podcast&&!old)await joinPlaylist(record);
      if(record.finishedAt&&natural.state==="done")await target.setLifecycle(record.id,podcast?{playedAt:record.finishedAt}:{finishedAt:record.finishedAt},{valid});
      rekeep.delete(record.id);
      if (!valid()) return;
      if(!await holdSelected(record,{valid}))return;
      selected = { ...record, groupId: group.id, storedRevision: revision, storedReady: false, lastPlace: { position: record.position, rate: natural.rate || 1 } };
      if (old?.finishedAt&&natural.state==="playing") await target.setLifecycle(record.id, { finishedAt: null });
      for (const previous of transport.groups.values()) if (previous !== group && (previous.deviceReference?.readingId===record.id||previous.key === group.key)) previous.localSave = false;
      group.localSave = true;
      group.historyRecord = record;
      group.deviceReference = { readingId: record.id, generation: record.generation, automatic: !explicit };
      group.deviceChanged = () => {
        void syncBackground(record, group);
        update();
      };
      assets.manifestReady = false;
      intent={id:record.id,createdAt:record.createdAt,text};
      rememberSelection(record.id);
      suppressed.delete(record.id);
      await assets.enable(group.session.records.filter((part) => part.id).map((part) => part.id), group.deviceReference);
      group.deviceReference.automatic = true;
      void shell().catch((error) => message(error.message));
      await list();
    } catch (error) {
      if (target === store()) {
        suppressed.add(logicalId);
        message(error.message);
      }
    } finally {
      saving = false;
      void flush();
      refresh();
    }
  }
  async function saveNative(player, { explicit = false } = {}) {
    if(!player?.synth)return;
    saving = true;
    const target = store(), text = getText(), chunks = [...player.chunks], voice = player.settings?.voice?.voiceURI||"", generation = player.generation;
    const request=serial;
    const valid = () => request===serial && target === store() && enabled() && getEngine() === "browser" && player.generation === generation && getText() === text && (!podcast||!id||!retireIds().has(id));
    let id;
    try {
      await flush();
      const audioKey="paste2speech.browser."+await digest(JSON.stringify({chunks,voice}));
      id=intent&&(!intent.text||intent.text===text)?intent.id:selected?.text===text?selected.id:crypto.randomUUID();
      if(retireIds().has(id))return;
      if (!valid()) return;
      if (suppressed.has(id) && !explicit && !rekeep.has(id)) {
        nativeBlocked = { chunks: player.chunks, voice };
        return;
      }
      explicit ||= rekeep.has(id);
      const old = await target.reading(id), record = { version: 2, engine: "browser", id, finishedAt:podcast?undefined:player.state==="done"?clock.now():old?.finishedAt, queueIntent:old?.queueIntent,queueStartedAt:old?.queueStartedAt, key: audioKey, scope: scope(), generation: explicit ? crypto.randomUUID() : old?.generation || crypto.randomUUID(), text, chunks, voice, options: snapshot(), records: [], parts: [], statuses: [], updated: Date.now(), createdAt: old?.createdAt || old?.updated || intent?.createdAt || pendingAddedAt || Date.now() };
      await target.save("readings", id, record, { valid, automatic: true, rekeep: explicit });
      if(podcast&&!old)await joinPlaylist(record);
      if(record.finishedAt&&player.state==="done")await target.setLifecycle(id,podcast?{playedAt:record.finishedAt}:{finishedAt:record.finishedAt},{valid});
      if (!valid()) return;
      if(!await holdSelected(record,{valid}))return;
      selected = { ...record, nativeChunks: player.chunks, lastPlace: { index: player.index || 0, offset: player.offset || 0, rate: player.settings.rate || 1 } };
      suppressed.delete(id);
      rekeep.delete(id);pendingAddedAt=null;
      intent={id,createdAt:record.createdAt,text};
      rememberSelection(id);
      if (old?.finishedAt&&player.state==="playing") await target.setLifecycle(id, { finishedAt: null });
      void shell().catch((error) => message(error.message));
      await list();
    } catch (error) {
      if (id) {
        suppressed.add(id);
        nativeBlocked = { chunks: player.chunks, voice };
      }
      message(error.message);
    } finally {
      saving = false;
      void flush();
      refresh();
    }
  }
  function update() {
    capture();resumeWaiting();
    if (selected && !timer) timer = setTimeout(() => {
      timer = null;
      void flush();
    }, 500);
    const player = getActive(), group = natural.getVideoPreparation?.();
    // A requested start can emit rate/ownership changes while the old run is
    // still done. Bind only after the player enters its new active run.
    if(podcast&&selected?.awaitingRun&&selected.runRequested&&['preparing','buffering','playing'].includes(player?.state)){selected.awaitingRun=false;if(selected.engine==='browser')selected.nativeChunks=player.chunks;}
    // Staging's zero-cost fixture bypasses LongReadingTransport groups. Bind
    // its real player run to the explicitly admitted logical reading instead.
    if(podcast&&selected?.engine==='google'&&natural.settings?.cached===true&&natural.id&&intent?.id===selected.id&&matches())selected.groupId=natural.id;
    const sameReading=selected&&(!podcast||!selected.awaitingRun)&&(selected.engine==='browser'?getEngine()==='browser'&&selected.nativeChunks===player?.chunks:(selected.groupId===natural.id||group?.id===natural.id&&group.logicalReading?.id===selected.id)&&matches());
    if(podcast&&sameReading&&!opening&&!handoffBusy&&!finishingEntries.has(selected.id)&&!['opening','waiting','needs-action'].includes(playlist?.state.handoff)&&['paused','idle'].includes(player?.state)){
      const nextIntent=player.state==='paused'?'paused':'stopped';
      if(selected.intentState!==nextIntent){selected.intentState=nextIntent;const id=selected.id,target=playlist;void target.edit(state=>{if(target===playlist&&state.currentId===id)state.playIntent=nextIntent;}).catch(error=>message(error.message));}
    }
    const audible=sameReading&&player?.state==='playing'&&!player.starting&&(selected.engine==='browser'||player.audio&&!player.audio.paused&&!player.audio.ended);
    if(podcast&&audible&&!selected.podcastStarted){const current=selected;current.podcastStarted=true;current.intentState="playing";void playlist.edit(state=>{if(state.order.includes(current.id)){(state.started||={})[current.id]=true;state.currentId=current.id;state.playIntent='playing';state.handoff='playing';}}).then(notifyPlaylist).catch(error=>message(error.message));}
    if(sameReading&&player?.state==='playing'&&selected.queueIntent&&!selected.queueStartedAt){const record=selected;record.queueStartedAt=clock.now();record.lifecycleSave=Promise.resolve(record.lifecycleSave).catch(()=>{}).then(()=>store().setLifecycle(record.id,{queueStartedAt:record.queueStartedAt},{valid:()=>selected===record})).catch(error=>message(error.message));}
    if(sameReading&&player?.state==='done'&&!selected.finishedAt){
      const record=selected;record.finishedAt=clock.now();if(podcast)void finishEntry(record.id,{reason:"natural",autoplay:true});record.lifecycleSave=store().setLifecycle(record.id,podcast?{playedAt:record.finishedAt}:{finishedAt:record.finishedAt}).catch(error=>message(error.message));
    }
    if(!cleaning&&performance.now()-lastCleanup>1000)void cleanup();
    if (selected?.finishedAt && player?.state === "playing" && (selected.engine === "browser" ? selected.nativeChunks === player.chunks : selected.groupId === natural.id)) {
      selected.finishedAt = null;
      selected.lifecycleSave = store().setLifecycle(selected.id, { finishedAt: null }).then(() => list()).catch((error) => message(error.message));
    }
    // Metadata registration is not a new playback run. An ended old player must
    // not bind or complete a fresh logical entry before its explicit start.
    if (!opening && !saving && !attaching && enabled() && (!podcast||!selected?.awaitingRun)) {
      if (getEngine() === "google" && (!podcast||natural.state!=="done"||selected?.awaitingRun===false) && assets.store && group && !group.cancelled && (!suppressed.has(naturalLogicalId(group))||rekeep.has(naturalLogicalId(group))) && matches() && (selected?.groupId !== group.id||group.logicalReading?.id&&selected?.id!==group.logicalReading.id)) {
        attaching = true;
        void saveNatural(group).finally(() => {
          attaching = false;
          setTimeout(update, 200);
        });
      } else if (getEngine() === "browser" && player?.synth && player?.chunks?.length && player.state !== "idle" && (!podcast||player.state!=="done"||selected?.awaitingRun===false) && (nativeBlocked?.chunks !== player.chunks || nativeBlocked?.voice !== player.settings?.voice?.voiceURI) && selected?.nativeChunks !== player.chunks) {
        attaching = true;
        void saveNative(player).finally(() => {
          attaching = false;
          setTimeout(update, 200);
        });
      }
    }
    $("retry-device-reading").disabled = saving;
    const manualDownloadCheck=selected?.records?.some(part=>{const job=assets.jobs.get(part.id);return job&&(job.storageBlocked||job.authRequired||job.invalid||job.transientDownloadError&&job.downloadRetryCount>=5);});
    $("retry-device-reading").hidden = !selected || saving || !(selected.engine === "google" && natural.offlineInfo?.error&&manualDownloadCheck || shellError && navigator.onLine);
    $("retry-device-reading").textContent=shellError?'Retry offline page':'Retry existing audio';
    $("keep-device-reading").hidden = true;
    $("regenerate-device-reading").hidden = selected?.engine !== "google" || !selected.records?.some((part) => assets.jobs.get(part.id)?.audioUnavailable);
    if (selected?.engine === "google" && group?.id === selected.groupId) {
      const info = natural.offlineInfo;
      // The player owns offline readiness; this area is only for distinct recovery/voice notices.
      if (info?.ready) message("");
      else if(info?.error||player?.state==="playing")message("");
    }
    for (const group2 of transport.groups.values()) if (group2.localSave && group2.ownerScope === assets.scope && group2.done && !group2.manifestSync && group2.deviceReference) {
      const ready = group2.session.records.length === group2.parts.length && group2.session.records.every((part) => part.id && assets.complete(part.id)) && shellReady;
      if (group2.savedReady !== ready) {
        const record = group2.historyRecord;
        if (record) void syncBackground(record, group2);
      }
    }
    renderNavigation();

  }
  assets.onPressure = async () => { const result=await cleanup();return result>0; };  $("retry-device-reading").onclick = async () => {
    try {
      await account();
      suppressed.clear();
      nativeBlocked = null;
      assets.retry();
      await shell();
      await flush();
      await list();
      update();
    } catch (error) {
      message(error.message);
    }
  };
  $("keep-device-reading").onclick = async () => {
    const player = getActive(), group = natural.getVideoPreparation?.();
    if (getEngine() === "google" && group) await saveNatural(group, { explicit: true });
    else if (getEngine() === "browser" && player?.chunks?.length) await saveNative(player, { explicit: true });
    update();
  };
  $("regenerate-device-reading").onclick = async () => {
    if (!selected || selected.engine !== "google") return;
    if (!confirm("Generate this reading again using normal speech credit? This creates new audio; it is not a free offline download.")) return;
    const record = selected;
    await flush();
    await regenerate(record);
  };
  function disable() {
    releaseReplacement();void flush();
    for (const group of transport.groups.values()) group.localSave = false;
    assets.writesEnabled = false;
    selectedRelease?.();
    selectedRelease = null;
    selected = null;
  }
  $("automatic-device-audio").onchange = () => {
    localStorage.setItem(preferenceKey, String(enabled()));
    assets.writesEnabled = enabled();
    if (!enabled()) disable();
    update();
  };
  window.addEventListener("focus", () => void account().then(() => {assets.recheck();void cleanup();}));
  window.addEventListener("online", () => void account().then(() => {
    for (const group of transport.groups.values()) if (group.localOnly) void transport.refreshLocal(group);
    assets.retry();
    if(enabled()&&selected)void shell().catch(error=>message(error.message));
  }));
  window.addEventListener("pagehide", () => void flush());
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) void flush();else void cleanup();
  });
  window.addEventListener("storage", (event) => {
    if (event.key === preferenceKey) {
      $("automatic-device-audio").checked = event.newValue !== "false";
      assets.writesEnabled = enabled();
      if (!enabled()) disable();
      update();
    }
    if (event.key === lastScopeKey && event.newValue !== assets.scope) void account();
    if(event.key===selectionKey())void cleanup();
  });
  if (globalThis.BroadcastChannel) {
    const channel = new BroadcastChannel("paste2speech-device-audio");
    channel.onmessage = (event) => {
      const data = event.data;
      if (data?.scope !== scope() || !["removed", "audio-reclaimed"].includes(data.type)) return;
      if (data.type === "removed") {
        suppressed.add(data.id);
        if (localStorage.getItem(latestKey()) === data.id) localStorage.removeItem(latestKey());
        if (selected?.id === data.id) {
          selected = null;
          selectedRelease?.();
          selectedRelease = null;
        }
      }
      for (const group of transport.groups.values()) if (group.deviceReference?.readingId===data.id||group.key === data.id) group.localSave = false;
      assets.forgetLocal((data.jobs || []).filter((id) => typeof id === "string"));
      void list();
    };
  }
  void Promise.resolve(navigator.storage?.persisted?.()).then((value) => persistent = value === true).catch(() => {
  });
  setInterval(()=>void cleanup(),30000);
  if(playlistChannel)playlistChannel.onmessage=async(event)=>{if(event.data?.scope!==scope()||!playlist)return;await playlist.load();const model=getQueue();if(model){const old=new Map(model.items.map(item=>[item.id,item]));model.items=(playlist.state.pending||[]).map(item=>Object.assign(old.get(item.id)||{},item));knownPending=new Set(model.items.map(item=>item.id));}await list();void cleanup();};
  void account();
  if (navigator.serviceWorker) void navigator.serviceWorker.getRegistration("/").then((registration) => {
    if (!registration?.active) return;
    const channel = new MessageChannel();
    channel.port1.onmessage = (e) => {
      shellReady = assets.shellReady = e.data.ok === true;
      update();
    };
    registration.active.postMessage({ type: "CHECK_OFFLINE_SHELL" }, [channel.port2]);
  }).catch(() => {
  });
  async function beforePlay({queuedAdmission=false}={}){
    const text=getText(),engine=getEngine(),owner=scope();
    if(podcast&&finishedText===text&&!selected){finishedText=null;intent={id:crypto.randomUUID(),createdAt:Date.now(),text};transport.nextLogicalReading={...intent};await rememberCurrent({...intent,activate:false});}
    await cleanup();
    if(getText()!==text||getEngine()!==engine||scope()!==owner)return false;
    // Editor transformations do not rewrite a queued source. Admit their new
    // logical reading only on Play, before binding the actual player/audio run.
    if(podcast&&!queuedAdmission&&selected&&selected.text!==text){
      if(!currentAdmission){
        const next={id:crypto.randomUUID(),createdAt:Date.now(),text};intent=next;transport.nextLogicalReading={...next};
        const work=rememberCurrent({...next,activate:false,valid:()=>getText()===text&&getEngine()===engine&&scope()===owner});currentAdmission=work;
        work.finally(()=>{if(currentAdmission===work)currentAdmission=null;}).catch(()=>{});
      }
      await currentAdmission;
      if(getText()!==text||getEngine()!==engine||scope()!==owner||selected?.text!==text)return false;
    }
    if(expiredSource?.text===text){
      if(engine==='google'&&!confirm('This reading has expired. Prepare it again using normal speech credit? Download an MP4 to keep readings longer.'))return false;
      rekeep.add(expiredSource.id);suppressed.delete(expiredSource.id);nativeBlocked=null;expiredSource=null;
    }
    if(selected){
      const record=selected;if(!await holdSelected(record))return false;
      const fresh=await store().reading(record.id);
      if(selected!==record||!fresh||fresh.generation!==record.generation)return false;
    }
    return getText()===text&&getEngine()===engine;
  }
  async function engineChanged({voiceChanged=false}={}){
    if(natural.getVideoPreparation?.()?.error?.creditPaused)return;
    const record=selected?.sourceRecord||selected;if(!record||getText()!==record.text)return;
    if(voiceChanged&&record.engine==='browser'&&getEngine()==='browser'){
      opening=true;refresh();
      try{
        await flush();const target=store(),fresh=await target.reading(record.id);if(!fresh)return;
        const voice=snapshot().voice;await target.save('readings',fresh.id,{...fresh,voice,options:{...fresh.options,voice}},{updateOnly:true,valid:()=>target===store()});
        if(selected?.id===fresh.id){selected.voice=voice;selected.voiceUnavailable=false;selected.sourceRecord={...fresh,voice,options:{...fresh.options,voice}};message('Browser voice · choice saved.');}
      }catch(error){message(error.message);}finally{opening=false;refresh();}
      return;
    }
    if(record.engine==='google')await openReading(record);else if(getEngine()==='google')voiceChanging();
  }
  function voiceChanging(){if(selected&&getText()===selected.text)transport.nextLogicalReading={id:selected.id,createdAt:selected.createdAt};}
  async function replace(){
    if(podcast){playlistTransition++;waitingEntry=null;handoffBusy=false;}
    recoveredId=null;recoveredItem=null;releaseReplacement();await flush();
    if(selected){replacement={record:await store().reading(selected.id),release:selectedRelease};selectedRelease=null;}
await ensurePlaylist();const ids=entries().map(item=>item.id),model=getQueue();
    await playlist.edit(state=>{state.retired=[...new Set([...state.retired,...ids])];state.pending=[];state.order=[];});
    model?.clear();intent={id:crypto.randomUUID(),createdAt:Date.now()};transport.nextLogicalReading={...intent};
    selectedRelease?.();selectedRelease=null;selected=null;notifyPlaylist();void cleanup();
  }
  function clearEditor(){
    if(podcast){playlistTransition++;waitingEntry=null;handoffBusy=false;}
    recoveredId=null;recoveredItem=null;releaseReplacement();capture();void flush();serial++;opening=false;restoreScope=scope();
    editorCleared=true;sessionStorage.setItem(blankKey,"true");
    selectedRelease?.();selectedRelease=null;selected=null;intent=null;
    transport.localRestore=null;transport.nextLogicalReading=null;
    if(timer){clearTimeout(timer);timer=null;}
  }
  async function retryPending(item){
    if(recoveryChecking)return;recoveryChecking=true;refresh();const text=getText();
    try{
      if(!getQueue()?.has(item.id)||scope()!==item.snapshot.libraryScope)await account({restore:false});
      if(getText()!==text||text!==item.text)return;
      if(scope()!==item.snapshot.libraryScope){message('Sign in to PasteToSpeech in another tab, then Retry Play. Your text is kept. No speech was started.');return;}
      const pending=getQueue()?.items.find(candidate=>candidate.id===item.id);
      if(!pending){message('This queued item is unavailable. Your text is kept; add it again explicitly to play.');return;}
      pending.snapshot={...item.snapshot};getQueue().retry(item.id);
    }catch{message('Account check failed. Your text is kept. No speech was started.');}
    finally{recoveryChecking=false;refresh();}
  }
  return { setPlayIntent,markCurrentRead:()=>selected&&finishEntry(selected.id,{reason:"seek",autoplay:true}),clearEditor,retryPending,get recoveryChecking(){return recoveryChecking||podcast&&finishingEntries.size>0;},get pendingPlayback(){const pending=getQueue()?.items.find(item=>item.id===(recoveredId||selected?.id)&&item.queuedReplay&&item.text===getText()&&!(selected?.id===item.id&&selected.queueStartedAt));return pending||recoveredItem?.text===getText()&&recoveredItem||null;}, get singleQueuedPlayback(){const all=entries();return all.length===1&&!all[0].saved&&all[0].state==='ready'&&(!getText().trim()||removedCurrentText===getText()||podcast&&finishedText===getText());}, replace, async registerCurrentMetadata(options={}){const replacing=replacement;try{await rememberCurrent({...intent,...options,activate:false});}catch(error){message(error.message);}finally{if(replacing===replacement)releaseReplacement();}}, queueChanged(){if(recoveredItem&&!getQueue()?.has(recoveredItem.id)&&getText()===recoveredItem.text&&['playing','preparing','buffering'].includes(getActive()?.state)){recoveredId=null;recoveredItem=null;}void persistPending().catch(error=>message(error.message));update();refresh();}, update, flush, capture, list, openReading, rememberCurrent, beforePlay, engineChanged, voiceChanging, expiredIntent(item){return Number.isFinite(item.createdAt)&&clock.now()-item.createdAt>=86400000;}, needsPlaybackGuard(){const same=selected&&(selected.engine==='browser'?getEngine()==='browser'&&getActive()?.chunks===selected.nativeChunks:natural.id===selected.groupId&&matches());return !!(podcast&&finishedText===getText())||!!(podcast&&selected&&selected.text!==getText())||!!expiredSource||!!selected&&(!selectedRelease||!!removalReason(selected,{now:clock.now(),currentId:same?selected.id:null}));}, setAddedAt(time,id){pendingAddedAt=time;intent={id:id||crypto.randomUUID(),createdAt:time,text:getText()};transport.nextLogicalReading={...intent};}, get scope() {
    return scope();
  }, get opening() {
    return opening||handoffBusy;
  }, get selected() {
    return selected;
  } };
}
export {
  setupDeviceAudio
};
