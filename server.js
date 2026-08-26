/**
 * Harbor Goods — Mode A shop.
 *
 * Fill the CONFIG block from the payment dashboard
 * (dashboard-front-test.mdogs.me): merchant API key / secret, and the
 * webhook signing secret shown once when you register this shop's
 * /webhook URL. The webhook URL itself is stored on payment, not here.
 *
 * vendor/payment-sdk is a snapshot. Drop it once @olares/payment-sdk is published.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { MerchantClient, PaymentError, webhooks } from '@olares/payment-sdk';

const CONFIG = {
  port: 32000,
  shopPublicUrl: 'http://127.0.0.1:32000',
  // Deployed HMAC API. Local stack: http://127.0.0.1:31000
  paymentEndpoint: 'https://api-svc-test.mdogs.me',
  apiKey: 'pk_live_REPLACE_ME',
  apiSecret: 'sk_live_REPLACE_ME',
  webhookSecret: 'whsec_REPLACE_ME',
};

const PRODUCTS = [
  { id: 'mug', title: 'Harbor Mug', blurb: 'Stoneware cup. Holds a long pour.', priceCents: 1 },
  { id: 'notebook', title: 'Field Notebook', blurb: 'Dot-grid, 80 pages, pocket size.', priceCents: 1 },
  { id: 'sticker', title: 'Lighthouse Sticker', blurb: 'Vinyl, weatherproof, 8cm.', priceCents: 1 },
];

const orders = new Map();
const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'index.html'), 'utf8');
const merchant = new MerchantClient({
  apiKey: CONFIG.apiKey,
  apiSecret: CONFIG.apiSecret,
  baseUrl: CONFIG.paymentEndpoint,
});

const app = express();

app.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  try {
    const event = webhooks.constructEvent(
      req.body.toString('utf8'),
      {
        'x-olares-webhook-timestamp': String(req.header('x-olares-webhook-timestamp') ?? ''),
        'x-olares-webhook-signature': String(req.header('x-olares-webhook-signature') ?? ''),
      },
      CONFIG.webhookSecret,
    );
    if (event.type === 'payment.succeeded') {
      const metaId = typeof event.metadata.order_id === 'string' ? event.metadata.order_id : '';
      const order =
        (metaId && orders.get(metaId)) ||
        [...orders.values()].find((o) => o.paymentId === event.paymentId);
      if (order) {
        order.status = 'shipped';
        order.txHash = event.credential.txHash || null;
        order.shipNote = `Packed ${order.productTitle} for ${order.buyerOlaresId}`;
        order.updatedAt = Date.now();
        console.log(`shipped order=${order.id} payment=${event.paymentId}`);
      } else {
        console.warn(`webhook paid unknown payment=${event.paymentId}`);
      }
    }
    res.status(200).send('ok');
  } catch (err) {
    console.warn(`webhook rejected: ${err instanceof PaymentError ? err.message : err}`);
    res.status(400).send('bad signature');
  }
});

app.use(express.json());

app.get('/', (_req, res) => {
  res.type('html').send(html);
});

app.get('/api/products', (_req, res) => {
  res.json({ products: PRODUCTS });
});

app.get('/api/orders/:id', (req, res) => {
  const order = orders.get(req.params.id);
  if (!order) {
    res.status(404).json({ error: 'order not found' });
    return;
  }
  res.json({ order });
});

app.post('/api/checkout', async (req, res) => {
  const product = PRODUCTS.find((p) => p.id === String(req.body?.productId ?? ''));
  const buyerOlaresId = String(req.body?.buyerOlaresId ?? '').trim();
  if (!product) {
    res.status(400).json({ error: 'unknown product' });
    return;
  }
  if (!buyerOlaresId) {
    res.status(400).json({ error: 'buyerOlaresId is required' });
    return;
  }

  const order = {
    id: `ord_${randomUUID().slice(0, 8)}`,
    productId: product.id,
    productTitle: product.title,
    amountCents: product.priceCents,
    buyerOlaresId,
    paymentId: null,
    checkoutUrl: null,
    status: 'pending',
    txHash: null,
    shipNote: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  orders.set(order.id, order);

  try {
    const created = await merchant.createPayment(
      {
        buyerOlaresId,
        amountCents: product.priceCents,
        currency: 'usd',
        returnUrl: `${CONFIG.shopPublicUrl}/?order=${encodeURIComponent(order.id)}`,
        metadata: {
          order_id: order.id,
          product_id: product.id,
          product_title: product.title,
        },
      },
      { idempotencyKey: `shop:${order.id}` },
    );
    order.paymentId = created.paymentId;
    order.checkoutUrl = created.checkoutUrl;
    order.updatedAt = Date.now();
    res.json({ order, checkoutUrl: created.checkoutUrl });
  } catch (err) {
    order.status = 'failed';
    order.updatedAt = Date.now();
    const message = err instanceof PaymentError ? err.message : 'createPayment failed';
    const code = err instanceof PaymentError ? err.code : 1000;
    console.error(`createPayment failed order=${order.id} code=${code} ${message}`);
    res.status(502).json({ error: message, code });
  }
});

app.listen(CONFIG.port, '0.0.0.0', () => {
  console.log(`shop  ${CONFIG.shopPublicUrl}`);
  console.log(`pay   ${CONFIG.paymentEndpoint}`);
  console.log(`hook  ${CONFIG.shopPublicUrl}/webhook   (register this URL on the payment dashboard)`);
});
