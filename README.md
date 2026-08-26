# olares-payment-user-demo

用 Olares Payment 收款的小店。下单 → 收银台付款 → webhook 到了就发货。

## 怎么跑

1. 打开 https://dashboard-front-test.mdogs.me ，建商户、填收款钱包、拿 API key，再登记 webhook：`http://你的机器:32000/webhook`（`whsec_` 只显示一次）
2. 把 key / secret / webhook secret 填进 `server.js` 开头的 `CONFIG`
3. `npm install && npm start`，打开 http://127.0.0.1:32000

连线上网关时，payment 打不到你的 `127.0.0.1`，webhook 要填公网地址，或把 `paymentEndpoint` 改成本机 `http://127.0.0.1:31000`。

`vendor/` 是还没上 npm 的 SDK，发布后可以删掉。
