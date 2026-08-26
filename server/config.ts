import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
loadEnv({ path: path.join(ROOT, '.env') });

function required(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`missing ${name} — run npm run bootstrap`);
  return v;
}

export const config = {
  port: Number(process.env.PORT || 32000),
  shopPublicUrl: process.env.SHOP_PUBLIC_URL || 'http://127.0.0.1:32001',
  paymentEndpoint: process.env.PAYMENT_ENDPOINT || 'http://127.0.0.1:31000',
  apiKey: required('PAYMENT_API_KEY'),
  apiSecret: required('PAYMENT_API_SECRET'),
  webhookSecret: required('WEBHOOK_SECRET'),
};
