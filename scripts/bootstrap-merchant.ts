#!/usr/bin/env tsx
/**
 * Temporary merchant provisioner.
 *
 * Payment dashboard cannot yet mint identity + merchant account + API key +
 * webhook without a LarePass QR session. This script writes those rows into
 * the local payment Postgres and prints a .env the shop can use.
 *
 * Discard this file once payment ships a dashboard registration flow.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const OLARES_ID = 'twlikesowl.olares.com';
const ACCOUNT_ID = 'acct_demo_shop';
const CFG_ID = 'cfg_demo_shop_merchant';
const CLIENT_ID = 'client_merchant_demo_shop';
const WEBHOOK_DESC = 'olares-payment-user-demo';
const PLACEHOLDER_WALLET = '0x13b1fc12829cF3cb49Ba6747dEdC9dA12DBe07C9';
const CHAIN_ID = '10'; // Optimism
const DEFAULT_WEBHOOK_URL = 'http://127.0.0.1:32000/webhook';
const DEFAULT_DB = 'postgres://postgres:postgres@127.0.0.1:5432/payment';

function parseEnvFile(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

function resolveDatabaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const demo = parseEnvFile(path.join(ROOT, '.env'));
  if (demo.DATABASE_URL) return demo.DATABASE_URL;
  const sibling = parseEnvFile(path.join(ROOT, '../olares-payment/packages/payment/.env'));
  if (sibling.DATABASE_URL) return sibling.DATABASE_URL;
  return DEFAULT_DB;
}

function assertLocalUrl(url: string): void {
  const u = new URL(url);
  if (u.hostname !== '127.0.0.1' && u.hostname !== 'localhost') {
    throw new Error(`refusing to write a remote database (host=${u.hostname})`);
  }
}

const hex = (n: number) => randomBytes(n).toString('hex');
const genPk = () => `pk_live_${hex(12)}`;
const genSk = () => `sk_live_${hex(16)}`;
const genWhsec = () => `whsec_${hex(12)}`;

function upsertEnv(file: string, patch: Record<string, string>): void {
  const existing = existsSync(file) ? readFileSync(file, 'utf8') : readFileSync(path.join(ROOT, '.env.example'), 'utf8');
  const keys = new Set(Object.keys(patch));
  const lines = existing.split('\n').map((line) => {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (m && keys.has(m[1])) {
      keys.delete(m[1]);
      return `${m[1]}=${patch[m[1]]}`;
    }
    return line;
  });
  for (const k of keys) lines.push(`${k}=${patch[k]}`);
  writeFileSync(file, lines.join('\n').replace(/\n+$/, '\n'));
}

async function main(): Promise<void> {
  const rotate = process.argv.includes('--rotate');
  const webhookUrl = process.env.WEBHOOK_URL || DEFAULT_WEBHOOK_URL;
  const dbUrl = resolveDatabaseUrl();
  assertLocalUrl(dbUrl);

  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();

  try {
    await client.query('BEGIN');

    await client.query(
      `INSERT INTO identities (id, olares_id, status)
       VALUES ($1, $2, 'active')
       ON CONFLICT (olares_id) DO UPDATE SET updated_at = now()`,
      [randomUUID(), OLARES_ID],
    );
    const identity = await client.query<{ id: string }>(
      `SELECT id FROM identities WHERE olares_id = $1`,
      [OLARES_ID],
    );
    const identityId = identity.rows[0].id;

    await client.query(
      `INSERT INTO accounts (id, identity_id, status)
       VALUES ($1, $2, 'active')
       ON CONFLICT (id) DO UPDATE SET identity_id = EXCLUDED.identity_id, updated_at = now()`,
      [ACCOUNT_ID, identityId],
    );

    await client.query(
      `INSERT INTO account_configurations (id, account_id, configuration)
       VALUES ($1, $2, 'merchant')
       ON CONFLICT DO NOTHING`,
      [CFG_ID, ACCOUNT_ID],
    );
    const cfg = await client.query<{ id: string }>(
      `SELECT id FROM account_configurations WHERE account_id = $1 AND configuration = 'merchant'`,
      [ACCOUNT_ID],
    );
    const cfgId = cfg.rows[0].id;

    const pmcConfig = {
      chains: [{ chain_id: CHAIN_ID, receive_wallet: PLACEHOLDER_WALLET, tokens: ['USDC'] }],
    };
    await client.query(
      `INSERT INTO payment_method_configs (account_config_id, channel, enabled, config)
       VALUES ($1, 'onchain', true, $2::jsonb)
       ON CONFLICT (account_config_id, channel) WHERE enabled
       DO UPDATE SET config = EXCLUDED.config, updated_at = now()`,
      [cfgId, JSON.stringify(pmcConfig)],
    );

    const existingKey = await client.query<{ api_key: string; api_secret: string }>(
      `SELECT api_key, api_secret FROM api_clients WHERE client_id = $1 AND active = true`,
      [CLIENT_ID],
    );
    let apiKey: string;
    let apiSecret: string;
    if (existingKey.rows[0] && !rotate) {
      apiKey = existingKey.rows[0].api_key;
      apiSecret = existingKey.rows[0].api_secret;
    } else {
      apiKey = genPk();
      apiSecret = genSk();
      await client.query(
        `INSERT INTO api_clients (client_id, client_name, client_type, account_id, api_key, api_secret, active)
         VALUES ($1, 'demo shop', 'merchant', $2, $3, $4, true)
         ON CONFLICT (client_id) DO UPDATE SET
           account_id = EXCLUDED.account_id,
           api_key = EXCLUDED.api_key,
           api_secret = EXCLUDED.api_secret,
           active = true`,
        [CLIENT_ID, ACCOUNT_ID, apiKey, apiSecret],
      );
    }

    const existingWh = await client.query<{ secret: string }>(
      `SELECT secret FROM notify_webhook_endpoints
       WHERE account_id = $1 AND description = $2 AND deleted_at IS NULL
       ORDER BY id ASC LIMIT 1`,
      [ACCOUNT_ID, WEBHOOK_DESC],
    );
    let webhookSecret: string;
    if (existingWh.rows[0] && !rotate) {
      webhookSecret = existingWh.rows[0].secret;
      await client.query(
        `UPDATE notify_webhook_endpoints
         SET url = $1, status = 'enabled', updated_at = now()
         WHERE account_id = $2 AND description = $3 AND deleted_at IS NULL`,
        [webhookUrl, ACCOUNT_ID, WEBHOOK_DESC],
      );
    } else {
      webhookSecret = genWhsec();
      if (existingWh.rows[0] && rotate) {
        await client.query(
          `UPDATE notify_webhook_endpoints
           SET url = $1, secret = $2, status = 'enabled', updated_at = now()
           WHERE account_id = $3 AND description = $4 AND deleted_at IS NULL`,
          [webhookUrl, webhookSecret, ACCOUNT_ID, WEBHOOK_DESC],
        );
      } else {
        await client.query(
          `INSERT INTO notify_webhook_endpoints (account_id, url, enabled_events, status, secret, description)
           VALUES ($1, $2, $3::jsonb, 'enabled', $4, $5)`,
          [ACCOUNT_ID, webhookUrl, JSON.stringify(['payment.succeeded']), webhookSecret, WEBHOOK_DESC],
        );
      }
    }

    await client.query('COMMIT');

    const envPath = path.join(ROOT, '.env');
    upsertEnv(envPath, {
      PAYMENT_ENDPOINT: process.env.PAYMENT_ENDPOINT || 'http://127.0.0.1:31000',
      PAYMENT_API_KEY: apiKey,
      PAYMENT_API_SECRET: apiSecret,
      WEBHOOK_SECRET: webhookSecret,
      PORT: '32000',
      SHOP_PUBLIC_URL: process.env.SHOP_PUBLIC_URL || 'http://127.0.0.1:32001',
    });

    console.log('merchant bootstrap ok (idempotent)');
    console.log(`  identity     ${OLARES_ID} (${identityId})`);
    console.log(`  account      ${ACCOUNT_ID}`);
    console.log(`  receive      ${PLACEHOLDER_WALLET}  chain=${CHAIN_ID}  token=USDC`);
    console.log(`  webhook url  ${webhookUrl}  (registered on payment, not in the shop request)`);
    console.log(`  wrote        ${envPath}`);
    console.log('');
    console.log(`PAYMENT_API_KEY=${apiKey}`);
    console.log(`PAYMENT_API_SECRET=${apiSecret}`);
    console.log(`WEBHOOK_SECRET=${webhookSecret}`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
