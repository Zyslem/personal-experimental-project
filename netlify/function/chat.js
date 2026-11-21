// netlify/functions/chat.js
export const handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405 };

  try {
    const body = JSON.parse(event.body);
    const path = event.queryStringParameters?.path || ""; // 用来接收前端传过来的子路径

    // 代理请求到 DeepSeek 的 Anthropic 兼容接口
    const targetUrl = `https://api.deepseek.com/anthropic/v1${path}`;
    
    const response = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.DEEPSEEK_API_KEY, // 安全注入你的 API Key
        "anthropic-beta": "files-api-2025-04-14",
        "Accept": "text/event-stream"
      },
      body: JSON.stringify(body)
    });

    // 把 DeepSeek 的流式打字机响应原样传回给前端
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "Access-Control-Allow-Origin": "*"
      },
      body: response.body
    };
  } catch (error) {
    return { statusCode: 500, body: error.message };
  }
};