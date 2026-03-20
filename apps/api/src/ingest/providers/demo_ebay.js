function nowIso() {
  return new Date().toISOString();
}

function buildItem({ id, title, priceAmount, currency = "EUR", sellerId, country = "BE" }) {
  const retrievedAt = nowIso();
  return {
    marketplace_code: "ebay",
    source_item_id: String(id),
    url: `https://www.ebay.com/itm/${encodeURIComponent(String(id))}`,
    title,
    last_retrieved_at: retrievedAt,
    is_active: true,

    price_amount: Number(priceAmount),
    price_currency: currency,
    shipping_amount: null,
    shipping_currency: null,
    fees_included: true,

    condition_raw: null,
    condition_physical_tier: "used_good",
    functional_status: "unknown",

    seller_type: "unknown",
    seller_id: sellerId ? String(sellerId) : null,
    seller_rating: null,

    country,
    region: null,
    city: null,
    pickup_possible: null,

    included_items: [],
    extracted_attributes: [],
    media: [
      {
        type: "image",
        url: `https://example.invalid/media/${encodeURIComponent(String(id))}.jpg`,
        width: null,
        height: null,
      },
    ],
    raw_ref: {},

    first_seen_at: retrievedAt,
    last_seen_at: retrievedAt,

    snapshot: {
      source: "demo_ebay",
      item_id: String(id),
      title,
      price: { amount: Number(priceAmount), currency },
      retrieved_at: retrievedAt,
    },
  };
}

export function fetchDemoEbayListings() {
  return [
    buildItem({ id: "ebay-1001", title: "Sony A7 IV body - boxed, low shutter count", priceAmount: 1699, sellerId: "seller_demo_1" }),
    buildItem({ id: "ebay-1002", title: "Sony A7 IV body only - good condition", priceAmount: 1549, sellerId: "seller_demo_2" }),
    buildItem({ id: "ebay-1003", title: "Sony A7 IV kit with 28-70mm - clean", priceAmount: 1849, sellerId: "seller_demo_3" }),
    buildItem({ id: "ebay-1004", title: "Sony A7 III body only - used excellent", priceAmount: 949, sellerId: "seller_demo_21" }),
    buildItem({ id: "ebay-1005", title: "Sony A7 III with 28-70mm kit lens - boxed", priceAmount: 1129, sellerId: "seller_demo_22" }),
    buildItem({ id: "ebay-1006", title: "Sony A7C II body - boxed, low shutter", priceAmount: 1849, sellerId: "seller_demo_23" }),
    buildItem({ id: "ebay-1007", title: "Sony A7C II silver body - excellent", priceAmount: 1799, sellerId: "seller_demo_24" }),
    buildItem({ id: "ebay-1008", title: "Sony A7R V body - low shutter count", priceAmount: 3199, sellerId: "seller_demo_25" }),
    buildItem({ id: "ebay-1009", title: "Sony A7S III body only - creator owned", priceAmount: 2399, sellerId: "seller_demo_26" }),
    buildItem({ id: "ebay-1011", title: "Sony a6700 body - near mint", priceAmount: 1329, sellerId: "seller_demo_27" }),
    buildItem({ id: "ebay-1012", title: "Sony a6700 with 16-50mm kit lens", priceAmount: 1469, sellerId: "seller_demo_28" }),
    buildItem({ id: "ebay-1013", title: "Sony a6600 body - great condition", priceAmount: 879, sellerId: "seller_demo_29" }),
    buildItem({ id: "ebay-1014", title: "Sony a6600 with 18-135mm lens - travel kit", priceAmount: 1129, sellerId: "seller_demo_30" }),
    buildItem({ id: "ebay-1015", title: "Sony ZV-E10 body - creator starter kit", priceAmount: 529, sellerId: "seller_demo_31" }),
    buildItem({ id: "ebay-1010", title: "Nikon Z6 II body - excellent condition", priceAmount: 1399, sellerId: "seller_demo_4" }),
    buildItem({ id: "ebay-1020", title: "Olympus M.Zuiko 12-40mm f/2.8 PRO lens", priceAmount: 479, sellerId: "seller_demo_5" }),
    buildItem({ id: "ebay-1021", title: "Sony FE 24-70mm f/2.8 GM II lens", priceAmount: 1699, sellerId: "seller_demo_6" }),
    buildItem({ id: "ebay-1022", title: "Canon RF 24-70mm f/2.8L IS USM lens", priceAmount: 1499, sellerId: "seller_demo_7" }),
    buildItem({ id: "ebay-1030", title: "Fujifilm X-T30 body - used", priceAmount: 699, sellerId: "seller_demo_8" }),

    // Canon (camera bodies + compacts) so Canon model pages show matched listings in local demo mode.
    buildItem({ id: "ebay-2001", title: "Canon EOS R5 body - boxed, shutter count 12k", priceAmount: 2399, sellerId: "seller_demo_9" }),
    buildItem({ id: "ebay-2002", title: "Canon EOS R5 body only - used excellent", priceAmount: 2199, sellerId: "seller_demo_10" }),
    buildItem({ id: "ebay-2003", title: "Canon EOS R5 + extras (grip, batteries)", priceAmount: 2499, sellerId: "seller_demo_11" }),
    buildItem({ id: "ebay-2010", title: "Canon EOS R6 body - clean", priceAmount: 1499, sellerId: "seller_demo_12" }),
    buildItem({ id: "ebay-2011", title: "Canon EOS R6 body - used good", priceAmount: 1299, sellerId: "seller_demo_13" }),
    buildItem({ id: "ebay-2020", title: "Canon EOS 5D Mark IV body - 90k actuations", priceAmount: 1199, sellerId: "seller_demo_14" }),
    buildItem({ id: "ebay-2021", title: "Canon EOS 5D Mark IV body only - excellent", priceAmount: 1399, sellerId: "seller_demo_15" }),
    buildItem({ id: "ebay-2030", title: "Canon PowerShot G7 X compact - vlogger friendly", priceAmount: 429, sellerId: "seller_demo_16" }),
    buildItem({ id: "ebay-2031", title: "Canon PowerShot G7 X - used good", priceAmount: 379, sellerId: "seller_demo_17" }),
    buildItem({ id: "ebay-2040", title: "Canon PowerShot G3 X superzoom camera - boxed", priceAmount: 699, sellerId: "seller_demo_18" }),
    buildItem({ id: "ebay-2050", title: "Canon PowerShot S90 compact camera - retro pocket", priceAmount: 159, sellerId: "seller_demo_19" }),
    buildItem({ id: "ebay-2060", title: "Canon PowerShot SX210 IS compact camera", priceAmount: 99, sellerId: "seller_demo_20" }),
  ];
}
