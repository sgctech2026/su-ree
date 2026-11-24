/* What POS has on the shelf, for the three things the site sells.
 *
 * Public, because the answer is public: a count and a price, no ids and
 * nothing that would let a caller work out the shop's catalogue. The
 * single is what the line on the Shop page speaks for, since that is
 * what a visitor is looking at when they read it.
 */
import { config, freshStock, send, allowOrigin, skuFor, fromPos } from "./_client.js";

export default async function handler(req, res) {
  allowOrigin(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return send(res, 405, { error: "GET only" });

  if (!config().ready) return send(res, 503, { error: "not_configured" });

  const keys = ["cream", "serum", "duo"];
  const out = {};
  let answered = 0;

  await Promise.all(keys.map(async (key) => {
    const sku = skuFor(key, 1);
    if (!sku) {
      out[key] = { remain: null, price: null };
      return;
    }
    try {
      const p = await freshStock(sku);
      out[key] = { remain: p.remain, price: fromPos(p.retail_price) };
      answered++;
    } catch (e) {
      out[key] = { remain: null, price: null };
    }
  }));

  if (!answered) {
    return send(res, 502, { error: "pos_refused", message: "POS named none of the products." });
  }

  res.setHeader("cache-control", "public, max-age=60, s-maxage=60, stale-while-revalidate=300");
  return send(res, 200, { ok: true, stock: out, at: new Date().toISOString() });
}
