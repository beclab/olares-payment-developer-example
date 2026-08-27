/**
 * Public types — what SDK consumers see. camelCase, `paymentId`, no "intent" concept.
 *
 * These are NOT 1:1 with the gateway wire (which is snake_case + `intent_id`).
 * The wire shapes live in core/wire.ts (internal); core/mapping.ts translates
 * between the two at the SDK boundary. Enum *values* still mirror the gateway
 * (e.g. status 'succeeded', chain 'optimism') since those are protocol-level.
 */

// ---------- Response envelope ----------

export interface ApiEnvelope<T> {
  code: number;
  message?: string;
  payload?: T;
}

/** Gateway timestamp: RFC3339 string (proto Timestamp → ToJsonInterceptor). */
export type Timestamp = string;

// ---------- SDK config & logging ----------

export type SdkLogLevel = 'info' | 'warn' | 'error';
export type SdkLogger = (level: SdkLogLevel, msg: string, ctx?: Record<string, unknown>) => void;

export const defaultLogger: SdkLogger = (level, msg, ctx) => {
  const line = ctx && Object.keys(ctx).length ? `${msg} ${JSON.stringify(ctx)}` : msg;
  if (level === 'error') console.error('[PaymentSDK]', line);
  else if (level === 'warn') console.warn('[PaymentSDK]', line);
  else console.log('[PaymentSDK]', line);
};

/** Local dev gateway address. TODO: replace with the production domain once live. */
export const DEFAULT_BASE_URL = 'http://localhost:31000';

/** Default request timeout (ms) for gateway calls and RPC verification. */
export const DEFAULT_TIMEOUT_MS = 30_000;

/** Options for constructing any client (PlatformClient / MerchantClient / PaymentSDK). */
export interface ClientOptions {
  /** Optional since the keyless catalog-order methods (createOrderFromCatalog /
   *  getPayment with clientSecret) need no key; HMAC methods throw without one. */
  apiKey?: string;
  apiSecret?: string;
  /** Gateway base URL, defaults to DEFAULT_BASE_URL. */
  baseUrl?: string;
  /** Logger: defaults to console; pass () => {} to silence. */
  logger?: SdkLogger;
  /** Request timeout in ms (default 30000); covers fetch + body read. */
  timeoutMs?: number;
  /** Optional EVM RPC URL; if set, verifyTransaction queries RPC directly
   *  instead of going through the gateway's /api/verifyTx (EVM only). */
  rpcUrl?: string;
}

// ---------- Enums (literal unions; values mirror the gateway proto) ----------

/** Payment state machine (proto enum PaymentStatus; ToJsonInterceptor serializes the name). */
export type PaymentStatus =
  | 'PAYMENT_STATUS_UNSPECIFIED'
  | 'PAYMENT_STATUS_REQUIRES_PAYMENT_METHOD'
  | 'PAYMENT_STATUS_PROCESSING'
  | 'PAYMENT_STATUS_SUCCEEDED'
  | 'PAYMENT_STATUS_CANCELED';

/** Attempt status (proto enum AttemptStatus). */
export type AttemptStatus =
  | 'ATTEMPT_STATUS_UNSPECIFIED'
  | 'ATTEMPT_STATUS_PENDING'
  | 'ATTEMPT_STATUS_SUCCEEDED'
  | 'ATTEMPT_STATUS_FAILED';

/** Payment channel (proto enum Channel; stripe 已下线删除,仅存 onchain). */
export type Channel =
  | 'CHANNEL_UNSPECIFIED'
  | 'CHANNEL_ONCHAIN';

/** Chain identity slug (gateway onchain_networks seed; stays lowercase string). */
export type ChainSlug = 'ethereum' | 'optimism' | 'base' | 'bsc' | 'bitcoin';

/** Chain network: mainnet or testnet (for verifyTransaction via gateway). */
export type Network = 'mainnet' | 'testnet';

/** Chain account model (proto enum ChainType). */
export type ChainType =
  | 'CHAIN_TYPE_UNSPECIFIED'
  | 'CHAIN_TYPE_EVM'
  | 'CHAIN_TYPE_SOLANA'
  | 'CHAIN_TYPE_UTXO';

/** Pricing currency (gateway whitelist, core/currency.go). */
export type Currency = 'usd';

export type Direction = 'in' | 'out';

/** On-chain outcome; guards against treating a reverted tx as paid. */
export type ReceiveWalletTxStatus = 'success' | 'failed';

export type WebhookEventType = 'payment.succeeded' | 'payment.failed' | 'payment.canceled' | 'endpoint.test';

// ---------- Resources (read) ----------

/** Payment credential; the webhook fast lane and the getPayment query leg share this exact shape.
 *  Chain fields are null for non-onchain channels (e.g. card). */
export interface PaymentCredential {
  txHash: string;
  payAmount: string;
  payCurrency: string;
  chain: ChainSlug | null;
  chainType: ChainType | null;
  /** EVM only; null for BTC. */
  networkId: number | null;
}

/** Latest attempt summary; credential fields are populated for succeeded onchain attempts. */
export interface LatestAttempt {
  status: AttemptStatus;
  txHash: string | null;
  failReason: string | null;
  payAmount: string | null;
  payCurrency: string | null;
  chain: ChainSlug | null;
  chainType: ChainType | null;
  networkId: number | null;
}

/**
 * Product snapshot frozen at order creation (catalog orders only; null for plain
 * SDK-created payments). Later price/catalog changes never rewrite it.
 */
export interface ProductSnapshot {
  productId: string;
  title: string | null;
  version: string | null;
  type: string | null;
  priceCents: number | null;
  currency: string | null;
  developer: string | null;
  status: string | null;
  resolvedAt: Timestamp | null;
}

/** A payment. The SDK's central object — no "intent" terminology leaks here. */
export interface Payment {
  paymentId: string;
  merchantAccountId: string;
  /** Buyer identity snapshot written at creation; unaffected by later re-binding. */
  buyerOlaresId: string;
  amountCents: number;
  currency: Currency;
  settlementCurrency: string | null;
  settlementAmount: number | null;
  status: PaymentStatus;
  /** Catalog terms frozen at order creation; null for payments without a catalog order. */
  product: ProductSnapshot | null;
  metadata: Record<string, unknown>;
  /** Plaintext (Stripe-style client_secret); not backfilled in listPayments items. */
  clientSecret: string | null;
  latestAttempt: LatestAttempt | null;
  expiresAt: Timestamp | null;
  canceledAt: Timestamp | null;
  paidAt: Timestamp | null;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

/**
 * getPayment result (discriminated union):
 * paid: true carries the credential (fulfillment basis); paid: false means unpaid
 * or anomalous data — never fulfill, read status from payment.status.
 */
export type PaymentResult =
  | { paid: true; payment: Payment; credential: PaymentCredential }
  | { paid: false; payment: Payment };

/** /api/getAccount response (merchant key reads itself only). */
export interface AccountInfo {
  accountId: string;
  did: string | null;
  olaresId: string | null;
  status: string;
}

/** Result of verifyTransaction (EVM receipt normalized; direct RPC is EVM only). */
export interface TxVerification {
  txHash: string;
  /** receipt exists AND status = success. */
  confirmed: boolean;
  blockNumber: number | null;
  /** success/failed from receipt status; null = pending/not on-chain yet. */
  status: 'success' | 'failed' | null;
  /** Raw receipt passthrough (debug/extension). */
  raw?: unknown;
}

/** /api/ping response — server time for clock-sync / liveness check. */
export interface PingResult {
  /** Server standard time (RFC3339). */
  serverTime: Timestamp;
}

/** Key type (proto enum ApiClientType). */
export type KeyType = 'API_CLIENT_TYPE_PLATFORM' | 'API_CLIENT_TYPE_MERCHANT';

/** /api/clientInfo response — caller identity (works for both platform & merchant keys). */
export interface ClientInfoResult {
  /** Key category: API_CLIENT_TYPE_PLATFORM or API_CLIENT_TYPE_MERCHANT. */
  keyType: KeyType;
  /** Account the key is bound to (platform account, or merchant's own); null if unbound. */
  accountId: string | null;
  did: string | null;
  olaresId: string | null;
}

// ---------- Requests (write) & responses ----------

/** createPayment request. merchantAccountId: required for platform; omitted for merchant (inferred from key). */
export interface CreatePaymentRequest {
  merchantAccountId?: string;
  /** Omit for an anonymous order: the gateway then skips the DID gate and the customer closure. */
  buyerOlaresId?: string;
  /** Trusted DID from the platform's scan-login session; back-fills identities.did. Requires buyerOlaresId. */
  buyerDid?: string;
  amountCents: number;
  currency?: Currency;
  metadata?: Record<string, unknown>;
  /** Post-payment redirect target; optional absolute http(s) URL (any host). Omitted = no redirect after payment. */
  returnUrl?: string;
}

/** createPayment one-step result (checkout URL composed by the gateway). */
export interface CreatePaymentResult {
  paymentId: string;
  checkoutUrl: string;
}

/** createOrderFromCatalog request (keyless, public endpoint): no price fields, no
 *  account — the gateway resolves amount/currency from the catalog authority and
 *  derives the seller account from the catalog entry's developer. */
export interface CreateOrderFromCatalogRequest {
  productId: string;
  buyerOlaresId: string;
  buyerDid?: string;
  returnUrl?: string;
}

/** listPayments request (all optional; keyset pagination, fixed created_at DESC). */
export interface ListPaymentsRequest {
  status?: PaymentStatus;
  /** JSONB containment match (metadata @> filter). */
  metadata?: Record<string, unknown>;
  /** nextCursor from the previous page. */
  cursor?: string;
  /** Default 20, max 200. */
  limit?: number;
}

export interface ListPaymentsResponse {
  items: Payment[];
  hasMore: boolean;
  nextCursor?: string;
}

// ---------- Webhook ----------

/** The two signature headers constructEvent reads from `response.headers`. */
export interface WebhookHeaders {
  'x-olares-payment-webhook-timestamp': string;
  'x-olares-payment-webhook-signature': string;
}

/** Fetch-style headers (`Request.headers`), the other shape constructEvent accepts. */
export interface WebhookHeaderGetter {
  get(name: string): string | null | undefined;
}

/**
 * Inbound HTTP message for `webhooks.constructEvent`.
 * Express `req` (after `express.raw`) is structurally compatible; otherwise pass
 * `{ body, headers }` and the SDK unpacks timestamp / signature / raw body.
 */
export interface WebhookResponse {
  /** Raw body — string or Buffer; must not have been JSON.parsed. */
  body: string | Buffer | Uint8Array;
  headers: WebhookHeaders | WebhookHeaderGetter | Record<string, string | string[] | undefined>;
}

/** Typed webhook event (discriminated by type). */
export type WebhookEvent =
  | {
      type: 'payment.succeeded';
      paymentId: string;
      merchantAccountId: string;
      buyerOlaresId: string;
      metadata: Record<string, unknown>;
      credential: PaymentCredential;
      /** unix ms */
      paidAt: number;
    }
  | {
      type: 'payment.failed';
      paymentId: string;
      merchantAccountId: string;
      buyerOlaresId: string;
      metadata: Record<string, unknown>;
      txHash: string | null;
      failReason: string | null;
    }
  | {
      type: 'payment.canceled';
      paymentId: string;
      merchantAccountId: string;
      buyerOlaresId: string;
      metadata: Record<string, unknown>;
      cancellationReason: string;
    }
  | { type: 'endpoint.test'; [key: string]: unknown };
