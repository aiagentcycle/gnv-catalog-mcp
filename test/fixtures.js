// Gedeelde nep-shop voor de tests: feeds en pagina's zoals de echte shop ze levert. Bevat zelf geen tests.

export const ORIGIN = "https://goodnaturevibe.com";

export const CATALOG_ROWS = [
  { sku: "1100", name: "Zinkoxide", price: "12.50", price_max: null, currency: "EUR", availability: "in_stock", store: "nl", product_type: "simple", url: "https://goodnaturevibe.com/zinkoxide", description: "<p>Zink</p>", categories: ["Grondstoffen"], brand: "GNV" },
  { sku: "2200", name: "Jojoba olie", price: "8.95", price_max: "24.95", currency: "EUR", availability: "in_stock", store: "nl", product_type: "configurable", url: "https://goodnaturevibe.com/jojoba-olie", description: "<p>Koudgeperste <b>olie</b> &amp; meer</p>", categories: [{ name: "Oliën" }, "Huidverzorging"], brand: "GNV" },
  // Andere host: valt weg.
  { sku: "3300", name: "Vreemd", price: "1.00", price_max: null, currency: "EUR", availability: "in_stock", store: "nl", product_type: "simple", url: "https://evil.example/x", description: "", categories: [], brand: null },
  // Andere store: hoort niet in nl.
  { sku: "1100", name: "Zinc oxide", price: "12.50", price_max: null, currency: "EUR", availability: "in_stock", store: "en", product_type: "simple", url: "https://goodnaturevibe.com/en/zinc-oxide", description: "", categories: [], brand: "GNV" },
];

export const CONTENT_ROWS = [
  { id: 12, type: "CMSPage", title: "Over ons", url: "https://goodnaturevibe.com/over-ons", description: "<p>Wie we zijn</p>", updated_at: "2026-10-01T10:00:00Z", store: "nl" },
  { id: 34, type: "BlogPost", title: "Olie voor de huid", url: "https://goodnaturevibe.com/blog/olie-voor-de-huid", description: "<p>Welke olie past bij jou?</p>", updated_at: "2026-10-02T10:00:00Z", store: "nl" },
  { id: 56, type: "CMSPage", title: "404 Not Found", url: "https://goodnaturevibe.com/pagina-niet-gevonden", description: "", updated_at: null, store: "nl" },
  { id: 78, type: "Product", title: "Geen kennis", url: "https://goodnaturevibe.com/x", description: "", updated_at: null, store: "nl" },
];

function ljson(rows, extra = "") {
  return `${rows.map((row) => JSON.stringify(row)).join("\n")}\n${extra}`;
}

const PRODUCT_PAGE = `<html><body><div class="column main"><div id="description"><p>Jojoba olie is een vloeibare was.</p></div>
<script type="text/x-magento-init">{"#product_addtocart_form":{"configurable":{"spConfig":{"index":{"501":{"93":"7"},"502":{"93":"8"}},"sku":{"501":"2200-50","502":"2200-100"}}}}}</script>
<div><span>50 ml</span><input name="super_attribute[93]" value="7"></div><div><span>100 ml</span><input name="super_attribute[93]" value="8"></div>
</div><footer>voet</footer></body></html>`;

const CMS_PAGE = `<html><body><div class="column main"><h1>Over ons</h1><p>Good Nature Vibe is een winkel.</p></div><footer>x</footer></body></html>`;

export function fakeShop({ calls = [] } = {}) {
  const pages = {
    "/llms-catalog-nl.ljson": () => ljson(CATALOG_ROWS, "{kapot\n"),
    "/llms-content-nl.ljson": () => ljson(CONTENT_ROWS),
    "/jojoba-olie": () => PRODUCT_PAGE,
    "/over-ons": () => CMS_PAGE,
  };
  async function fetchImpl(url, options = {}) {
    const target = new URL(String(url));
    calls.push({ url: target.toString(), redirect: options.redirect, ua: options.headers?.["user-agent"] });
    const page = pages[target.pathname];
    if (target.origin !== ORIGIN || !page) return new Response("<html>not found</html>", { status: 404 });
    return new Response(page(), { status: 200 });
  }
  return { fetchImpl, calls };
}
