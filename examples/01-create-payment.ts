/**
 * Create a payment and print the hosted checkout URL.
 *
 *   npx tsx examples/01-create-payment.ts
 *
 * Writes paymentId to examples/.last-payment-id for 02-get-payment.ts.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MerchantClient } from '@olares/payment-sdk';
import { CONFIG } from '../config.js';

const client = new MerchantClient({
  apiKey: process.env.PAYMENT_API_KEY || CONFIG.apiKey,
  apiSecret: process.env.PAYMENT_API_SECRET || CONFIG.apiSecret,
  baseUrl: process.env.PAYMENT_ENDPOINT || CONFIG.paymentEndpoint,
});

const { paymentId, checkoutUrl } = await client.createPayment(
  {
    amountCents: 1,
    metadata: { example: '01-create-payment' },
  },
  { idempotencyKey: `example:${Date.now()}` },
);

writeFileSync(join(dirname(fileURLToPath(import.meta.url)), '.last-payment-id'), paymentId);

console.log('createPayment');
console.log('  paymentId    ', paymentId);
console.log('  checkoutUrl  ', checkoutUrl);
