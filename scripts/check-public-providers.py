"""Read-only readiness; never prints credential values or customer/provider payloads."""
import json
from pathlib import Path
from urllib.request import Request,urlopen
from urllib.error import HTTPError
config=json.loads(Path('cloudflare/reader/wrangler.public.jsonc').read_text())['vars']
credentials=Path.home()/'.config/paste2speech'
report={'liveCatalogConfigured':bool(config.get('PADDLE_PRICE_ID') and config.get('PADDLE_PRODUCT_ID'))}
for name in ['paddle-live-api-key','paddle-live-client-token','paddle-live-webhook-secret']:
    report[name]={'present':(credentials/name).is_file()}
if report['paddle-live-api-key']['present'] and report['liveCatalogConfigured']:
    key=(credentials/'paddle-live-api-key').read_text().strip()
    if not key.startswith('pdl_live_apikey_'):
        report['catalog']={'verified':False,'reason':'credential environment mismatch'}
    else:
        try:
            req=Request('https://api.paddle.com/prices/'+config['PADDLE_PRICE_ID'],headers={'Authorization':'Bearer '+key,'Paddle-Version':'1'})
            with urlopen(req,timeout=30) as response:
                price=json.load(response)['data']
            report['catalog']={'verified':price.get('status')=='active' and price.get('product_id')==config['PADDLE_PRODUCT_ID'] and price.get('billing_cycle') is None and price.get('unit_price')=={'amount':'1000','currency_code':'USD'}}
        except HTTPError as error:
            report['catalog']={'verified':False,'httpStatus':error.code}
        except Exception as error:
            report['catalog']={'verified':False,'error':type(error).__name__}
print(json.dumps(report,indent=2))
