// app/api/chat/route.ts
export const runtime = 'edge';

function redact(text = '') {
  return text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig, '[EMAIL]')
    .replace(/\b09\d{8}\b/g, '[PHONE]')
    .replace(/\d{3,}-\d{3,}/g, '[PHONE]')
    .slice(0, 8000);
}

export async function POST(req: Request) {
  const { sessionId, messages, model = 'gpt-4o-mini', temperature = 0.3 } = await req.json();
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;
  const GAS_WEBHOOK_URL = process.env.GAS_WEBHOOK_URL!;
  if (!OPENAI_API_KEY || !GAS_WEBHOOK_URL) {
    return new Response('Missing env', { status: 500 });
  }

  // 1) 先把使用者最後一句寫到 Google Sheet（透過 Apps Script）
  const turnIndex = Date.now(); // 簡單當回合索引
  const lastUser = messages?.[messages.length - 1];
  await fetch(GAS_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'message',
      session_id: sessionId,
      turn_index: turnIndex,
      role: 'user',
      content: redact(lastUser?.content || ''),
      model
    }),
  });

  // 2) 建立 SSE 串流
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: any) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      };

      const t0 = Date.now();
      send({ type: 'sse_open' });

      // 3) 串 OpenAI Responses（stream: true）
      const upstream = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          temperature,
          stream: true,
          input: messages.map((m: any) => ({ role: m.role, content: m.content })),
        }),
      });

      if (!upstream.ok || !upstream.body) {
        send({ type: 'error', message: `Upstream error: ${upstream.status}` });
        controller.close();
        return;
      }

      let firstTokenTs: number | null = null;
      let acc = '';
      const reader = (upstream.body as ReadableStream).getReader();

      // 4) 逐塊讀取 OpenAI 的串流 → 回推給前端
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = new TextDecoder().decode(value);
        if (!firstTokenTs) { firstTokenTs = Date.now(); send({ type: 'sse_first_token' }); }
        acc += chunk;
        send({ type: 'delta', text: chunk });
      }

      const totalLatency = Date.now() - t0;
      const ttfb = firstTokenTs ? (firstTokenTs - t0) : totalLatency;

      // 5) 把 AI 的完整回覆與統計寫回 Google Sheet
      await fetch(GAS_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'message',
          session_id: sessionId,
          turn_index: turnIndex,
          role: 'assistant',
          content: redact(acc),
          model,
          ttfb_ms: ttfb,
          total_ms: totalLatency,
        }),
      });
      await fetch(GAS_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'invocation',
          session_id: sessionId,
          turn_index: turnIndex,
          provider: 'openai',
          model,
          temperature,
          finish_reason: 'stop',
        }),
      });

      send({ type: 'done', stats: { ttfb, totalLatency } });
      controller.close();
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
