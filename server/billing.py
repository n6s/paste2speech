"""Private Paddle sandbox pilot. Server verification, never browser success, grants credit.

This router is served only by the private workstation. It is not public auth or
production billing. Verified email accounts can recover sandbox credit across browsers.
"""
import asyncio
import json
import re
import secrets
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import FileResponse, JSONResponse
from server.usage import PACK_CHARACTERS

router = APIRouter()
CONFIG = Path.home() / '.config/paste2speech'
PRICE = 'pri_01m32geyt53f5h9nxqfhqbt19x'
PRODUCT = 'pro_01m32gd3hj94whqywcvmyta74b'
COOKIE = 'p2s_sandbox'
ASSETS = Path(__file__).parent / 'billing'
_order_lock = asyncio.Lock()


def credential(name):
    try:
        return (CONFIG / name).read_text().strip()
    except OSError:
        return ''


def paddle_request(path, payload=None):
    key = credential('paddle-sandbox-api-key')
    if not key or 'live' in key[:20]:
        raise HTTPException(503, 'Paddle sandbox API key is not configured.')
    req = urllib.request.Request('https://sandbox-api.paddle.com' + path,
        data=json.dumps(payload).encode() if payload is not None else None,
        headers={'Authorization':'Bearer ' + key,'Content-Type':'application/json','Paddle-Version':'1'})
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            raw = response.read(2_000_001)
        if len(raw) > 2_000_000:
            raise ValueError('Oversize')
        data = json.loads(raw)
        if not isinstance(data, dict) or 'data' not in data:
            raise ValueError('Invalid response')
        return data
    except (OSError, ValueError, KeyError, TypeError):
        raise HTTPException(502, 'Paddle sandbox could not complete the request. No credit was added.') from None


def paddle(path, payload=None):
    data = paddle_request(path,payload)['data']
    if not isinstance(data,dict):
        raise HTTPException(502,'Invalid Paddle response')
    return data


def adjustments(transaction):
    # Construct each next-page URL locally, never follow an arbitrary response URL.
    rows, after = [], ''
    for _ in range(100):
        page = paddle_request('/adjustments?transaction_id='+transaction+'&per_page=50&order_by=id[ASC]'+('&after='+after if after else ''))
        data = page.get('data')
        if not isinstance(data,list): raise ValueError('Invalid adjustment list')
        rows.extend(data)
        pagination = page.get('meta',{}).get('pagination',{})
        if pagination.get('has_more') is False: return rows
        if pagination.get('has_more') is not True or not data: raise ValueError('Incomplete adjustment list')
        next_id = data[-1].get('id','')
        if not re.fullmatch(r'adj_[a-z0-9]{26}',next_id) or next_id==after: raise ValueError('Invalid page cursor')
        after = next_id
    raise ValueError('Too many adjustment pages')


def check(request):
    from server.app import ALLOWED_ORIGINS
    origin = request.headers.get('origin')
    if origin in ALLOWED_ORIGINS:
        return
    if request.method == 'GET' and not origin and request.headers.get('sec-fetch-site') == 'same-origin':
        return
    raise HTTPException(403, 'Origin not allowed')


def ledger_for(request):
    ledger = getattr(request.app.state, 'usage', None)
    if not ledger:
        raise HTTPException(503, 'Usage accounting is unavailable.')
    return ledger


def account_for(request):
    account = ledger_for(request).account(request.cookies.get(COOKIE))
    if not account:
        raise HTTPException(401, 'Start a sandbox session first.')
    return account


async def body(request):
    raw = bytearray()
    async for part in request.stream():
        raw.extend(part)
        if len(raw) > 2048:
            raise HTTPException(413, 'Request too large')
    try:
        data = json.loads(raw)
        if not isinstance(data, dict):
            raise ValueError()
        return data
    except (ValueError, UnicodeDecodeError):
        raise HTTPException(422, 'Invalid request') from None


def valid_purchase(data, order):
    """Only the exact server-created sandbox order/pack can grant this allowance."""
    try:
        items = data['items']
        price = items[0]['price']
        return (data['id'] == order['transaction_id'] and data['status'] == 'completed'
            and data.get('custom_data', {}).get('p2s_order') == order['id']
            and data['currency_code'] == 'USD' and data.get('subscription_id') is None
            and len(items) == 1 and type(items[0]['quantity']) is int and items[0]['quantity'] == 1
            and price['id'] == PRICE and price['product_id'] == PRODUCT
            and price.get('billing_cycle') is None and price['unit_price'] == {'amount':'1000','currency_code':'USD'}
            and data.get('discount_id') is None
            # Tax-inclusive regions have a lower net subtotal; validate the
            # catalog unit price above, not the post-tax subtotal.
            and data['details']['totals']['discount'] == '0')
    except (KeyError, TypeError, IndexError, AttributeError):
        return False


@router.get('/billing')
@router.get('/api/billing')
async def page(request: Request):
    if request.headers.get('sec-fetch-site') == 'cross-site':
        raise HTTPException(403, 'Open this page from the private reader.')
    return FileResponse(ASSETS / 'index.html', headers={'Referrer-Policy':'no-referrer'})


@router.get('/billing/app.js')
@router.get('/api/billing/app.js')
async def script():
    return FileResponse(ASSETS / 'app.js', media_type='text/javascript')


@router.post('/billing/session')
@router.post('/api/billing/session')
async def session(request: Request):
    check(request)
    ledger = ledger_for(request)
    token = request.cookies.get(COOKIE)
    if not ledger.account(token):
        token = ledger.new_account()
    response = JSONResponse({'ready':True})
    response.set_cookie(COOKIE,token,httponly=True,secure=request.url.hostname not in ('127.0.0.1','localhost','testserver'),
                        samesite='strict',path='/',max_age=60*60*24*30)
    return response


@router.get('/billing/status')
@router.get('/api/billing/status')
async def status(request: Request, response: Response):
    response.headers['Cache-Control'] = 'no-store'
    check(request)
    ledger = ledger_for(request)
    account = ledger.account(request.cookies.get(COOKIE))
    month = datetime.now(timezone.utc).strftime('%Y-%m')
    client = credential('paddle-sandbox-client-token')
    configured = bool(credential('paddle-sandbox-api-key') and client.startswith('test_'))
    from server.auth import settings
    return {'emailConfigured':bool(settings()), 'email':account.get('email') if account else None, 'sandbox':True,'configured':configured,'clientToken':client if client.startswith('test_') else '',
            'packCharacters':PACK_CHARACTERS,'priceUSD':10,
            'account':{k:account[k] for k in ('balance','reserved','enabled','shortfall')} if account else None,
            'pendingOrder':ledger.pending_order(account['id']) if account else None,
            'paymentStatus':ledger.payment_status(account['id']) if account else None,
            'month':month,'usage':ledger.summary(month)}


@router.post('/billing/mode')
@router.post('/api/billing/mode')
async def mode(request: Request):
    check(request)
    data = await body(request)
    if set(data) != {'enabled'} or type(data['enabled']) is not bool:
        raise HTTPException(422, 'Choose a sandbox mode')
    account = account_for(request)
    ledger_for(request).enable(account['id'],data['enabled'])
    return {'enabled':data['enabled']}


@router.post('/billing/order')
@router.post('/api/billing/order')
async def order(request: Request):
    check(request)
    account = account_for(request)
    ledger = ledger_for(request)
    async with _order_lock:
        record = ledger.new_order(account['id'])
        if not record['transaction_id']:
            data = await asyncio.to_thread(paddle,'/transactions',{
                'items':[{'price_id':PRICE,'quantity':1}], 'currency_code':'USD',
                'collection_mode':'automatic','custom_data':{'p2s_order':record['id']}})
            txn = data.get('id','')
            if not re.fullmatch(r'txn_[a-z0-9]{26}',txn):
                raise HTTPException(502,'Paddle returned an invalid transaction')
            ledger.bind_order(record['id'],txn)
            record = ledger.order(record['id'],account['id'])
    return {'order':record['id'],'transactionId':record['transaction_id']}


@router.post('/billing/reconcile')
@router.post('/api/billing/reconcile')
async def reconcile(request: Request):
    check(request)
    account = account_for(request)
    data = await body(request)
    if set(data) != {'order'} or not isinstance(data['order'],str):
        raise HTTPException(422,'Invalid order')
    ledger = ledger_for(request)
    record = ledger.order(data['order'],account['id'])
    if not record or not record['transaction_id']:
        raise HTTPException(404,'Unknown sandbox order')
    from server.payment_sync import sync_order
    try:
        return await sync_order(ledger,record)
    except (ValueError, KeyError, TypeError, HTTPException):
        ledger.payment_error(record['id'])
        raise HTTPException(502,'Payment status could not be verified. Please try again; do not pay again.') from None
