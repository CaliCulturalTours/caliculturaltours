import type { APIRoute } from "astro";

export const POST: APIRoute = async ({ request }) => {
  try {
    const { amount } = await request.json();

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
            total_amount: amount,
            tip_amount: 0
          }
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

  } catch (error) {

    return new Response(
      JSON.stringify({
        error: "Unable to create payment link"
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
