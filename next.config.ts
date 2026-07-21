import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'picsum.photos',
      },
      {
        protocol: 'https',
        hostname: 'media.giphy.com',
      },
      {
        protocol: 'https',
        hostname: 'media0.giphy.com',
      },
      {
        protocol: 'https',
        hostname: 'media1.giphy.com',
      },
      {
        protocol: 'https',
        hostname: 'media2.giphy.com',
      },
      {
        protocol: 'https',
        hostname: 'media3.giphy.com',
      },
      {
        protocol: 'https',
        hostname: 'media4.giphy.com',
      },
      {
        protocol: 'https',
        hostname: 'fonts.gstatic.com',
      },
      {
        protocol: 'https',
        hostname: 'media.tenor.com',
      },
      {
        protocol: 'https',
        hostname: 'i.giphy.com',
      },
      {
        protocol: 'https',
        hostname: 'c.tenor.com',
      },
      {
        protocol: 'https',
        hostname: 'giphy.com',
      }
    ],
  },
  serverExternalPackages: [
    '@whiskeysockets/baileys',
    'pino',
    'ws',
    'bufferutil',
    'utf-8-validate',
    'postgres',
    'pg',
    '@huggingface/transformers',
    'onnxruntime-node',
    'sharp',
    'ffmpeg-static'
  ],
  // onnxruntime-node empacota binarios nativos para win32/darwin/linux dentro
  // do mesmo pacote; o servidor de deploy roda Linux, entao os outros ~160MB
  // sao mortos e so servem pra estourar o limite de 250MB da lambda.
  outputFileTracingExcludes: {
    '*': [
      'node_modules/onnxruntime-node/bin/napi-v6/darwin/**',
      'node_modules/onnxruntime-node/bin/napi-v6/win32/**',
    ],
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  }
};

export default nextConfig;
