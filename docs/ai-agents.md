---
outline: [2, 3]
description: 用 AI 智能体创建一个集成 Olares Payment 的商城 demo 并安装到 Olares OS：准备好密钥后，由智能体完成支付集成、应用打包和 webhook 配置。
head:
  - - meta
    - name: keywords
      content: Olares Payment, AI agent, olares-cli, Agent Skills, demo store, Olares app, chart, webhook
---

# 用 AI 智能体构建

本文演示如何用 AI 智能体（AI agent）写一个集成 Olares Payment 的商城 demo，并把它发布到 Olares OS 中，即快速创建一个带支付功能、在任何地方都能访问的在线商店。

## 先决条件

- **AI 智能体**：任意 AI 编程智能体，如 Codex、Claude Code、Cursor、DeepSeek Harness 等。
- **olares-cli 和 Agent Skills**：已安装。参考[安装 olares-cli](../cli-install) 和[安装与使用 Agent Skills](../cli-agent-skills)。
- **已登录 Olares**：参考[登录 Olares](../cli-log-in)。登录成功的输出如下：

  ![term:olares-cli profile login 运行效果](images/cli-profile-login.png)

- **Olares Payment 商户账号和 API 密钥**：已用 LarePass 登录 [Olares Payment Dashboard](https://www.olares.com/payment/dashboard/)（首次登录会自动创建商户账号），并在 **Checkouts → Advanced settings → API keys** 创建密钥，拿到 `pk_live_…` 和 `sk_live_…`。详细步骤见 [Quickstart](./quickstart) 的前两步。

  ![cap:商户后台 Advanced settings：创建 API 密钥](images/dashboard-api-keys.png)

- **Docker**：本地已登录公共镜像仓库，第 4 步推送应用镜像时需要。

## 操作步骤

### 1. 新建仓库，保存密钥

新建一个 git 仓库，把密钥写入 `.env`（webhook 签名密钥先留空），并把 `.env` 加入 `.gitignore`：

```bash
mkdir my-store && cd my-store
git init
echo ".env" >> .gitignore
```

```bash
# .env
PAYMENT_API_KEY=pk_live_…
PAYMENT_API_SECRET=sk_live_…
PAYMENT_WEBHOOK_SECRET=   # 第 5 步登记 webhook 后再填
```

::: warning 密钥安全
整个流程中，密钥只应出现在本地 `.env`、商户后台和 Olares 应用的环境变量里，不要写进代码或提交到 git。如果密钥进入过 git 历史，请到商户后台轮换。
:::

### 2. 用智能体打开仓库

把这个仓库作为智能体的工作目录：在仓库目录下启动智能体 CLI（如 `codex`、`claude`），或在 Cursor 中打开该文件夹。

### 3. 创建商店

把下面这段提示词发给智能体：

```text
做一个最小的在线商店 demo（Node.js）：一个商品页面、一个下单接口、一个订单结果页。
用 Olares Payment 收款：
- 下单时调用 createPayment 创建支付，把 checkoutUrl 返回给前端，跳转到托管收银台
- 提供一个 /webhook 接口接收 payment.succeeded，验签通过后把订单标记为已支付
- 密钥从 .env 读取（PAYMENT_API_KEY / PAYMENT_API_SECRET / PAYMENT_WEBHOOK_SECRET），
  不要写进代码；webhook 签名密钥先留空，部署后再填

支付 API 文档：https://doc-review.mdogs.me/developer/payment/llms-full.txt
```

<!-- 发布前：上面提示词里的 llms-full.txt 链接切回生产地址 https://www.olares.com/docs/developer/payment/llms-full.txt（当前生产 404，暂用 review 站） -->

智能体会读完 API 文档，自己完成集成并跑起来。在本地验证下单和跳转收银台都正常后，进入下一步。

### 4. 打包成 Olares 应用并安装

把下面这段提示词发给智能体：

```text
把这个商店打包成 Olares 应用，安装到我的 Olares OS 上：
- 构建镜像并推送到公共镜像仓库
- 生成 chart：入口设为公开访问，支付密钥做成可配置的环境变量
- 上传并安装，完成后告诉我商店的访问地址
```

打包和安装的具体做法（生成 chart、lint、上传、安装、查看状态）都写在 `olares-chart`、`olares-market` 等 Skills 里，智能体会按需读取，不需要你逐条指导。

### 5. 配置 webhook

安装完成后，智能体会给出商店的访问地址（Olares 分配的固定域名）。用这个域名去商户后台登记 webhook，商店才能收到支付成功通知：

1. 进入 **Checkouts → Advanced settings → Webhooks**，把 webhook 地址填为 `https://<商店域名>/webhook`，保存后会生成签名密钥 `whsec_…`。

   ![cap:在商户后台登记 webhook 地址](images/dashboard-webhooks.png)

2. 自己把签名密钥填进本地 `.env` 文件（`PAYMENT_WEBHOOK_SECRET=whsec_…`），然后让智能体读取并同步到应用：

   ```text
   webhook 签名密钥已经填到 .env 里了。把它配置到商店应用的环境变量，并重启应用让配置生效。
   ```

关于 webhook 的验签、重试和调试，详见 [Webhooks](./webhooks)。

### 6. 验证商店

打开商店地址，下一单测试：跳转收银台、完成支付、返回商店看到订单已支付，整个流程就跑通了。这个地址是 Olares 分配的固定域名，商店从此可以在任何地方访问。

成功后的样子可以参考我们的示例：[olares-payment-developer-example](https://github.com/beclab/olares-payment-developer-example) 是按本文流程做出的完整 demo，下单、收银台、webhook、退款的闭环都在；它的在线实例 <https://dc86a2fa.olarespayment.olares.com/> 跑在 Olares OS 上，可以直接打开下一单。
