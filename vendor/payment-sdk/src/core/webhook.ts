/**
 * webhooks.constructEvent — the only way to consume a webhook.
 *
 * Verifies the signature (canonical = "{timestamp}\n{body}", HMAC-SHA256 hex,
 * constant-time compare) plus timestamp replay protection (default 5-min skew),
 * then returns a typed event. Any failure throws PaymentError (gateway codes:
 * SIGNATURE_MISMATCH / TIMESTAMP_EXPIRED / INVALID_ARGUMENT) instead of returning
 * a boolean, so callers cannot silently ignore forgeries.
 *
 * Returns the public WebhookEvent (camelCase + paymentId); the wire intent_id in
 * the payload is mapped away here.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

import { INVALID_ARGUMENT, PaymentError, SIGNATURE_MISMATCH, TIMESTAMP_EXPIRED } from './errors';
import { wireToCredential } from './mapping';
import type { WebhookEvent, WebhookHeaders } from '../types/base';
import type { WireWebhookPayload } from './wire';

const DEFAULT_MAX_SKEW_MS = 5 * 60 * 1000;

export function constructEvent(
  rawBody: string,
  headers: WebhookHeaders,
  webhookSecret: string,
  opts?: { maxSkewMs?: number },
): WebhookEvent {
  const tsHeader = headers['x-olares-webhook-timestamp'];
  const ts = Number(tsHeader);
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > (opts?.maxSkewMs ?? DEFAULT_MAX_SKEW_MS)) {
    throw new PaymentError(TIMESTAMP_EXPIRED, 0, 'webhook timestamp out of allowed window');
  }

  const expected = createHmac('sha256', webhookSecret).update(`${tsHeader}\n${rawBody}`).digest('hex');
  const a = Buffer.from(headers['x-olares-webhook-signature'] ?? '');
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new PaymentError(SIGNATURE_MISMATCH, 0, 'webhook signature verification failed');
  }

  let p: WireWebhookPayload;
  try {
    p = JSON.parse(rawBody) as WireWebhookPayload;
  } catch {
    throw new PaymentError(INVALID_ARGUMENT, 0, 'webhook payload is not valid json');
  }

  const base = {
    paymentId: p.intent_id ?? '',
    merchantAccountId: p.merchant_account_id ?? '',
    buyerOlaresId: p.buyer_olares_id ?? '',
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
