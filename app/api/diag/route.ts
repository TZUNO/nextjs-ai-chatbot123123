// app/api/diag/route.ts
export const runtime = 'edge';

export async function GET() {
  const env = {
    hasOpenAI: !!process.env.OPENAI_API_KEY,
    hasGAS: !!process.env.GAS_WEBHOOK_URL,
    gasUrlPreview: process.env.GAS_WEBHOOK_URL?.slice(0, 60) + '...',
  };

  let gasPing: any = null;
  if (process.env.GAS_WEBHOOK_URL) {
    try {
      const r = await fetch(process.env.GAS_WEBHOOK_URL!, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'ping' }),
      });
      gasPing = { ok: r.ok, status: r.status, text: await r.text() };
    } catch (e: any) {
      gasPing = { ok: false, error: String(e) };
    }
  }

  return new Response(JSON.stringify({ env, gasPing }, null, 2), {
    headers: { 'Content-Type': 'application/json' },
  });
}
