/**
 * MerchantClient — for the seller backend (merchant-level key).
 *
 * Every method is scoped to the key's own account:
 *   - createPayment: self-service collection (merchantAccountId omitted, inferred from key)
 *   - getPayment: query + fulfillment judgment
 *   - listPayments: order list / reconciliation (card-channel history lives here too)
 *   - listChannels: receiving channels + onchain receive wallets
 *   - listReceiveWalletTransactions: on-chain transactions (the main treasury view)
 *   - me: read own account (Setup-page connectivity self-check)
 *   - ping: public health check (server time, no auth required)
 *   - clientInfo: caller identity check (key type + account, requires auth)
 *   - verifyTransaction: self-verify an on-chain tx (direct RPC if rpcUrl set, else gateway)
 * Webhook endpoints are registered in the dashboard; the SDK only verifies and parses them
 * (webhooks.constructEvent).
 *
 * Full camelCase + paymentId surface; the wire (intent_id) is mapped away in core/.
 */
import { PaymentSDK } from './core/client';
import { verifyViaRpc } from './core/verify';
import {
  createPaymentRequestToWire,
  listPaymentsRequestToWire,
  listReceiveWalletTransactionsRequestToWire,
  paymentIdToWire,
  receiptToVerification,
  toPaymentResult,
  upsertOnchainPmcRequestToWire,
  verifyTxReceiptFromWire,
  verifyTxRequestToWire,
  wireToAccountInfo,
  wireToClientInfoResult,
  wireToCreateResult,
  wireToListChannels,
  wireToListPaymentMethodConfigs,
  wireToListPaymentsResponse,
  wireToListReceiveWalletTransactions,
  wireToListSupportedChains,
  wireToPingResult,
} from './core/mapping';
import type {
  WireAccountInfo,
  WireClientInfoResult,
  WireCreateResponse,
  WireListChannelsResponse,
  WireListPaymentMethodConfigsResponse,
  WireListPaymentsResponse,
  WireListReceiveWalletTransactionsResponse,
  WireListSupportedChainsResponse,
  WirePayment,
  WirePingResult,
  WireVerifyTxResponse,
} from './core/wire';
import type {
  AccountInfo,
  ChainSlug,
  ClientInfoResult,
  ClientOptions,
  CreatePaymentRequest,
  CreatePaymentResult,
  ListPaymentsRequest,
  ListPaymentsResponse,
  Network,
  PaymentResult,
  PingResult,
  TxVerification,
} from './types/base';
import { DEFAULT_TIMEOUT_MS } from './types/base';
import type {
  ListChannelsResponse,
  ListPaymentMethodConfigsResponse,
  ListReceiveWalletTransactionsRequest,
  ListReceiveWalletTransactionsResponse,
  ListSupportedChainsResponse,
  UpsertOnchainPmcRequest,
} from './types/merchant';

export class MerchantClient {
  private readonly sdk: PaymentSDK;
  private readonly rpcUrl?: string;
  private readonly timeoutMs: number;

  constructor(opts: ClientOptions) {
    this.sdk = new PaymentSDK(opts);
    this.rpcUrl = opts.rpcUrl;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /** Create a payment for yourself. The type carries no merchantAccountId — the
   *  gateway infers it from the key (a platform-style sub-account field is not
   *  part of the merchant surface). Buyer is a BuyerRef tier; omitted = anonymous.
   *  Idempotency semantics: see PlatformClient.createPayment. */
  async createPayment(
    p: CreatePaymentRequest,
    opts?: { idempotencyKey?: string },
  ): Promise<CreatePaymentResult> {
    const w = await this.sdk.call<WireCreateResponse>('createPayment', createPaymentRequestToWire(p), opts);
    return wireToCreateResult(w);
  }

  /** Query + fulfillment judgment (pre-issuance check; the fallback leg carries txHash too). */
  async getPayment(paymentId: string): Promise<PaymentResult> {
    const w = await this.sdk.call<WirePayment>('getPayment', paymentIdToWire(paymentId));
    return toPaymentResult(w);
  }

  /** Order list / reconciliation (keyset pagination; card-channel history included). */
  async listPayments(params: ListPaymentsRequest = {}): Promise<ListPaymentsResponse> {
    const w = await this.sdk.call<WireListPaymentsResponse>('listPayments', listPaymentsRequestToWire(params));
    return wireToListPaymentsResponse(w);
  }

  /** Receiving channels; the onchain channel embeds wallets (card channels have none). */
  async listChannels(): Promise<ListChannelsResponse> {
    const w = await this.sdk.call<WireListChannelsResponse>('listChannels', {});
    return wireToListChannels(w);
  }

  /** Receive wallet transactions (keyset pagination); addresses come from listChannels. */
  async listReceiveWalletTransactions(
    params: ListReceiveWalletTransactionsRequest = {},
  ): Promise<ListReceiveWalletTransactionsResponse> {
    const w = await this.sdk.call<WireListReceiveWalletTransactionsResponse>(
      'listReceiveWalletTransactions',
      listReceiveWalletTransactionsRequestToWire(params),
    );
    return wireToListReceiveWalletTransactions(w);
  }

  /** Read your own account (inferred from the key by the gateway). */
  async getAccount(): Promise<AccountInfo> {
    const w = await this.sdk.call<WireAccountInfo>('getAccount', {});
    return wireToAccountInfo(w);
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

  /** List payment method configs (receive wallet setup) for the current account. */
  async listPaymentMethodConfigs(): Promise<ListPaymentMethodConfigsResponse> {
    const w = await this.sdk.call<WireListPaymentMethodConfigsResponse>('listPaymentMethodConfigs', {});
    return wireToListPaymentMethodConfigs(w);
  }

  /** Configure onchain receive wallets (chain + address + tokens). */
  async upsertOnchainPmc(params: UpsertOnchainPmcRequest): Promise<ListPaymentMethodConfigsResponse> {
    const w = await this.sdk.call<WireListPaymentMethodConfigsResponse>('upsertOnchainPmc', upsertOnchainPmcRequestToWire(params));
    return wireToListPaymentMethodConfigs(w);
  }

  /** List supported chains with their enabled tokens (official, read-only). */
  async listSupportedChains(): Promise<ListSupportedChainsResponse> {
    const w = await this.sdk.call<WireListSupportedChainsResponse>('listSupportedChains', {});
    return wireToListSupportedChains(w);
  }
}
