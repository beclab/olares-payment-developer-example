/**
 * Mapping layer — the only place wire (snake_case + intent_id) meets the public
 * surface (camelCase + paymentId). Everything crosses this boundary here, so the
 * gateway can keep its naming and users never see "intent".
 *
 * Wire shapes are the proto SSOT *Json types (core/wire.ts aliases). Proto optional
 * fields arrive as absent keys, so public `| null` fields are normalized with `?? null`.
 */
import type {
  CreateOrderFromCatalogReqJson,
  CreatePaymentReqJson,
  GetPaymentReqJson,
  ListPaymentsReqJson,
  ListReceiveWalletTransactionsReqJson,
  VerifyTxReqJson,
  VerifyTxResponseJson,
} from '@olares/payment-proto';
import type {
  AccountInfo,
  AttemptStatus,
  BuyerRef,
  ChainSlug,
  ChainType,
  ClientInfoResult,
  CreatePaymentRequest,
  CreatePaymentResult,
  LatestAttempt,
  ListPaymentsRequest,
  ListPaymentsResponse,
  Payment,
  PaymentCredential,
  PaymentResult,
  PaymentStatus,
  PingResult,
  TxVerification,
} from '../types/base';
import type {
  ChannelInfo,
  ReceiveWallet,
  ListChannelsResponse,
  ListReceiveWalletTransactionsRequest,
  ListReceiveWalletTransactionsResponse,
  ReceiveWalletTransactionItem,
  ListSupportedChainsResponse,
  SupportedChain,
  SupportedToken,
  ListPaymentMethodConfigsResponse,
  PaymentMethodConfig,
  UpsertOnchainPmcRequest,
} from '../types/merchant';
import type {
  EvmReceipt,
  WireAccountInfo,
  WireChannelInfo,
  WireClientInfoResult,
  WireCreateResponse,
  WireLatestAttempt,
  WireListChannelsResponse,
  WireListPaymentsResponse,
  WireListReceiveWalletTransactionsResponse,
  WireListSupportedChainsResponse,
  WireListPaymentMethodConfigsResponse,
  WireUpsertOnchainPmcRequest,
  WireParty,
  WirePayment,
  WirePingResult,
  WireReceiveWallet,
  WireReceiveWalletTransactionItem,
  WireWebhookCredential,
} from './wire';

function toLatestAttempt(w: WireLatestAttempt): LatestAttempt {
  return {
    status: (w.status ?? 'ATTEMPT_STATUS_UNSPECIFIED') as AttemptStatus,
    txHash: w.tx_hash ?? null,
    failReason: w.fail_reason ?? null,
    payAmount: w.pay_amount ?? null,
    payCurrency: w.pay_currency ?? null,
    chain: (w.chain ?? null) as ChainSlug | null,
    chainType: (w.chain_type ?? null) as ChainType | null,
    networkId: w.network_id ?? null,
  };
}

/**
 * Wire Party (the unified identity object) → public BuyerRef. Snapshot semantics
 * (ruling 11 — what was sent at creation is what comes back):
 * kind=olares (id + did) → 'olares'; kind=external → 'external' (display included;
 * legacy name-only orders arrive already folded into this tier by the gateway);
 * absent/unknown → null.
 */
export function wireToBuyer(p: WireParty | null | undefined): BuyerRef | null {
  if (p == null) return null;
  if (p.kind === 'olares' && p.olares_id != null && p.did != null) {
    return { kind: 'olares', olaresId: p.olares_id, did: p.did };
  }
  if (p.kind === 'external' && p.ref != null && p.ref !== '') {
    const name = p.display_name;
    const avatarUrl = p.avatar_url;
    const display =
      name != null || avatarUrl != null
        ? { name: name ?? undefined, avatarUrl: avatarUrl ?? undefined }
        : undefined;
    return display != null ? { kind: 'external', ref: p.ref, display } : { kind: 'external', ref: p.ref };
  }
  return null;
}

/** Public BuyerRef → wire Party (request direction; one tier, one object). */
export function buyerRefToWire(b: BuyerRef): WireParty {
  if (b.kind === 'olares') {
    return { kind: 'olares', olares_id: b.olaresId, did: b.did };
  }
  return { kind: 'external', ref: b.ref, display_name: b.display?.name, avatar_url: b.display?.avatarUrl };
}

function wireToProductSnapshot(w: NonNullable<WirePayment['product']>): Payment['product'] {
  return {
    productId: w.product_id ?? '',
    title: w.title ?? null,
    version: w.version ?? null,
    type: w.type ?? null,
    priceCents: w.price_cents ?? null,
    currency: w.currency ?? null,
    developer: w.developer ?? null,
    status: w.status ?? null,
    resolvedAt: w.resolved_at ?? null,
  };
}

export function wireToPayment(w: WirePayment): Payment {
  return {
    paymentId: w.id ?? '',
    merchantAccountId: w.merchant_account_id ?? '',
    buyer: wireToBuyer(w.buyer),
    amountCents: w.amount_cents ?? 0,
    currency: (w.currency ?? 'usd') as Payment['currency'],
    settlementCurrency: w.settlement_currency ?? null,
    settlementAmount: w.settlement_amount ?? null,
    status: (w.status ?? 'PAYMENT_STATUS_UNSPECIFIED') as PaymentStatus,
    product: w.product ? wireToProductSnapshot(w.product) : null,
    metadata: w.metadata ?? {},
    clientSecret: w.client_secret ?? null,
    latestAttempt: w.latest_attempt ? toLatestAttempt(w.latest_attempt) : null,
    expiresAt: w.expires_at ?? null,
    canceledAt: w.canceled_at ?? null,
    paidAt: w.paid_at ?? null,
    createdAt: w.created_at ?? null,
    updatedAt: w.updated_at ?? null,
  };
}

export function wireToCreateResult(w: WireCreateResponse): CreatePaymentResult {
  return { paymentId: w.intent_id ?? '', checkoutUrl: w.checkout_url ?? '' };
}

export function wireToListPaymentsResponse(w: WireListPaymentsResponse): ListPaymentsResponse {
  return {
    items: (w.items ?? []).map(wireToPayment),
    hasMore: w.has_more ?? false,
    nextCursor: w.next_cursor,
  };
}

export function wireToAccountInfo(w: WireAccountInfo): AccountInfo {
  return {
    accountId: w.account_id ?? '',
    did: w.did ?? null,
    olaresId: w.olares_id ?? null,
    status: w.status ?? '',
  };
}

/** Wire credential shape (from webhook payload) → public PaymentCredential. */
export function wireToCredential(c: WireWebhookCredential): PaymentCredential {
  return {
    txHash: c.tx_hash ?? '',
    payAmount: c.pay_amount ?? '',
    payCurrency: c.pay_currency ?? '',
    chain: (c.chain ?? null) as ChainSlug | null,
    chainType: (c.chain_type ?? null) as ChainType | null,
    networkId: c.network_id ?? null,
  };
}

/** createPayment request: public camelCase → gateway snake_case body.
 *  The buyer discriminant maps onto the single wire Party object; merchantAccountId
 *  only rides the platform variant. */
export function createPaymentRequestToWire(
  p: CreatePaymentRequest | (CreatePaymentRequest & { merchantAccountId?: string }),
): CreatePaymentReqJson {
  const w: CreatePaymentReqJson = {
    amount_cents: p.amountCents,
    currency: p.currency,
    metadata: p.metadata as CreatePaymentReqJson['metadata'],
    return_url: p.returnUrl,
  };
  const merchantAccountId = (p as { merchantAccountId?: string }).merchantAccountId;
  if (merchantAccountId != null) w.merchant_account_id = merchantAccountId;
  if (p.buyer != null) w.buyer = buyerRefToWire(p.buyer);
  return w;
}

/** getPayment request: paymentId → gateway intent_id body. */
export function paymentIdToWire(paymentId: string, clientSecret?: string): GetPaymentReqJson {
  return { intent_id: paymentId, client_secret: clientSecret };
}

/** createOrderFromCatalog request: positional args → gateway snake_case body (unsigned).
 *  Catalog orders are olares-tier by contract; the client rejects other tiers
 *  before the call and the gateway enforces it again (1100). */
export function createOrderFromCatalogRequestToWire(
  productId: string,
  buyer: BuyerRef,
  returnUrl?: string,
): CreateOrderFromCatalogReqJson {
  return {
    product_id: productId,
    buyer: buyerRefToWire(buyer),
    return_url: returnUrl,
  };
}

/** listPayments request: public keys already match the wire (all lowercase). */
export function listPaymentsRequestToWire(p: ListPaymentsRequest): ListPaymentsReqJson {
  return {
    status: p.status,
    metadata: p.metadata as ListPaymentsReqJson['metadata'],
    cursor: p.cursor,
    limit: p.limit,
  };
}

/** verifyTx request body (gateway passthrough leg of verifyTransaction). */
export function verifyTxRequestToWire(txHash: string, chain?: string, network?: string): VerifyTxReqJson {
  return { tx_hash: txHash, chain, network };
}

/** verifyTx response: receipt absent = tx not on-chain yet → null. */
export function verifyTxReceiptFromWire(w: VerifyTxResponseJson | null | undefined): EvmReceipt | null {
  return (w?.receipt ?? null) as EvmReceipt | null;
}

// ---------- channels / receive wallet (merchant) ----------

function wireToReceiveWallet(w: WireReceiveWallet): ReceiveWallet {
  return {
    chain: (w.chain ?? '') as ChainSlug,
    chainType: (w.chain_type ?? 'CHAIN_TYPE_UNSPECIFIED') as ChainType,
    networkId: w.network_id ?? null,
    address: w.address ?? '',
  };
}

export function wireToListChannels(w: WireListChannelsResponse): ListChannelsResponse {
  return {
    channels: (w.channels ?? []).map((c): ChannelInfo => ({
      channel: c.channel ?? '',
      enabled: c.enabled ?? false,
      receiveWallets: c.receive_wallets?.map(wireToReceiveWallet),
    })),
  };
}

/** listReceiveWalletTransactions request: public keys already match the wire. */
export function listReceiveWalletTransactionsRequestToWire(
  p: ListReceiveWalletTransactionsRequest,
): ListReceiveWalletTransactionsReqJson {
  return { address: p.address, cursor: p.cursor, limit: p.limit };
}

function wireToReceiveWalletTransactionItem(w: WireReceiveWalletTransactionItem): ReceiveWalletTransactionItem {
  return {
    txHash: w.tx_hash ?? '',
    chain: (w.chain ?? '') as ChainSlug,
    chainType: (w.chain_type ?? 'CHAIN_TYPE_UNSPECIFIED') as ChainType,
    networkId: w.network_id ?? null,
    direction: (w.direction ?? 'in') as ReceiveWalletTransactionItem['direction'],
    fromAddress: w.from_address ?? null,
    toAddress: w.to_address ?? null,
    amount: w.amount ?? null,
    symbol: w.symbol ?? null,
    contractAddress: w.contract_address ?? null,
    txFee: w.tx_fee ?? null,
    blockTimestamp: w.block_timestamp ?? null,
    blockNumber: w.block_number ?? 0,
    logIndex: w.log_index ?? null,
    status: (w.status ?? 'failed') as ReceiveWalletTransactionItem['status'],
    receiveWalletAddress: w.receive_wallet_address ?? '',
    decimals: w.decimals ?? null,
    buyer: wireToBuyer(w.buyer),
    paymentId: w.intent_id ?? null,
    paymentStatus: w.intent_status ?? null,
    paymentMetadata: w.intent_metadata ?? null,
  };
}

export function wireToListReceiveWalletTransactions(
  w: WireListReceiveWalletTransactionsResponse,
): ListReceiveWalletTransactionsResponse {
  return {
    items: (w.items ?? []).map(wireToReceiveWalletTransactionItem),
    hasMore: w.has_more ?? false,
    nextCursor: w.next_cursor,
  };
}

// ---------- tx verification (EVM; gateway passthrough + direct RPC share this) ----------

/** Normalize an EVM receipt (or null=pending) into the public TxVerification. */
export function receiptToVerification(
  txHash: string,
  receipt: EvmReceipt | null | undefined,
): TxVerification {
  if (!receipt) {
    return { txHash, confirmed: false, blockNumber: null, status: null };
  }
  const blockNumber = receipt.blockNumber ? parseInt(receipt.blockNumber, 16) : null;
  const status: TxVerification['status'] =
    receipt.status === '0x1' ? 'success' : receipt.status === '0x0' ? 'failed' : null;
  return {
    txHash,
    confirmed: status === 'success',
    blockNumber,
    status,
    raw: receipt,
  };
}

/** Wire /api/ping → public PingResult. */
export function wireToPingResult(w: WirePingResult): PingResult {
  return {
    serverTime: w.server_time ?? '',
  };
}

/** Wire /api/clientInfo → public ClientInfoResult. */
export function wireToClientInfoResult(w: WireClientInfoResult): ClientInfoResult {
  return {
    keyType: (w.key_type ?? 'API_CLIENT_TYPE_UNSPECIFIED') as ClientInfoResult['keyType'],
    accountId: w.account_id ?? null,
    did: w.did ?? null,
    olaresId: w.olares_id ?? null,
  };
}

/** Fulfillment judgment: succeeded AND txHash → paid (the logic behind getPayment). */
export function toPaymentResult(wire: WirePayment): PaymentResult {
  const payment = wireToPayment(wire);
  const la = payment.latestAttempt;
  if (payment.status === 'PAYMENT_STATUS_SUCCEEDED' && la?.txHash) {
    return {
      paid: true,
      payment,
      credential: {
        txHash: la.txHash,
        payAmount: la.payAmount ?? '',
        payCurrency: la.payCurrency ?? '',
        chain: la.chain,
        chainType: la.chainType,
        networkId: la.networkId,
      },
    };
  }
  return { paid: false, payment };
}

/** Wire listSupportedChains → public. */
export function wireToListSupportedChains(w: WireListSupportedChainsResponse): ListSupportedChainsResponse {
  return {
    chains: (w.chains ?? []).map((c): SupportedChain => ({
      chain: (c.chain ?? '') as ChainSlug,
      chainType: (c.chain_type ?? 'CHAIN_TYPE_UNSPECIFIED') as ChainType,
      networkId: c.chain_network_id != null ? Number(c.chain_network_id) : null,
      network: c.network ?? '',
      tokens: (c.tokens ?? []).map((t): SupportedToken => ({
        symbol: t.symbol ?? '',
        contractAddress: t.contract_address ?? null,
        decimals: t.decimals ?? null,
      })),
    })),
  };
}

/** Wire listPaymentMethodConfigs → public. */
export function wireToListPaymentMethodConfigs(w: WireListPaymentMethodConfigsResponse): ListPaymentMethodConfigsResponse {
  return {
    configs: (w.configs ?? []).map((c): PaymentMethodConfig => {
      const rawChains = (c.config as { chains?: unknown } | undefined)?.chains;
      const chains = Array.isArray(rawChains)
        ? (rawChains as Record<string, unknown>[]).map((ch) => ({
            chainId: (ch.chain_id as string) ?? '',
            receiveWallet: (ch.receive_wallet as string) ?? '',
            tokens: Array.isArray(ch.tokens) ? (ch.tokens as string[]) : undefined,
          }))
        : [];
      return {
        id: c.id ?? '',
        accountConfigId: c.account_config_id ?? '',
        channel: c.channel ?? '',
        enabled: c.enabled ?? false,
        config: { chains },
        createdAt: c.created_at ?? null,
        updatedAt: c.updated_at ?? null,
      };
    }),
  };
}

/** upsertOnchainPmc: public request → wire (snake_case). */
export function upsertOnchainPmcRequestToWire(p: UpsertOnchainPmcRequest): WireUpsertOnchainPmcRequest {
  return {
    chains: p.chains.map((c) => ({
      chain_id: c.chainId,
      receive_wallet: c.receiveWallet,
      tokens: c.tokens,
    })),
  };
}
