export const config = { runtime: "edge" };

// normalize target once
const BASE = (() => {
  const raw = process.env.TARGET_DOMAIN || "";
  return raw.endsWith("/") ? raw.slice(0, -1) : raw;
})();

// hop-by-hop + unwanted headers
const BLOCKED = new Set([
  "host",
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "forwarded",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-forwarded-port",
]);

function buildTargetUrl(inputUrl) {
  const url = new URL(inputUrl);
  return BASE + url.pathname + url.search;
}

function filterHeaders(inHeaders) {
  const out = new Headers();
  let ip = null;

  for (const [key, value] of inHeaders.entries()) {
    if (BLOCKED.has(key)) continue;
    if (key.startsWith("x-vercel-")) continue;

    if (key === "x-real-ip") {
      ip = value;
      continue;
    }

    if (key === "x-forwarded-for") {
      if (!ip) ip = value;
      continue;
    }

    out.append(key, value);
  }

  if (ip) out.set("x-forwarded-for", ip);

  return out;
}

function shouldHaveBody(method) {
  return !(method === "GET" || method === "HEAD");
}

export default async function handler(req) {
  if (!BASE) {
    return new Response("Missing TARGET_DOMAIN", { status: 500 });
  }

  try {
    const target = buildTargetUrl(req.url);
    const headers = filterHeaders(req.headers);

    const init = {
      method: req.method,
      headers,
      redirect: "manual",
      duplex: "half",
    };

    if (shouldHaveBody(req.method)) {
      init.body = req.body;
    }

    return await fetch(target, init);
  } catch (e) {
    console.error("proxy failure:", e);
    return new Response("Upstream request failed", { status: 502 });
  }
}
