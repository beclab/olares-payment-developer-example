/**
 * Harbor Goods — a shop demo for Olares Payment.
 *
 * Read the Gateway section first. Those four calls are the integration:
 *   createPayment → hosted checkout URL
 *   getPayment    → has this payment settled? (return-url / continue-pay)
 *   constructEvent → verify an inbound webhook
 *   listPayments  → merchant-side reconciliation
 *
 * Everything below that is ordinary shop code (sessions, orders, HTTP).
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { MerchantClient, PaymentError, webhooks } from '@olares/payment-sdk';
import { CONFIG } from './config.js';

const here = dirname(fileURLToPath(import.meta.url));
const page = (name) => readFileSync(join(here, name), 'utf8');
const app = express();

// ---------------------------------------------------------------------------
// Gateway
// ---------------------------------------------------------------------------

const merchant = new MerchantClient({
  apiKey: CONFIG.apiKey,
  apiSecret: CONFIG.apiSecret,
});

const gatewayError = (err) =>
  err instanceof PaymentError ? `${err.code} ${err.message}` : String(err);

/** createPayment — open a hosted checkout for this order.
 *  buyer is the unified Party: { kind: 'external', ref, display } for shop nicknames. */
async function createPayment(order) {
  order.paySeq = (order.paySeq || 0) + 1;
  const created = await merchant.createPayment(
    {
      amountCents: order.amountCents,
      buyer: {
        kind: 'external',
        ref: order.buyerId,
        display: { name: order.buyerNickname },
      },
      returnUrl: `${CONFIG.shopPublicUrl}/?order=${encodeURIComponent(order.id)}`,
      metadata: { order_id: order.id },
    },
    { idempotencyKey: `shop:${order.id}:${order.paySeq}` },
  );
  order.paymentId = created.paymentId;
  order.checkoutUrl = created.checkoutUrl;
  order.status = OPEN;
  order.failReason = null;
  return created;
}

/** getPayment — only `paid: true` is safe to fulfill. */
async function getPayment(paymentId) {
  return merchant.getPayment(paymentId);
}

/** listPayments — recent rows on this merchant account. */
async function listPayments(limit = 50) {
  return merchant.listPayments({ limit });
}

/** constructEvent — verify the HMAC; throws if the body is not from the gateway. */
function constructEvent(req) {
  return webhooks.constructEvent(req, CONFIG.webhookSecret);
}

/** Return-url / continue-pay fallback: ask the gateway, then update the order. */
async function syncOrder(order) {
  if (!order?.paymentId || order.status !== OPEN) return order;
  try {
    const result = await getPayment(order.paymentId);
    if (result.paid) {
      markPaid(order, result.credential, result.payment.paymentId, msOf(result.payment.paidAt));
    } else if (result.payment.status === 'PAYMENT_STATUS_CANCELED') {
      markClosed(order, 'canceled', 'payment canceled or expired');
    }
  } catch (err) {
    console.warn(`getPayment failed order=${order.id} ${gatewayError(err)}`);
  }
  return order;
}

/** Live path: apply a verified webhook to the matching order. */
function applyWebhook(event) {
  const order =
    orders.get(event.metadata?.order_id) ??
    [...orders.values()].find((o) => o.paymentId === event.paymentId) ??
    null;
  if (!order) {
    console.warn(`webhook ${event.type} unknown payment=${event.paymentId}`);
    return;
  }
  if (event.type === 'payment.succeeded') {
    markPaid(order, event.credential || {}, event.paymentId, event.paidAt);
    console.log(`paid order=${order.id} payment=${event.paymentId}`);
    return;
  }
  if (event.type === 'payment.failed') {
    markClosed(order, 'failed', event.failReason);
    console.log(`failed order=${order.id} ${event.failReason || ''}`);
    return;
  }
  if (event.type === 'payment.canceled') {
    markClosed(order, 'canceled', event.cancellationReason);
    console.log(`canceled order=${order.id}`);
  }
}

function msOf(ts) {
  if (ts == null) return Date.now();
  const n = typeof ts === 'number' ? ts : Date.parse(ts);
  return Number.isFinite(n) ? n : Date.now();
}

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

const PRODUCTS = [
  { id: 'mug', title: 'Harbor Mug', blurb: 'Stoneware cup. Holds a long pour.', priceCents: 1 },
  { id: 'notebook', title: 'Field Notebook', blurb: 'Dot-grid, 80 pages, pocket size.', priceCents: 1 },
  { id: 'sticker', title: 'Lighthouse Sticker', blurb: 'Vinyl, weatherproof, 8cm.', priceCents: 1 },
];

// ---------------------------------------------------------------------------
// Sessions — buyer cookie + seller admin
// ---------------------------------------------------------------------------

const COOKIE = 'shop_buyer';
const ADMIN_COOKIE = 'shop_admin';
const ADMIN_USER = 'admin';
const ADMIN_PASS = 'admin';
const buyersByNick = new Map();
const buyers = new Map();
const adminSessions = new Set();

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
const adminAuthed = (req) => adminSessions.has(cookies(req)[ADMIN_COOKIE]);

function requireBuyer(req, res, next) {
  const buyer = buyerOf(req);
  if (!buyer) return res.status(401).json({ error: 'sign in with a nickname first' });
  req.buyer = buyer;
  next();
}

function requireAdmin(req, res, next) {
  if (!adminAuthed(req)) return res.status(401).json({ error: 'seller sign-in required' });
  next();
}

function signInBuyer(nickname) {
  const key = nickname.toLowerCase();
  let buyer = buyersByNick.get(key);
  if (!buyer) {
    buyer = { id: `buy_${randomUUID().slice(0, 8)}`, nickname, lastShipTo: null };
    buyersByNick.set(key, buyer);
    buyers.set(buyer.id, buyer);
  }
  return buyer;
}

function setBuyerCookie(res, buyerId) {
  res.setHeader(
    'Set-Cookie',
    `${COOKIE}=${encodeURIComponent(buyerId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`,
  );
}

function clearBuyerCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function signInAdmin() {
  const token = randomUUID();
  adminSessions.add(token);
  return token;
}

function setAdminCookie(res, token) {
  res.setHeader(
    'Set-Cookie',
    `${ADMIN_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`,
  );
}

function clearAdminCookie(req, res) {
  adminSessions.delete(cookies(req)[ADMIN_COOKIE]);
  res.setHeader('Set-Cookie', `${ADMIN_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

// ---------------------------------------------------------------------------
// Orders — shop-owned state (pending → paid → shipped)
// ---------------------------------------------------------------------------

const OPEN = 'pending_payment';
const orders = new Map();

const collected = (o) => o.status === 'paid' || o.status === 'shipped';

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
  failReason: o.failReason,
  shipNote: o.shipNote,
  createdAt: o.createdAt,
  paidAt: o.paidAt,
  shippedAt: o.shippedAt,
});

function createOrder(buyer, product, shipTo) {
  const order = {
    id: `ord_${randomUUID().slice(0, 8)}`,
    buyerId: buyer.id,
    buyerNickname: buyer.nickname,
    productId: product.id,
    productTitle: product.title,
    amountCents: product.priceCents,
    recipient: shipTo.recipient,
    phone: shipTo.phone,
    address: shipTo.address,
    note: shipTo.note,
    status: OPEN,
    paySeq: 0,
    paymentId: null,
    checkoutUrl: null,
    txHash: null,
    chain: null,
    payCurrency: null,
    payAmount: null,
    failReason: null,
    shipNote: null,
    createdAt: Date.now(),
    paidAt: null,
    shippedAt: null,
  };
  orders.set(order.id, order);
  buyer.lastShipTo = { recipient: shipTo.recipient, phone: shipTo.phone, address: shipTo.address };
  return order;
}

function applyCredential(order, cred, paymentId, paidAt) {
  if (paymentId) order.paymentId = paymentId;
  if (cred.txHash) order.txHash = cred.txHash;
  if (cred.chain) order.chain = cred.chain;
  if (cred.payCurrency) order.payCurrency = cred.payCurrency;
  if (cred.payAmount) order.payAmount = cred.payAmount;
  if (paidAt) order.paidAt = paidAt;
}

function markPaid(order, cred = {}, paymentId, paidAt) {
  applyCredential(order, cred, paymentId, paidAt || order.paidAt || Date.now());
  if (order.status !== 'shipped') order.status = 'paid';
  order.failReason = null;
}

function markClosed(order, status, detail) {
  if (collected(order)) return;
  order.status = status;
  order.failReason = detail || null;
}

function markShipped(order) {
  if (order.status !== 'paid') return false;
  order.status = 'shipped';
  order.shippedAt = Date.now();
  order.shipNote = `Packed ${order.productTitle} for ${order.recipient}`;
  return true;
}

function stats() {
  const list = [...orders.values()];
  const paid = list.filter(collected);
  const byProduct = {};
  const byChain = {};
  const byBuyer = {};
  for (const o of list) {
    const p = (byProduct[o.productId] ||= {
      productId: o.productId,
      title: o.productTitle,
      orders: 0,
      paid: 0,
      shipped: 0,
      revenueCents: 0,
    });
    p.orders += 1;
    if (collected(o)) {
      p.paid += 1;
      p.revenueCents += o.amountCents;
    }
    if (o.status === 'shipped') p.shipped += 1;
    if (collected(o)) {
      const key = o.chain || 'unknown';
      const c = (byChain[key] ||= { chain: key, payCurrency: o.payCurrency, orders: 0, revenueCents: 0 });
      c.orders += 1;
      c.revenueCents += o.amountCents;
    }
    const b = (byBuyer[o.buyerId] ||= {
      buyerId: o.buyerId,
      nickname: o.buyerNickname,
      orders: 0,
      paid: 0,
      shipped: 0,
      revenueCents: 0,
      lastAddress: o.address,
    });
    b.orders += 1;
    b.lastAddress = o.address;
    if (collected(o)) {
      b.paid += 1;
      b.revenueCents += o.amountCents;
    }
    if (o.status === 'shipped') b.shipped += 1;
  }
  return {
    totals: {
      orders: list.length,
      pending: list.filter((o) => o.status === OPEN).length,
      paid: list.filter((o) => o.status === 'paid').length,
      shipped: list.filter((o) => o.status === 'shipped').length,
      failed: list.filter((o) => o.status === 'failed').length,
      canceled: list.filter((o) => o.status === 'canceled').length,
      revenueCents: paid.reduce((n, o) => n + o.amountCents, 0),
      buyers: buyers.size,
    },
    byProduct: Object.values(byProduct),
    byChain: Object.values(byChain),
    byBuyer: Object.values(byBuyer),
  };
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

// Webhook must read the raw body — register it before express.json().
app.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  let event;
  try {
    event = constructEvent(req);
  } catch (err) {
    console.warn(`webhook rejected: ${gatewayError(err)}`);
    return res.status(400).send('bad signature');
  }
  applyWebhook(event);
  res.send('ok');
});

app.use(express.json());
app.get('/', (_req, res) => res.type('html').send(page('index.html')));
app.get('/admin', (_req, res) => res.type('html').send(page('admin.html')));
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
  const buyer = signInBuyer(nickname);
  setBuyerCookie(res, buyer.id);
  res.json({ buyer: publicBuyer(buyer), lastShipTo: buyer.lastShipTo });
});

app.post('/api/session/logout', (_req, res) => {
  clearBuyerCookie(res);
  res.json({ ok: true });
});

app.get('/api/orders', requireBuyer, async (req, res) => {
  const mine = [...orders.values()]
    .filter((o) => o.buyerId === req.buyer.id)
    .sort((a, b) => b.createdAt - a.createdAt);
  await Promise.all(mine.filter((o) => o.status === OPEN).map((o) => syncOrder(o)));
  res.json({ orders: mine.map(publicOrder) });
});

app.get('/api/orders/:id', async (req, res) => {
  const order = orders.get(req.params.id);
  if (!order) return res.status(404).json({ error: 'order not found' });
  const buyer = buyerOf(req);
  if (buyer && buyer.id !== order.buyerId) return res.status(404).json({ error: 'order not found' });
  await syncOrder(order);
  res.json({ order: publicOrder(order) });
});

app.post('/api/orders/:id/pay', requireBuyer, async (req, res) => {
  const order = orders.get(req.params.id);
  if (!order || order.buyerId !== req.buyer.id) return res.status(404).json({ error: 'order not found' });
  await syncOrder(order);
  if (collected(order)) return res.json({ paid: true, order: publicOrder(order) });
  if (order.status === OPEN && order.checkoutUrl) {
    return res.json({ checkoutUrl: order.checkoutUrl, order: publicOrder(order) });
  }
  try {
    const created = await createPayment(order);
    res.json({ checkoutUrl: created.checkoutUrl, order: publicOrder(order) });
  } catch (err) {
    console.error(`createPayment failed order=${order.id} ${gatewayError(err)}`);
    res.status(502).json({ error: err instanceof PaymentError ? err.message : 'could not resume payment' });
  }
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

  const order = createOrder(req.buyer, product, { recipient, phone, address, note });
  try {
    const created = await createPayment(order);
    res.json({ order: publicOrder(order), checkoutUrl: created.checkoutUrl });
  } catch (err) {
    order.status = 'failed';
    order.failReason = err instanceof PaymentError ? err.message : 'createPayment failed';
    console.error(`createPayment failed order=${order.id} ${gatewayError(err)}`);
    res.status(502).json({ error: order.failReason });
  }
});

app.get('/api/admin/me', (req, res) => res.json({ ok: adminAuthed(req) }));

app.post('/api/admin/session', (req, res) => {
  if (req.body?.username !== ADMIN_USER || req.body?.password !== ADMIN_PASS) {
    return res.status(401).json({ error: 'wrong username or password' });
  }
  setAdminCookie(res, signInAdmin());
  res.json({ ok: true });
});

app.post('/api/admin/session/logout', (req, res) => {
  clearAdminCookie(req, res);
  res.json({ ok: true });
});

app.get('/api/admin/orders', requireAdmin, async (_req, res) => {
  const list = [...orders.values()].sort((a, b) => b.createdAt - a.createdAt);
  await Promise.all(list.filter((o) => o.status === OPEN).map((o) => syncOrder(o)));
  res.json({ orders: list.map(publicOrder) });
});

app.post('/api/admin/orders/:id/ship', requireAdmin, (req, res) => {
  const order = orders.get(req.params.id);
  if (!order) return res.status(404).json({ error: 'order not found' });
  if (!markShipped(order)) {
    return res.status(409).json({ error: 'only a paid order can be shipped' });
  }
  console.log(`shipped order=${order.id} buyer=${order.buyerNickname}`);
  res.json({ order: publicOrder(order) });
});

app.get('/api/admin/stats', requireAdmin, (_req, res) => res.json(stats()));

app.get('/api/admin/gateway-payments', requireAdmin, async (_req, res) => {
  try {
    const page = await listPayments(50);
    res.json({ items: page.items, error: null });
  } catch (err) {
    res.json({ items: [], error: gatewayError(err) });
  }
});

app.listen(CONFIG.port, '0.0.0.0', () => {
  console.log(`           shop    ${CONFIG.shopPublicUrl}`);
  console.log(`          admin    ${CONFIG.shopPublicUrl}/admin`);
  console.log('payment gateway    https://www.olares.com/payment (SDK default)');
});
