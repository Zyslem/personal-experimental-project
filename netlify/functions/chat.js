// netlify/functions/chat.js
export const handler = async (event) => {
  // 只允许 POST
  if (event.httpMethod !== "POST") {
    return { 
      statusCode: 405, 
      body: JSON.stringify({ error: "Method Not Allowed" }) // 强制字符串
    };
  }

  try {
    const body = JSON.parse(event.body);
    const path = event.queryStringParameters?.path || "";
    const targetUrl = `https://api.deepseek.com/anthropic/v1${path}`;
    
    const response = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.DEEPSEEK_API_KEY,
        "Authorization": `Bearer ${process.env.DEEPSEEK_API_KEY}`,
        "anthropic-beta": "files-api-2025-04-14",
        "Accept": "text/event-stream"
      },
      body: JSON.stringify(body)
    });

    // 如果 DeepSeek 返回错误（非 2xx）
    if (!response.ok) {
      const errorText = await response.text();
      // 关键：把错误文本包在 JSON.stringify 里，确保 body 是字符串
      return { 
        statusCode: response.status, 
        body: JSON.stringify({ error: errorText }) 
      };
    }

    // 成功时，流式响应必须原样传递 body（Netlify 支持 ReadableStream）
    // 但为了保险，我们检查一下 response.body 是否存在
    if (!response.body) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Empty response body from DeepSeek" })
      };
    }

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "Access-Control-Allow-Origin": "*"
      },
      body: response.body // 这是 Stream，Netlify 通常能处理，但如果报错，就是这里的问题
    };
  } catch (error) {
    // 兜底：无论什么错误，body 都必须是字符串
    return { 
      statusCode: 500, 
      body: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }) 
    };
  }
};