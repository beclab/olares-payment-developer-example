/**
 * webhooks.constructEvent — the only way to consume a webhook.
 *
 * Verifies the signature (canonical = "{timestamp}\n{body}", HMAC-SHA256 hex,
 * constant-time compare) plus timestamp replay protection (default 5-min skew),
 * then returns a typed event. Any failure throws PaymentError (gateway codes:
 * SIGNATURE_MISMATCH / TIMESTAMP_EXPIRED / INVALID_ARGUMENT) instead of returning
 * a boolean, so callers cannot silently ignore forgeries.
 *
 * First argument is the inbound HTTP message (Express `req`, or `{ body, headers }`).
 * The SDK unpacks the raw body and signature headers internally.
 *
 * Returns the public WebhookEvent (camelCase + paymentId); the wire intent_id in
 * the payload is mapped away here.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

import { INVALID_ARGUMENT, PaymentError, SIGNATURE_MISMATCH, TIMESTAMP_EXPIRED } from './errors';
import { wireToBuyer, wireToCredential } from './mapping';
import type { ChainSlug, WebhookHeaderGetter, WebhookEvent, WebhookResponse } from '../types/base';
import type { WireRefundCallback, WireWebhookPayload } from './wire';
const DEFAULT_MAX_SKEW_MS = 5 * 60 * 1000;
const TS_HEADER = 'x-olares-payment-webhook-timestamp';
const SIG_HEADER = 'x-olares-payment-webhook-signature';

export function constructEvent(
  response: WebhookResponse,
  webhookSecret: string,
  opts?: { maxSkewMs?: number },
): WebhookEvent {
  const rawBody = readRawBody(response.body);
  const header = headerReader(response.headers);
  const tsHeader = header(TS_HEADER);
  const signature = header(SIG_HEADER);

  const ts = Number(tsHeader);
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > (opts?.maxSkewMs ?? DEFAULT_MAX_SKEW_MS)) {
    throw new PaymentError(TIMESTAMP_EXPIRED, 0, 'webhook timestamp out of allowed window');
  }

  const expected = createHmac('sha256', webhookSecret).update(`${tsHeader}\n${rawBody}`).digest('hex');
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new PaymentError(SIGNATURE_MISMATCH, 0, 'webhook signature verification failed');
  }

  let parsed: WireWebhookPayload | WireRefundCallback;
  try {
    parsed = JSON.parse(rawBody) as WireWebhookPayload | WireRefundCallback;
  } catch {
    throw new PaymentError(INVALID_ARGUMENT, 0, 'webhook payload is not valid json');
  }

  // Refund events ride a different protocol message (RefundCallback): no metadata,
  // plus refund_id and the amount/token facts. Decoding them as a PaymentCallback
  // would silently drop all of it.
  if (parsed.event_type === 'refund.succeeded' || parsed.event_type === 'refund.failed') {
    return refundEvent(parsed as WireRefundCallback);
  }

  const p = parsed as WireWebhookPayload;
  const base = {
    paymentId: p.intent_id ?? '',
    merchantAccountId: p.merchant_account_id ?? '',
    // Creation-time snapshot echoed verbatim as the unified BuyerRef (ruling 11);
    // null = anonymous order.
    buyer: wireToBuyer(p.buyer),
    metadata: p.metadata ?? {},
  };
  switch (p.event_type) {
    case 'payment.succeeded':
      return {
        type: 'payment.succeeded',
        ...base,
        credential: p.credential
          ? wireToCredential(p.credential)
          : { txHash: '', payAmount: '', payCurrency: '', chain: null, chainType: null, networkId: null },
        paidAt: p.paid_at ? new Date(p.paid_at).getTime() : 0, // RFC3339 → unix ms
      };
    case 'payment.failed':
      return { type: 'payment.failed', ...base, txHash: p.tx_hash ?? null, failReason: p.fail_reason ?? null };
    case 'payment.canceled':
      return { type: 'payment.canceled', ...base, cancellationReason: p.cancellation_reason ?? '' };
    default:
      return { type: 'endpoint.test', ...(p as Record<string, unknown>) };
  }
}

function refundEvent(r: WireRefundCallback): WebhookEvent {
  const base = {
    refundId: r.refund_id ?? '',
    paymentId: r.intent_id ?? '',
    merchantAccountId: r.merchant_account_id ?? '',
    buyer: wireToBuyer(r.buyer),
    amount: r.amount ?? '',
    tokenSymbol: r.token_symbol ?? null,
    chain: (r.chain ?? null) as ChainSlug | null,
    networkId: r.network_id ?? null,
    txHash: r.tx_hash ?? null,
    reason: r.reason ?? null,
  };
  if (r.event_type === 'refund.succeeded') {
    return { type: 'refund.succeeded', ...base, succeededAt: toUnixMs(r.succeeded_at) };
  }
  return {
    type: 'refund.failed',
    ...base,
    failReason: r.fail_reason ?? null,
    failedAt: toUnixMs(r.failed_at),
  };
}

/** RFC3339 → unix ms; absent timestamp = 0 (same convention as paidAt). */
function toUnixMs(ts: string | null | undefined): number {
  if (!ts) return 0;
  const ms = new Date(ts).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

/** Buffer is a Uint8Array; anything else means the body was parsed (express.json) and the bytes are gone. */
function readRawBody(body: WebhookResponse['body']): string {
  if (typeof body === 'string') return body;
  if (body instanceof Uint8Array) return Buffer.from(body).toString('utf8');
  throw new PaymentError(INVALID_ARGUMENT, 0, 'webhook body must be the raw string or Buffer (use express.raw)');
}

/** Reads header names case-insensitively from either a plain object or fetch-style Headers. */
function headerReader(headers: WebhookResponse['headers']): (name: string) => string {
  if (headers && typeof (headers as WebhookHeaderGetter).get === 'function') {
    const fetchHeaders = headers as WebhookHeaderGetter;
    return (name) => fetchHeaders.get(name) ?? '';
  }

  const byLowerName = new Map<string, string>();
  for (const [name, value] of Object.entries(headers ?? {})) {
    const first = Array.isArray(value) ? value[0] : value;
    if (first != null) byLowerName.set(name.toLowerCase(), String(first));
  }
  return (name) => byLowerName.get(name.toLowerCase()) ?? '';
}
