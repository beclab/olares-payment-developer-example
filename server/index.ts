import { randomUUID } from 'node:crypto';
import cors from 'cors';
import express from 'express';
import { MerchantClient, PaymentError, webhooks } from '@olares/payment-sdk';
import { config } from './config.js';
import { createOrder, findOrderByPaymentId, getOrder, patchOrder, shipOrder } from './orders.js';
import { findProduct, PRODUCTS } from './products.js';

const merchant = new MerchantClient({
  apiKey: config.apiKey,
  apiSecret: config.apiSecret,
  baseUrl: config.paymentEndpoint,
});

const app = express();
app.use(cors({ origin: true }));

app.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  try {
    const event = webhooks.constructEvent(
      req.body.toString('utf8'),
      {
        'x-olares-webhook-timestamp': String(req.header('x-olares-webhook-timestamp') ?? ''),
        'x-olares-webhook-signature': String(req.header('x-olares-webhook-signature') ?? ''),
      },
      config.webhookSecret,
    );

    if (event.type === 'payment.succeeded') {
      const metaOrderId = typeof event.metadata.order_id === 'string' ? event.metadata.order_id : '';
      const order = (metaOrderId && getOrder(metaOrderId)) || findOrderByPaymentId(event.paymentId);
      if (order) {
        shipOrder(order.id, event.credential.txHash || null);
        console.log(`shipped order=${order.id} payment=${event.paymentId}`);
      } else {
        console.warn(`webhook paid unknown payment=${event.paymentId}`);
      }
    }

    res.status(200).send('ok');
  } catch (err) {
    const message = err instanceof PaymentError ? err.message : 'bad webhook';
    console.warn(`webhook rejected: ${message}`);
    res.status(400).send('bad signature');
  }
});

app.use(express.json());

app.get('/api/products', (_req, res) => {
  res.json({ products: PRODUCTS });
});

app.get('/api/orders/:id', (req, res) => {
  const order = getOrder(req.params.id);
  if (!order) {
    res.status(404).json({ error: 'order not found' });
    return;
  }
  res.json({ order });
});

app.post('/api/checkout', async (req, res) => {
  const productId = String(req.body?.productId ?? '');
  const buyerOlaresId = String(req.body?.buyerOlaresId ?? '').trim();
  const product = findProduct(productId);
  if (!product) {
    res.status(400).json({ error: 'unknown product' });
    return;
  }
  if (!buyerOlaresId) {
    res.status(400).json({ error: 'buyerOlaresId is required' });
    return;
  }

  const orderId = `ord_${randomUUID().slice(0, 8)}`;
  const returnUrl = `${config.shopPublicUrl}/?order=${encodeURIComponent(orderId)}`;
  const order = createOrder({
    id: orderId,
    productId: product.id,
    productTitle: product.title,
    amountCents: product.priceCents,
    buyerOlaresId,
    paymentId: null,
    checkoutUrl: null,
  });

  try {
    const created = await merchant.createPayment(
      {
        buyerOlaresId,
        amountCents: product.priceCents,
        currency: 'usd',
        returnUrl,
        metadata: {
          order_id: order.id,
          product_id: product.id,
          product_title: product.title,
        },
      },
      { idempotencyKey: `shop:${order.id}` },
    );
    const next = patchOrder(order.id, { paymentId: created.paymentId, checkoutUrl: created.checkoutUrl });
    res.json({ order: next, checkoutUrl: created.checkoutUrl });
  } catch (err) {
    patchOrder(order.id, { status: 'failed' });
    const message = err instanceof PaymentError ? err.message : 'createPayment failed';
    const code = err instanceof PaymentError ? err.code : 1000;
    console.error(`createPayment failed order=${order.id} code=${code} ${message}`);
    res.status(502).json({ error: message, code });
  }
});

app.listen(config.port, '127.0.0.1', () => {
  console.log(`shop api + webhook on http://127.0.0.1:${config.port}`);
  console.log(`payment ${config.paymentEndpoint}`);
});
