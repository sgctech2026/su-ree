/* A checkout on the site becomes an order in Pancake POS.
 *
 * The browser sends what it knows -- who is buying, where it goes, and
 * which of the three choices at which size -- and nothing about POS.
 * The product code behind that choice, and the price, are read here, so
 * a visitor cannot name a product or set a price of their own.
 *
 * The shop keeps the pair and the doubles as products in their own
 * right, each with its own price, so one choice is one line whatever
 * its size: a double is SR-CREAM2 once, not SR-CREAM twice.
 */
import { call, config, lookup, send, allowOrigin, skuFor, toPos } from "./_client.js";

function clean(s, max) {
  return String(s === undefined || s === null ? "" : s).trim().slice(0, max);
}

export default async function handler(req, res) {
  allowOrigin(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return send(res, 405, { error: "POST only" });

  const cfg = config();
  if (!cfg.ready) {
    return send(res, 503, {
      error: "not_configured",
      message: "PANCAKE_API_KEY and PANCAKE_SHOP_ID are not set yet."
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

  // which product code each line is, and how many of it
  const want = Array.isArray(body.items) ? body.items : [];
  const lines = [];
  for (const row of want) {
    const key = clean(row && row.key, 20);
    const qty = Math.max(1, Math.min(9, Math.round(Number(row && row.qty) || 1)));
    const pick = skuFor(key, qty);
    if (!pick) continue;
    lines.push({ sku: pick.sku, count: pick.exact ? 1 : qty });
  }
  if (!lines.length) return send(res, 400, { error: "empty_cart" });

  let items;
  try {
    items = await Promise.all(lines.map(async (line) => {
      const p = await lookup(line.sku);
      return {
        variation_id: p.variation_id,
        product_id: p.product_id,
        quantity: line.count,
        discount_each_product: 0,
        is_bonus_product: false,
        is_discount_percent: false,
        is_wholesale: false,
        one_time_product: false,
        variation_info: {
          name: p.name,
          retail_price: p.retail_price,
          weight: p.weight,
          detail: null,
          fields: null,
          display_id: p.sku,
          product_display_id: p.sku
        }
      };
    }));
  } catch (e) {
    console.error("POS could not name a product:", e.status, e.message);
    return send(res, e.status === 404 ? 503 : 502, {
      error: "unmapped",
      message: e.message
    });
  }

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

  // ?dry=1 builds the order and stops, so the whole path up to the write
  // can be checked without leaving a real order in the shop
  const dry = req.query && (req.query.dry === "1" || req.query.dry === "true");
  if (dry) return send(res, 200, { ok: true, dry: true, order });

  try {
    const made = await call("/shops/{shop}/orders", { method: "POST", body: order });
    const placed = (made && (made.data || made.order)) || made;
    return send(res, 201, {
      ok: true,
      id: placed && (placed.id || placed.system_id),
      display_id: placed && placed.display_id,
      status: placed && placed.status
    });
  } catch (e) {
    // the logs are where a refusal can be read back afterwards
    console.error("POS refused an order:", e.status, e.code, e.message);
    const status = e.status === 400 || e.status === 422 ? 400 : 502;
    return send(res, status, { error: "pos_refused", code: e.code, message: e.message });
  }
}
