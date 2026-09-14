/**
 * The refund loop: create a refund, read the ledger, watch the state machine.
 *
 *   npx tsx examples/05-create-refund.js
 *   PAYMENT_ID=pi_xxx npx tsx examples/05-create-refund.js
 *   AMOUNT=600000 npx tsx examples/05-create-refund.js   # token minor units; omit = full remaining
 *
 * Default id is examples/.last-payment-id from 01-create-payment.js — the payment
 * must be succeeded. What you should take away:
 *
 *   createRefund hands back an executionUrl exactly once (the secret lives in the
 *   URL fragment — hand it to the wallet operator, never log or persist it). Then
 *   getPayment's refundSummary / getRefund tell you where the money is:
 *   prepared → submitted → succeeded/failed/canceled (one open refund per payment).
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
  baseUrl: process.env.GATEWAY_BASE_URL || CONFIG.gatewayBaseUrl,
});

const stamp = join(dirname(fileURLToPath(import.meta.url)), '.last-payment-id');
const paymentId = process.env.PAYMENT_ID || readFileSync(stamp, 'utf8').trim();

// The refund ledger first — can this payment be refunded right now?
const before = await client.getPayment(paymentId);
const summary = before.payment.refundSummary;
if (!before.paid || !summary) {
  console.log('getPayment');
  console.log('  status       ', before.payment.status);
  console.log('  refunds      not available (only succeeded payments carry a refund ledger)');
  process.exit(0);
}
const sym = summary.route?.tokenSymbol || '';
console.log('refund ledger');
console.log('  received     ', formatToken(summary.receivedAmount, sym), sym);
console.log('  refunded     ', formatToken(summary.refundedAmount, sym), sym);
console.log('  remaining    ', formatToken(summary.remainingRefundable, sym), sym);
console.log('  refundable   ', summary.refundable, summary.nonRefundableReason || '');

// createRefund — amount omitted = the whole remaining balance.
const handoff = await client.createRefund({
  paymentId,
  ...(process.env.AMOUNT ? { amount: process.env.AMOUNT } : {}),
  reason: 'example script run',
});
console.log('\ncreateRefund');
console.log('  refundId     ', handoff.refund.refundId);
console.log('  status       ', handoff.refund.status);
console.log('  amount       ', formatToken(handoff.refund.amount, sym), sym);
console.log('  expires at   ', handoff.executionExpiresAt?.toISOString() ?? '—');
// One-time link: print it once, never store it. Open it in a browser to sign
// with the receive wallet (an EOA — contract wallets are blocked there).
console.log('  executionUrl ', handoff.executionUrl);

// Watch the state machine (prepared → submitted → succeeded | failed | canceled).
const REFRESH_MS = 4000;
for (let i = 0; i < 20; i++) {
  await new Promise((r) => setTimeout(r, REFRESH_MS));
  const r = await client.getRefund(handoff.refund.refundId);
  console.log(`  poll ${String(i + 1).padStart(2)}      ${r.status}${r.txHash ? ` tx=${r.txHash}` : ''}${r.failReason ? ` fail=${r.failReason}` : ''}`);
  if (r.status === 'REFUND_STATUS_SUCCEEDED' || r.status === 'REFUND_STATUS_CANCELED') {
    const after = await client.getPayment(paymentId);
    console.log('\nfinal ledger');
    console.log('  refunded     ', formatToken(after.payment.refundSummary.refundedAmount, sym), sym);
    console.log('  remaining    ', formatToken(after.payment.refundSummary.remainingRefundable, sym), sym);
    process.exit(0);
  }
}
console.log('\nstill open — re-run 02-get-payment.js later, or cancel with cancelRefund(refundId).');
