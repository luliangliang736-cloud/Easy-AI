/**
 * 云资产默认 302 到只签了 GET 的 OSS 地址。
 * 浏览器/下载插件若先发 HEAD，OSS 会回 403 SignatureDoesNotMatch。
 * 下载一律走同源 ?download=1，由服务端拉字节并带 attachment。
 */
export function toCloudAssetDownloadUrl(url = "") {
  const value = String(url || "");
  if (!/^\/api\/cloud-assets\//i.test(value)) return value;
  const [path, query = ""] = value.split("?");
  const params = new URLSearchParams(query);
  params.set("download", "1");
  return `${path}?${params.toString()}`;
}

export function inferDownloadFilename(url = "", { isVideo = false, isSvg = false } = {}) {
  const path = String(url || "").split("?")[0];
  const extMatch = path.match(/\.([a-z0-9]+)$/i);
  const ext = extMatch?.[1]?.toLowerCase() || (isSvg ? "svg" : isVideo ? "mp4" : "png");
  const kind = isSvg ? "vector" : isVideo ? "video" : "image";
  return `${kind}-${Date.now()}.${ext}`;
}

export async function downloadMediaFile(url, options = {}) {
  const source = String(url || "");
  if (!source) throw new Error("empty url");
  const filename = options.filename || inferDownloadFilename(source, options);
  const cloudDownloadUrl = toCloudAssetDownloadUrl(source);

  if (/^\/api\/cloud-assets\//i.test(source)) {
    const a = document.createElement("a");
    a.href = cloudDownloadUrl;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    return;
  }

  try {
    const res = await fetch(source);
    if (!res.ok) throw new Error(`download failed ${res.status}`);
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(blobUrl);
  } catch {
    window.open(source, "_blank", "noopener,noreferrer");
  }
}
