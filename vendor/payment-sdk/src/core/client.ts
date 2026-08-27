/**
 * PaymentSDK — HMAC-signed transport layer.
 *
 * Does exactly one thing: sign + POST {baseUrl}/api/{method}, with timeout.
 * Uses axios (mature timeout + error handling; works in Node & browser).
 * No domain methods; those live on PlatformClient / MerchantClient (+ core/* helpers).
 * Throws PaymentError on any non-zero envelope code, transport failure, or timeout.
 */
import axios from 'axios';
import { webcrypto } from 'node:crypto';

import { INTERNAL_ERROR, PaymentError, SDK_NETWORK_ERROR, SDK_TIMEOUT } from './errors';
import type { ApiEnvelope, ClientOptions, SdkLogger } from '../types/base';
import { DEFAULT_BASE_URL, DEFAULT_TIMEOUT_MS, defaultLogger } from '../types/base';

const subtle = webcrypto.subtle;
const randomUUID = (): string => webcrypto.randomUUID();

export class PaymentSDK {
  private readonly apiKey: string;
  private readonly apiSecret: string;
  private readonly baseUrl: string;
  private readonly logger: SdkLogger;
  private readonly timeoutMs: number;

  constructor(opts: ClientOptions) {
    this.apiKey = opts.apiKey ?? '';
    this.apiSecret = opts.apiSecret ?? '';
    this.baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
    this.logger = opts.logger ?? defaultLogger;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  static async signAsync(
    apiSecret: string,
    method: string,
    body: string,
    timestamp: string,
    nonce: string,
  ): Promise<string> {
    const canonical = `${method}\n${body}\n${timestamp}\n${nonce}`;
    const enc = new TextEncoder();
    const key = await subtle.importKey(
      'raw',
      enc.encode(apiSecret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const sig = await subtle.sign('HMAC', key, enc.encode(canonical));
    return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  async call<T = unknown>(
    method: string,
    params: object,
    opts?: { idempotencyKey?: string },
  ): Promise<T> {
    if (!this.apiKey || !this.apiSecret) {
      throw new PaymentError(INTERNAL_ERROR, 0, `${method} requires apiKey/apiSecret (keyless client)`);
    }
    const body = JSON.stringify(params);
    const timestamp = Date.now().toString();
    const nonce = randomUUID().slice(0, 16);
    const signature = await PaymentSDK.signAsync(this.apiSecret, method, body, timestamp, nonce);
    return this.post<T>(method, body, {
      'x-olares-payment-key': this.apiKey,
      'x-olares-payment-timestamp': timestamp,
      'x-olares-payment-nonce': nonce,
      'x-olares-payment-signature': signature,
    }, opts);
  }

  /** Unsigned call for public endpoints (createOrderFromCatalog, getPayment by client_secret). */
  async callUnsigned<T = unknown>(
    method: string,
    params: object,
    opts?: { idempotencyKey?: string },
  ): Promise<T> {
    return this.post<T>(method, JSON.stringify(params), {}, opts);
  }

  private async post<T>(
    method: string,
    body: string,
    authHeaders: Record<string, string>,
    opts?: { idempotencyKey?: string },
  ): Promise<T> {
    const url = `${this.baseUrl}/api/${method}`;

    this.logger('info', `→ ${method}`, { url, apiKey: this.apiKey || '(unsigned)' });

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...authHeaders,
    };
    if (opts?.idempotencyKey) {
      headers['Idempotency-Key'] = opts.idempotencyKey;
    }

    let resp;
    try {
      resp = await axios.post(url, body, {
        headers,
        timeout: this.timeoutMs,
        validateStatus: () => true, // don't auto-reject HTTP errors; we check code manually
      });
    } catch (e) {
      if (axios.isAxiosError(e)) {
        if (e.code === 'ECONNABORTED') {
          throw new PaymentError(SDK_TIMEOUT, 0, `${method} timeout after ${this.timeoutMs}ms`);
        }
        this.logger('error', `✗ ${method} network error`, { url, error: e.message });
        throw new PaymentError(SDK_NETWORK_ERROR, 0, `${method} → ${url} request failed: ${e.message}`);
      }
      throw e;
    }

    const data = resp.data as ApiEnvelope<T>;
    if (resp.status >= 400 || data?.code !== 0) {
      this.logger('error', `✗ ${method} error response`, {
        url, httpStatus: resp.status, code: data?.code, message: data?.message,
      });
      throw new PaymentError(
        data?.code ?? INTERNAL_ERROR,
        resp.status,
        data?.message || `${method} → ${url} http ${resp.status}`,
      );
    }

    this.logger('info', `← ${method} ok`, { url, httpStatus: resp.status, code: data.code });
    return data.payload as T;
  }
}

export default PaymentSDK;
