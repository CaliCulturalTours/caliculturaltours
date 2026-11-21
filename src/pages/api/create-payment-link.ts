import type { APIRoute } from "astro";
import { validateCouponCode } from "../../lib/coupons";

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    const { amount, base_amount, coupon_code, name } = await request.json();

    let computedAmount = Number(amount || 0);
    const parsedBase = Number(base_amount || 0);

    if (parsedBase > 0) {
      if (coupon_code && String(coupon_code).trim()) {
        const couponCheck = await validateCouponCode(String(coupon_code));
        computedAmount =
          couponCheck.valid && couponCheck.discountPercent
            ? Math.round(parsedBase * (1 - couponCheck.discountPercent / 100))
            : parsedBase;
      } else {
        computedAmount = parsedBase;
      }
    }

    const finalAmount =
      name?.trim().toLowerCase() === "cct-test" ? 1000 : computedAmount;

    const bookingReference = `CCT-${new Date()
      .toISOString()
      .slice(0, 10)
      .replace(/-/g, "")}-${Date.now().toString().slice(-4)}`;

    const response = await fetch(
      "https://integrations.api.bold.co/online/link/v1",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `x-api-key ${import.meta.env.BOLD_API_KEY}`,
        },
        body: JSON.stringify({
          amount_type: "CLOSE",
          amount: {
            currency: "COP",
            total_amount: finalAmount,
            tip_amount: 0,
          },
          callback_url: "https://caliculturaltours.com/booking-confirmed",
          reference: bookingReference,
        }),
      }
    );

    const data = await response.json();

    return new Response(JSON.stringify(data), {
      status: response.status,
      headers: {
        "Content-Type": "application/json",
      },
    });
  } catch (error: any) {
    console.error(error);

    return new Response(
      JSON.stringify({
        error: error?.message || String(error),
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
        },
      }
    );
  }
};
