const FAKE_404_HTML = `<!DOCTYPE html>
<html>
<head><title>404 Not Found</title></head>
<body>
<h1>404 Not Found</h1>
<p>The requested URL was not found on this server.</p>
</body>
</html>`;

const ALL_IPS_KEY = "all_ips";

function isIPv6(ip) {
  return ip.includes(":");
}

function ipv4ToSubnet(ip, prefix) {
  const octets = ip.split(".").map(Number);
  const octetCount = Math.floor(prefix / 8);
  const remainingBits = prefix % 8;

  for (let i = octetCount; i < 4; i++) {
    octets[i] = 0;
  }
  if (remainingBits > 0 && octetCount < 4) {
    octets[octetCount] &= ~(255 >>> remainingBits);
  }

  return octets.join(".") + "/" + prefix;
}

function ipv6ToSubnet(ip, prefix) {
  const parts = ip.replace(/::/g, ":" + "0".repeat(9 - ip.split(":").length)).split(":");
  let num = 0n;
  for (const part of parts) {
    num = (num << 16n) | BigInt(parseInt(part || "0", 16));
  }
  const mask = (1n << 128n) - (1n << (128n - BigInt(prefix)));
  const result = num & mask;
  const segments = [];
  for (let i = 0; i < 8; i++) {
    segments.unshift((result >> BigInt(i * 16)) & 0xffffn);
  }
  const firstNonZero = segments.findIndex((s) => s !== 0n);
  let formatted;
  if (firstNonZero === -1) {
    formatted = "::";
  } else {
    const leading = segments.slice(firstNonZero);
    const trailing = [];
    for (let i = leading.length - 1; i >= 0; i--) {
      if (leading[i] === 0n) trailing.push("");
      else break;
    }
    const middle = leading.slice(0, leading.length - trailing.length);
    formatted = segments.slice(0, firstNonZero).map((s) => s.toString(16)).join(":");
    if (middle.length > 0) formatted += ":" + middle.map((s) => s.toString(16)).join(":");
    if (trailing.length > 0) formatted += "::" + trailing.map((s) => s.toString(16)).join(":");
  }
  if (!formatted.includes("::") && formatted.split(":").length < 8) {
    formatted = segments.map((s) => s.toString(16)).join(":");
  }
  return formatted + "/" + prefix;
}

function ipToSubnet(ip, subnetV4, subnetV6) {
  if (isIPv6(ip)) {
    return ipv6ToSubnet(ip, subnetV6);
  }
  return ipv4ToSubnet(ip, subnetV4);
}

async function updateWafRule(env) {
  const allIps = await env.HONEYPOT_KV.get(ALL_IPS_KEY);
  if (!allIps) return;

  const ipArray = allIps.split(",").filter(Boolean);
  if (ipArray.length === 0) return;

  let expression;
  if (ipArray.length === 1) {
    expression = `ip.src eq ${ipArray[0]}`;
  } else {
    expression = `ip.src in {${ipArray.join(" ")}}`;
  }

  const res = await fetch(
    `https://api.cloudflare.com/client/v4/zones/${env.ZONE_ID}/rulesets/${env.WAF_RULESET_ID}/rules/${env.WAF_RULE_ID}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${env.CF_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ expression, action: "managed_challenge" }),
    },
  );

  if (!res.ok) {
    console.error("WAF update failed:", res.status, await res.text());
  }
}

export default {
  async fetch(request, env, ctx) {
    const clientIP = request.headers.get("CF-Connecting-IP");
    if (!clientIP) {
      return new Response(FAKE_404_HTML, {
        status: 404,
        headers: { "Content-Type": "text/html" },
      });
    }

    const subnetV4 = parseInt(env.SUBNET_V4) || 24;
    const subnetV6 = parseInt(env.SUBNET_V6) || 64;

    const subnet = ipToSubnet(clientIP, subnetV4, subnetV6);

    const allIps = await env.HONEYPOT_KV.get(ALL_IPS_KEY);
    const knownSubnets = allIps ? allIps.split(",").filter(Boolean) : [];

    if (!knownSubnets.includes(subnet)) {
      knownSubnets.push(subnet);
      await env.HONEYPOT_KV.put(ALL_IPS_KEY, knownSubnets.join(","));
    }

    ctx.waitUntil(updateWafRule(env));

    return new Response(FAKE_404_HTML, {
      status: 404,
      headers: { "Content-Type": "text/html" },
    });
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(updateWafRule(env));
  },
};