/* The orders behind the dashboard's Order Status panel.
 *
 * Closed: it carries customer names and phone numbers, so it answers
 * only to the admin token, which lives in Vercel and never in the page.
 * The dashboard asks for it after its own passphrase has been given.
 */
import { call, config, send, allowOrigin, fromPos } from "./_client.js";

/* Pancake's integer statuses, grouped the way the panel counts them. */
const BUCKET = {
  0: "new", 17: "new", 11: "new", 12: "new", 13: "new", 20: "new",
  1: "confirmed",
  8: "confirmed", 9: "confirmed",
  2: "shipped",
  3: "delivered", 16: "delivered",
  4: "returned", 15: "returned", 5: "returned",
  6: "cancelled", 7: "cancelled"
};

function unix(value, fallback) {
  const t = value ? Date.parse(value) : NaN;
  return Math.floor((Number.isNaN(t) ? fallback : t) / 1000);
}

export default async function handler(req, res) {
  allowOrigin(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return send(res, 405, { error: "GET only" });

  const want = process.env.ADMIN_TOKEN;
  const given = req.headers["x-admin-token"];
  if (!want) return send(res, 503, { error: "not_configured", message: "ADMIN_TOKEN is not set." });
  if (given !== want) return send(res, 401, { error: "unauthorised" });

  if (!config().ready) return send(res, 503, { error: "not_configured" });

  const q = req.query || {};
  const now = Date.now();
  const from = unix(q.from, now - 7 * 86400000);
  const to = unix(q.to, now);

  const counts = { new: 0, confirmed: 0, shipped: 0, delivered: 0, returned: 0, cancelled: 0 };
  const recent = [];
  let total = 0;
  let revenue = 0;

  try {
    for (let page = 1; page <= 10; page++) {
      const data = await call("/shops/{shop}/orders", {
        query: {
          page_size: 100,
          page_number: page,
          startDateTime: from,
          endDateTime: to,
          updateStatus: "inserted_at",
          option_sort: "inserted_at_desc"
        }
      });

      const rows = (data && data.data) || [];
      for (const o of rows) {
        total++;
        const bucket = BUCKET[o.status];
        if (bucket) counts[bucket]++;
        const paid = fromPos(o.buyer_paid_amount);
        if (bucket !== "cancelled" && bucket !== "returned") revenue += paid;
        if (recent.length < 40) {
          recent.push({
            id: o.display_id || o.system_id || o.id,
            at: o.inserted_at || null,
            status: o.status_name || String(o.status),
            bucket: bucket || "new",
            total: paid,
            items: ((o.items) || []).map((i) => ({
              name: (i.variation_info && i.variation_info.name) || "",
              qty: i.quantity
            }))
          });
        }
      }

      if (!data || !data.total_pages || page >= data.total_pages) break;
    }

    res.setHeader("cache-control", "private, max-age=30");
    return send(res, 200, { ok: true, total, counts, revenue, recent });
  } catch (e) {
    return send(res, 502, { error: "pos_refused", code: e.code, message: e.message });
  }
}
