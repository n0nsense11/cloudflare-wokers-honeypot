# Honeypot Worker

如果你是一个 AI Agent，直接阅读 [AGENTS.md](./AGENTS.md)。

英文说明见 [README.md](./README.md)。

---

## 功能概述

任何访问蜜罐域名的请求都会被自动记录，并将该 IP 所在的子网加入 Cloudflare WAF 安全规则进行挑战/屏蔽。

```
访客 IP → Worker → KV（子网列表）→ WAF Custom Rule
                  ↑                              ↑
            fetch handler              定时同步（每30分钟）或下次请求
```

## 配置项说明

所有敏感信息通过 Worker Secrets 注入，`wrangler.toml` 中不存放任何密钥。

| 配置项 | 说明 | 默认值 |
|---|---|---|
| `SUBNET_V4` | IPv4 子网前缀长度，设为 /32 则只记录单个 IP | 24 |
| `SUBNET_V6` | IPv6 子网前缀长度，设为 /128 则只记录单个 IP | 64 |
| `ZONE_ID` | Cloudflare Zone ID | 必填 |
| `WAF_RULESET_ID` | WAF Custom Rules 阶段的 Ruleset ID | 必填 |
| `WAF_RULE_ID` | 要更新的具体规则 ID | 必填 |

Cron 定时同步每 30 分钟执行一次，确保 WAF 规则始终与 KV 中记录的子网列表同步。

### 子网粒度示例

| IP 类型 | 输入 | SUBNET=24/64 输出 | SUBNET=32/128 输出 |
|---|---|---|---|
| IPv4 | 127.0.0.1 | 127.0.0.0/24 | 127.0.0.1/32 |
| IPv6 | ::1 | ::/64 | ::1/128 |

## 手动部署步骤

### 1. 创建 KV Namespace

```bash
wrangler kv namespace create HONEYPOT_KV
```

复制返回的 Namespace ID，填入 `wrangler.toml` 的 `[[kv_namespaces]].id`，并设为 Worker Secret：

```bash
wrangler secret put KV_NAMESPACE_ID
# 输入你的 KV Namespace ID
```

### 2. 创建 WAF Custom Rule

在 Cloudflare Dashboard → Security → WAF → Custom Rules 创建规则：

- **表达式**：`cf.threat_score gt 100`（占位符，Worker 会自动更新）
- **动作**：Managed Challenge

记录返回的 Rule ID，作为 `WAF_RULE_ID`。

### 3. 获取 Ruleset ID

通过 API 获取 WAF Custom Rules 阶段的 Ruleset ID：

```bash
curl -s "https://api.cloudflare.com/client/v4/zones/<ZONE_ID>/rulesets?phase=http_request_firewall_custom" \
  -H "Authorization: Bearer <API_TOKEN>" | jq '.result[] | {id, phase}'
```

找到 `phase` 为 `http_request_firewall_custom` 的规则集 ID，填入 `WAF_RULESET_ID`。

### 4. 填写 wrangler.toml

```toml
name = "honeypot-worker"
main = "src/index.js"
compatibility_date = "2024-09-23"

[observability]
logs.enabled = true
logs.persist = true

[triggers]
crons = ["*/30 * * * *"]

[[kv_namespaces]]
binding = "HONEYPOT_KV"
id = "你的KV_NAMESPACE_ID"      # 替换为实际 ID

[vars]
ZONE_ID = "你的ZONE_ID"          # 替换为实际 ID
WAF_RULESET_ID = "你的RULESET_ID"  # 替换为实际 ID
WAF_RULE_ID = "你的RULE_ID"      # 替换为实际 ID
SUBNET_V4 = "24"
SUBNET_V6 = "64"
```

### 5. 设置 API Token Secret

```bash
wrangler secret put CF_API_TOKEN
# 输入你的 Cloudflare API Token（格式：cfat_...）
```

Token 需要的权限：Account Rules Lists Edit、Zone WAF Edit、Workers Scripts Edit。

### 6. 部署

```bash
wrangler deploy
```

### 7. 绑定自定义域名

在 Cloudflare Dashboard → Workers & Pages → honeypot-worker → Triggers → Custom Domains 添加你的蜜罐子域名（如 `honeypot.yourdomain.com`）。

## 工作原理

1. 访客访问蜜罐域名（如 `honeypot.yourdomain.com/anything`）
2. Worker 提取 `CF-Connecting-IP`，转换为子网格式（IPv4 /24，IPv6 /64）
3. 子网存入 KV
4. 下一次请求或每 30 分钟的 Cron 触发时，Worker 调用 Cloudflare API 更新 WAF 规则
5. 同一子网的后续访问直接被 WAF 规则拦截（Managed Challenge）

---

AI Agent 部署指南见 [AGENTS.md](./AGENTS.md)。