/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [{ protocol: "https", hostname: "**" }],
  },
  serverExternalPackages: ["@imgly/background-removal-node", "sharp"],
};

export default nextConfig;
