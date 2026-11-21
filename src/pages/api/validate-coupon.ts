import type { APIRoute } from 'astro';
import { validateCouponCode } from '../../lib/coupons';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const code = String(body?.code || '').trim();

    if (!code) {
      return new Response(
        JSON.stringify({ valid: false, error: 'Please enter a promo code.' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const result = await validateCouponCode(code);
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    });
  } catch (err: any) {
    console.error('POST /api/validate-coupon error:', err);
    return new Response(
      JSON.stringify({ valid: false, error: 'Could not verify code right now. Please try again.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
