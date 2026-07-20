import type { APIRoute } from "astro";

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const payload = await request.json();

  console.log("Webhook recibido:");
  console.log(payload);

  await fetch("https://hook.us2.make.com/xos18jxmhaujtg9695h7i6m34ykyma7g", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  return new Response(null, {
    status: 200,
  });
};