export async function onRequestGet({ env }) {
  const configured = Boolean(env?.AI_API_KEY?.trim());

  return new Response(JSON.stringify({ configured }), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
