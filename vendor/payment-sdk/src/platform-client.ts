/**
 * PlatformClient — for the marketplace (platform-level key).
 *
 * Scope: connected sub-accounts (active connection).
 *   - createOrderFromCatalog: KEYLESS catalog-order create (public endpoint; the
 *     gateway resolves price centrally) — a client constructed without apiKey/apiSecret
 *     can use this plus the clientSecret variant of getPayment
 *   - createPayment: collect on behalf of a sub-account (merchantAccountId required),
 *     returns the checkout URL in one step
 *   - getPayment: query + fulfillment judgment (paid only when succeeded AND txHash present)
 *   - ping: public health check (server time, no auth required)
 *   - clientInfo: caller identity check (key type + account, requires auth)
 *   - verifyTransaction: self-verify an on-chain tx (direct RPC if rpcUrl set, else gateway)
 * Reconciliation: query each locally stored paymentId — no platform list method on purpose.
 *
 * Webhook management, channels and wallet data are deliberately absent:
 * they are the merchant's financial data and the gateway rejects platform keys there.
 *
 * The public surface is camelCase + paymentId; the wire (intent_id) is mapped away in core/.
 */
import { PaymentSDK } from './core/client';
import { verifyViaRpc } from './core/verify';
import { INVALID_ARGUMENT, PaymentError } from './core/errors';
import {
  createOrderFromCatalogRequestToWire,
  createPaymentRequestToWire,
  paymentIdToWire,
  receiptToVerification,
  toPaymentResult,
  verifyTxReceiptFromWire,
  verifyTxRequestToWire,
  wireToClientInfoResult,
  wireToCreateResult,
  wireToPingResult,
} from './core/mapping';
import type { WireClientInfoResult, WireCreateResponse, WirePayment, WirePingResult, WireVerifyTxResponse } from './core/wire';
import type {
  BuyerRef,
  ChainSlug,
  ClientInfoResult,
  ClientOptions,
  CreatePaymentResult,
  Network,
  PaymentResult,
  PingResult,
  PlatformCreatePaymentRequest,
  TxVerification,
} from './types/base';
import { DEFAULT_TIMEOUT_MS } from './types/base';

export class PlatformClient {
  private readonly sdk: PaymentSDK;
  private readonly rpcUrl?: string;
  private readonly timeoutMs: number;

  constructor(opts: ClientOptions) {
    this.sdk = new PaymentSDK(opts);
    this.rpcUrl = opts.rpcUrl;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /** Collect on behalf of a connected sub-account (merchantAccountId = the sub-account,
   *  required for platform keys). Buyer is a BuyerRef tier — omitted = anonymous order.
   *  opts.idempotencyKey: derive from your business identity (e.g. `purchase:{purchaseId}`)
   *  and reuse on retries — a hit returns the first result; same key with a different
   *  body is rejected with 400. The SDK never generates a key. */
  async createPayment(
    p: PlatformCreatePaymentRequest,
    opts?: { idempotencyKey?: string },
  ): Promise<CreatePaymentResult> {
    const w = await this.sdk.call<WireCreateResponse>('createPayment', createPaymentRequestToWire(p), opts);
    return wireToCreateResult(w);
  }

  /** Create an order from the catalog authority (KEYLESS, public endpoint): no price
   *  fields, no account — the gateway resolves amount/currency centrally and derives
   *  the seller account from the catalog entry's developer.
   *  buyer must be the olares tier ({ kind: 'olares', olaresId, did }) — catalog
   *  orders keep VC eligibility, other tiers are rejected here and by the gateway.
   *  opts.returnUrl: post-payment redirect; opts.idempotencyKey: same semantics as createPayment. */
  async createOrderFromCatalog(
    productId: string,
    buyer: BuyerRef,
    opts?: { returnUrl?: string; idempotencyKey?: string },
  ): Promise<CreatePaymentResult> {
    if (buyer.kind !== 'olares') {
      throw new PaymentError(INVALID_ARGUMENT, 0, 'catalog orders require an olares-tier buyer (kind=olares, olaresId + did)');
    }
    const { returnUrl, idempotencyKey } = opts ?? {};
    const w = await this.sdk.callUnsigned<WireCreateResponse>(
      'createOrderFromCatalog',
      createOrderFromCatalogRequestToWire(productId, buyer, returnUrl),
      { idempotencyKey },
    );
    return wireToCreateResult(w);
  }

  /** Query + fulfillment judgment (the active-query leg; source of truth).
   *  Unpaid returns { paid: false } — never throws for that.
   *  opts.clientSecret: keyless read — client_secret as the bearer credential
   *  (unsigned call, pairing-checked by the gateway). Omit for the HMAC path. */
  async getPayment(paymentId: string, opts?: { clientSecret?: string }): Promise<PaymentResult> {
    const w = opts?.clientSecret != null
      ? await this.sdk.callUnsigned<WirePayment>('getPayment', paymentIdToWire(paymentId, opts.clientSecret))
      : await this.sdk.call<WirePayment>('getPayment', paymentIdToWire(paymentId));
    return toPaymentResult(w);
  }

  /** Public health check (no HMAC auth required). Returns server time for clock-sync. */
  async ping(): Promise<PingResult> {
    const w = await this.sdk.call<WirePingResult>('ping', {});
    return wireToPingResult(w);
  }

  /** Caller identity check (requires HMAC auth). Returns key-bound account info. */
  async clientInfo(): Promise<ClientInfoResult> {
    const w = await this.sdk.call<WireClientInfoResult>('clientInfo', {});
    return wireToClientInfoResult(w);
  }

  /** Self-verify an on-chain tx.
   *  Direct EVM RPC if rpcUrl is configured; otherwise gateway passthrough (/api/verifyTx). */
  async verifyTransaction(txHash: string, chain?: ChainSlug, network?: Network): Promise<TxVerification> {
    if (this.rpcUrl) {
      return verifyViaRpc(txHash, this.rpcUrl, this.timeoutMs);
    }
    const w = await this.sdk.call<WireVerifyTxResponse>('verifyTx', verifyTxRequestToWire(txHash, chain, network));
    return receiptToVerification(txHash, verifyTxReceiptFromWire(w));
  }
}
