#!/usr/bin/env python3
"""Bounded operator tooling. Credentials stay in the environment; reads by default."""
import argparse, datetime, json, os, urllib.request
ACCOUNT='c71dba5be3cc617a904adc61e767704d'
ENVS={
 'staging':('private-wavenet-reader-staging','74f0d55c-b7ab-4d6b-aa26-cf06bfa9036f','9f677ec91b1a426684191f4ad2a57948'),
 'production':('paste2speech-reader-production','d3c03af9-3833-4242-b032-f10620d65fe7','8e99d1c1d5904542a7bbdb6329f5ba2d')}
def api(path,data=None):
 req=urllib.request.Request('https://api.cloudflare.com/client/v4/'+path,data=None if data is None else json.dumps(data).encode(),headers={'Authorization':'Bearer '+os.environ['CLOUDFLARE_API_TOKEN'],'Content-Type':'application/json'})
 result=json.load(urllib.request.urlopen(req,timeout=30))
 if result.get('success') is False or result.get('errors'):raise RuntimeError(json.dumps(result.get('errors')))
 return result

def query(env,sql,params=()):
 return api(f'accounts/{ACCOUNT}/d1/database/{ENVS[env][1]}/query',{'sql':sql,'params':params})['result'][0]['results']
def inventory(env):
 items=[];cursor=None
 while True:
  path=f'accounts/{ACCOUNT}/workers/durable_objects/namespaces/{ENVS[env][2]}/objects?limit=1000'+('&cursor='+cursor if cursor else '')
  result=api(path);rows=result['result'];items.extend(rows)
  next_cursor=result.get('result_info',{}).get('cursor')
  if not rows or not next_cursor or next_cursor==cursor:break
  cursor=next_cursor
 return items

def report(since):
 q='''{viewer{accounts(filter:{accountTag:"%s"}){
 d1AnalyticsAdaptiveGroups(limit:1000,filter:{datetime_geq:"%s"}){dimensions{databaseId} sum{rowsWritten rowsRead}}
 durableObjectsInvocationsAdaptiveGroups(limit:1000,filter:{datetime_geq:"%s"}){dimensions{scriptName type status} sum{requests}}
 }}}'''%(ACCOUNT,since,since)
 data=api('graphql',{'query':q})['data']['viewer']['accounts'][0]
 now=datetime.datetime.now(datetime.timezone.utc);start=datetime.datetime.fromisoformat(since.replace('Z','+00:00'));scale=86400/max(1,(now-start).total_seconds())
 print(json.dumps({'since':since,'checked':now.isoformat(),'analytics':data,'daily_projection_multiplier':scale},indent=2))

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('command',choices=['report','inventory','queue','probes','status','verify']);p.add_argument('--env',choices=ENVS,default='staging');p.add_argument('--since');p.add_argument('--action',choices=['inspect','retire'],default='inspect');p.add_argument('--apply',action='store_true');p.add_argument('--limit',type=int,default=5)
 args=p.parse_args()
 if args.command=='report':report(args.since or (datetime.datetime.now(datetime.timezone.utc)-datetime.timedelta(minutes=30)).strftime('%Y-%m-%dT%H:%M:%SZ'))
 elif args.command=='inventory':print(json.dumps(inventory(args.env)))
 elif args.command=='verify':
  result=api(f'accounts/{ACCOUNT}/workers/scripts/{ENVS[args.env][0]}/settings')['result']
  print(json.dumps({b['name']:b.get('text') for b in result['bindings'] if b['name'] in ['BACKGROUND_WORK_PAUSED','MAINTENANCE_QUEUE_ENABLED','READER_MODE']}))
 elif args.command=='status':
  print(json.dumps(query(args.env,'SELECT action,state,COUNT(*) AS n FROM reader_maintenance GROUP BY action,state')))
  print(json.dumps(query(args.env,"SELECT object_id,action,state,attempts,result FROM reader_maintenance WHERE state='attention' OR action='inspect' ORDER BY updated LIMIT 10")))
 elif args.command=='probes':
  if args.env!='staging':raise SystemExit('Cached probes are staging-only')
  import uuid
  print(json.dumps({'environment':args.env,'probes':['ready','cancel','expire'],'apply':args.apply}))
  if args.apply:
   for kind in ['ready','cancel','expire']:
    query(args.env,"INSERT INTO reader_maintenance(object_id,action,probe,updated) VALUES(?,'inspect',?,-1)",[str(uuid.uuid4()),kind])
 elif args.command=='queue':
  objects=[row['id'] for row in inventory(args.env) if row['hasStoredData']][:args.limit]
  print(json.dumps({'environment':args.env,'action':args.action,'objects':len(objects),'apply':args.apply}))
  if args.apply:
   for object_id in objects:
    query(args.env,"INSERT INTO reader_maintenance(object_id,action) VALUES(?,?) ON CONFLICT(object_id) DO UPDATE SET action=excluded.action,state='pending',attempts=0,next_attempt=0,result=NULL WHERE reader_maintenance.action<>excluded.action",[object_id,args.action])
