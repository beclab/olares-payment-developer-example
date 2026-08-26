# olares-payment-user-demo

A tiny shop that collects money with **Olares Payment mode A**: the merchant backend holds an API key, calls `MerchantClient.createPayment`, sends the buyer to the hosted checkout, then ships when the gateway webhook arrives.

This repo vendors `@olares/payment-sdk` (plus its proto wire types) so it can run without being inside the `olares-payment` monorepo.

## What you need first

Local `olares-payment` already running:

- gateway API `:31000`
- checkout front `:21000`
- worker (so webhooks actually fire)
- Postgres on `127.0.0.1:15432`

## Setup

```bash
npm install
npm run bootstrap   # writes .env (local Postgres only)
npm run dev         # shop UI :32001  ·  API/webhook :32000
```

Open http://127.0.0.1:32001, pick a buyer olares id, click Buy. After checkout, the shop polls until `payment.succeeded` lands on `POST /webhook`.

`scripts/bootstrap-merchant.ts` is temporary. It inserts identity / merchant account / placeholder receive wallet / API key / webhook URL directly into the payment database because dashboard self-serve is not ready. Throw the script away once payment has a registration UI.

## Environment

| Variable | Where it lives | Role |
|---|---|---|
| `PAYMENT_ENDPOINT` | shop `.env` | Gateway base URL |
| `PAYMENT_API_KEY` / `PAYMENT_API_SECRET` | shop `.env` | HMAC merchant credentials |
| `WEBHOOK_SECRET` | shop `.env` | Verify inbound webhook signatures (`whsec_...`) |
| webhook **URL** | payment `notify_webhook_endpoints` | Gateway posts here. Default `http://127.0.0.1:32000/webhook` |
| `SHOP_PUBLIC_URL` | shop `.env` | Checkout `return_url` (the Vite UI) |

The shop does **not** send the webhook URL when creating a payment. After you put this demo on a public host, update the endpoint URL on the payment side (or re-run bootstrap with `WEBHOOK_URL=https://your.domain/webhook`).

Placeholder receive wallet written by bootstrap: `0x000000000000000000000000000000000000dEaD` on Optimism (`chain_id=10`, USDC). Replace it before a real on-chain pay, or checkout will show a dead address.

## Layout

```
vendor/payment-sdk     vendored SDK
vendor/payment-proto   vendored *Json wire types the SDK imports
scripts/               temporary merchant provisioner
server/                Express: products, checkout, webhook
web/                   Vite + Vue shop
```
