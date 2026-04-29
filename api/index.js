// Run on Edge to keep response time low and closer to the user
export const config = { runtime: "edge" };

// Base target domain (comes from env)
// trailing slash is trimmed to avoid double slashes when joining paths
const TARGET_BASE = (process.env.TARGET_DOMAIN || "").replace(/\/$/, "");

// Headers that should never be forwarded (hop-by-hop or problematic)
const STRIP_HEADERS = new Set([
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

export default async function handler(req) {
  // fail fast if env is not set properly
  if (!TARGET_BASE) {
    return new Response("Misconfigured: TARGET_DOMAIN is not set", { status: 500 });
  }

  try {
    // find where the actual path starts (skip protocol + host)
    const pathStart = req.url.indexOf("/", 8);

    // rebuild destination URL based on incoming request
    const targetUrl =
      pathStart === -1
        ? TARGET_BASE + "/"
        : TARGET_BASE + req.url.slice(pathStart);

    // prepare outgoing headers (filtered copy of incoming ones)
    const out = new Headers();
    let clientIp = null;

    for (const [k, v] of req.headers) {
      // skip restricted headers
      if (STRIP_HEADERS.has(k)) continue;

      // ignore vercel internal headers
      if (k.startsWith("x-vercel-")) continue;

      // keep track of client IP for forwarding
      if (k === "x-real-ip") {
        clientIp = v;
        continue;
      }

      if (k === "x-forwarded-for") {
        if (!clientIp) clientIp = v;
        continue;
      }

      // forward everything else as-is
      out.set(k, v);
    }

    // reattach client IP if we have it
    if (clientIp) out.set("x-forwarded-for", clientIp);

    const method = req.method;

    // only non-GET/HEAD requests may contain a body
    const hasBody = method !== "GET" && method !== "HEAD";

    // forward the request to target
    return await fetch(targetUrl, {
      method,
      headers: out,
      body: hasBody ? req.body : undefined,
      duplex: "half", // needed for streaming in edge runtime
      redirect: "manual", // don't auto-follow redirects
    });
  } catch (err) {
    // log for debugging purposes
    console.error("relay error:", err);

    // generic fallback response
    return new Response("Bad Gateway: Tunnel Failed", { status: 502 });
  }
}