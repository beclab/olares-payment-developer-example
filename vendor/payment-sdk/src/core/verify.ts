/**
 * On-chain tx verification via direct EVM RPC — the "don't trust the gateway" leg.
 *
 * verifyViaRpc queries eth_getTransactionReceipt directly against a configured RPC,
 * with timeout. EVM only.
 */
import axios from 'axios';

import { PaymentError, SDK_RPC_ERROR, SDK_TIMEOUT } from './errors';
import { receiptToVerification } from './mapping';
import type { TxVerification } from '../types/base';
import type { EvmReceipt } from './wire';

export async function verifyViaRpc(
  txHash: string,
  rpcUrl: string,
  timeoutMs: number,
): Promise<TxVerification> {
  try {
    const resp = await axios.post(
      rpcUrl,
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_getTransactionReceipt',
        params: [txHash],
      },
      { timeout: timeoutMs, validateStatus: () => true },
    );
    const result = resp.data?.result as EvmReceipt | null;
    return receiptToVerification(txHash, result ?? null);
  } catch (e) {
    if (axios.isAxiosError(e)) {
      if (e.code === 'ECONNABORTED') {
        throw new PaymentError(SDK_TIMEOUT, 0, `verifyTransaction rpc timeout after ${timeoutMs}ms`);
      }
      throw new PaymentError(SDK_RPC_ERROR, 0, `verifyTransaction rpc failed: ${e.message}`);
    }
    throw e;
  }
}
