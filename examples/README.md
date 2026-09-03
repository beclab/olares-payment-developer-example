# SDK snippets

One file per call. Each script builds its own `MerchantClient` and prints the result to the terminal. Keys come from `config.js` (same file as the shop), or from `PAYMENT_API_KEY` / `PAYMENT_API_SECRET` / `PAYMENT_WEBHOOK_SECRET`. The gateway address defaults to the production endpoint (`https://www.olares.com/payment`) baked into the SDK; no configuration needed.

```bash
npm run ex:create    # createPayment  → checkout URL
npm run ex:get       # getPayment     → paid?
npm run ex:list      # listPayments   → recent rows
npm run ex:webhook   # constructEvent → print events on :32001
```

Or `npx tsx examples/01-create-payment.js` (and the same for `02` / `03` / `04`).

**01 → 02.** `ex:create` writes `examples/.last-payment-id`. `ex:get` reads it. Override with `PAYMENT_ID=pi_xxx npm run ex:get`. Open the printed `checkoutUrl` in a browser to pay, then run `ex:get` again.

**04.** Listens on port `32001` so it does not clash with the shop (`32000`). Register `http://<your-host>:32001/webhook` in **Checkouts → Advanced settings**. A hosted gateway cannot reach `127.0.0.1`.
