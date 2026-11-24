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

/* What the site sells, and the POS product code behind each choice.
 * The shop keeps a pair and a double as their own products with their
 * own prices, so a tier is a different code -- not the same code twice. */
const FALLBACK = {
  cream: { 1: "SR-CREAM", 2: "SR-CREAM2" },
  serum: { 1: "SR-SERUM", 2: "SR-SERUM2" },
  duo: { 1: "SR-DUO" }
};

export function catalogue() {
  try {
    const raw = process.env.PANCAKE_SKUS;
    if (!raw) return FALLBACK;
    const map = JSON.parse(raw);
    return map && typeof map === "object" ? map : FALLBACK;
  } catch (e) {
    return FALLBACK;
  }
}

/**
 * The code for one choice at one size. `exact` says whether the shop
 * keeps that size as its own product -- a double is one SR-CREAM2, not
 * two SR-CREAM -- or whether we fell back to the single, in which case
 * the order carries that many of it.
 */
export function skuFor(key, qty) {
  const rows = catalogue()[key];
  if (!rows) return null;
  const own = rows[String(qty)];
  if (own) return { sku: own, exact: true };
  const single = rows["1"];
  return single ? { sku: single, exact: false } : null;
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

/* A product code is readable and stable; the ids an order needs are not.
 * So the codes are what we keep, and the ids are looked up and held for
 * as long as the function instance lives. */
const resolved = new Map();

export async function lookup(sku) {
  if (resolved.has(sku)) return resolved.get(sku);
  const data = await call("/shops/{shop}/products/" + encodeURIComponent(sku));
  const product = (data && (data.data || data.product)) || null;
  if (!product) throw Object.assign(new Error("POS has no " + sku), { status: 404 });

  const variations = product.variations || [];
  const v = variations[0] || null;
  let remain = v && v.remain_quantity;
  if ((remain === undefined || remain === null) && v) {
    remain = (v.variations_warehouses || []).reduce(
      (n, w) => n + Number(w.remain_quantity || 0), 0
    );
  }

  const out = {
    sku,
    name: product.name || sku,
    product_id: product.id,
    variation_id: v && v.id,
    retail_price: v ? v.retail_price : product.retail_price,
    weight: (v && v.weight) || 0,
    remain: Number(remain) || 0
  };
  if (!out.variation_id) {
    throw Object.assign(new Error(sku + " has no variation"), { status: 502 });
  }
  resolved.set(sku, out);
  return out;
}

/** Stock changes, so it is read fresh rather than taken from the cache. */
export async function freshStock(sku) {
  resolved.delete(sku);
  return lookup(sku);
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
