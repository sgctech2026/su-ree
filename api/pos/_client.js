/* Talking to Pancake POS.
 *
 * The key is a full-access secret and Pancake's own documentation says
 * not to ship it to a browser, so every call to them goes through this
 * file, which only ever runs on Vercel's side.
 *
 * Money is sent in storage units. Whole-unit currencies (VND) take the
 * displayed figure; the rest are multiplied by a hundred. The peso has
 * centavos, so POS_MINOR_UNITS defaults to 100 and can be set to 1 if a
 * shop turns out to be keeping whole pesos.
 */

const BASE = "https://pos.pages.fm/api/v1";

export function config() {
  const key = process.env.PANCAKE_API_KEY;
  const shop = process.env.PANCAKE_SHOP_ID;
  const minor = Number(process.env.POS_MINOR_UNITS || 100);
  return { key, shop, minor, ready: Boolean(key && shop) };
}

/** What our site calls a thing, and what POS calls it. */
export function catalogue() {
  try {
    const raw = process.env.PANCAKE_SKUS;
    if (!raw) return null;
    const map = JSON.parse(raw);
    return map && typeof map === "object" ? map : null;
  } catch (e) {
    return null;
  }
}

function wait(ms) {
  return new Promise((done) => setTimeout(done, ms));
}

/**
 * One call, with the back-off their errors page asks for: retry 429 and
 * 5xx on a doubling delay and honour Retry-After; never retry anything
 * else, and never retry a POST that may already have landed.
 */
export async function call(path, { method = "GET", body, query, retry } = {}) {
  const { key, shop } = config();
  if (!key || !shop) {
    const e = new Error("POS is not configured");
    e.status = 503;
    e.code = "not_configured";
    throw e;
  }

  const url = new URL(BASE + path.replace("{shop}", encodeURIComponent(shop)));
  url.searchParams.set("api_key", key);
  for (const [k, v] of Object.entries(query || {})) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) v.forEach((x) => url.searchParams.append(k + "[]", x));
    else url.searchParams.set(k, String(v));
  }

  const tries = retry === undefined ? (method === "GET" ? 4 : 1) : retry;
  let last;
  for (let attempt = 0; attempt < tries; attempt++) {
    if (attempt) await wait(Math.min(8000, 1000 * 2 ** (attempt - 1)));
    let res;
    try {
      res = await fetch(url, {
        method,
        headers: { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
    } catch (err) {
      last = Object.assign(new Error("POS unreachable"), { status: 502 });
      continue;
    }

    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (e) {
      data = null;
    }

    if (res.ok && data && data.success !== false) return data;

    const err = new Error((data && data.message) || "POS refused the call");
    err.status = res.status;
    err.code = data && data.error_code;
    if (res.status === 429 || res.status >= 500) {
      const after = Number(res.headers.get("retry-after"));
      if (after > 0 && after < 30) await wait(after * 1000);
      last = err;
      continue;
    }
    throw err;
  }
  throw last || new Error("POS unreachable");
}

/** Minor units in, pesos out, and the other way about. */
export function toPos(pesos) {
  return Math.round(Number(pesos || 0) * config().minor);
}
export function fromPos(units) {
  return Number(units || 0) / config().minor;
}

export function send(res, status, payload) {
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.status(status).end(JSON.stringify(payload));
}

/** The browser may read the shop's own site and nothing else. */
export function allowOrigin(req, res) {
  const allowed = (process.env.POS_ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const origin = req.headers.origin;
  if (origin && (allowed.length === 0 || allowed.includes(origin))) {
    res.setHeader("access-control-allow-origin", origin);
    res.setHeader("vary", "origin");
  }
  res.setHeader("access-control-allow-headers", "content-type, x-admin-token");
  res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
}
