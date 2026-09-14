# Refund 重构设计 — Harbor Goods 商城

> 状态：设计稿（实施前评审用）
> 范围：`olares-payment-developer-example`（下称 example）。`olares-payment`（下称网关仓）只读，作为协议与设计参照。

## 0. 结论先行

1. **SDK 不用等**。网关仓的 `packages/payment-sdk` 已实现完整 refund 面：
   - `MerchantClient.createRefund / getRefund / cancelRefund / reissueRefundLink`
   - `Payment.refundSummary`（挂在 `getPayment` 的 succeeded 单上）
   - webhook 已能解码 `refund.succeeded` / `refund.failed`（`RefundCallback` 是独立的消息形状）
   - 本仓 `vendor/payment-sdk` 是旧快照，**第一步就是同步 vendor**（7 个文件有 diff：`errors/mapping/webhook/wire/merchant-client/types/base/types/merchant`）。
2. **职责切分**（与网关仓的设计一致；已按 refund v3 step 8–11 更新）：
   - 网关 = 退款"收银台"：execution page 下发 calldata、接收 tx hash、链上 verify loop、终态 webhook；并托管**买家收据页**（step 9，`/receipt?intent_id=…&client_secret=…`）。
   - dashboard = Olares 托管的退款操作台（step 10：`RefundCreateModal` / `RefundCreatedModal` / TxDrawer 的 `RefundSection`）。
   - example = **SDK 驱动的嵌入式对照实现**：把 dashboard 同款的退款管理（发起、账本、重试、取消、买家展示）用 `@olares/payment-sdk` 长在你自己的订单系统里。UI 直接对齐 dashboard step 10 的组件语汇。
3. UI 全面对齐 dashboard 的 **Ledger 设计语言**（`dashboard-front/src/styles/tokens.css`），商城从现在的 serif/暖纸风格迁移到 mist 画布 + 白卡 + indigo 主色。

## 1. 网关侧 refund 模型（读到的事实，作为约束输入）

### 1.1 状态机（`domain/refund/model/refund-status.ts` / `refund.proto`）

```
prepared ──submit(人工交 tx hash)──▶ submitted ──verify(链上证据)──▶ succeeded(终态)
   │                                    │
   │                                    └─fail(revert/不匹配)──▶ failed ─┐
   ├──cancel──▶ canceled(终态)          failed ──submit/claim──▶ submitted（可重试）
   └──claim(链上先见到广播 tx)──▶ submitted   failed ──cancel──▶ canceled
```

- 事件驱动，无超时自动迁移；时间只产生只读提示（`preparedStale` / `stuck`）。
- **一个支付同时只能有一个未结清退款**（`uk_refunds_one_open`；`prepared/submitted/failed` 都占额，只有 `canceled` 释放额度）。
- 金额是 token 最小单位 string，只能 BigInt 运算；`remainingRefundable = received − Σsucceeded`。

### 1.2 网关 API 面（merchant key 专属）

| RPC | 说明 |
|---|---|
| `CreateRefund(payment_id, amount?, reason?, return_url?)` | amount 缺省 = 剩余可退全额；返回 `RefundHandoff` |
| `GetRefund(refund_id)` | 单笔全字段商户视图（含 reason、stale/stuck 提示） |
| `CancelRefund(refund_id)` | prepared/failed → canceled，唯一的额度释放 |
| `ReissueRefundLink(refund_id)` | 轮换 secret，旧 execution 链接立即失效 |

`RefundHandoff = { refund, route, refund_execution_url, execution_expires_at }` —— 明文 secret 只在 URL fragment 出现一次，**不落库、不打日志**，交给操作员（卖家）去退款执行页签名广播。

错误码闭集：1901 未满足退款前提 / 1902 超额 / 1905 路由不可退 / 1906 已有未结清退款。

### 1.2b step 8–11 带来的新事实（2026-09 更新）

- **step 8**：checkout-front 落地了**托管退款执行页**（单卡 shell、执行端点、快照与流转）——与 §1.2 的 executionUrl 假设完全吻合，无需改设计。
- **step 9**：新增**买家收据页** `/receipt?intent_id=…&client_secret=…`（含 succeeded 退款条目、fullyRefunded）；dashboard 详情已下发 `receipt_url`（proto `PaymentIntentView.receipt_url`，仅单条详情）。**SDK 的 `getPayment` 尚未带 receiptUrl**——见 §6。
- **step 9b**：支付页与退款执行页共用一个合约钱包探针，**合约钱包（L0）在两侧都会被拦截**。退款操作员签名钱包必须是 EOA。
- **step 10**：dashboard 退款操作台上线（`RefundCreateModal` / `RefundCreatedModal` / `RefundSection` + `utils/refund.ts` 派生助手）——example 的 admin UI 以这套组件为交互与视觉的**第一参照**（第二参照才是通用 Ledger 令牌）。
- **step 11**：home KPI + 交易流搜索/退款投影，均为 dashboard 专属后端，不经过网关 merchant API，对本设计无影响（`stats()` 的"已退/净收入"口径与 KPI 的 refund badge 概念同源）。
- **SDK 在 step 8–11 中零改动**：vendor 同步范围仍是那 7 个文件。

### 1.3 对账数据源

- `getPayment(succeeded 单).refundSummary`：`receivedAmount / refundedAmount / remainingRefundable / refundable / nonRefundableReason / route / refunds[]`（买家安全裁剪：仅 succeeded 条目）。
- webhook：`refund.succeeded`（带 txHash、succeededAt）、`refund.failed`（带 failReason）。**注意 `RefundCallback` 没有 metadata**，只能靠 `refund_id` / `intent_id` 定位订单 → example 需要维护 `refundId → orderId` 映射。

## 2. Example 侧订单生命周期重构

### 2.1 现状

`pending_payment → paid → shipped`，以及 `failed / canceled`（终态）。退款维度完全缺失。

### 2.2 目标状态机

支付维度不变，新增退款维度（订单上的是**汇总视图**，明细在退款账本）：

```
订单:  pending_payment ──▶ paid ──▶ shipped
                         │  │
                         │  └─(退款)─▶ refund_open ──▶ partially_refunded ──▶ refunded
                         │                 │
                         └─(退款)──────────┘   refund_open 可回 paid/shipped（取消时）
失败终态: failed / canceled（不变）
```

规则：

| 订单状态 | 进入条件 | 允许的动作 |
|---|---|---|
| `pending_payment` | 下单 | 支付 / 取消 |
| `paid` / `shipped` | 网关 paid | 发货（paid→shipped）、发起退款 |
| `refund_open` | 存在占额退款（prepared/submitted/failed） | 取消退款、重签链接（failed 后重试）；**不能再发货、不能再开新退款**（镜像网关 1906） |
| `partially_refunded` | 有 succeeded 退款且 remaining > 0 | 可再退（合计 ≤ remaining） |
| `refunded` | remainingRefundable == 0 | 终态 |

- 退款允许在 `paid` 和 `shipped` 上发起（对应"仅退款"与"退货退款"两种商户场景），demo 里用 reason 区分。
- 订单层状态由**退款账本推导**（`recomputeRefundView(order)`），不自己另记一份真相，避免和网关漂移。

### 2.3 数据结构（server.js，仍为内存 Map）

```js
// order 新增
refundView: {
  receivedAmount, refundedAmount, remainingRefundable,   // 最小单位 string
  refundable, nonRefundableReason, route,                 // 镜像 refundSummary
}
// 独立账本
refunds = Map<refundId, {
  refundId, orderId, paymentId,
  amount, status,            // 网关 REFUND_STATUS_*
  txHash, failReason, reason,
  executionUrl, executionExpiresAt,   // executionUrl 只在创建/重签后的响应里出现一次，不落库（前端弹窗展示）
  createdAt, updatedAt,
}>
order.refundIds = []
```

同步策略（三层，和现有支付同步同构）：

1. **webhook 快车道**：`refund.succeeded|failed` → 按 `refund_id` 找到本地退款行，更新状态并 `recomputeRefundView`。
2. **拉取兜底**：`syncOrder` 在订单已支付时顺带 `getPayment` 取 `refundSummary` 对账（return-url / 列表刷新时触发）；`refund_open` 的单再 `getRefund` 刷新明细。
3. **手动刷新**：admin 详情页按钮。

## 3. API 变更（server.js）

买家侧（只读，退款是卖家动作）：

- `GET /api/orders` / `GET /api/orders/:id` — 响应带 `refundView` + succeeded 退款列表（买家安全裁剪：不带 reason）。

卖家侧（admin）：

| 端点 | 语义 | 网关调用 |
|---|---|---|
| `POST /api/admin/orders/:id/refund` | 发起退款 `{ amountMin?, reason }` | `createRefund`；响应一次性携带 `executionUrl`（前端弹"去签名"） |
| `GET  /api/admin/orders/:id/refunds` | 该单退款账本（全状态） | 本地 + `getRefund` 刷新 |
| `POST /api/admin/refunds/:rid/cancel` | 取消草稿/失败单 | `cancelRefund` |
| `POST /api/admin/refunds/:rid/reissue` | 重签执行链接 | `reissueRefundLink`；响应一次性携带新 `executionUrl` |

守卫（在网关守卫之前先本地挡一道，报错可读）：订单必须是 `paid/shipped/partially_refunded`；不得已有占额退款；金额 ≤ remainingRefundable。网关错误码 1901/1902/1905/1906 原样透传为文案。

webhook：`applyWebhook` 增加 `refund.succeeded` / `refund.failed` 分支（新的事件形状：`refundId` 有、`metadata` 无，匹配逻辑按 refundId → intentId 两级）。

`stats()` 增加：`refundedCents`（Σ succeeded 退款）、`refundOpen` 计数、净收入 = 已收 − 已退。

## 4. UI 重设计 — 对齐 dashboard 的 Ledger 风格

### 4.1 设计令牌（直接搬 `dashboard-front/src/styles/tokens.css`）

```
--bg: #f8fafd        画布 mist          --acc: #635bff   品牌 indigo
--card: #ffffff      卡片               --r-card: 10px   卡片圆角
--ink / --ink2 / --ink3  三级文字        --r-ctl: 7px     控件圆角
--line: #e5edf5      frost 边框          --sh-card: 极浅投影
green #0e9f5b / amber #b07200 / red #d4353f + 各自 -soft 底色 → 状态徽章
.num tabular-nums；.mono SF Mono — 金额与哈希的展示纪律
```

组件语汇照搬 dashboard：白卡 + `--line` 1px 边 + `--sh-card`；表格表头 11px 大写字距 0.07em 的 `--ink3`；FChip 式筛选片；DBadge 式状态徽章（soft 底色 + 深色字）；弹窗/抽屉用 `--sh-pop`。字体从 serif 换成系统 UI sans（dashboard 同款）。

### 4.2 买家页 `index.html`

- 布局：顶部细导航（昵称 / My orders / Seller admin），mist 画布上白卡商品网格。
- 订单列表每行加退款汇总徽章：`Refund pending`（amber）/ `Partially refunded`（amber）/ `Refunded`（green soft 反义——用 red-soft？统一用 neutral+文案，避免和失败混淆，见 §6 开放问题）。
- 订单详情（弹窗）增加"Refunds"区块：succeeded 条目（金额、txHash mono 可复制、时间）；同时给出**网关托管收据页**外链（step 9 的 `/receipt` 页，买家凭证视角的完整退款记录）。URL 拼法见 §6 开放问题 5。

### 4.3 卖家页 `admin.html`

- KPI 行：Orders / Paid / Shipped / **Refunded** / **Net revenue**。
- 订单表新增 Refund 列（徽章 + 已退/可退金额）；行点击开**抽屉**（dashboard TxDrawer 式）：
  - 订单事实 + 链上凭证；
  - 退款账本表（全状态、stale/stuck 提示）；
  - 动作区：`Refund…`（金额 + reason 表单，默认 remaining 全额）、`Cancel refund`、`Reissue link`；
  - `executionUrl` 只在创建/重签成功后的弹窗中一次性展示（CopyBox 式复制 + 过期时间 + "打开执行页"按钮），提示绝不入库。
- **交互与视觉的第一参照是 dashboard step 10 的退款组件**：`RefundCreateModal`（金额表单 + 余额校验文案）、`RefundCreatedModal`（一次性链接弹窗，注意 step 10 还修过"详情刷新不能杀掉链接弹窗"）、`RefundSection`（账本渲染 + stale/stuck 提示）、`utils/refund.ts`（状态→徽章派生，含单测）。example 实现时语义对齐这套派生逻辑，视觉对齐 §4.1 令牌。

### 4.4 状态 → 视觉映射（全站统一一张表）

| 状态 | 色 |
|---|---|
| pending_payment | amber soft |
| paid / shipped | green soft |
| refund_open | amber（加 spinner 语义文案 awaiting signature / awaiting on-chain） |
| partially_refunded | amber soft |
| refunded | indigo soft（区别于失败的 red） |
| failed / canceled | red soft / neutral |

## 5. 实施拆步

1. **P0 vendor 同步**：把网关仓 `packages/payment-sdk/src` 的 7 个 diff 文件同步进 `vendor/payment-sdk`（refund API + webhook 解码都在其中），`npm install` 重链。
2. **P1 服务端**：退款账本 + 状态推导 + webhook 分支 + §3 端点 + stats 扩展。
   - 代码约定：**沿 `server.js` 现有风格与布局**——退款逻辑集中为一个横幅分区（Orders 之后、HTTP 之前）；函数头 JSDoc 讲网关契约（错误码语义写在注释里）；命名沿用 `markXxx` / `publicXxx` 动词族；守卫前置 early-return 的平铺风格；不引入新抽象层与新依赖；唯一改动现有函数的是 `applyWebhook`（尾部加两个分支 + 形状说明注释）。
3. **P2 卖家 UI**：admin 改 Ledger 风 + 退款抽屉 + executionUrl 一次性弹窗。
4. **P3 买家 UI**：index 改 Ledger 风 + 订单退款展示。
5. **P4 文档**：README 增补 refund 集成章节 + `examples/05-create-refund.js`（演示 createRefund → executionUrl → getRefund → webhook 全链路脚本）。

每步独立可跑、可演示。

## 6. 开放问题

1. `refunded` 终态徽章配色：indigo soft vs red soft（当前倾向 indigo，避免与 failed 混淆）。
2. 买家侧是否展示"退款处理中"（当前方案：展示，不带 reason 与内部提示）。
3. demo 商家操作员签名钱包：退款执行页需要操作员用**EOA** 收款钱包签名广播（step 9b 起合约钱包被两侧页面拦截）—— demo 里就用网关自带的 simulated 流程，不在 example 内造钱包 UI。
4. `executionExpiresAt` 过期后的引导文案（检测过期 → 直接给 Reissue 按钮还是提示）。
5. 买家收据页外链的 URL 来源：dashboard 走后端下发的 `receipt_url`，但 SDK `getPayment` 还没有这个字段。过渡方案 = example 服务端用 `payment.clientSecret` 自拼 `/receipt?intent_id=…&client_secret=…`（脆弱，checkout 基址写死）；更稳的是等 SDK 补 `receiptUrl`——已列入对网关仓的反馈项。
