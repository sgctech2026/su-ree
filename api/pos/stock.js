/* What POS has on the shelf, for the three things the site sells.
 *
 * Public, because the answer is public: a count and a price, no ids and
 * nothing that would let a caller work out the shop's catalogue. The duo
 * can only go out while both halves can, so it takes the smaller count.
 */
import { call, catalogue, config, send, allowOrigin, fromPos } from "./_client.js";

export default async function handler(req, res) {
  allowOrigin(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return send(res, 405, { error: "GET only" });

  const cfg = config();
  const skus = catalogue();
  if (!cfg.ready || !skus) return send(res, 503, { error: "not_configured" });

  const ids = [];
  for (const key of ["cream", "serum"]) {
    if (skus[key] && skus[key].variation_id) ids.push(skus[key].variation_id);
  }
  if (!ids.length) return send(res, 503, { error: "unmapped" });

  try {
    const data = await call("/shops/{shop}/products/variations", {
      query: { variation_ids: ids, page_size: 100, page_number: 1 }
    });

    const byId = {};
    for (const v of (data && data.data) || []) {
      // remain_quantity is the sellable count; sum the warehouses when
      // the variation does not carry its own figure
      let remain = v.remain_quantity;
      if (remain === undefined || remain === null) {
        remain = ((v.variations_warehouses) || []).reduce(
          (n, w) => n + Number(w.remain_quantity || 0), 0
        );
      }
      byId[v.id] = { remain: Number(remain) || 0, price: fromPos(v.retail_price) };
    }

    const out = {};
    for (const key of ["cream", "serum"]) {
      const sku = skus[key];
      const found = sku && byId[sku.variation_id];
      out[key] = found ? found : { remain: null, price: null };
    }
    out.duo = {
      remain: out.cream.remain === null || out.serum.remain === null
        ? null
        : Math.min(out.cream.remain, out.serum.remain),
      price: null
    };

    res.setHeader("cache-control", "public, max-age=60, s-maxage=60, stale-while-revalidate=300");
    return send(res, 200, { ok: true, stock: out, at: new Date().toISOString() });
  } catch (e) {
    return send(res, 502, { error: "pos_refused", code: e.code, message: e.message });
  }
}
