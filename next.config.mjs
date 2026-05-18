/** @type {import('next').NextConfig} */

const ONE_YEAR = "public, max-age=31536000, immutable";

const nextConfig = {
  images: {
    remotePatterns: [{ protocol: "https", hostname: "**" }],
  },
  serverExternalPackages: ["@imgly/background-removal-node", "sharp"],
  async headers() {
    return [
      {
        // 首页所有图片/视频静态资源 — 长期缓存，浏览器第一次加载后 1 年内不再重新请求
        source: "/images/:path*",
        headers: [{ key: "Cache-Control", value: ONE_YEAR }],
      },
      {
        source: "/videos/:path*",
        headers: [{ key: "Cache-Control", value: ONE_YEAR }],
      },
      {
        source: "/ip-assets/:path*",
        headers: [{ key: "Cache-Control", value: ONE_YEAR }],
      },
    ];
  },
};

export default nextConfig;
