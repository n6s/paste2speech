import test from 'node:test';
import assert from 'node:assert/strict';
import {validPurchase,revokedCharacters,PRICE,LEGACY_PRICE,PRODUCT} from '../cloudflare/prepared/payments.js';
const order={id:'order',transaction_id:'txn_'+'a'.repeat(26),characters:1000000};
const purchase=()=>({id:order.transaction_id,status:'completed',custom_data:{p2s_order:order.id},currency_code:'USD',items:[{quantity:1,price:{id:PRICE,product_id:PRODUCT,unit_price:{amount:'1000',currency_code:'USD'}}}],details:{totals:{discount:'0',subtotal:'834'}}});
const adjustment=(action='refund',subtotal='417')=>({id:'adj_'+'b'.repeat(26),transaction_id:order.transaction_id,currency_code:'USD',status:'approved',action,totals:{subtotal}});
test('purchase verifier rejects mismatched orders, quantities, discounts and recurring prices',()=>{
 assert.ok(validPurchase(purchase(),order));
 for(const mutate of [p=>p.status='paid',p=>p.items[0].quantity='1',p=>p.discount_id='discount',p=>p.items[0].price.billing_cycle={},p=>p.custom_data.p2s_order='other',p=>p.items[0].price.unit_price.amount='999']){const p=purchase();mutate(p);assert.equal(validPurchase(p,order),false);}
 const legacy=purchase();legacy.items[0].price.id=LEGACY_PRICE;assert.ok(validPurchase(legacy,{...order,characters:3000000}));assert.equal(validPurchase(legacy,order),false);
});
test('refund uses principal, rounds upward, caps, excludes reversals, rejects unknown evidence',()=>{
 assert.equal(revokedCharacters(purchase(),[adjustment()]),500000);
 assert.equal(revokedCharacters(purchase(),[adjustment('refund','1')]),1200);
 assert.equal(revokedCharacters(purchase(),[adjustment('chargeback','999999999999')]),1000000);
 assert.equal(revokedCharacters(purchase(),[adjustment('chargeback_reverse')]),0);
 assert.equal(revokedCharacters(purchase(),[{...adjustment(),status:'reversed'}]),0);
 assert.throws(()=>revokedCharacters(purchase(),[adjustment(),adjustment()]));
 assert.throws(()=>revokedCharacters(purchase(),[adjustment('unknown')]));
 assert.throws(()=>revokedCharacters(purchase(),[adjustment('refund',1)]));
});
