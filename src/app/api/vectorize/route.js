export async function POST(req) {
  try {
    const { imageUrl } = await req.json();
    if (!imageUrl) {
      return Response.json({ error: "缺少 imageUrl 参数" }, { status: 400 });
    }

    const apiId = process.env.VECTORIZER_API_ID;
    const apiSecret = process.env.VECTORIZER_API_SECRET;
    if (!apiId || !apiSecret) {
      return Response.json({ error: "服务端未配置 VECTORIZER_API_ID / VECTORIZER_API_SECRET" }, { status: 500 });
    }

    const auth = Buffer.from(`${apiId}:${apiSecret}`).toString("base64");

    // 如果是相对路径，拼接完整 URL（服务端 fetch 需要绝对地址）
    let absoluteUrl = imageUrl;
    if (imageUrl.startsWith("/")) {
      const host = req.headers.get("host") || "localhost:3000";
      const protocol = host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https";
      absoluteUrl = `${protocol}://${host}${imageUrl}`;
    }

    // 从 OSS / CDN 拉取图片二进制
    const imgRes = await fetch(absoluteUrl);
    if (!imgRes.ok) {
      return Response.json({ error: `拉取原图失败（${imgRes.status}）` }, { status: 502 });
    }
    const imgBuffer = await imgRes.arrayBuffer();
    const imgBlob = new Blob([imgBuffer], { type: imgRes.headers.get("content-type") || "image/png" });

    const form = new FormData();
    form.append("image", imgBlob, "image.png");
    form.append("output.file_format", "svg");

    const vectorRes = await fetch("https://api.vectorizer.ai/api/v1/vectorize", {
      method: "POST",
      headers: { Authorization: `Basic ${auth}` },
      body: form,
      // Node 18+ fetch 无 signal/timeout；Next.js 会在 180s 内由框架层超时
    });

    if (!vectorRes.ok) {
      let errMsg = `转矢量失败（${vectorRes.status}）`;
      try {
        const errJson = await vectorRes.json();
        if (errJson?.error?.message) errMsg = errJson.error.message;
      } catch { /* ignore */ }
      return Response.json({ error: errMsg }, { status: vectorRes.status });
    }

    const svgBuffer = await vectorRes.arrayBuffer();
    return new Response(svgBuffer, {
      headers: {
        "Content-Type": "image/svg+xml",
        "Content-Disposition": 'attachment; filename="vector.svg"',
      },
    });
  } catch (err) {
    return Response.json({ error: err?.message || "服务器内部错误" }, { status: 500 });
  }
}
