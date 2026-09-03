/**
 * Look up one payment. paid: true is the only safe signal to fulfill.
 *
 *   npx tsx examples/02-get-payment.ts
 *   PAYMENT_ID=pi_xxx npx tsx examples/02-get-payment.ts
 *
 * Default id is examples/.last-payment-id from 01-create-payment.ts.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MerchantClient } from '@olares/payment-sdk';
import { CONFIG } from '../config.js';
import { formatToken } from '../format.js';

const client = new MerchantClient({
  apiKey: process.env.PAYMENT_API_KEY || CONFIG.apiKey,
  apiSecret: process.env.PAYMENT_API_SECRET || CONFIG.apiSecret,
});

const stamp = join(dirname(fileURLToPath(import.meta.url)), '.last-payment-id');
const paymentId = process.env.PAYMENT_ID || readFileSync(stamp, 'utf8').trim();

const result = await client.getPayment(paymentId);

console.log('getPayment');
console.log('  paymentId    ', result.payment.paymentId);
console.log('  status       ', result.payment.status);
console.log('  paid         ', result.paid);
if (result.paid) {
  console.log('  txHash       ', result.credential.txHash);
  console.log(
    '  payAmount    ',
    formatToken(result.credential.payAmount, result.credential.payCurrency),
    result.credential.payCurrency,
  );
  console.log('  chain        ', result.credential.chain);
}
