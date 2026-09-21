"""Server-owned sandbox reconciliation; works with all browsers closed.

Only reads Paddle. Refunds are initiated in Paddle, never by this worker.
"""
import asyncio
import logging
import re
from server import billing
from server.usage import PACK_CHARACTERS

log = logging.getLogger(__name__)
_lock = asyncio.Lock()


def money(value):
    if not isinstance(value,str) or not re.fullmatch(r'\d{1,12}',value):
        raise ValueError('Invalid money amount')
    return int(value)


def revoked_characters(transaction, adjustments):
    """Sum current approved principal adjustments, excluding tax and fees.

Paddle marks the original chargeback/credit reversed when it creates a reversal.
Those originals and the informational reversal rows therefore contribute zero.
Unknown structures fail closed rather than guessing an entitlement.
"""
    principal = money(transaction['details']['totals']['subtotal'])
    if principal <= 0: raise ValueError('Invalid principal')
    seen, refunded = set(), 0
    for row in adjustments:
        key = row['id']
        if not re.fullmatch(r'adj_[a-z0-9]{26}',key) or key in seen:
            raise ValueError('Duplicate or invalid adjustment')
        seen.add(key)
        if row['transaction_id'] != transaction['id'] or row['currency_code'] != 'USD':
            raise ValueError('Adjustment mismatch')
        if row['status'] in ('pending_approval','rejected','reversed'): continue
        if row['status'] != 'approved': raise ValueError('Unknown adjustment status')
        if row['action'] in ('chargeback_reverse','credit_reverse','chargeback_warning','chargeback_warning_reverse'):
            continue
        if row['action'] not in ('refund','credit','chargeback'):
            raise ValueError('Unknown adjustment action')
        refunded += money(row['totals']['subtotal'])
    # Ceiling avoids fractional characters; cap a pack so fees never remove extra credit.
    return min(PACK_CHARACTERS,(refunded*PACK_CHARACTERS+principal-1)//principal)


async def sync_order(ledger, order):
    async with _lock:
        txn = order['transaction_id']
        if not re.fullmatch(r'txn_[a-z0-9]{26}',txn): raise ValueError('Invalid transaction')
        remote = await asyncio.to_thread(billing.paddle,'/transactions/'+txn)
        if remote.get('id') != txn: raise ValueError('Wrong transaction')
        state = remote.get('status')
        if state not in ('draft','ready','billed','paid','completed','canceled','past_due'):
            raise ValueError('Unknown transaction status')
        revoked = 0
        if state == 'completed':
            if not billing.valid_purchase(remote,order): raise ValueError('Purchase mismatch')
            rows = await asyncio.to_thread(billing.adjustments,txn)
            revoked = revoked_characters(remote,rows)
        added = ledger.sync_payment(order['id'],txn,state,revoked)
        return {'credited':state=='completed','newCredit':added,'status':state,'revokedCharacters':revoked}


async def sync_once(ledger):
    counts = {'checked':0,'failed':0}
    for order in ledger.payment_candidates():
        try:
            await sync_order(ledger,order)
            counts['checked'] += 1
        except Exception:
            # No provider response bodies, email addresses, credentials or tokens in logs.
            ledger.payment_error(order['id'])
            counts['failed'] += 1
    return counts


async def sync_loop(ledger):
    while True:
        try:
            result = await sync_once(ledger)
            if result['failed']:
                log.warning('Sandbox payment sync: %d order checks failed; will retry.', result['failed'])
        except Exception:
            log.warning('Sandbox payment sync interrupted; will retry.')
        await asyncio.sleep(60)
