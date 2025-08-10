import Stripe from "stripe";
export const config = { runtime: "nodejs" };

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  const key = process.env.STRIPE_SECRET_KEY || "";
  const stripe = key ? new Stripe(key, { apiVersion: "2024-06-20" }) : null;

  if (req.method === "GET" && req.query?.debug === "1") {
    return res.status(200).json({ ok: true, hasKey: !!key, keyPrefix: key ? key.slice(0,7) : null });
  }

  const input = req.method === "GET" ? req.query : req.body;
  const { productId, priceId } = input || {};
  if (!stripe) return res.status(400).json({ error: "Stripe key missing on server" });
  if (!productId && !priceId) return res.status(400).json({ error: "Provide productId or priceId" });

  try {
    let price, product;
    if (priceId) {
      price = await stripe.prices.retrieve(priceId);
      product = typeof price.product === "string" ? await stripe.products.retrieve(price.product) : price.product;
    } else {
      product = await stripe.products.retrieve(productId);
      const defaultPriceId = typeof product.default_price === "string"
        ? product.default_price
        : product.default_price?.id;
      price = defaultPriceId
        ? await stripe.prices.retrieve(defaultPriceId)
        : (await stripe.prices.list({ product: product.id, active: true, limit: 1 })).data[0];
    }
    if (!product) return res.status(404).json({ error: "Product not found" });
    if (!price) return res.status(404).json({ error: "Price not found for this product" });

    const amount = price.unit_amount ?? null;
    const currency = price.currency ?? "usd";
    const recurring = price.recurring || null;

    const computed = {
      "ProductSummary-name": product.name || "",
      "CurrencyAmount": amount != null ? {
        amount,
        currency,
        formatted: new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() })
          .format((amount || 0) / 100),
        recurring: recurring ? {
          interval: recurring.interval,
          interval_count: recurring.interval_count || 1,
          label: recurring.interval_count && recurring.interval_count > 1
            ? `every ${recurring.interval_count} ${recurring.interval}s`
            : `per ${recurring.interval}`,
        } : null
      } : null,
      "product-summary-product-description": product.description || ""
    };

    return res.status(200).json({
      ok: true,
      product: {
        id: product.id,
        name: product.name,
        description: product.description,
        images: product.images,
        default_price: typeof product.default_price === "string" ? product.default_price : product.default_price?.id || null,
      },
      price: {
        id: price.id,
        currency,
        unit_amount: amount,
        recurring: recurring ? { interval: recurring.interval, interval_count: recurring.interval_count || 1 } : null
      },
      computed
    });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}
