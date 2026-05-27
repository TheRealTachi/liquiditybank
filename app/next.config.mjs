/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config) => {
    // Solana web3 + pino need these polyfilled away in the browser.
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      net: false,
      tls: false,
      crypto: false,
      "pino-pretty": false,
    };
    // pino's optional pino-pretty transport — silence the warning.
    config.externals = [
      ...(config.externals ?? []),
      "pino-pretty",
    ];
    return config;
  },
};

export default nextConfig;
