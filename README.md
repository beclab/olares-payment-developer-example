# olares-payment-developer-example

A small shop that collects through Olares Payment. The shop owns the catalog, ship-to addresses, and order state. The gateway sees only the amount, an optional buyer label, and `metadata.order_id`.

Shop orders move **pending → paid → shipped**. A successful checkout marks the order **Paid**. Shipping is a seller action, not a payment callback.

## How to run

1. Open the Olares Payment Dashboard and sign in with LarePass. The first login creates a merchant account and receive addresses on the enabled EVM chains. The receive address is the Ethereum address derived from the LarePass mnemonic, so checkout is payable without adding a wallet by hand.
2. Go to **Checkouts → Advanced settings** to create a new API key and secret. The key is used to identify the merchant, and the secret is used to sign requests to the gateway. Register a webhook endpoint: `http://<your-host>:32000/webhook`. The secret is used to verify the webhook signature.
4. Put the key, secret, webhook secret, and gateway `baseUrl` in `CONFIG` at the top of `server.js`.
5. Install and start:

```bash
npm install
npm start
```

Buyer shop: http://127.0.0.1:32000  
Seller admin: http://127.0.0.1:32000/admin (username `admin`, password `admin`)

A hosted gateway cannot reach `127.0.0.1`. Use a public webhook URL in that case. The return page also calls `getPayment`, so a local shop can still mark an order paid if the webhook never arrives.

`vendor/` is a snapshot of `@olares/payment-sdk` before it is published to npm. Orders live in memory and are lost when the process exits.

## What this example shows

### Buyer

Open http://127.0.0.1:32000.

- Sign in with a nickname (no password). The same nickname is the same buyer.
- Browse three sample goods, confirm a ship-to, and pay on the hosted Olares Payment checkout.
- After checkout, return to an order page (`/?order=`). The page shows item, amount, ship-to, and payment status.
- If checkout is still open, continue paying from that order page. If it expired or failed, start a new payment on the same shop order.

### Seller

Open http://127.0.0.1:32000/admin.

- Sign in with username `admin` and password `admin`.
- Review shop orders, revenue, and buyers.
- When an order is **Paid**, use **Mark shipped** on the right of the row. Only paid orders can be shipped.
- Compare shop orders with the gateway ledger (`listPayments`) for the same merchant key.

## Integration notes

- **Create a payment** with `MerchantClient.createPayment`: `amountCents`, `returnUrl`, `metadata.order_id`, and optional `buyer: { kind: 'external', ref, display }`. Use a stable idempotency key (`shop:{orderId}:{seq}`). Omit `buyer` if the merchant does not want customer labels on the payment side.
- **Fulfill from `getPayment` on return.** The checkout redirects to `/?order=`. Call `getPayment` and treat `paid: true` as the only safe signal to mark the shop order Paid.
- **Webhooks are the live path.** Verify with `webhooks.constructEvent` on the raw body. `payment.succeeded` → Paid; `payment.failed` and `payment.canceled` update the shop order. Do not ship from the webhook.
- **Resume or replace checkout.** If the intent is still open, reuse `checkoutUrl`. If it is canceled or expired, create a new payment for the same shop order (increment the idempotency sequence).
- **Paid is not shipped.** The seller marks shipment after collection. Payment success only means the gateway has the funds.
