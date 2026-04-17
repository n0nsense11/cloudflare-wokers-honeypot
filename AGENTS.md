# Deployment Guide for AI Agents

This document describes everything needed to deploy the Honeypot Worker to a new Cloudflare account.

## What This Project Does

The Honeypot Worker detects and automatically blocks suspicious traffic by:
1. Capturing the `CF-Connecting-IP` from any request to the configured honeypot domain
2. Converting the IP to a subnet (IPv4: /24 by default, IPv6: /64 by default)
3. Storing the subnet in a Workers KV namespace
4. Updating a WAF Custom Rule to challenge/block all IPs within that subnet

## Prerequisites

You must have:
- [Wrangler](https://developers.cloudflare.com/workers/wrangler/install-and-update/) v4+
- A Cloudflare account with at least one zone configured
- An API token with the following permissions:

| Permission | Resource | Access |
|---|---|---|
| Workers Scripts | Account | Edit |
| Workers Routes | Zone | Edit |
| Account Rules Lists | Account | Edit |
| Zone WAF | Zone | Edit |

## Configuration Reference

All sensitive values are stored as Worker Secrets (not in `wrangler.toml`). Before deployment, you must set the following secrets using `wrangler secret put`:

```bash
wrangler secret put CF_API_TOKEN
# When prompted, paste your Cloudflare API token (starts with cfat_...)

wrangler secret put KV_NAMESPACE_ID
# When prompted, paste the KV namespace ID (a hex string like 74c...)
```

### wrangler.toml Variables

These go in `[vars]` section of `wrangler.toml`:

| Variable | Description | Default |
|---|---|---|
| `ZONE_ID` | Cloudflare Zone ID for your domain | Required |
| `WAF_RULESET_ID` | Ruleset ID for WAF Custom Rules phase (`http_request_firewall_custom`) | Required |
| `WAF_RULE_ID` | The specific rule ID to update with blocked subnets | Required |
| `SUBNET_V4` | IPv4 subnet prefix length (default: /24) | 24 |
| `SUBNET_V6` | IPv6 subnet prefix length (default: /64) | 64 |

### wrangler.toml Other Config

| Config | Description |
|---|---|
| `[[kv_namespaces]]` binding | Must match the binding name used in `updateWafRule()` function (currently `HONEYPOT_KV`) |
| `[[kv_namespaces]]` id | KV namespace ID - replace `<KV_NAMESPACE_ID>` with your actual ID |
| `[triggers] crons` | Cron schedule for periodic WAF sync (default: every 30 minutes) |
| `[observability] logs` | Enables persistent log storage in Cloudflare |

### Environment Variables Required (Worker Secrets)

| Secret Name | Description |
|---|---|
| `CF_API_TOKEN` | Cloudflare API token with permissions: Account Rules Lists Edit, Zone WAF Edit, Workers Scripts Edit |
| `KV_NAMESPACE_ID` | The Workers KV namespace ID to store IP subnets |

## Setup Steps

### 1. Create KV Namespace

```bash
wrangler kv namespace create HONEYPOT_KV
```

Copy the returned namespace ID and:
- Replace `<KV_NAMESPACE_ID>` in `wrangler.toml`
- Set as Worker secret: `wrangler secret put KV_NAMESPACE_ID`

### 2. Create WAF Custom Rule

In Cloudflare Dashboard → Security → WAF → Custom Rules, create a new rule with:
- **Expression**: `cf.threat_score gt 100` (placeholder - will be updated by Worker)
- **Action**: Managed Challenge

Or via API:

```bash
curl -X POST "https://api.cloudflare.com/client/v4/zones/<ZONE_ID>/rulesets/<WAF_RULESET_ID>/rules" \
  -H "Authorization: Bearer <API_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "description": "Honeypot subnet blocker",
    "expression": "cf.threat_score gt 100",
    "action": "managed_challenge",
    "enabled": true
  }'
```

Record the returned `rule_id` - this is your `WAF_RULE_ID`.

### 3. Set Worker Secrets

```bash
# CF API Token
wrangler secret put CF_API_TOKEN

# KV Namespace ID
wrangler secret put KV_NAMESPACE_ID
```

### 4. Deploy

```bash
wrangler deploy
```

### 5. Bind Custom Domain

In Cloudflare Dashboard → Workers & Pages → honeypot-worker → Triggers → Custom Domains:
- Add your honeypot subdomain (e.g., `honeypot.yourdomain.com`)

Or via API:

```bash
curl -X POST "https://api.cloudflare.com/client/v4/zones/<ZONE_ID>/workers/routes" \
  -H "Authorization: Bearer <API_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"pattern": "honeypot.yourdomain.com/*", "script": "honeypot-worker"}'
```

## WAF Rule Behavior

The Worker updates the WAF rule expression dynamically. After deployment, the rule expression will look like:

```
ip.src in {127.0.0.0/24 ::/64}
```

When a visitor accesses the honeypot domain, their IP is converted to a subnet and stored in KV. The next scheduled cron run (or the next incoming request) will update the WAF rule to block/challenge that entire subnet.

## Subnet Calculation

| IP Type | Example Input | Subnet Output (default) |
|---|---|---|
| IPv4 | 127.0.0.1 | 127.0.0.0/24 |
| IPv6 | ::1 | ::/64 |

Modify `SUBNET_V4` and `SUBNET_V6` in `wrangler.toml` to change subnet granularity.

## Architecture Summary

```
Visitor IP → Worker → KV (subnet list) → WAF Custom Rule
                  ↑                              ↑
            fetch handler                scheduled (cron) or next request
```
