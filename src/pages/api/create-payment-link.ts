import type { APIRoute } from "astro";
export const prerender = false;
export const POST: APIRoute = async ({ request }) => {
  try {
    const { amount, name } = await request.json();
    const finalAmount =
  name?.trim().toLowerCase() === "cct-test"
    ? 1000
    : amount;
    const bookingReference =
  `CCT-${new Date().toISOString().slice(0,10).replace(/-/g,"")}-${Date.now().toString().slice(-4)}`;
    const response = await fetch(
      "https://integrations.api.bold.co/online/link/v1",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `x-api-key ${import.meta.env.BOLD_API_KEY}`
        },
        body: JSON.stringify({
          amount_type: "CLOSE",
          amount: {
            currency: "COP",
            total_amount: finalAmount,
            tip_amount: 0
          },
          callback_url: "https://caliculturaltours.com/booking-confirmed",
          reference: bookingReference,
        })
      }
    );

    const data = await response.json();

    return new Response(JSON.stringify(data), {
      status: response.status,
      headers: {
        "Content-Type": "application/json"
      }
    });

  } catch (error: any) {

  console.error(error);

  return new Response(
    JSON.stringify({
      error: error?.message || String(error)
    }),
    {
      status: 500,
      headers: {
        "Content-Type": "application/json"
      }
    }
  );

}
};
