"""Isolated browser fixture: fake delivery, no provider calls or real balances."""
import json
import os
import sys
from pathlib import Path
from fastapi import FastAPI
import uvicorn
from server import auth, billing
from server.usage import Ledger
root = Path(sys.argv[1])
class FixtureLedger(Ledger):
    first = True
    def new_account(self):
        token = super().new_account()
        if self.first:
            self.first = False
            with self.connect() as db: db.execute('UPDATE accounts SET balance=6000000')
        return token
app = FastAPI()
app.state.usage = FixtureLedger(root/'ledger.sqlite3')
auth.settings = lambda: {'test':True}
billing.credential = lambda name: ''
def delivery(config, email, token):
    (root/'email.json').write_text(json.dumps({'email':email, 'token':token}))
auth.send_link = delivery
app.include_router(billing.router)
uvicorn.run(app, host='127.0.0.1', port=18769, log_level='error')
