const nextConfig = {
  distDir: process.env.NEXT_DIST_DIR || ".next",
  images: {
    unoptimized: true,
  },
  eslint: {
    // We run lint separately; skipping it here keeps production builds from stalling in this environment.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
