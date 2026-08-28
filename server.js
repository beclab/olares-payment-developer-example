/**
 * Harbor Goods — buyer shop + seller admin, collecting through Olares Payment.
 *
 * The shop owns addresses and orders. Payment sees amountCents, an optional
 * buyerOlaresId (this demo sends the nickname so the payment dashboard can
 * label Transactions → Buyer), and metadata.order_id. Omit buyerOlaresId if
 * the merchant does not want customer identity on the payment side.
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

const COOKIE = 'shop_buyer';
const ADMIN_COOKIE = 'shop_admin';
const ADMIN_USER = 'admin';
const ADMIN_PASS = 'admin';
const adminSessions = new Set();
const here = dirname(fileURLToPath(import.meta.url));
const shopHtml = readFileSync(join(here, 'index.html'), 'utf8');
const adminHtml = readFileSync(join(here, 'admin.html'), 'utf8');

const buyersByNick = new Map();
const buyers = new Map();
const orders = new Map();

const merchant = new MerchantClient({
  apiKey: CONFIG.apiKey,
  apiSecret: CONFIG.apiSecret,
  baseUrl: CONFIG.paymentEndpoint,
});
const app = express();

const reason = (err) => (err instanceof PaymentError ? `${err.code} ${err.message}` : String(err));
const cookies = (req) =>
  Object.fromEntries(
    (req.headers.cookie || '')
      .split(';')
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => {
        const i = p.indexOf('=');
        return [decodeURIComponent(p.slice(0, i)), decodeURIComponent(p.slice(i + 1))];
      }),
  );
const buyerOf = (req) => buyers.get(cookies(req)[COOKIE]) || null;
const publicBuyer = (b) => (b ? { id: b.id, nickname: b.nickname } : null);
const publicOrder = (o) => ({
  id: o.id,
  buyerId: o.buyerId,
  buyerNickname: o.buyerNickname,
  productId: o.productId,
  productTitle: o.productTitle,
  amountCents: o.amountCents,
  recipient: o.recipient,
  phone: o.phone,
  address: o.address,
  note: o.note,
  status: o.status,
  paymentId: o.paymentId,
  checkoutUrl: o.checkoutUrl,
  txHash: o.txHash,
  chain: o.chain,
  payCurrency: o.payCurrency,
  payAmount: o.payAmount,
  shipNote: o.shipNote,
  createdAt: o.createdAt,
  paidAt: o.paidAt,
});

function requireBuyer(req, res, next) {
  const buyer = buyerOf(req);
  if (!buyer) return res.status(401).json({ error: 'sign in with a nickname first' });
  req.buyer = buyer;
  next();
}

const adminAuthed = (req) => adminSessions.has(cookies(req)[ADMIN_COOKIE]);
function requireAdmin(req, res, next) {
  if (!adminAuthed(req)) return res.status(401).json({ error: 'seller sign-in required' });
  next();
}

function ship(event) {
  const order =
    orders.get(event.metadata?.order_id) ??
    [...orders.values()].find((o) => o.paymentId === event.paymentId);
  if (!order) return console.warn(`webhook paid unknown payment=${event.paymentId}`);
  const cred = event.credential || {};
  Object.assign(order, {
    status: 'shipped',
    paymentId: event.paymentId || order.paymentId,
    txHash: cred.txHash || null,
    chain: cred.chain || null,
    payCurrency: cred.payCurrency || null,
    payAmount: cred.payAmount || null,
    paidAt: event.paidAt || Date.now(),
    shipNote: `Packed ${order.productTitle} for ${order.recipient}`,
  });
  console.log(`shipped order=${order.id} payment=${event.paymentId} buyer=${order.buyerNickname}`);
}

function stats() {
  const list = [...orders.values()];
  const shipped = list.filter((o) => o.status === 'shipped');
  const byProduct = {};
  const byChain = {};
  const byBuyer = {};
  for (const o of list) {
    const p = (byProduct[o.productId] ||= { productId: o.productId, title: o.productTitle, orders: 0, shipped: 0, revenueCents: 0 });
    p.orders += 1;
    if (o.status === 'shipped') {
      p.shipped += 1;
      p.revenueCents += o.amountCents;
    }
    if (o.status === 'shipped') {
      const key = o.chain || 'unknown';
      const c = (byChain[key] ||= { chain: key, payCurrency: o.payCurrency, orders: 0, revenueCents: 0 });
      c.orders += 1;
      c.revenueCents += o.amountCents;
    }
    const b = (byBuyer[o.buyerId] ||= {
      buyerId: o.buyerId,
      nickname: o.buyerNickname,
      orders: 0,
      shipped: 0,
      revenueCents: 0,
      lastAddress: o.address,
    });
    b.orders += 1;
    b.lastAddress = o.address;
    if (o.status === 'shipped') {
      b.shipped += 1;
      b.revenueCents += o.amountCents;
    }
  }
  return {
    totals: {
      orders: list.length,
      pending: list.filter((o) => o.status === 'pending_payment').length,
      shipped: shipped.length,
      failed: list.filter((o) => o.status === 'failed').length,
      revenueCents: shipped.reduce((n, o) => n + o.amountCents, 0),
      buyers: buyers.size,
    },
    byProduct: Object.values(byProduct),
    byChain: Object.values(byChain),
    byBuyer: Object.values(byBuyer),
  };
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
app.get('/', (_req, res) => res.type('html').send(shopHtml));
app.get('/admin', (_req, res) => res.type('html').send(adminHtml));
app.get('/api/products', (_req, res) => res.json({ products: PRODUCTS }));

app.get('/api/me', (req, res) => {
  const buyer = buyerOf(req);
  res.json({ buyer: publicBuyer(buyer), lastShipTo: buyer?.lastShipTo || null });
});

app.post('/api/session', (req, res) => {
  const nickname = String(req.body?.nickname ?? '').trim();
  if (nickname.length < 2 || nickname.length > 32) {
    return res.status(400).json({ error: 'nickname must be 2–32 characters' });
  }
  const key = nickname.toLowerCase();
  let buyer = buyersByNick.get(key);
  if (!buyer) {
    buyer = { id: `buy_${randomUUID().slice(0, 8)}`, nickname, lastShipTo: null };
    buyersByNick.set(key, buyer);
    buyers.set(buyer.id, buyer);
  }
  res.setHeader(
    'Set-Cookie',
    `${COOKIE}=${encodeURIComponent(buyer.id)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`,
  );
  res.json({ buyer: publicBuyer(buyer), lastShipTo: buyer.lastShipTo });
});

app.post('/api/session/logout', (_req, res) => {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  res.json({ ok: true });
});

app.get('/api/orders', requireBuyer, (req, res) => {
  const mine = [...orders.values()]
    .filter((o) => o.buyerId === req.buyer.id)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(publicOrder);
  res.json({ orders: mine });
});

app.get('/api/orders/:id', (req, res) => {
  const order = orders.get(req.params.id);
  if (!order) return res.status(404).json({ error: 'order not found' });
  const buyer = buyerOf(req);
  if (buyer && buyer.id !== order.buyerId) return res.status(404).json({ error: 'order not found' });
  res.json({ order: publicOrder(order) });
});

app.post('/api/orders/:id/pay', requireBuyer, (req, res) => {
  const order = orders.get(req.params.id);
  if (!order || order.buyerId !== req.buyer.id) return res.status(404).json({ error: 'order not found' });
  if (order.status !== 'pending_payment') {
    return res.status(409).json({ error: 'order is not waiting for payment' });
  }
  if (!order.checkoutUrl) return res.status(409).json({ error: 'checkout url is gone' });
  res.json({ checkoutUrl: order.checkoutUrl, order: publicOrder(order) });
});

app.post('/api/checkout', requireBuyer, async (req, res) => {
  const product = PRODUCTS.find((p) => p.id === req.body?.productId);
  const recipient = String(req.body?.recipient ?? '').trim();
  const phone = String(req.body?.phone ?? '').trim();
  const address = String(req.body?.address ?? '').trim();
  const note = String(req.body?.note ?? '').trim();
  if (!product) return res.status(400).json({ error: 'unknown product' });
  if (!recipient || !phone || !address) {
    return res.status(400).json({ error: 'recipient, phone and address are required' });
  }

  const order = {
    id: `ord_${randomUUID().slice(0, 8)}`,
    buyerId: req.buyer.id,
    buyerNickname: req.buyer.nickname,
    productId: product.id,
    productTitle: product.title,
    amountCents: product.priceCents,
    recipient,
    phone,
    address,
    note,
    status: 'pending_payment',
    paymentId: null,
    checkoutUrl: null,
    txHash: null,
    chain: null,
    payCurrency: null,
    payAmount: null,
    shipNote: null,
    createdAt: Date.now(),
    paidAt: null,
  };
  orders.set(order.id, order);
  req.buyer.lastShipTo = { recipient, phone, address };

  try {
    const created = await merchant.createPayment(
      {
        amountCents: product.priceCents,
        buyerOlaresId: req.buyer.nickname,
        returnUrl: `${CONFIG.shopPublicUrl}/?order=${encodeURIComponent(order.id)}`,
        metadata: { order_id: order.id },
      },
      { idempotencyKey: `shop:${order.id}` },
    );
    order.paymentId = created.paymentId;
    order.checkoutUrl = created.checkoutUrl;
    res.json({ order: publicOrder(order), checkoutUrl: created.checkoutUrl });
  } catch (err) {
    order.status = 'failed';
    console.error(`createPayment failed order=${order.id} ${reason(err)}`);
    res.status(502).json({ error: err instanceof PaymentError ? err.message : 'createPayment failed' });
  }
});

app.get('/api/admin/me', (req, res) => res.json({ ok: adminAuthed(req) }));
app.post('/api/admin/session', (req, res) => {
  if (req.body?.username !== ADMIN_USER || req.body?.password !== ADMIN_PASS) {
    return res.status(401).json({ error: 'wrong username or password' });
  }
  const token = randomUUID();
  adminSessions.add(token);
  res.setHeader(
    'Set-Cookie',
    `${ADMIN_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`,
  );
  res.json({ ok: true });
});
app.post('/api/admin/session/logout', (req, res) => {
  adminSessions.delete(cookies(req)[ADMIN_COOKIE]);
  res.setHeader('Set-Cookie', `${ADMIN_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  res.json({ ok: true });
});
app.get('/api/admin/orders', requireAdmin, (_req, res) => {
  const list = [...orders.values()].sort((a, b) => b.createdAt - a.createdAt).map(publicOrder);
  res.json({ orders: list });
});
app.get('/api/admin/stats', requireAdmin, (_req, res) => res.json(stats()));

app.listen(CONFIG.port, '0.0.0.0', () => {
  console.log(`shop   ${CONFIG.shopPublicUrl}`);
  console.log(`admin  ${CONFIG.shopPublicUrl}/admin`);
  console.log(`pay    ${CONFIG.paymentEndpoint}`);
});
