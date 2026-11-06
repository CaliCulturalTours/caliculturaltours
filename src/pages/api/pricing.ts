import { getPricing } from "../../lib/pricing";

export async function GET() {
  const pricing = await getPricing();

  return new Response(JSON.stringify(pricing), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, s-maxage=900, stale-while-revalidate=3600"
    }
  });
}
