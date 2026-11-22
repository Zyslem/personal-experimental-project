// netlify/edge-functions/chat.ts
export default async (request: Request) => {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  try {
    const body = await request.json();
    const url = new URL(request.url);
    const path = url.searchParams.get("path") || "";

    const targetUrl = `https://api.deepseek.com/anthropic/v1${path}`;
    
    // 发起真实的流式请求
    const response = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": Deno.env.get("DEEPSEEK_API_KEY") || "",
        "Authorization": `Bearer ${Deno.env.get("DEEPSEEK_API_KEY")}`,
        "anthropic-beta": "files-api-2025-04-14",
        "Accept": "text/event-stream"
      },
      body: JSON.stringify({ ...body, stream: true }) // 强制开启流式
    });

    // Edge Function 可以直接 return 这个 response，完美透传流
    return new Response(response.body, {
      status: response.status,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "Access-Control-Allow-Origin": "*"
      }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
};