import test from 'node:test';import assert from 'node:assert/strict';import {scanCreditOutcome} from '../public/scan-visibility.js';
test('scan outcomes use verified refund/settlement and distinguish free saved replay from original charge',()=>{
 assert.match(scanCreditOutcome({job:{creditsReleased:2,creditsUsed:0}}),/2 credits returned.*0 credits/);
 assert.match(scanCreditOutcome({receipt:{receiptCredits:2,creditsUsed:0,cached:true}}),/Original scan: 2 credits used.*no more credits/);
 assert.doesNotMatch(scanCreditOutcome({receipt:{creditsUsed:0,cached:true}}),/0 credits used|returned/);
 assert.match(scanCreditOutcome(),/not been confirmed/);assert.match(scanCreditOutcome({job:{creditsUsed:-1}}),/not been confirmed/);
});
