// app/api/event/route.ts
export const runtime = 'edge';

export async function POST(req: Request) {
  const { sessionId, eventType, ts, clientMs, payload } = await req.json();
  const GAS_WEBHOOK_URL = process.env.GAS_WEBHOOK_URL!;
  if (!GAS_WEBHOOK_URL) return new Response('Missing GAS url', { status: 500 });

  await fetch(GAS_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'event',
      session_id: sessionId,
      event_type: eventType,
      ts: ts || new Date().toISOString(),
      client_ms: clientMs || '',
      payload: payload || {},
    }),
  });

  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
