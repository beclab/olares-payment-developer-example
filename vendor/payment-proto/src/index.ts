/**
 * Olares Payment wire types (@olares/payment-proto).
 *
 * Type-only re-export of the protobuf-es generated `*Json` wire types for the
 * gateway proto SSOT (packages/payment/proto). Consumers (frontends and other
 * services) import JSON wire types from here instead of reaching into the
 * gateway's generated code. The gateway itself keeps its own generated code
 * under packages/payment/src/proto.
 *
 * Layout mirrors the proto source: v1/domain/ holds pure domain types (no
 * service), v1/service/ holds the per-process RPC services with their own
 * request/response messages. Package stays payment.v1.
 */
export type * from './proto/v1/domain/account_pb';
export type * from './proto/v1/domain/common_pb';
export type * from './proto/v1/domain/payment_pb';
export type * from './proto/v1/domain/receive-wallet_pb';
export type * from './proto/v1/domain/developer-key_pb';
export type * from './proto/v1/domain/webhook_pb';
export type * from './proto/v1/service/admin_pb';
export type * from './proto/v1/service/checkout_pb';
export type * from './proto/v1/service/dashboard_pb';
export type * from './proto/v1/service/gateway_pb';
