import test from 'node:test';
import assert from 'node:assert/strict';
import {balanceCapacity,listeningHours,NORMAL_SPEED_CHARACTERS_PER_HOUR,CAPACITY_ASSUMPTION} from '../public/balance-capacity.js';
test('capacity uses a fixed documented normal-speed assumption and alternative shared uses',()=>{
 assert.equal(NORMAL_SPEED_CHARACTERS_PER_HOUR,150*6*60);
 assert.match(CAPACITY_ASSUMPTION,/not based on your listening history/);
 assert.equal(balanceCapacity(1000000),'Approximately 18.5 listening hours at normal speed OR 500 scanned pages');
 assert.equal(balanceCapacity(95301),'Approximately 1.8 listening hours at normal speed OR 47 scanned pages');
});
test('whole scanning pages round down while tiny and zero balances are honest',()=>{
 assert.equal(balanceCapacity(0),'Approximately 0 listening hours at normal speed OR 0 scanned pages');
 assert.equal(balanceCapacity(1999),'Approximately less than 0.1 listening hours at normal speed OR 0 scanned pages');
 assert.equal(balanceCapacity(2000),'Approximately less than 0.1 listening hours at normal speed OR 1 scanned page');
 assert.equal(listeningHours(54000),'1');
});
test('invalid display balances fail closed without inventing capacity',()=>{
 for(const units of [-1,NaN,Infinity,1.2,undefined,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>balanceCapacity(units),/Invalid available balance/);
});
