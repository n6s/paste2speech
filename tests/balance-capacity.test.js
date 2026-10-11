import test from 'node:test';
import assert from 'node:assert/strict';
import {balanceCapacity,capacityEstimate,listeningHours,NORMAL_SPEED_CHARACTERS_PER_HOUR,CAPACITY_ASSUMPTION,SHARED_BALANCE_EXPLANATION} from '../public/balance-capacity.js';
test('capacity uses a fixed documented normal-speed assumption and alternative shared uses',()=>{
 assert.equal(NORMAL_SPEED_CHARACTERS_PER_HOUR,150*6*60);
 for(const value of ['150','six','54,000'])assert.ok(CAPACITY_ASSUMPTION.includes(value));
 assert.match(CAPACITY_ASSUMPTION,/fixed estimate/);assert.match(CAPACITY_ASSUMPTION,/not based.*history/);
 assert.deepEqual(capacityEstimate(1000000),{listeningHours:1000000/54000,scannedPages:500});
 assert.deepEqual(capacityEstimate(95301),{listeningHours:95301/54000,scannedPages:47});
 for(const [units,hours,pages]of [[1000000,'18.5',500],[95301,'1.8',47]]){
  const display=balanceCapacity(units);assert.ok(display.includes(hours));assert.match(display,new RegExp('\\bor\\b.*'+pages+' pages','i'));
 }
 assert.match(SHARED_BALANCE_EXPLANATION,/shared balance/);assert.match(SHARED_BALANCE_EXPLANATION,/either reduces both/);assert.match(SHARED_BALANCE_EXPLANATION,/Browser voices are free/);
});
test('whole scanning pages round down while tiny and zero balances are honest',()=>{
 for(const [units,pages]of [[0,0],[1999,0],[2000,1]])assert.equal(capacityEstimate(units).scannedPages,pages);
 assert.equal(listeningHours(0),'0');assert.equal(listeningHours(1999),'less than 0.1');assert.equal(listeningHours(2000),'less than 0.1');assert.equal(listeningHours(54000),'1');
 assert.match(balanceCapacity(0),/0 hours.*or.*0 pages/i);assert.match(balanceCapacity(2000),/or.*1 page\b/i);
});
test('invalid display balances fail closed without inventing capacity',()=>{
 for(const units of [-1,NaN,Infinity,1.2,undefined,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>balanceCapacity(units),/Invalid available balance/);
});
