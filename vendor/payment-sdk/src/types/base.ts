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

/** Production gateway (hardcoded default). Override via ClientOptions.baseUrl for
 *  test environments or self-hosted deployments (local dev: http://localhost:31000). */
export const DEFAULT_BASE_URL = 'https://www.olares.com/payment';

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

export type WebhookEventType =
  | 'payment.succeeded'
  | 'payment.failed'
  | 'payment.canceled'
  | 'refund.succeeded'
  | 'refund.failed'
  | 'endpoint.test';

// ---------- Buyer identity (three disclosure tiers) ----------

/**
 * Buyer reference — a discriminated union over the gateway's disclosure tiers.
 *
 * - 'olares': verifiable Olares identity (name + did, both required). Runs the DID
 *   gate, closes a customer account, keeps VC eligibility.
 * - 'external': opaque caller-side label. No identity, no account, no VC — the
 *   snapshot (ref + optional display) lands on the intent for merchant reconciliation.
 * - omitted: fully anonymous order.
 *
 * The tiers are mutually exclusive at the type level AND fail-closed on the
 * gateway (half disclosure or mixing → 1100).
 */
export type BuyerRef =
  | { kind: 'olares'; olaresId: string; did: string }
  | {
      kind: 'external';
      /** Caller-internal user id (reconciliation key). 1..128 chars. */
      ref: string;
      /** Voluntary UI disclosure for the merchant dashboard (format-checked only, never verified). */
      display?: { name?: string; avatarUrl?: string };
    };

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

/** Refund state machine (proto enum RefundStatus; ToJsonInterceptor serializes the name). */
export type RefundStatus =
  | 'REFUND_STATUS_UNSPECIFIED'
  | 'REFUND_STATUS_PREPARED'
  | 'REFUND_STATUS_SUBMITTED'
  | 'REFUND_STATUS_SUCCEEDED'
  | 'REFUND_STATUS_FAILED'
  | 'REFUND_STATUS_CANCELED';

/** One refund. Quota is held from PREPARED onward and released only by CANCELED;
 *  FAILED keeps holding it so the refund can be re-signed and retried. */
export interface Refund {
  /** re_xxx; also the OLRP-RFD marker payload carried by the on-chain transfer. */
  refundId: string;
  paymentId: string;
  status: RefundStatus;
  /** Token minor units (the payment's original chain and token). */
  amount: string;
  txHash: string | null;
  failReason: string | null;
  /** Merchant-internal note. Non-null only on getRefund / createRefund responses;
   *  PaymentRefundSummary entries are the buyer-safe audience and always null here. */
  reason: string | null;
  /** Read-only hint: the draft has been holding quota for too long. */
  preparedStale: boolean;
  /** Read-only hint: submitted but still without on-chain evidence. */
  stuck: boolean;
  createdAt: Timestamp | null;
  submittedAt: Timestamp | null;
  succeededAt: Timestamp | null;
  failedAt: Timestamp | null;
  canceledAt: Timestamp | null;
}

/** The money route frozen at the original payment; every refund on an order shares it. */
export interface RefundRoute {
  chain: ChainSlug;
  /** EVM only. */
  networkId: number | null;
  tokenSymbol: string;
  /** Required to format the minor-unit amounts; null for unregistered tokens. */
  tokenDecimals: number | null;
  contractAddress: string | null;
  /** The original receive wallet the refund is sent from. */
  fromWallet: string;
  /** The original payer address the refund is sent to. */
  toPayer: string;
  /** Frozen route self-consistency (payer == tx_from); not a live EOA check. */
  payerRouteVerified: boolean;
}

/** Why the order cannot be refunded right now (closed set).
 *  payer_contract is a create-time block only (surfaces as 1905), never a read view. */
export type NonRefundableReason =
  | 'payment_not_succeeded'
  | 'channel_unsupported'
  | 'route_unavailable'
  | 'route_inconsistent'
  | 'nothing_left'
  | 'refund_already_open';

/**
 * Order refund ledger. Non-null only on getPayment and only for succeeded orders;
 * listPayments items always carry null.
 *
 * refunds[] is the buyer-safe audience: succeeded entries only, with reason /
 * preparedStale / stuck withheld. Use MerchantClient.getRefund for the full row.
 */
export interface PaymentRefundSummary {
  /** Amount actually received on-chain (minor units). */
  receivedAmount: string;
  /** Sum of succeeded refunds (minor units). */
  refundedAmount: string;
  /** receivedAmount − refundedAmount (minor units). */
  remainingRefundable: string;
  /** Whether a new refund can be created right now. */
  refundable: boolean;
  nonRefundableReason: NonRefundableReason | null;
  /** Null for legacy or non-refundable orders. */
  route: RefundRoute | null;
  refunds: Refund[];
}

/** A payment. The SDK's central object — no "intent" terminology leaks here. */
export interface Payment {
  paymentId: string;
  merchantAccountId: string;
  /**
   * Buyer snapshot from the intent's creation-time Party object (ruling 11 —
   * what was sent is what comes back, never re-derived from live identity rows):
   * olares tier → { kind: 'olares', olaresId, did }; external tier → { kind: 'external' }
   * (incl. legacy name-only orders, folded by the gateway); nothing → null (anonymous).
   */
  buyer: BuyerRef | null;
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
  /** Refund ledger; getPayment on a succeeded order only, null everywhere else. */
  refundSummary: PaymentRefundSummary | null;
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

/**
 * createPayment request. Buyer is optional (omitted = anonymous order); when present
 * pick one disclosure tier via the BuyerRef discriminant. merchantAccountId lives on
 * PlatformCreatePaymentRequest only (platform keys) — merchant keys infer from the key.
 */
export interface CreatePaymentRequest {
  buyer?: BuyerRef;
  amountCents: number;
  currency?: Currency;
  metadata?: Record<string, unknown>;
  /** Post-payment redirect target; optional absolute http(s) URL (any host). Omitted = no redirect after payment. */
  returnUrl?: string;
}

/** createPayment for platform keys: the sub-account to collect on behalf of is required. */
export type PlatformCreatePaymentRequest = CreatePaymentRequest & { merchantAccountId: string };

/** createPayment one-step result (checkout URL composed by the gateway). */
export interface CreatePaymentResult {
  paymentId: string;
  checkoutUrl: string;
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

/**
 * Typed webhook event (discriminated by type). buyer echoes the intent's
 * creation-time snapshot as the unified BuyerRef (null = anonymous order).
 *
 * The refund variants carry no metadata — the gateway's refund callback protocol
 * has no such field. Correlate a refund event to your own records via paymentId.
 */
export type WebhookEvent =
  | {
      type: 'payment.succeeded';
      paymentId: string;
      merchantAccountId: string;
      buyer: BuyerRef | null;
      metadata: Record<string, unknown>;
      credential: PaymentCredential;
      /** unix ms */
      paidAt: number;
    }
  | {
      type: 'payment.failed';
      paymentId: string;
      merchantAccountId: string;
      buyer: BuyerRef | null;
      metadata: Record<string, unknown>;
      txHash: string | null;
      failReason: string | null;
    }
  | {
      type: 'payment.canceled';
      paymentId: string;
      merchantAccountId: string;
      buyer: BuyerRef | null;
      metadata: Record<string, unknown>;
      cancellationReason: string;
    }
  | {
      type: 'refund.succeeded';
      refundId: string;
      paymentId: string;
      merchantAccountId: string;
      buyer: BuyerRef | null;
      /** Token minor units, on the payment's original chain and token. */
      amount: string;
      tokenSymbol: string | null;
      chain: ChainSlug | null;
      networkId: number | null;
      txHash: string | null;
      /** Merchant-internal note; never disclosed to the buyer. */
      reason: string | null;
      /** unix ms */
      succeededAt: number;
    }
  | {
      type: 'refund.failed';
      refundId: string;
      paymentId: string;
      merchantAccountId: string;
      buyer: BuyerRef | null;
      amount: string;
      tokenSymbol: string | null;
      chain: ChainSlug | null;
      networkId: number | null;
      txHash: string | null;
      reason: string | null;
      failReason: string | null;
      /** unix ms */
      failedAt: number;
    }
  | { type: 'endpoint.test'; [key: string]: unknown };
