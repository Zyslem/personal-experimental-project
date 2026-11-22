export const handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const body = JSON.parse(event.body);
    const path = event.queryStringParameters?.path || "";
    const targetUrl = `https://api.deepseek.com/anthropic/v1${path}`;
    
    // 强制关闭流式输出
    const fetchBody = { ...body, stream: false };

    const response = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.DEEPSEEK_API_KEY,
        "Authorization": `Bearer ${process.env.DEEPSEEK_API_KEY}`,
        "anthropic-beta": "files-api-2025-04-14",
        "Accept": "application/json" // 只要 JSON，不要流
      },
      body: JSON.stringify(fetchBody)
    });

    const text = await response.text();

    // 【核心修复】：将获取到的完整结果，强行包在一个字符串里返回
    return {
      statusCode: response.status,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      },
      body: text // 此时 text 是纯字符串，Go 网关就不会崩溃了
    };
    
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }) // 错误也必须转成字符串
    };
  }
};