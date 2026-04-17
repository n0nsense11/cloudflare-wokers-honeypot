# Honeypot Worker

If you are an AI agent, read [AGENTS.md](./AGENTS.md) directly.

[English](./README.md) | [中文](./README_CN.md)

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

完整的手动部署说明见 [AGENTS.md](./AGENTS.md)。核心步骤：

1. **创建 KV Namespace**：`wrangler kv namespace create HONEYPOT_KV`
2. **创建 WAF Custom Rule**：表达式填 `cf.threat_score gt 100`（占位），动作选 Managed Challenge
3. **填入配置**：将 Zone ID、Ruleset ID、Rule ID 填入 `wrangler.toml` 的 `[vars]`，KV Namespace ID 填入 `[[kv_namespaces]]`
4. **设置密钥**：`wrangler secret put CF_API_TOKEN`
5. **部署**：`wrangler deploy`
6. **绑定自定义域名**：在 Cloudflare Dashboard → Workers → honeypot-worker → Triggers → Custom Domains 添加你的蜜罐子域名

---

AI Agent 部署指南见 [AGENTS.md](./AGENTS.md)。