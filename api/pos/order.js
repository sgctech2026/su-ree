/* A checkout on the site becomes an order in Pancake POS.
 *
 * The browser sends what it knows -- who is buying, where it goes, and
 * which of our three choices they picked -- and nothing about POS. The
 * mapping from our keys to Pancake's product and variation ids, and the
 * prices, are read here, so a visitor cannot name a variation or set a
 * price of their own.
 */
import { call, catalogue, config, send, allowOrigin, toPos } from "./_client.js";

/** The duo is one jar and one bottle, so it becomes two lines. */
const LINES = {
  cream: [{ key: "cream", each: 1 }],
  serum: [{ key: "serum", each: 1 }],
  duo: [{ key: "cream", each: 1 }, { key: "serum", each: 1 }]
};

function clean(s, max) {
  return String(s === undefined || s === null ? "" : s).trim().slice(0, max);
}

/** Their current price, asked of POS rather than taken from the page. */
async function priceOf(ids) {
  const seen = {};
  const data = await call("/shops/{shop}/products/variations", {
    query: { variation_ids: ids, page_size: 100, page_number: 1 }
  });
  for (const v of (data && data.data) || []) {
    seen[v.id] = {
      retail_price: v.retail_price,
      name: (v.product && v.product.name) || v.display_id || "",
      weight: v.weight || 0
    };
  }
  return seen;
}

export default async function handler(req, res) {
  allowOrigin(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return send(res, 405, { error: "POST only" });

  const cfg = config();
  const skus = catalogue();
  if (!cfg.ready || !skus) {
    return send(res, 503, {
      error: "not_configured",
      message: "PANCAKE_API_KEY, PANCAKE_SHOP_ID and PANCAKE_SKUS are not set yet."
    });
  }

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch (e) {
      return send(res, 400, { error: "bad_json" });
    }
  }
  body = body || {};

  const name = clean(body.name, 120);
  const phone = clean(body.phone, 32);
  if (!name || !phone) {
    return send(res, 400, { error: "missing", message: "A name and a phone number are needed." });
  }

  // what they are buying, expanded into POS lines
  const want = Array.isArray(body.items) ? body.items : [];
  const tally = {};
  for (const row of want) {
    const parts = LINES[clean(row && row.key, 20)];
    const qty = Math.max(0, Math.min(99, Math.round(Number(row && row.qty) || 0)));
    if (!parts || !qty) continue;
    for (const part of parts) {
      tally[part.key] = (tally[part.key] || 0) + part.each * qty;
    }
  }
  const keys = Object.keys(tally);
  if (!keys.length) return send(res, 400, { error: "empty_cart" });

  const missing = keys.filter((k) => !skus[k] || !skus[k].variation_id);
  if (missing.length) {
    return send(res, 503, {
      error: "unmapped",
      message: "PANCAKE_SKUS has no variation for: " + missing.join(", ")
    });
  }

  let prices = {};
  try {
    prices = await priceOf(keys.map((k) => skus[k].variation_id));
  } catch (e) {
    // a price we could not read is not a reason to lose the order; POS
    // prices the line itself when variation_info is thin
    prices = {};
  }

  const items = keys.map((k) => {
    const sku = skus[k];
    const known = prices[sku.variation_id] || {};
    return {
      variation_id: sku.variation_id,
      product_id: sku.product_id,
      quantity: tally[k],
      discount_each_product: 0,
      is_bonus_product: false,
      is_discount_percent: false,
      is_wholesale: false,
      one_time_product: false,
      variation_info: {
        name: known.name || sku.name || k,
        retail_price: known.retail_price,
        weight: known.weight || 0,
        detail: null,
        fields: null,
        display_id: null,
        product_display_id: null
      }
    };
  });

  const addr = body.address || {};
  const order = {
    shop_id: Number(cfg.shop),
    status: 0, // New
    bill_full_name: name,
    bill_phone_number: phone,
    bill_email: clean(body.email, 160) || undefined,
    items,
    note: clean(body.note, 500),
    note_print: null,
    merge_order: false,
    is_free_shipping: Boolean(body.freeShipping),
    received_at_shop: false,
    is_abandoned_order: false,
    shipping_fee: toPos(body.shippingFee),
    total_discount: toPos(body.discount),
    cash: 0,
    custom_id: clean(body.reference, 40) || undefined,
    shipping_address: {
      full_name: name,
      phone_number: phone,
      address: clean(addr.line, 300),
      full_address: clean(addr.full || addr.line, 400),
      province_id: clean(addr.province_id, 24) || null,
      district_id: clean(addr.district_id, 24) || null,
      commune_id: clean(addr.commune_id, 24) || null,
      country_code: clean(addr.country_code, 4) || "PH",
      post_code: clean(addr.post_code, 16) || null
    }
  };
  if (process.env.PANCAKE_WAREHOUSE_ID) {
    order.warehouse_id = process.env.PANCAKE_WAREHOUSE_ID;
  }

  try {
    const made = await call("/shops/{shop}/orders", { method: "POST", body: order });
    const placed = made && (made.data || made.order || made);
    return send(res, 201, {
      ok: true,
      id: placed && (placed.id || placed.system_id),
      display_id: placed && placed.display_id,
      status: placed && placed.status
    });
  } catch (e) {
    const status = e.status === 400 || e.status === 422 ? 400 : 502;
    return send(res, status, {
      error: "pos_refused",
      code: e.code,
      message: e.message
    });
  }
}
