# Olares Payment SDK 使用指南

> `@olares/payment-sdk` — 通过 HMAC 签名访问 Olares Payment 网关的 TypeScript SDK。
> 仅供后端使用（持有 secret，勿暴露到浏览器）。

---

## 快速开始

### 安装

```bash
npm install @olares/payment-sdk
```

### Market（平台）后端 — 3 行跑通支付

```ts
import { PlatformClient } from '@olares/payment-sdk';

const market = new PlatformClient({
  apiKey: process.env.PAYMENT_API_KEY!,
  apiSecret: process.env.PAYMENT_SECRET!,
  baseUrl: process.env.PAYMENT_ENDPOINT!,
});

// 替买家下单 → 一步拿到收银台 URL
const { paymentId, checkoutUrl } = await market.createPayment({
  merchantAccountId: 'acct_xxx',       // 收款方（已挂接的商户）
  buyerOlaresId: 'alice.olares.com',   // 可选，省略 = 匿名单
  amountCents: 1999,                   // $19.99
  currency: 'usd',                     // 计价币种（目前只支持 usd）
  returnUrl: 'https://your-app.com/done',
});

// 把 checkoutUrl 给前端跳转，买家在收银台付款
```

### Merchant（商户）后端 — 查 + 收 webhook

```ts
import { MerchantClient, webhooks } from '@olares/payment-sdk';

const merchant = new MerchantClient({
  apiKey: process.env.MERCHANT_API_KEY!,
  apiSecret: process.env.MERCHANT_SECRET!,
  baseUrl: process.env.PAYMENT_ENDPOINT!,
});

// 查一笔付款是否到账
const result = await merchant.getPayment(paymentId);
if (result.paid) {
  console.log(result.credential.txHash);  // 链上凭证 → 发货
}

// 收到 payment 回调时验签（Express 示例）
app.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const event = webhooks.constructEvent(req, WEBHOOK_SECRET);
  if (event.type === 'payment.succeeded') {
    // event.paymentId + event.credential.txHash
  }
  res.status(200).send('ok');
});
```

---

## SDK 整体架构

SDK 提供两个 Client，**按你的角色选一个**：

- **PlatformClient** — 给**平台**（如 Market 应用商店）后端用。平台替买家发起收款（代商户收），持有 **platform key**。
- **MerchantClient** — 给**商户**（卖家）后端用。商户自助收款 + 管自己的订单和钱包，持有 **merchant key**。

两个 Client 底层共用同一个传输层（HMAC 签名 + axios + timeout），区别只是：**暴露哪些方法 + 用什么 key**。用 platform key 调 merchant 专属方法（如 `listReceiveWalletTransactions`），网关会直接拒绝——权限由后端的 capability 矩阵强制。

### 怎么选？

```
你是 Market（平台）后端？  → PlatformClient + platform key
你是 Merchant（商户）后端？ → MerchantClient + merchant key
```

### 职责对比

| | PlatformClient | MerchantClient |
|---|---|---|
| **角色** | 代收方（替买家下单，代商户收款） | 收款方（自助收款，管自己的订单/钱包） |
| **持什么 key** | platform key（绑平台账户） | merchant key（绑商户自己的账户） |
| **createPayment** | 代已挂接的商户收款（merchantAccountId **必填**） | 自助收款（merchantAccountId 省略，从 key 推断） |
| **getPayment** | ✅ 查询 + 轮询 | ✅ 查询 + 履约判断 |
| **listPayments** | ❌（平台不枚举） | ✅（订单列表 / 对账） |
| **listChannels / listReceiveWalletTransactions** | ❌（网关拒） | ✅（收款通道 / 收款钱包流水） |
| **getAccount** | ❌（/api/getAccount 拒 platform） | ✅（读自己账户） |
| **ping** | ✅（连通 + key 身份） | ✅（连通 + key 身份） |
| **verifyTransaction** | ✅ | ✅ |
| **webhook 验签** | ✅（`webhooks.constructEvent`） | ✅（同左） |

---

## 核心场景

### PlatformClient 场景（平台 / Market 后端）

平台是**代收方**——替买家下单，钱进商户的钱包。

#### 创建支付（代商户收款）

```ts
const { paymentId, checkoutUrl } = await market.createPayment({
  merchantAccountId: 'acct_xxx',       // 必填：指定代哪个商户收款（须已挂接）
  buyerOlaresId: 'alice.olares.com',   // 可选，省略 = 匿名单
  buyerDid: 'did:olares:xxx',          // 可选（扫码登录带入，需配对 buyerOlaresId）
  amountCents: 1999,
  currency: 'usd',                     // 可选，默认 usd
  metadata: { productId: 'app-123' },  // 可选业务字段
  returnUrl: 'https://your-app.com/done',
});
```

返回 `{ paymentId, checkoutUrl }`——把 checkoutUrl 给前端跳转，买家进收银台付款。

**幂等**（防重复下单，重试安全）：
```ts
await market.createPayment(params, {
  idempotencyKey: `purchase:${orderId}`,  // 按业务身份派生，重试复用
});
```

#### 查询支付状态（轮询是否成功）

```ts
const result = await market.getPayment(paymentId);
if (result.paid) {
  // 买家付了 → 给买家开通权益
} else {
  // 还没付 → 看 result.payment.status
}
```

#### 连通性检查（启动自检）

```ts
const info = await market.ping();
// { isPlatform: true, accountId: 'acct_olares_market', ... }
```

#### 核验链上交易（极端场景用）

```ts
const v = await market.verifyTransaction(txHash, 'optimism', 'mainnet');
if (v.confirmed) { /* 链上确认了 */ }
```

---

### MerchantClient 场景（商户 / 卖家后端）

商户是**收款方**——收钱、查自己的订单、管钱包。

#### 创建支付（自助收款）

```ts
const { paymentId, checkoutUrl } = await merchant.createPayment({
  amountCents: 1999,
  currency: 'usd',
  returnUrl: 'https://your-app.com/done',
  metadata: { order_id: 'ord_123' },   // 回调时凭它找回自己的单
  // buyerOlaresId 省略——匿名单，买家身份不进网关
  // merchantAccountId 省略——网关从 key 自动推断为"自己"
});
```

#### 查询支付状态（履约判断）

```ts
const result = await merchant.getPayment(paymentId);

if (result.paid) {
  // 已支付：result.credential 含链上凭证
  const { txHash, payAmount, payCurrency, chain } = result.credential;
  // → 发货 / 签发 VC
} else {
  // 未支付：读 result.payment.status 了解卡在哪
  // requires_payment_method / processing / canceled
}
```

> **履约判断封装在 SDK 里**：`paid: true` = `status === 'succeeded' AND latestAttempt.txHash`。succeeded 但无 txHash 的异常返回 `paid: false`（不履约）。

#### 订单列表（对账）

```ts
const { items, hasMore, nextCursor } = await merchant.listPayments({
  status: 'succeeded',   // 可选：按状态过滤
  limit: 20,             // 默认 20，上限 200
});
// 翻页：下次传 cursor: nextCursor
```

#### 收款通道 + 收款钱包流水

```ts
// 收款通道（哪些链 + 哪些币 + 收款钱包地址）
const { channels } = await merchant.listChannels();

// 收款钱包流水（按 blockNumber 倒序）
const { items } = await merchant.listReceiveWalletTransactions({
  address: '0xYourWallet',  // 可选：按收款钱包过滤
  limit: 50,
});
```

#### 读取自己的账户信息

```ts
const info = await merchant.getAccount();
// { accountId, did, olaresId, status }
```

#### 连通性检查 + 核验

```ts
await merchant.ping();  // { isPlatform: false, accountId: 'acct_xxx', ... }

const v = await merchant.verifyTransaction(txHash, 'optimism');
// 或配了 rpcUrl 直连链上：
const v = await merchant.verifyTransaction(txHash);  // 走 rpcUrl
```

---

### 两边通用：Webhook 验签

不管你是平台还是商户，收到 payment 回调时都用同一个函数验签：

```ts
import { webhooks } from '@olares/payment-sdk';

app.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  try {
    const event = webhooks.constructEvent(
      req,                           // Express req（body + headers，SDK 自己拆）
      process.env.WEBHOOK_SECRET!,   // whsec_...（dashboard 登记时拿到）
    );

    switch (event.type) {
      case 'payment.succeeded':
        // event.paymentId, event.credential.txHash, event.paidAt
        break;
      case 'payment.failed':
        // event.paymentId, event.failReason
        break;
      case 'payment.canceled':
        // event.paymentId, event.cancellationReason
        break;
    }
    res.status(200).send('ok');  // 必须 2xx，否则网关重试
  } catch (e) {
    // 验签失败 — 绝不能当成功处理
    res.status(400).send('bad signature');
  }
});
```

> **webhook endpoint 在 dashboard 登记**，登记时拿到 `whsec_`（只此一次，存好）。
> **body 必须是原始字节**（用 `express.raw`，不是 `express.json`）；SDK 从 `response.body` / `response.headers` 自己拆签名头。

---

## ClientOptions 参数说明

```ts
new PlatformClient({
  apiKey: string;        // 必填：pk_live_xxx
  apiSecret: string;     // 必填：sk_live_xxx（HMAC 签名用，勿泄露）
  baseUrl?: string;      // 网关地址，默认 http://localhost:31000
  logger?: SdkLogger;    // 日志器，默认 console；传 () => {} 静默
  timeoutMs?: number;    // 请求超时(ms)，默认 30000
  rpcUrl?: string;       // EVM RPC URL；配了则 verifyTransaction 直连 RPC
});
```

---

## 何时使用 verifyTransaction？

**短回答：正常场景不需要。**

你的日常履约流程：

```
getPayment → paid: true → 看 credential.txHash → 发货
                  ↑
            或 webhook payment.succeeded（推送 credential）
```

这两条已经覆盖了 99% 的场景。网关已经帮你查了链上确认（succeeded = tx 已上链 + status success），SDK 把判定封装在 `paid` 里。

**verifyTransaction 是保险栓，只在「不信任网关判定」的极端场景用：**

| 场景 | 为什么 |
|---|---|
| **高价值履约前二次核验**（签发 VC / 开通永久权益） | 防网关误判或被攻破，独立确认 tx_hash 真在链上 success |
| **网关不可达时的降级** | 网关宕机，但你有 tx_hash，配 `rpcUrl` 直连链上查 |
| **争议对账** | 买家说"付了"但网关 unpaid → 直连链上查，谁对谁错一目了然 |

**一句话**：`getPayment` + `webhook` 是两条腿（查询 + 推送），`verifyTransaction` 是第三条独立核验腿。日常走路两条腿够，关键时刻（大额/永久权益）加第三条保险。

---

## 错误处理

SDK 统一抛 `PaymentError`：

```ts
import { PaymentError, PAYMENT_NOT_FOUND, PERMISSION_DENIED } from '@olares/payment-sdk';

try {
  await client.getPayment(paymentId);
} catch (e) {
  if (e instanceof PaymentError) {
    console.log(e.code);        // 错误码（数字）
    console.log(e.httpStatus);  // HTTP 状态码（SDK 本地错误为 0）
    console.log(e.message);     // 错误描述
  }
}
```

### 错误码表

**网关业务码（1000-1699）**：请求到达了网关，网关返回的业务错误。

| 段 | 代表码 | 含义 |
|---|---|---|
| 1000-1099 System | 1000 INTERNAL_ERROR | 服务端内部错误 |
| 1100-1199 Parameter | 1100 INVALID_ARGUMENT | 参数错误 |
| 1200-1299 Resource | 1203 PAYMENT_NOT_FOUND | 支付不存在 |
| 1300-1399 Permission | 1300 PERMISSION_DENIED | 权限不足 |
| 1400-1499 Business | 1402 STATE_MACHINE_VIOLATION | 非法状态转换 |
| 1500-1599 Auth | 1500 SIGNATURE_MISMATCH / 1501 INVALID_API_KEY | 鉴权失败 |

**SDK 传输码（1900+）**：请求没到网关（本地失败）。

| 码 | 常量 | 含义 |
|---|---|---|
| 1901 | SDK_TIMEOUT | 请求超时 |
| 1902 | SDK_NETWORK_ERROR | 网络错误（连不上 / 非 JSON） |
| 1903 | SDK_RPC_ERROR | 直连 RPC 失败 |

**判断逻辑**：
```ts
if (e.code >= 1900) {
  // SDK 本地错误（网关没收到请求）→ 重试可能有效
} else {
  // 网关业务错误 → 看 e.code 决定怎么处理
}
```

---

## Payment 对象（返回值）

```ts
interface Payment {
  paymentId: string;
  merchantAccountId: string;
  buyerOlaresId: string;
  amountCents: number;
  currency: 'usd';
  status: 'requires_payment_method' | 'processing' | 'succeeded' | 'canceled';
  settlementCurrency: string | null;  // 实付币种（USDC/USDT）
  settlementAmount: number | null;
  clientSecret: string | null;        // 仅 createPayment 返回时非空
  latestAttempt: LatestAttempt | null; // 最近一次扣款尝试
  metadata: Record<string, unknown>;
  expiresAt / canceledAt / paidAt / createdAt / updatedAt: Timestamp | null;
}
```
