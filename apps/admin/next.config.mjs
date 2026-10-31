/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Lint runs as its own turbo task with the shared flat config.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
