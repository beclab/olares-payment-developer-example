# olares-payment-user-demo

用 Olares Payment 收款的小店。买家用昵称进入、填收货并确认订单，再到托管收银台付款。店自己管商品和订单；网关只看见金额、可选的外部买家标签，以及 `metadata.order_id`。

店内状态是 `pending → paid → shipped`。收款完成（webhook 或回跳时 `getPayment`）只把订单标成 **Paid**；卖家在 `/admin` 点发货后才是 **Shipped**。

## 怎么跑

1. 打开 https://dashboard-front-test.mdogs.me ，建商户、填收款钱包、拿 API key，再登记 webhook：`http://你的机器:32000/webhook`（`whsec_` 只显示一次）
2. 把 key / secret / webhook secret 填进 `server.js` 开头的 `CONFIG`
3. `npm install && npm start`，买家打开 http://127.0.0.1:32000 ，卖家打开 http://127.0.0.1:32000/admin （用户名 `admin`，密码 `admin`）

连线上网关时，payment 打不到你的 `127.0.0.1`，webhook 要填公网地址。回跳页会用 `getPayment` 兜底，所以本机也能看到已付。

`vendor/` 是还没上 npm 的 SDK，发布后可以删掉。订单存在内存里，重启进程会丢。

## 接入要点

- `createPayment`：`amountCents`、`returnUrl`、`metadata.order_id`、`buyer: { kind: 'external', ref, display }`、幂等键 `shop:{orderId}:{seq}`
- 收银台回跳 `/?order=`：先 `getPayment`。`paid: true` 才履约为 Paid
- webhook：`payment.succeeded` → Paid；`failed` / `canceled` 回写店内状态
- 继续支付：未过期复用原 `checkoutUrl`；已取消或过期则同订单再开一单
- 发货是卖家动作，不是支付回调
