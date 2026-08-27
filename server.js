import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { MerchantClient, PaymentError, webhooks } from '@olares/payment-sdk';

const CONFIG = {
  port: 32000,
  shopPublicUrl: 'http://127.0.0.1:32000',
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

const reason = (err) => (err instanceof PaymentError ? `${err.code} ${err.message}` : String(err));

function ship(event) {
  const order =
    orders.get(event.metadata.order_id) ??
    [...orders.values()].find((o) => o.paymentId === event.paymentId);
  if (!order) return console.warn(`webhook paid unknown payment=${event.paymentId}`);
  Object.assign(order, {
    status: 'shipped',
    txHash: event.credential.txHash || null,
    shipNote: `Packed ${order.productTitle}`,
  });
  console.log(`shipped order=${order.id} payment=${event.paymentId}`);
}

app.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  let event;
  try {
    event = webhooks.constructEvent(req, CONFIG.webhookSecret);
  } catch (err) {
    console.warn(`webhook rejected: ${reason(err)}`);
    return res.status(400).send('bad signature');
  }
  if (event.type === 'payment.succeeded') ship(event);
  res.send('ok');
});

app.use(express.json());
app.get('/', (_req, res) => res.type('html').send(html));
app.get('/api/products', (_req, res) => res.json({ products: PRODUCTS }));
app.get('/api/orders/:id', (req, res) => {
  const order = orders.get(req.params.id);
  return order ? res.json({ order }) : res.status(404).json({ error: 'order not found' });
});

app.post('/api/checkout', async (req, res) => {
  const product = PRODUCTS.find((p) => p.id === req.body?.productId);
  if (!product) return res.status(400).json({ error: 'unknown product' });

  const order = {
    id: `ord_${randomUUID().slice(0, 8)}`,
    productTitle: product.title,
    amountCents: product.priceCents,
    paymentId: null,
    status: 'pending',
    txHash: null,
    shipNote: null,
  };
  orders.set(order.id, order);

  try {
    const created = await merchant.createPayment(
      {
        amountCents: product.priceCents,
        returnUrl: `${CONFIG.shopPublicUrl}/?order=${encodeURIComponent(order.id)}`,
        metadata: { order_id: order.id },
      },
      { idempotencyKey: `shop:${order.id}` },
    );
    order.paymentId = created.paymentId;
    res.json({ order, checkoutUrl: created.checkoutUrl });
  } catch (err) {
    order.status = 'failed';
    console.error(`createPayment failed order=${order.id} ${reason(err)}`);
    res.status(502).json({ error: err instanceof PaymentError ? err.message : 'createPayment failed' });
  }
});

app.listen(CONFIG.port, '0.0.0.0', () => {
  console.log(`shop  ${CONFIG.shopPublicUrl}  (checkout 付完后浏览器跳回这里)`);
  console.log(`pay   ${CONFIG.paymentEndpoint}`);
});
