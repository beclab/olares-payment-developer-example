/**
 * Olares Payment SDK — barrel entry.
 *
 * Two type layers:
 *   - types/ (public, camelCase + paymentId; no "intent" concept exposed)
 *   - core/wire.ts (internal, snake_case + intent_id; mirrors the gateway, never exported)
 * core/mapping.ts translates between them at the SDK boundary, so the gateway can keep
 * its naming without leaking "PaymentIntent" terminology to SDK consumers.
 *
 * Layout:
 *   index.ts / platform-client.ts / merchant-client.ts  — the public surface
 *   core/      client (HMAC transport) / wire / mapping / errors / result / webhook
 *   types/     public types: base (shared) / platform / merchant
 */

// ---------- Types ----------
export * from './types/base';
export * from './types/platform';
export * from './types/merchant';

// ---------- Clients ----------
export { PaymentSDK } from './core/client';
export { PlatformClient } from './platform-client';
export { MerchantClient } from './merchant-client';

// ---------- Errors ----------
export * from './core/errors';

// ---------- Webhook verification ----------
export { constructEvent } from './core/webhook';
import { constructEvent } from './core/webhook';

/** sdk.webhooks.constructEvent — the only way to consume a webhook. */
export const webhooks = { constructEvent };

// ---------- Default export (back-compat: default = PaymentSDK) ----------
export { default } from './core/client';
