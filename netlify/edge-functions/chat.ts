// netlify/edge-functions/chat.ts
export default async (request: Request) => {
  // 处理 CORS 预检请求
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "*",
      },
    });
  }

  try {
    const url = new URL(request.url);
    const path = url.searchParams.get("path") || "";
    const targetUrl = `https://api.deepseek.com/anthropic/v1${path}`;
    
    // 1. 准备请求头，注入真实 Key
    const headers = new Headers();
    headers.set("x-api-key", Deno.env.get("DEEPSEEK_API_KEY") || "");
    headers.set("Authorization", `Bearer ${Deno.env.get("DEEPSEEK_API_KEY")}`);
    headers.set("anthropic-beta", "files-api-2025-04-14");

    let body: BodyInit | null = null;

    // 2. 根据前端请求的内容类型，处理 Body
    const contentType = request.headers.get("content-type") || "";

    if (contentType.includes("application/json")) {
      // ----- 处理普通聊天（JSON）-----
      const json = await request.json();
      headers.set("Content-Type", "application/json");
      headers.set("Accept", "text/event-stream");
      // 强制开启流式
      body = JSON.stringify({ ...json, stream: true });
    } else {
      // ----- 处理文件上传（FormData/二进制）-----
      // 不能设置 Content-Type，浏览器/Deno 会自动加上包含 boundary 的 multipart/form-data
      headers.set("Accept", "application/json");
      body = request.body;
    }

    // 3. 向 DeepSeek 发起请求
    const response = await fetch(targetUrl, {
      method: request.method,
      headers,
      body,
    });

    // 4. 判断返回的是不是流（聊天返回流，上传返回普通 JSON）
    const resContentType = response.headers.get("Content-Type") || "";
    const responseHeaders = new Headers();
    responseHeaders.set("Access-Control-Allow-Origin", "*");
    responseHeaders.set("Cache-Control", "no-cache");

    if (resContentType.includes("text/event-stream")) {
      // 聊天流
      responseHeaders.set("Content-Type", "text/event-stream");
      responseHeaders.set("Connection", "keep-alive");
    } else {
      // 普通 JSON（比如上传后的返回，或者报错）
      responseHeaders.set("Content-Type", "application/json");
    }

    return new Response(response.body, {
      status: response.status,
      headers: responseHeaders
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { 
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*" 
      }
    });
  }
};