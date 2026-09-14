/**
 * Error codes — unified table mirroring the gateway (packages/payment/src/core/error-codes.ts)
 * plus SDK-local transport codes.
 *
 * Ranges:
 *   1000-1949  Gateway business codes (SDK mirrors; never invents new codes here)
 *   1950-1999  SDK transport codes (never collide with gateway)
 *
 * Callers can distinguish:
 *   code < 1950  → gateway business error (request reached the gateway)
 *   code >= 1950 → SDK-local error (transport failure; gateway never saw the request)
 */

// ===== Gateway business codes (mirror error_codes.go) =====

// System (1000-1099)
export const INTERNAL_ERROR = 1000;
export const SERVICE_NOT_FOUND = 1001;
export const METHOD_NOT_FOUND = 1002;

// Parameter (1100-1199)
export const INVALID_ARGUMENT = 1100;
export const MISSING_PARAMETER = 1101;
export const CHAIN_NOT_SUPPORTED = 1103;
export const INVALID_RETURN_URL = 1104;
export const INVALID_CURSOR = 1105;

// Resource (1200-1299)
export const STORE_NOT_FOUND = 1200;
export const STORE_INACTIVE = 1201;
export const ACCOUNT_NOT_FOUND = 1202;
export const PAYMENT_NOT_FOUND = 1203;
export const RECEIVE_WALLET_NOT_FOUND = 1204;
export const ORDER_NOT_FOUND = 1206;
export const TOKEN_NOT_FOUND = 1207;
export const ATTEMPT_NOT_FOUND = 1208;
export const PRODUCT_NOT_FOUND = 1215;

// Permission (1300-1399)
export const PERMISSION_DENIED = 1300;
export const UNAUTHENTICATED = 1301;

// Business (1400-1499)
export const INSUFFICIENT_BALANCE = 1400;
export const TRANSACTION_FAILED = 1401;
export const STATE_MACHINE_VIOLATION = 1402;
export const TOKEN_UNSUPPORTED = 1403;
export const PAYMENT_METHOD_UNSUPPORTED = 1404;

// Auth (1500-1599)
export const SIGNATURE_MISMATCH = 1500;
export const INVALID_API_KEY = 1501;
export const TIMESTAMP_EXPIRED = 1502;
export const MISSING_HEADERS = 1503;
export const PAYMENT_NOTIFICATION_FAILED = 1504;

// Refund (1900-1949)
// Thrown by createRefund / getRefund / cancelRefund / reissueRefundLink.
export const REFUND_PRECONDITION_FAILED = 1901;
export const REFUND_AMOUNT_EXCEEDED = 1902;
export const REFUND_STATE_CONFLICT = 1903;
export const REFUND_EXECUTION_INVALID = 1904;
export const REFUND_ROUTE_UNSUPPORTED = 1905;
export const REFUND_ALREADY_OPEN = 1906;
export const REFUND_CANCEL_UNAVAILABLE = 1907;

// ===== SDK transport codes (1950-1999; never collide with gateway) =====
export const SDK_TIMEOUT = 1951;
export const SDK_NETWORK_ERROR = 1952;
export const SDK_RPC_ERROR = 1953;

// ===== PaymentError =====

export class PaymentError extends Error {
  constructor(
    public readonly code: number,
    public readonly httpStatus: number,
    message: string,
  ) {
    super(message);
    this.name = 'PaymentError';
  }
}
