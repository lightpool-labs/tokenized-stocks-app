/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@noble/hashes", "@noble/secp256k1"],
};

module.exports = nextConfig;
