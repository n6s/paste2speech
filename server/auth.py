"""Private sandbox email sign-in. SMTP credentials stay on the workstation."""
import asyncio
import json
import re
import secrets
import smtplib
import ssl
from email.message import EmailMessage
from urllib.parse import urlsplit

from fastapi import HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from server.usage import AccountConflict
from server.billing import router, check, body, ledger_for, COOKIE, ASSETS, CONFIG

FLOW_COOKIE = 'p2s_login_flow'


def settings():
    try:
        data = json.loads((CONFIG / 'email-signin.json').read_text())
        if data.get('password_file') == 'resend-api-key':
            data['password'] = (CONFIG / 'resend-api-key').read_text().strip()
        from server.app import ALLOWED_ORIGINS
        url = urlsplit(data['billing_url'])
        if (f'{url.scheme}://{url.netloc}' not in ALLOWED_ORIGINS or url.scheme != 'https'
                or url.query or url.fragment or url.path.rstrip('/') != '/speak/api/billing'
                or data['port'] not in (465, 587) or not data['host'] or not data['username']
                or not data['password'] or not re.fullmatch(r'[A-Za-z0-9.!#$%&\'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+', data['sender'])):
            return None
        return data
    except (OSError, ValueError, KeyError, TypeError):
        return None


def send_link(config, email, token):
    msg = EmailMessage()
    msg['From'] = 'speak.rogerpbrown.com <' + config['sender'] + '>'
    msg['To'] = email
    msg['Subject'] = 'Sign in to speak.rogerpbrown.com (private test)'
    msg.set_content('Open this link in the browser where you requested it, then confirm sign-in. '
                    'It expires in 15 minutes and works once.\n\n' + config['billing_url'].rstrip('/')
                    + '/signin#' + token + '\n\nIf you did not request this, ignore this email.\n')
    context = ssl.create_default_context()
    if config['port'] == 465:
        client = smtplib.SMTP_SSL(config['host'], 465, timeout=20, context=context)
    else:
        client = smtplib.SMTP(config['host'], 587, timeout=20)
    with client:
        if config['port'] == 587:
            client.starttls(context=context)
        client.login(config['username'], config['password'])
        client.send_message(msg)


def cookie(response, request, name, value, age):
    response.set_cookie(name, value, httponly=True,
        secure=request.url.hostname not in ('localhost', '127.0.0.1', 'testserver'),
        samesite='strict', path='/', max_age=age)


@router.get('/billing/signin')
@router.get('/api/billing/signin')
async def signin_page():
    return FileResponse(ASSETS / 'signin.html', headers={'Cache-Control':'no-store', 'Referrer-Policy':'no-referrer',
        'Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'"})


@router.get('/billing/signin.js')
@router.get('/api/billing/signin.js')
async def signin_script():
    return FileResponse(ASSETS / 'signin.js', media_type='text/javascript')


@router.get('/billing/signin.css')
@router.get('/api/billing/signin.css')
async def signin_style():
    return FileResponse(ASSETS / 'signin.css', media_type='text/css')


@router.post('/billing/login/request')
@router.post('/api/billing/login/request')
async def request_link(request: Request):
    check(request)
    data = await body(request)
    email = data.get('email', '')
    if not isinstance(email, str) or len(email) > 254 or not re.fullmatch(r'[A-Za-z0-9.!#$%&\'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+', email):
        raise HTTPException(422, 'Enter a valid email address.')
    email = email.lower()
    config = settings()
    if not config:
        raise HTTPException(503, 'Email sign-in is waiting for sender setup. Your current credit is safe in this browser.')
    ledger = ledger_for(request)
    account = ledger.account(request.cookies.get(COOKIE))
    flow = secrets.token_urlsafe(32)
    try:
        token = ledger.login_request(email, flow, account['id'] if account else None,
                                     request.client.host if request.client else 'unknown')
    except ValueError:
        raise HTTPException(429, 'Too many sign-in requests. Please try again later.') from None
    try:
        await asyncio.to_thread(send_link, config, email, token)
    except Exception:
        ledger.cancel_login(token)
        raise HTTPException(503, 'The sign-in email could not be sent. Please try again later.') from None
    response = JSONResponse({'sent':True}, headers={'Cache-Control':'no-store'})
    cookie(response, request, FLOW_COOKIE, flow, 900)
    return response


@router.post('/billing/login/confirm')
@router.post('/api/billing/login/confirm')
async def confirm_link(request: Request):
    check(request)
    data = await body(request)
    token = data.get('token')
    if not isinstance(token, str) or len(token) > 100:
        raise HTTPException(400, 'Invalid sign-in link.')
    try:
        session = ledger_for(request).login_confirm(token, request.cookies.get(FLOW_COOKIE, ''))
    except AccountConflict as exc:
        raise HTTPException(409, str(exc)) from None
    except ValueError:
        raise HTTPException(400, 'This link expired, was already used, or belongs to another browser. Request a new link in this browser.') from None
    response = JSONResponse({'signedIn':True}, headers={'Cache-Control':'no-store'})
    cookie(response, request, COOKIE, session, 30*86400)
    response.delete_cookie(FLOW_COOKIE, path='/')
    return response


@router.post('/billing/logout')
@router.post('/api/billing/logout')
async def logout(request: Request):
    check(request)
    ledger_for(request).logout(request.cookies.get(COOKIE, ''))
    response = JSONResponse({'signedOut':True}, headers={'Cache-Control':'no-store'})
    response.delete_cookie(COOKIE, path='/')
    response.delete_cookie(FLOW_COOKIE, path='/')
    return response
