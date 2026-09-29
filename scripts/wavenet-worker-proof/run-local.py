"""Run only local workerd. --live enables the already-bounded synthetic pilot.

The existing service-account file never enters shell arguments or console output.
An owner-only ignored dev-vars file exists only while this process is running.
"""
import argparse
import json
import os
import subprocess
from pathlib import Path

p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--live',action='store_true')
p.add_argument('--accounts',action='store_true',help='Separate cached-only account API on port 8789')
p.add_argument('--state',help='Local persistence directory; apply the account migration there first')
p.add_argument('--wrangler',default='/home/roger/workarea/paste2speech/node_modules/.bin/wrangler')
args=p.parse_args()
if args.accounts and args.live:
    p.error('The account pilot permits cached audio only')
config=Path('scripts/wavenet-worker-proof')/('wrangler-accounts.jsonc' if args.accounts else 'wrangler.jsonc')
port='8789' if args.accounts else '8788'
state=args.state or ('work/wavenet-account-proof/state' if args.accounts else 'work/wavenet-worker-proof/state')
secret_file=config.with_name('.dev.vars')
child=None
created=False
try:
    if secret_file.exists():
        raise SystemExit('An existing private dev-vars file is present. Check the running proof before starting another.')
    if args.live:
        account=json.loads((Path.home()/'.config/paste2speech/google-tts-service-account.json').read_text())
        value=json.dumps(account,separators=(',',':'))
        if "'" in value:
            raise SystemExit('Unsupported credential encoding; no credential was written.')
        fd=os.open(secret_file,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
        created=True
        with os.fdopen(fd,'w') as f:
            f.write("ENABLE_LIVE_SYNTHESIS='1'\nGOOGLE_SERVICE_ACCOUNT_JSON='"+value+"'\n")
    # Suppress tool/debug logs completely while real credentials are loaded.
    child=subprocess.Popen([args.wrangler,'dev','--local','--ip','127.0.0.1','--port',port,
        '--config',str(config),'--persist-to',state],
        stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    print(f'Local Worker starting at http://127.0.0.1:{port}; '+('bounded synthetic live mode.' if args.live else 'cached mode.'),flush=True)
    code=child.wait()
    if code:
        raise SystemExit(code)
except KeyboardInterrupt:
    pass
finally:
    if child and child.poll() is None:
        child.terminate()
        try:child.wait(timeout=10)
        except subprocess.TimeoutExpired:child.kill();child.wait()
    if created:
        secret_file.unlink(missing_ok=True)
