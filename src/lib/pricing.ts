const PRICING_URL =
  "https://script.google.com/macros/s/AKfycbz99eR5GUnp9OslA4WboWQOZsJm_oywU3xq7C1kF5X9ZKp3OOeoH1w2D3LvsR7CPCMD/exec";

export async function getPricing() {
  try {
    const response = await fetch(PRICING_URL);

    if (!response.ok) {
      console.warn("Pricing service unavailable. Using fallback prices.");
      return {};
    }

    return await response.json();
  } catch (error) {
    console.warn("Unable to fetch pricing. Using fallback prices.", error);
    return {};
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
    return formatPrice(dynamicPrice);
  }

  return tour.price;
}