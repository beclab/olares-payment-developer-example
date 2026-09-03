/**
 * List recent payments (newest first).
 *
 *   npx tsx examples/03-list-payments.js
 */
import { MerchantClient } from '@olares/payment-sdk';
import { CONFIG } from '../config.js';
import { formatBuyer } from '../format.js';

const client = new MerchantClient({
  apiKey: process.env.PAYMENT_API_KEY || CONFIG.apiKey,
  apiSecret: process.env.PAYMENT_API_SECRET || CONFIG.apiSecret,
});

const { items, hasMore } = await client.listPayments({ limit: 5 });

console.log('listPayments');
console.log('  count        ', items.length, hasMore ? '(more)' : '');
for (const p of items) {
  console.log(`  ${p.paymentId}  ${p.status}  ${p.amountCents}¢  ${formatBuyer(p.buyer)}`);
}
