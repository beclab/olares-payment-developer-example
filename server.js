/**
 * Harbor Goods — a shop demo for Olares Payment.
 *
 * Read the Gateway section first. Those calls are the integration:
 *   createPayment → hosted checkout URL
 *   getPayment    → has this payment settled? (return-url / continue-pay; carries refundSummary when paid)
 *   constructEvent → verify an inbound webhook (payment.* and refund.* events)
 *   listPayments  → merchant-side reconciliation
 *   createRefund  → open a refund, get the one-time execution URL (see Refund ledger)
 *
 * Everything below that is ordinary shop code (sessions, orders, HTTP).
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { DEFAULT_BASE_URL, MerchantClient, PaymentError, webhooks } from '@olares/payment-sdk';
import { CONFIG } from './config.js';

const apiKey = process.env.PAYMENT_API_KEY || CONFIG.apiKey;
const apiSecret = process.env.PAYMENT_API_SECRET || CONFIG.apiSecret;
const webhookSecret = process.env.PAYMENT_WEBHOOK_SECRET || CONFIG.webhookSecret;
const port = Number(process.env.PORT || CONFIG.port);
const shopPublicUrl = process.env.SHOP_PUBLIC_URL || CONFIG.shopPublicUrl;
// SDK default is https://www.olares.com/payment; GATEWAY_BASE_URL / CONFIG.gatewayBaseUrl
// override it (also used for the hosted receipt link — keep them on the same gateway).
const gatewayBaseUrl = process.env.GATEWAY_BASE_URL || CONFIG.gatewayBaseUrl || DEFAULT_BASE_URL; // 未配置时回落 SDK 默认（生产）

const here = dirname(fileURLToPath(import.meta.url));
const page = (name) => readFileSync(join(here, name), 'utf8');
const app = express();

// ---------------------------------------------------------------------------
// Gateway
// ---------------------------------------------------------------------------

const merchant = new MerchantClient({
  apiKey,
  apiSecret,
  ...(gatewayBaseUrl ? { baseUrl: gatewayBaseUrl } : {}),
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
      returnUrl: `${shopPublicUrl}/?order=${encodeURIComponent(order.id)}`,
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

/** createRefund — open a refund on a succeeded payment. The handoff carries the
 *  executionUrl exactly once (its secret lives in the URL fragment): shown to the
 *  seller, never persisted, never logged. Amount omitted = the whole remaining
 *  balance. Shop-side bookkeeping lives in applyRefundHandoff (Refund ledger). */
async function createRefund(order, { amountMin, reason }) {
  return merchant.createRefund(
    {
      paymentId: order.paymentId,
      ...(amountMin != null ? { amount: amountMin } : {}),
      ...(reason ? { reason } : {}),
      returnUrl: `${shopPublicUrl}/admin?order=${order.id}`,
    },
    { idempotencyKey: `shop-refund:${order.id}:${order.refundIds.length + 1}` },
  );
}

/** listPayments — recent rows on this merchant account. */
async function listPayments(limit = 50) {
  return merchant.listPayments({ limit });
}

/** constructEvent — verify the HMAC; throws if the body is not from the gateway. */
function constructEvent(req) {
  return webhooks.constructEvent(req, webhookSecret);
}

/** Return-url / continue-pay fallback: ask the gateway, then update the order.
 *  Paid orders keep coming back here too — that is how the refund ledger syncs. */
async function syncOrder(order) {
  if (!order?.paymentId) return order;
  try {
    if (order.status !== OPEN) {
      if (collected(order)) {
        const result = await getPayment(order.paymentId);
        applyRefundSummary(order, result.payment.refundSummary ?? null);
      }
      return order;
    }
    const result = await getPayment(order.paymentId);
    if (result.paid) {
      markPaid(order, result.credential, result.payment.paymentId, msOf(result.payment.paidAt));
      // clientSecret arrives here (not in webhooks) — the only place we can build
      // the hosted buyer receipt link from. See receiptUrlOf().
      if (result.payment.clientSecret) order.clientSecret = result.payment.clientSecret;
    } else if (result.payment.status === 'PAYMENT_STATUS_CANCELED') {
      markClosed(order, 'canceled', 'payment canceled or expired');
    }
    applyRefundSummary(order, result.payment.refundSummary ?? null);
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

/** Refund events ride a different protocol message (RefundCallback): they carry
 *  refundId + amount/token facts but NO metadata, so the order is matched by
 *  refundId first, paymentId second (covers refunds opened from the dashboard). */
function applyRefundWebhook(event) {
  let refund = refunds.get(event.refundId);
  if (!refund) {
    const order =
      [...orders.values()].find((o) => o.paymentId === event.paymentId) ?? null;
    if (!order) {
      console.warn(`webhook ${event.type} unknown refund=${event.refundId}`);
      return;
    }
    refund = recordRefundRow(order, {
      refundId: event.refundId,
      paymentId: event.paymentId,
      amount: event.amount || '0',
      status: 'REFUND_STATUS_SUBMITTED',
    });
  }
  const order = orders.get(refund.orderId);
  if (event.type === 'refund.succeeded') {
    markRefundSucceeded(refund, event.txHash, msOf(event.succeededAt));
    console.log(`refund ok order=${order.id} refund=${refund.refundId}`);
  } else {
    markRefundFailed(refund, event.failReason, msOf(event.failedAt));
    console.log(`refund failed order=${order.id} refund=${refund.refundId} ${event.failReason || ''}`);
  }
  recomputeRefundView(order);
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
  { id: 'mug', title: 'Harbor Mug', blurb: 'Stoneware cup. Holds a long pour.', priceCents: 2 },
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
// Plus the in-shop refund request (buyer ↔ seller negotiation; no gateway calls —
// the seller turns a granted-looking request into a gateway refund from the admin
// desk). Request states: open → granted | dismissed | withdrawn.
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
  refund: publicRefundView(o),
  refundRequest: o.refundRequest,
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
    refundIds: [],
    clientSecret: null,
    refundView: null,
    refundRequest: null, // { status, reason, requestedAt, decidedAt } — in-shop, buyer-side
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

// ----- Refund requests (in-shop negotiation; no gateway calls anywhere here) -----

/** Buyer-side guard: a collected order can carry one open request at a time,
 *  and not while a gateway refund is already running or fully refunded. */
function refundRequestGuard(order) {
  if (!collected(order)) return 'only a paid or shipped order can request a refund';
  if (refundStatusOf(order) === 'open') return 'a refund is already in progress on this order';
  if (refundStatusOf(order) === 'full') return 'this order is already fully refunded';
  if (order.refundRequest?.status === 'open') return 'a refund request is already open on this order';
  return null;
}

function markRefundRequested(order, reason) {
  order.refundRequest = { status: 'open', reason, requestedAt: Date.now(), decidedAt: null };
}

/** Terminal transitions: granted (seller opened a gateway refund), dismissed
 *  (seller declined, with a note the buyer sees), withdrawn (buyer rethought). */
function markRefundRequestDecided(order, status, note = null) {
  if (order.refundRequest?.status !== 'open') return false;
  order.refundRequest.status = status;
  order.refundRequest.note = note;
  order.refundRequest.decidedAt = Date.now();
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
      // Refund rollup. Token minor-unit strings (not cents): a shop may be paid in
      // several tokens, so a single net figure would lie — show refunded separately.
      refundOpen: list.filter((o) => refundStatusOf(o) === 'open').length,
      refundRequested: list.filter((o) => o.refundRequest?.status === 'open').length,
      refundedOrders: list.filter((o) => refundStatusOf(o) === 'full').length,
      partiallyRefundedOrders: list.filter((o) => refundStatusOf(o) === 'partial').length,
      refundedAmount: String(list.reduce((n, o) => n + sumSucceeded(o), 0n)),
    },
    byProduct: Object.values(byProduct),
    byChain: Object.values(byChain),
    byBuyer: Object.values(byBuyer),
  };
}

// ---------------------------------------------------------------------------
// Refund ledger — shop-owned mirror of the gateway refund state machine
// (prepared → submitted → succeeded/failed/canceled; one open refund per payment)
// ---------------------------------------------------------------------------

const refunds = new Map(); // refundId → row (orderId back-reference; RefundCallback has no metadata)

/** Buyer-safe projection: no merchant-internal reason, no stale/stuck hints. */
const publicRefund = (r) => ({
  refundId: r.refundId,
  orderId: r.orderId,
  paymentId: r.paymentId,
  amount: r.amount,
  status: r.status,
  txHash: r.txHash,
  createdAt: r.createdAt,
  succeededAt: r.succeededAt,
});

/** Seller view adds the internal note and the read-only stale/stuck hints. */
const internalRefund = (r) => ({ ...publicRefund(r), reason: r.reason, failReason: r.failReason, updatedAt: r.updatedAt });

/** Derived order-level rollup — never stored as a second source of truth.
 *  'none' | 'open' (prepared/submitted/failed holds the slot) | 'partial' | 'full'. */
function refundStatusOf(o) {
  const rows = o.refundIds.map((id) => refunds.get(id)).filter(Boolean);
  if (rows.length === 0) return 'none';
  if (rows.some((r) => r.status !== 'REFUND_STATUS_SUCCEEDED' && r.status !== 'REFUND_STATUS_CANCELED')) return 'open';
  // Partial/full only mean something once money actually went back: a lone
  // canceled refund released its quota and the order never was refunded.
  if (sumSucceeded(o) === 0n) return 'none';
  const v = o.refundView;
  if (v && BigInt(v.remainingRefundable) === 0n) return 'full';
  return 'partial';
}

const sumSucceeded = (o) =>
  o.refundIds
    .map((id) => refunds.get(id))
    .filter((r) => r && r.status === 'REFUND_STATUS_SUCCEEDED')
    .reduce((n, r) => n + BigInt(r.amount), 0n);

/** What the buyer sees on an order: the rollup + succeeded rows only. */
function publicRefundView(o) {
  if (!collected(o) && o.refundView == null) return null;
  const rows = o.refundIds.map((id) => refunds.get(id)).filter(Boolean);
  const succeeded = rows.filter((r) => r.status === 'REFUND_STATUS_SUCCEEDED').map(publicRefund);
  return {
    status: refundStatusOf(o),
    refundedAmount: o.refundView ? o.refundView.refundedAmount : String(sumSucceeded(o)),
    remainingRefundable: o.refundView?.remainingRefundable ?? null,
    refunds: succeeded,
    receiptUrl: receiptUrlOf(o),
  };
}

/** Hosted buyer receipt page (gateway step 9). The SDK does not expose receiptUrl
 *  yet, so we self-assemble it — tracked as an SDK improvement item (see
 *  docs/refund-open-questions.md). The receipt page lives on the CHECKOUT FRONT,
 *  not on the API gateway, so the base is the origin of the stored checkoutUrl. */
function receiptUrlOf(o) {
  if (!o.paymentId || !o.clientSecret || !o.checkoutUrl) return null;
  try {
    return `${new URL(o.checkoutUrl).origin}/receipt?intent_id=${o.paymentId}&client_secret=${o.clientSecret}`;
  } catch {
    return null;
  }
}

/** Mirror a getPayment refundSummary onto the order (amounts are token minor-unit strings). */
function applyRefundSummary(order, summary) {
  if (!summary) return;
  order.refundView = {
    receivedAmount: summary.receivedAmount,
    refundedAmount: summary.refundedAmount,
    remainingRefundable: summary.remainingRefundable,
    refundable: summary.refundable,
    nonRefundableReason: summary.nonRefundableReason ?? null,
    route: summary.route,
  };
  for (const r of summary.refunds ?? []) {
    if (!refunds.has(r.refundId)) recordRefundRow(order, r);
  }
}

function recordRefundRow(order, r) {
  const row = {
    refundId: r.refundId,
    orderId: order.id,
    paymentId: r.paymentId || order.paymentId,
    amount: r.amount,
    status: r.status,
    txHash: r.txHash ?? null,
    failReason: r.failReason ?? null,
    reason: r.reason ?? null,
    createdAt: msOf(r.createdAt),
    succeededAt: r.succeededAt != null ? msOf(r.succeededAt) : null,
    updatedAt: Date.now(),
  };
  refunds.set(row.refundId, row);
  if (!order.refundIds.includes(row.refundId)) order.refundIds.push(row.refundId);
  return row;
}

function markRefundSucceeded(row, txHash, succeededAt) {
  row.status = 'REFUND_STATUS_SUCCEEDED';
  if (txHash) row.txHash = txHash;
  row.succeededAt = succeededAt || Date.now();
  row.failReason = null;
  row.updatedAt = Date.now();
}

function markRefundFailed(row, failReason, failedAt) {
  row.status = 'REFUND_STATUS_FAILED';
  row.failReason = failReason || 'refund failed';
  row.updatedAt = failedAt || Date.now();
}

/** Fold a local mutation back into the cached gateway summary (best effort — the
 *  next syncOrder/getRefund reconciles any drift). */
function recomputeRefundView(order) {
  if (!order.refundView) return;
  order.refundView.refundedAmount = String(sumSucceeded(order));
  const received = BigInt(order.refundView.receivedAmount);
  const remaining = received - BigInt(order.refundView.refundedAmount);
  order.refundView.remainingRefundable = String(remaining > 0n ? remaining : 0n);
}

/** Local pre-guards: readable errors before the gateway's 1901/1902/1906. */
function refundGuard(order) {
  if (!collected(order)) return 'only a paid or shipped order can be refunded';
  if (refundStatusOf(order) === 'open') return 'another refund is already open on this order';
  const v = order.refundView;
  if (!v) return 'refund balance not synced yet — refresh the order and retry';
  if (!v.refundable) return `not refundable: ${v.nonRefundableReason || 'gateway refused'}`;
  return null;
}

/** The seller thinks in USD (the shop's price currency); the gateway speaks token
 *  minor units. Convert with the rate frozen at payment time:
 *  the buyer paid receivedAmount minor units for amountCents US cents. */
function usdToTokenMinor(order, amountUsd) {
  const usdCents = Math.round(amountUsd * 100);
  if (!Number.isFinite(amountUsd) || amountUsd <= 0 || usdCents < 1) {
    return { error: 'amount must be a positive USD amount' };
  }
  const v = order.refundView;
  const minor = (BigInt(usdCents) * BigInt(v.receivedAmount)) / BigInt(order.amountCents);
  if (minor <= 0n) return { error: 'amount is below the smallest refundable unit for this payment' };
  if (minor > BigInt(v.remainingRefundable)) return { error: 'amount exceeds the remaining refundable balance' };
  return { minor: minor.toString() };
}

/** Fold a createRefund/reissueRefundLink handoff into the local ledger.
 *  The executionUrl itself is deliberately NOT kept — it is one-time. */
function applyRefundHandoff(order, handoff, reason) {
  const row = recordRefundRow(order, { ...handoff.refund, reason: reason ?? null });
  row.status = handoff.refund.status;
  recomputeRefundView(order);
  return row;
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
  if (event.type.startsWith('refund.')) applyRefundWebhook(event);
  else applyWebhook(event);
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

/** Buyer opens a refund request — an in-shop message to the seller with a reason.
 *  No gateway involvement: the seller decides, then refunds from the admin desk. */
app.post('/api/orders/:id/refund-request', requireBuyer, (req, res) => {
  const order = orders.get(req.params.id);
  if (!order || order.buyerId !== req.buyer.id) return res.status(404).json({ error: 'order not found' });
  const reason = String(req.body?.reason ?? '').trim();
  if (reason.length < 4 || reason.length > 500) {
    return res.status(400).json({ error: 'tell the seller why (4–500 characters)' });
  }
  const guard = refundRequestGuard(order);
  if (guard) return res.status(409).json({ error: guard });
  markRefundRequested(order, reason);
  console.log(`refund requested order=${order.id} buyer=${order.buyerNickname}`);
  res.json({ order: publicOrder(order) });
});

/** Buyer withdraws their own still-open request. */
app.post('/api/orders/:id/refund-request/withdraw', requireBuyer, (req, res) => {
  const order = orders.get(req.params.id);
  if (!order || order.buyerId !== req.buyer.id) return res.status(404).json({ error: 'order not found' });
  if (!markRefundRequestDecided(order, 'withdrawn')) {
    return res.status(409).json({ error: 'no open refund request on this order' });
  }
  console.log(`refund request withdrawn order=${order.id}`);
  res.json({ order: publicOrder(order) });
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

app.post('/api/admin/orders/:id/refund', requireAdmin, async (req, res) => {
  const order = orders.get(req.params.id);
  if (!order) return res.status(404).json({ error: 'order not found' });
  await syncOrder(order); // refresh the refund summary before guarding
  const reason = String(req.body?.reason ?? '').trim() || null;
  const guard = refundGuard(order);
  if (guard) return res.status(409).json({ error: guard });
  // Amount arrives in USD (the shop's price currency); convert to token minor units.
  let amountMin = null;
  if (req.body?.amountUsd != null) {
    const { minor, error } = usdToTokenMinor(order, Number(req.body.amountUsd));
    if (error) return res.status(409).json({ error });
    amountMin = minor;
  }
  try {
    const handoff = await createRefund(order, { amountMin, reason });
    const row = applyRefundHandoff(order, handoff, reason);
    // An open buyer request that led here is now the seller's accepted request.
    markRefundRequestDecided(order, 'granted');
    console.log(`refund opened order=${order.id} refund=${row.refundId}`);
    // executionUrl is one-time (secret in the fragment) — returned, never stored.
    res.json({
      refund: internalRefund(row),
      executionUrl: handoff.executionUrl,
      executionExpiresAt: msOf(handoff.executionExpiresAt),
      order: publicOrder(order),
    });
  } catch (err) {
    console.error(`createRefund failed order=${order.id} ${gatewayError(err)}`);
    res.status(502).json({ error: err instanceof PaymentError ? err.message : 'could not open refund' });
  }
});

app.get('/api/admin/orders/:id/refunds', requireAdmin, async (req, res) => {
  const order = orders.get(req.params.id);
  if (!order) return res.status(404).json({ error: 'order not found' });
  await syncOrder(order);
  // Refresh open rows in full (getRefund carries reason + stale/stuck hints).
  for (const id of order.refundIds) {
    const row = refunds.get(id);
    if (!row || (row.status === 'REFUND_STATUS_SUCCEEDED' || row.status === 'REFUND_STATUS_CANCELED')) continue;
    try {
      const fresh = await merchant.getRefund(id);
      Object.assign(row, {
        status: fresh.status,
        txHash: fresh.txHash ?? row.txHash,
        failReason: fresh.failReason ?? null,
        updatedAt: Date.now(),
      });
    } catch (err) {
      console.warn(`getRefund failed refund=${id} ${gatewayError(err)}`);
    }
  }
  recomputeRefundView(order);
  res.json({
    refunds: order.refundIds.map((id) => refunds.get(id)).filter(Boolean).map(internalRefund),
    refundView: order.refundView,
  });
});

app.post('/api/admin/refunds/:rid/cancel', requireAdmin, async (req, res) => {
  const row = refunds.get(req.params.rid);
  if (!row) return res.status(404).json({ error: 'refund not found' });
  const order = orders.get(row.orderId);
  try {
    const fresh = await merchant.cancelRefund(row.refundId);
    row.status = fresh.status;
    row.failReason = null;
    row.updatedAt = Date.now();
    recomputeRefundView(order);
    console.log(`refund canceled order=${order.id} refund=${row.refundId}`);
    res.json({ refund: internalRefund(row), order: publicOrder(order) });
  } catch (err) {
    console.error(`cancelRefund failed refund=${row.refundId} ${gatewayError(err)}`);
    res.status(502).json({ error: err instanceof PaymentError ? err.message : 'could not cancel refund' });
  }
});

app.post('/api/admin/refunds/:rid/reissue', requireAdmin, async (req, res) => {
  const row = refunds.get(req.params.rid);
  if (!row) return res.status(404).json({ error: 'refund not found' });
  const order = orders.get(row.orderId);
  try {
    const handoff = await merchant.reissueRefundLink(row.refundId);
    row.status = handoff.refund.status;
    row.updatedAt = Date.now();
    console.log(`refund link reissued order=${order.id} refund=${row.refundId}`);
    res.json({
      refund: internalRefund(row),
      executionUrl: handoff.executionUrl,
      executionExpiresAt: msOf(handoff.executionExpiresAt),
    });
  } catch (err) {
    console.error(`reissueRefundLink failed refund=${row.refundId} ${gatewayError(err)}`);
    res.status(502).json({ error: err instanceof PaymentError ? err.message : 'could not reissue link' });
  }
});

/** Seller declines a buyer's refund request with a reason the buyer will see
 *  (in-shop decision, no gateway call). */
app.post('/api/admin/orders/:id/refund-request/dismiss', requireAdmin, (req, res) => {
  const order = orders.get(req.params.id);
  if (!order) return res.status(404).json({ error: 'order not found' });
  const note = String(req.body?.note ?? '').trim();
  if (note.length < 4 || note.length > 200) {
    return res.status(400).json({ error: 'tell the buyer why (4–200 characters)' });
  }
  if (!markRefundRequestDecided(order, 'dismissed', note)) {
    return res.status(409).json({ error: 'no open refund request on this order' });
  }
  console.log(`refund request dismissed order=${order.id}`);
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

app.listen(port, '0.0.0.0', () => {
  console.log(`           shop    ${shopPublicUrl}`);
  console.log(`          admin    ${shopPublicUrl}/admin`);
  console.log(`payment gateway    ${gatewayBaseUrl}`);
});
