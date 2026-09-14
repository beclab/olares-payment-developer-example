/**
 * Wire types — aliases of the gateway proto SSOT (`@olares/payment-proto` *Json types).
 *
 * NEVER exported to users. The public surface (types/base.ts) is camelCase + `paymentId`,
 * with no "intent" concept. The mapping layer (core/mapping.ts) translates between
 * wire and public types at the SDK boundary.
 *
 * Proto optional fields deserialize as ABSENT keys (not null), so every *Json field is
 * optional in the type even when the gateway always emits it (alwaysEmitImplicit);
 * mapping.ts normalizes with `??`.
 */
import type {
  AccountInfoJson,
  ChannelInfoJson,
  ClientInfoResponseJson,
  CreatePaymentResponseJson,
  GatewayListSupportedChainsResponseJson,
  GatewayUpsertOnchainPmcReqJson,
  LatestAttemptJson,
  ListChannelsResponseJson,
  ListPaymentsResponseJson,
  ListReceiveWalletTransactionsResponseJson,
  PartyJson,
  PaymentCallbackCredentialJson,
  PaymentCallbackJson,
  PaymentIntentJson,
  PaymentMethodConfigJson,
  PingResponseJson,
  ReceiveWalletJson,
  ReceiveWalletTransactionItemJson,
  RefundCallbackJson,
  RefundHandoffJson,
  RefundJson,
  RefundRouteJson,
  RefundSummaryJson,
  VerifyTxResponseJson,
} from '@olares/payment-proto';

export type WireLatestAttempt = LatestAttemptJson;
export type WireParty = PartyJson;
export type WirePayment = PaymentIntentJson;
export type WireCreateResponse = CreatePaymentResponseJson;
export type WireListPaymentsResponse = ListPaymentsResponseJson;
export type WireAccountInfo = AccountInfoJson;
export type WireWebhookPayload = PaymentCallbackJson;
export type WireWebhookCredential = PaymentCallbackCredentialJson;
export type WireReceiveWallet = ReceiveWalletJson;
export type WireChannelInfo = ChannelInfoJson;
export type WireListChannelsResponse = ListChannelsResponseJson;
export type WireReceiveWalletTransactionItem = ReceiveWalletTransactionItemJson;
export type WireListReceiveWalletTransactionsResponse = ListReceiveWalletTransactionsResponseJson;
export type WirePingResult = PingResponseJson;
export type WireClientInfoResult = ClientInfoResponseJson;
export type WireVerifyTxResponse = VerifyTxResponseJson;
export type WireListSupportedChainsResponse = GatewayListSupportedChainsResponseJson;
export type WireListPaymentMethodConfigsResponse = { configs?: PaymentMethodConfigJson[] };
export type WireUpsertOnchainPmcResponse = PaymentMethodConfigJson;
export type WireUpsertOnchainPmcRequest = GatewayUpsertOnchainPmcReqJson;
export type WireRefund = RefundJson;
export type WireRefundRoute = RefundRouteJson;
export type WireRefundSummary = RefundSummaryJson;
export type WireRefundHandoff = RefundHandoffJson;
export type WireRefundCallback = RefundCallbackJson;

/** EVM transaction receipt (eth_getTransactionReceipt result); raw chain fact, not proto-modeled.
 *  Used by both the gateway passthrough (/api/verifyTx) and direct RPC. */
export interface EvmReceipt {
  transactionHash?: string;
  blockHash?: string;
  blockNumber?: string; // hex
  status?: string; // '0x1' success | '0x0' failed
  gasUsed?: string;
  [key: string]: unknown;
}
