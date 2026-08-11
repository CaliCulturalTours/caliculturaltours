const PRICING_URL =
  "https://script.google.com/macros/s/AKfycbz99eR5GUnp9OslA4WboWQOZsJm_oywU3xq7C1kF5X9ZKp3OOeoH1w2D3LvsR7CPCMD/exec";

// Cache en memoria
let pricingCache: Record<string, any> | null = null;

export async function getPricing() {
  // Si ya cargó una vez, reutilizar
  if (pricingCache) {
    return pricingCache;
  }

  try {
    const response = await fetch(PRICING_URL);

    if (!response.ok) {
      console.warn("Pricing service unavailable. Using fallback prices.");
      pricingCache = {};
      return pricingCache;
    }

    pricingCache = await response.json();
    return pricingCache;
  } catch (error) {
    console.warn("Unable to fetch pricing. Using fallback prices.", error);
    pricingCache = {};
    return pricingCache;
  }
}

export function formatPrice(value: number | string) {
  return `${Number(value).toLocaleString("en-US")} pesos`;
}

export function getTourDisplayPrice(
  tour: any,
  pricing: Record<string, any>
) {
  const dynamicPrice = pricing[tour.id]?.from_price;

  if (dynamicPrice) {
    return `From ${formatPrice(dynamicPrice)}`;
  }

  return tour.price;
}