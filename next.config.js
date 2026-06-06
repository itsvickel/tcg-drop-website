/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "cdn.shopify.com" },
      { protocol: "https", hostname: "*.myshopify.com" },
      { protocol: "https", hostname: "multimedia.bbyastatic.ca" },
      { protocol: "https", hostname: "images.pokemoncenter.com" },
      { protocol: "https", hostname: "cdn11.bigcommerce.com" }
    ]
  }
};

module.exports = nextConfig;
