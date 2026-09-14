/**
 * Merchant-only types — MerchantClient's channels, receive wallet transactions and refunds.
 *
 * camelCase + paymentId (no intent concept); the wire shapes live in core/wire.ts.
 * The platform key is rejected by the gateway on these endpoints, so these types
 * do not belong to the shared layer (./base).
 */
import type {
  BuyerRef,
  ChainSlug,
  ChainType,
  Direction,
  ReceiveWalletTxStatus,
  Refund,
  RefundRoute,
  Timestamp,
} from './base';

// ---------- Resources (read) ----------

/** One on-chain receive wallet on a channel (expanded from pmc config + chain directory). */
export interface ReceiveWallet {
  chain: ChainSlug;
  chainType: ChainType;
  /** EVM only. */
  networkId: number | null;
  address: string;
}

/** A receiving channel (listChannels); only the onchain channel carries receive wallets. */
export interface ChannelInfo {
  channel: string; // onchain|olarespay (stripe 已下线删除)
  enabled: boolean;
  receiveWallets?: ReceiveWallet[];
}

/** Token supported on a chain (admin-managed onchain_tokens registry). */
export interface SupportedToken {
  symbol: string;
  /** ERC-20 contract address; null for native gas token. */
  contractAddress: string | null;
  decimals: number | null;
}

/** Supported chain with its enabled tokens (listSupportedChains). */
export interface SupportedChain {
  chain: ChainSlug;
  chainType: ChainType;
  /** EVM only. */
  networkId: number | null;
  network: string;
  tokens: SupportedToken[];
}

/** Onchain chain config within a payment method config. */
export interface OnchainChainConfig {
  chainId: string;
  receiveWallet: string;
  tokens?: string[];
}

/** Payment method config (listPaymentMethodConfigs / upsertOnchainPmc). */
export interface PaymentMethodConfig {
  id: string;
  accountConfigId: string;
  channel: string;
  enabled: boolean;
  config: { chains?: OnchainChainConfig[] };
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

/** Receive wallet transaction row; paymentId / paymentStatus / paymentMetadata are the tx_hash-matched payment linkage. */
export interface ReceiveWalletTransactionItem {
  txHash: string;
  chain: ChainSlug;
  chainType: ChainType;
  networkId: number | null;
  direction: Direction;
  fromAddress: string | null;
  toAddress: string | null;
  amount: string | null;
  symbol: string | null;
  contractAddress: string | null;
  txFee: string | null;
  blockTimestamp: number | null;
  /** Confirmation anchor / explorer locator / cursor sort key. */
  blockNumber: number;
  /** Position inside the block (keyset tiebreaker); null for legacy rows. */
  logIndex: number | null;
  /** On-chain outcome; guards against treating a reverted tx as paid. */
  status: ReceiveWalletTxStatus;
  /** Which receive wallet received the funds (multi-wallet merchants). */
  receiveWalletAddress: string;
  /** Required for human-readable amounts; null for unregistered tokens. */
  decimals: number | null;
  /** Who paid (backfilled via the intent's buyer snapshot, three tiers); null when unmatched/anonymous. */
  buyer: BuyerRef | null;
  paymentId: string | null;
  paymentStatus: string | null;
  /** Linked payment's metadata (order/product identity); null when unmatched or meta absent. */
  paymentMetadata: Record<string, unknown> | null;
}

// ---------- Refunds (write surface; the read types are shared, see ./base) ----------

/** createRefund request; amount omitted = the whole remaining refundable balance. */
export interface CreateRefundRequest {
  paymentId: string;
  /** Token minor units. */
  amount?: string;
  /** Merchant-internal note (audit only; never disclosed to the buyer). */
  reason?: string;
  /** Execution-page redirect on a terminal state; absolute http(s) URL, any host. */
  returnUrl?: string;
}

/**
 * createRefund / reissueRefundLink deliverable.
 *
 * executionUrl carries the plaintext execution secret in its fragment and it appears
 * exactly once: hand it to the operator, never log or persist it. Once expired, call
 * reissueRefundLink for a fresh one (which invalidates the previous link).
 */
export interface RefundHandoff {
  refund: Refund;
  route: RefundRoute | null;
  executionUrl: string;
  executionExpiresAt: Timestamp | null;
}

// ---------- Requests (write) & responses ----------

/** listReceiveWalletTransactions request (all optional; keyset pagination, fixed blockNumber DESC). */
export interface ListReceiveWalletTransactionsRequest {
  /** Filter by receive wallet address; scoped to wallets declared by the caller
   *  account's onchain PMCs (other addresses simply return empty results). */
  address?: string;
  /** nextCursor from the previous page. */
  cursor?: string;
  /** Default 20, max 200. */
  limit?: number;
}

export interface ListChannelsResponse {
  channels: ChannelInfo[];
}

export interface ListReceiveWalletTransactionsResponse {
  items: ReceiveWalletTransactionItem[];
  hasMore: boolean;
  nextCursor?: string;
}

export interface ListSupportedChainsResponse {
  chains: SupportedChain[];
}

export interface ListPaymentMethodConfigsResponse {
  configs: PaymentMethodConfig[];
}

export interface UpsertOnchainPmcRequest {
  chains: { chainId: string; receiveWallet: string; tokens?: string[] }[];
}
