/* su-ree — what the site records about its own use.
 *
 * Everything lands in this browser's localStorage. That is the whole
 * store: there is no server behind it, so the dashboard reads one
 * device, not one audience. The shape below is the shape a backend
 * would take, so moving to one is a change of transport, not of model.
 */
(function () {
  "use strict";
  var KEY = "sr.an.v1";
  var CAP = 6000;

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return null;
  }

  function uid() {
    return (
      Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10)
    );
  }

  var db = load();
  if (!db || !db.e) {
    db = { d: uid(), f: Date.now(), e: [], subs: [], orders: [] };
  }
  if (!db.d) db.d = uid();
  if (!db.subs) db.subs = [];
  if (!db.orders) db.orders = [];

  var saveTimer = null;
  function save() {
    if (saveTimer) return;
    saveTimer = setTimeout(function () {
      saveTimer = null;
      if (db.e.length > CAP) db.e = db.e.slice(db.e.length - CAP);
      try {
        localStorage.setItem(KEY, JSON.stringify(db));
      } catch (e) {}
    }, 250);
  }

  function sid() {
    try {
      var s = sessionStorage.getItem("sr.an.s");
      if (!s) {
        s = uid();
        sessionStorage.setItem("sr.an.s", s);
      }
      return s;
    } catch (e) {
      return "nosession";
    }
  }

  function path() {
    var p = location.pathname.replace(/\/+$/, "");
    var f = p.split("/").pop() || "";
    var m = {
      "": "/",
      "home.dc.html": "/",
      "shop.dc.html": "/shop",
      "about.dc.html": "/story",
      "science.dc.html": "/science",
      "faq.dc.html": "/faq",
      "cart.dc.html": "/cart",
      "checkout.dc.html": "/checkout",
      "product.dc.html": "/product",
      "privacy.dc.html": "/privacy",
      "terms.dc.html": "/terms",
      "returns.dc.html": "/returns",
      "shipping.dc.html": "/shipping"
    };
    var k = f.toLowerCase();
    if (m[k] !== undefined) return m[k];
    return p || "/";
  }

  var P = path();
  var S = sid();

  function push(kind, extra) {
    var ev = { t: Date.now(), k: kind, p: P, dev: db.d, s: S };
    if (extra) for (var key in extra) ev[key] = extra[key];
    db.e.push(ev);
    save();
  }

  push("view");

  /* engaged: ten seconds with the tab in front */
  var seen = 0;
  var last = Date.now();
  var engagedSent = false;
  setInterval(function () {
    var now = Date.now();
    if (!document.hidden) seen += now - last;
    last = now;
    if (!engagedSent && seen >= 10000) {
      engagedSent = true;
      push("eng", { v: Math.round(seen / 1000) });
    }
  }, 1000);

  /* which part of the page people actually stop at */
  var dwell = {};
  var since = {};
  function sectionName(el) {
    if (el.getAttribute("data-sr-section")) {
      return el.getAttribute("data-sr-section");
    }
    var h = el.querySelector("h1,h2,h3");
    var t = h ? (h.textContent || "").trim().replace(/\s+/g, " ") : "";
    if (!t) return "";
    return t.length > 54 ? t.slice(0, 54) + "…" : t;
  }
  if (window.IntersectionObserver) {
    setTimeout(function () {
      var secs = [].slice.call(document.querySelectorAll("section"));
      var io = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (en) {
            var name = sectionName(en.target);
            if (!name) return;
            if (en.isIntersecting) {
              since[name] = Date.now();
            } else if (since[name]) {
              dwell[name] = (dwell[name] || 0) + (Date.now() - since[name]);
              delete since[name];
            }
          });
        },
        { threshold: 0.45 }
      );
      secs.forEach(function (s) {
        io.observe(s);
      });
    }, 400);
  }
  function flushSections() {
    var now = Date.now();
    for (var n in since) {
      dwell[n] = (dwell[n] || 0) + (now - since[n]);
      delete since[n];
    }
    for (var name in dwell) {
      var ms = dwell[name];
      if (ms >= 1200) push("sec", { n: name, v: Math.round(ms / 1000) });
    }
    dwell = {};
    try {
      if (db.e.length > CAP) db.e = db.e.slice(db.e.length - CAP);
      localStorage.setItem(KEY, JSON.stringify(db));
    } catch (e) {}
  }
  window.addEventListener("pagehide", flushSections);
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) flushSections();
  });

  /* the three things worth counting, read off the buttons that do them */
  var api = {
    cart: function (label) {
      push("cart", { n: label || "" });
    },
    checkout: function (order) {
      order = order || {};
      var rec = {
        id: "SR-" + Date.now().toString(36).toUpperCase(),
        t: Date.now(),
        total: order.total || 0,
        items: order.items || [],
        status: "new"
      };
      db.orders.push(rec);
      push("co", { v: rec.total, id: rec.id });
      return rec.id;
    },
    subscribe: function (email, source) {
      email = (email || "").trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return false;
      var had = db.subs.some(function (s) {
        return s.m === email;
      });
      if (!had) db.subs.push({ m: email, src: source || P, t: Date.now() });
      push("sub", { n: email });
      return true;
    },
    key: KEY
  };
  window.srTrack = api;

  function money(text) {
    var m = (text || "").replace(/,/g, "").match(/[₱$]\s*([\d.]+)/);
    return m ? Number(m[1]) : 0;
  }

  document.addEventListener(
    "click",
    function (ev) {
      var el = ev.target && ev.target.closest && ev.target.closest("a,button");
      if (!el) return;
      var t = (el.textContent || "").trim();
      var low = t.toLowerCase();
      if (/add to (cart|bag)/.test(low)) {
        api.cart(t.split("—")[0].trim());
        return;
      }
      if (/place order|complete order|pay now/.test(low)) {
        var mail = document.querySelector('input[type="email"]');
        if (mail && mail.value) api.subscribe(mail.value, "checkout");
        api.checkout({ total: money(t) });
        return;
      }
      /* the newsletter sits as an input with a button beside it */
      var box = el.closest("form,div,span");
      for (var i = 0; box && i < 4; i++) {
        var input = box.querySelector && box.querySelector('input[type="email"]');
        if (input && input.value) {
          api.subscribe(input.value, P === "/checkout" ? "checkout" : "newsletter");
          return;
        }
        box = box.parentElement;
      }
    },
    true
  );

  document.addEventListener(
    "submit",
    function (ev) {
      var f = ev.target;
      var input = f && f.querySelector && f.querySelector('input[type="email"]');
      if (input && input.value) api.subscribe(input.value, "newsletter");
    },
    true
  );
})();
