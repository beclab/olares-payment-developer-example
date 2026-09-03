/**
 * Verify inbound webhook signatures and print each event.
 *
 *   npx tsx examples/04-webhook.js
 *
 * Point the Dashboard webhook at http://<your-host>:32001/webhook
 * (port 32001 so it does not clash with the shop on 32000).
 */
import express from 'express';
import { webhooks } from '@olares/payment-sdk';
import { CONFIG } from '../config.js';
import { formatToken } from '../format.js';

const port = Number(process.env.WEBHOOK_PORT || 32001);
const secret = process.env.PAYMENT_WEBHOOK_SECRET || CONFIG.webhookSecret;
const app = express();

app.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  try {
    const event = webhooks.constructEvent(req, secret);
    console.log(event.type, event.paymentId ?? '');
    if (event.type === 'payment.succeeded') {
      console.log('  txHash       ', event.credential.txHash);
      console.log(
        '  payAmount    ',
        formatToken(event.credential.payAmount, event.credential.payCurrency),
        event.credential.payCurrency,
      );
    }
    if (event.type === 'payment.failed') console.log('  failReason   ', event.failReason);
    if (event.type === 'payment.canceled') console.log('  reason       ', event.cancellationReason);
    res.send('ok');
  } catch (err) {
    console.warn('rejected', err instanceof Error ? err.message : err);
    res.status(400).send('bad signature');
  }
});

app.listen(port, '0.0.0.0', () => {
  console.log(`webhook  http://127.0.0.1:${port}/webhook`);
});
