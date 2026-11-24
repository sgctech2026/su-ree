# Connecting su-ree to Pancake POS

Everything on the site's side is built. What is missing are the two values
only you can get, because they are your shop's. Until they are set, the site
behaves exactly as it did before: the stock line stays hidden, the dashboard's
order panel says `POS NOT CONNECTED YET`, and a checkout tells the buyer to
message you rather than pretending it went through.

## 1. Get an API key

In Pancake POS: **Settings → Apps → Webhook/API → API Key tab → Create**.

The key is shown once, so copy it there and then. Note Pancake's own warning:
this key is a full-access secret, so it must never go into a page. It does not
— it lives in Vercel and is read only by the three functions under `api/pos/`.

## 2. Get the shop id

With the key in hand:

```
https://pos.pages.fm/api/v1/shops?api_key=YOUR_KEY
```

The answer is `{"shops":[{"id": 1234567, "name": "…"}], "success": true}`.
The number in `id` is the shop id.

## 3. The product codes

The shop keeps five products, and the site's five prices line up with them
exactly:

| Choice on the site | POS product |
| --- | --- |
| Capsule Cream, 1 jar | `SR-CREAM` |
| Capsule Cream, 2 jars | `SR-CREAM2` |
| GHK-Cu Serum, 1 bottle | `SR-SERUM` |
| GHK-Cu Serum, 2 bottles | `SR-SERUM2` |
| The Duo | `SR-DUO` |

That mapping is built in, so nothing needs setting for it. The ids an order
actually needs are looked up from these codes the first time they are wanted
and held for as long as the function lives. Set `PANCAKE_SKUS` only if the
codes ever change:

```json
{"cream":{"1":"SR-CREAM","2":"SR-CREAM2"},"serum":{"1":"SR-SERUM","2":"SR-SERUM2"},"duo":{"1":"SR-DUO"}}
```

## 4. Set them in Vercel

Vercel → the `su-ree` project → **Settings → Environment Variables**. Add these
for Production (and Preview, if you want the preview URLs to work too):

| Name | Value |
| --- | --- |
| `PANCAKE_API_KEY` | the key from step 1 |
| `PANCAKE_SHOP_ID` | the number from step 2 |
| `ADMIN_TOKEN` | the same passphrase you type at the `/admin` gate |
| `POS_ALLOWED_ORIGINS` | `https://su-ree.vercel.app` |

Two more, only if they apply:

| Name | When |
| --- | --- |
| `PANCAKE_WAREHOUSE_ID` | if the shop has more than one warehouse and orders should land in a particular one |
| `POS_MINOR_UNITS` | `100` by default, which is right if POS keeps pesos in centavos. Set it to `1` if your shop's figures come back as whole pesos. |

Then **redeploy** — environment variables are read at run time, but a deploy is
the simplest way to be sure the functions pick them up.

## 5. Check it

- `https://su-ree.vercel.app/api/pos/stock` should answer with counts rather
  than `{"error":"not_configured"}`.
- Open `/admin`, sign in, and the Order Status panel should show real numbers.
- Place a test order on the site and look for it in POS. Cancel it there
  afterwards so it does not count as a sale.

## What is wired, and where

| What | File | Notes |
| --- | --- | --- |
| Checkout → POS | `api/pos/order.js`, `Checkout.dc.html` | Creates the order with status `0` (New). The browser sends a name, a phone, an address and which of the three choices was picked; the price and the ids are read here, so nobody can name their own. |
| Stock → Shop | `api/pos/stock.js`, `Shop.dc.html` | A line under the formula chooser: in stock, "N left in this batch" under ten, or sold out. Cached a minute. |
| Orders → dashboard | `api/pos/orders.js`, `admin.html` | Order Status and Recent checkouts. Closed behind `ADMIN_TOKEN`, which is the passphrase you type at the gate — it is sent as a header and never written into the page. |

## Two things worth knowing

**The dashboard's other panels are still local.** Visitors, engagement, pages,
sections and subscribers are recorded by `track.js` in whichever browser
produced them, so they count your device, not your audience. Making those real
needs somewhere shared to send them — Pancake does not hold them.

**Checkout does not take payment.** The order reaches POS as a new order, to be
confirmed and collected the way your other orders are. Nothing on the site
charges a card.
