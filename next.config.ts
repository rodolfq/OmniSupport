import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Empacotamento em container (ver Dockerfile): 'standalone' gera
  // .next/standalone com um server.js e SÓ as dependências que o runtime
  // realmente usa (resolvidas pelo mesmo tracing do outputFileTracingExcludes
  // abaixo). Sem isso a imagem teria que carregar o node_modules inteiro —
  // com os binários nativos de onnxruntime/sharp/ffmpeg, alguns GB à toa.
  output: 'standalone',
  // Anexo vai em base64 dentro do JSON do POST (ver lib/attachment-limits.ts).
  // Como há middleware, o Next COPIA o corpo da requisição pra ele e, por
  // padrão, só guarda os primeiros 10MB: o que passa disso chega TRUNCADO na
  // rota e falha com "Unterminated string in JSON" (500). Um arquivo de 8MB já
  // vira ~10,7MB em base64, então "arquivo acima de 8MB não sobe" era isso — o
  // Nginx (300m) nunca chegava a ser o gargalo. Este valor acompanha o
  // client_max_body_size do Nginx; o teto de verdade por envio continua sendo
  // o de lib/attachment-limits.ts (220MB de arquivo ≈ 293MB em base64).
  experimental: {
    middlewareClientMaxBodySize: '300mb',
  },
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
    'pg',
    '@huggingface/transformers',
    'onnxruntime-node',
    'sharp',
    'ffmpeg-static'
  ],
  // onnxruntime-node empacota binarios nativos para win32/darwin/linux dentro
  // do mesmo pacote; o container roda Linux, entao os outros ~160MB sao peso
  // morto na imagem.
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
