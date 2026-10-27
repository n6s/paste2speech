// Only release-owned test subprocesses load this helper. User Chrome is untouched.
import{createRequire,syncBuiltinESMExports}from'node:module';
const gate=/\/(tests|scripts\/reader-parity|scripts\/video-download)\/.+\.mjs$/.test(process.argv[1]||'');
if(gate){
const require=createRequire(import.meta.url),http=require('node:http'),https=require('node:https'),cp=require('node:child_process');
const browsers=new Set(),servers=new Set(),children=new Set();
for(const api of[http,https]){const original=api.createServer;api.createServer=function(...args){const server=original.apply(this,args);servers.add(server);server.once('close',()=>servers.delete(server));return server;};}
const originalSpawn=cp.spawn;cp.spawn=function(...args){const child=originalSpawn.apply(this,args);children.add(child);child.once('exit',()=>children.delete(child));return child;};syncBuiltinESMExports();
const{chromium}=await import('playwright'),originalLaunch=chromium.launch;chromium.launch=async function(...args){const browser=await originalLaunch.apply(this,args);browsers.add(browser);browser.on('disconnected',()=>browsers.delete(browser));return browser;};
let stopping=false;async function stop(code){if(stopping)return;stopping=true;const timer=setTimeout(()=>process.exit(code),3000);timer.unref();await Promise.allSettled([...browsers].map(b=>b.close()));for(const server of servers){server.closeAllConnections?.();server.close();}for(const child of children)if(child.exitCode===null)child.kill('SIGTERM');process.exit(code);}
process.once('SIGTERM',()=>void stop(143));process.once('SIGINT',()=>void stop(130));

}
