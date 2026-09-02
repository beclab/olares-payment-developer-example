# olares-payment-user-demo

用 Olares Payment 收款的小店。买家用昵称进入、填收货并确认订单，再到收银台付款。下单时会把店内用户标成可选的 `buyer: { kind: 'external', ref, display }` 传给网关（`ref` 是店内用户 id，`display.name` 是昵称），payment dashboard 的 Transactions 就能标出 Buyer；商家不想把客户资料放到 payment 侧的话可以不传 `buyer`，dashboard 会显示 Anonymous buyer。webhook 把 `order_id` 和支付凭证粘回商店后自动发货。卖家看 `/admin`。

## 怎么跑

1. 打开 https://dashboard-front-test.mdogs.me ，建商户、填收款钱包、拿 API key，再登记 webhook：`http://你的机器:32000/webhook`（`whsec_` 只显示一次）
2. 把 key / secret / webhook secret 填进 `server.js` 开头的 `CONFIG`
3. `npm install && npm start`，买家打开 http://127.0.0.1:32000 ，卖家打开 http://127.0.0.1:32000/admin （用户名 `admin`，密码 `admin`）

连线上网关时，payment 打不到你的 `127.0.0.1`，webhook 要填公网地址。

`vendor/` 是还没上 npm 的 SDK，发布后可以删掉。
