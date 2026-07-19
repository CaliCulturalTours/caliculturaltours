import type { APIRoute } from "astro";

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {

  const payload = await request.json();

  console.log("Webhook recibido:");
  console.log(payload);

  return new Response("CALI WEBHOOK TEST", {
  status: 200,
  headers: {
    "Content-Type": "text/plain",
  },
});