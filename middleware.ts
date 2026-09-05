import { NextResponse, type NextRequest } from 'next/server'
import { verifyJWT } from '@/lib/jwt'
import { isOriginAllowed, CORS_ALLOWED_ORIGINS } from '@/lib/runtime-config'

// Camada global de autenticação — roda antes de qualquer página ou rota de
// API. Sem isso, cada rota é seu próprio ponto único de falha: uma que
// esqueça de checar a sessão fica 100% aberta (foi exatamente o que
// aconteceu com várias rotas enquanto isto esteve desativado). Aqui só se
// confirma que existe uma sessão válida (assinatura do JWT + não expirado,
// verificado via Web Crypto — sem round-trip ao banco, barato o suficiente
// pra rodar em toda requisição); quem/o quê a sessão pode fazer continua
// sendo decidido em cada Server Action/rota, como já era.
const PUBLIC_PATHS = new Set([
  '/login',
  '/login/new', // tela secreta de lançamento (descartável, ver app/login/new/page.tsx)
  '/api/auth/login',
  '/api/auth/logout',
  '/api/whatsapp/webhook', // chamado pela Meta, sem sessão de usuário
  '/api/whatsapp/pyvon-webhook', // chamado pelo Pyvon, autenticado por X-Pyvon-Secret (ver pyvon-service.ts)
  '/api/health', // healthcheck do container (Dockerfile), sem sessão de usuário
  '/api/version', // polling do aviso de nova versão (app-context.tsx) — não deve cair em 401 se a sessão expirar no meio do dia
  '/manifest.webmanifest',
  '/sw.js',
]);

// API de integração se autentica por chave própria (Authorization: Bearer),
// não por cookie de sessão — ver lib/integration-auth.ts.
const PUBLIC_PREFIXES = ['/api/integrations/v1/'];

// Arquivos estáticos servidos de public/ (ícones do PWA, imagens da tela de
// login) não têm sessão pra checar. A regra vale SÓ fora de /api/: a checagem
// morava no `matcher` como "qualquer caminho terminado em .png/.jpg/..." e
// isso passou a isentar /api/files/2026/08/<uuid>.png — ou seja, todo anexo de
// imagem de chamado/conversa ficou legível sem login (a rota se descreve como
// autenticada em app/api/files/[...path]/route.ts). Anexo é documento de
// cliente; o prefixo /api/ nunca pode escapar por causa da extensão do arquivo.
const STATIC_FILE_EXTENSION = /\.(?:svg|png|jpg|jpeg|gif|webp|ico)$/i;

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  if (!pathname.startsWith('/api/') && STATIC_FILE_EXTENSION.test(pathname)) return true;
  return PUBLIC_PREFIXES.some(prefix => pathname.startsWith(prefix));
}

// CORS — necessário porque, com front e back separados, o navegador chama a API
// a partir de OUTRA origem. Três pontos que costumam custar caro se ficarem de
// fora:
//
//  1. `Access-Control-Allow-Credentials: true` sem isso o cookie de sessão não
//     é enviado nem aceito, e tudo responde 401 sem explicação;
//  2. a origem é ecoada individualmente (nunca `*`) — o navegador RECUSA `*`
//     junto de credenciais, e aceitar qualquer origem numa API autenticada por
//     cookie permitiria a outro site fazer requisições em nome do usuário;
//  3. `Vary: Origin` sem isso, um cache intermediário pode devolver a uma
//     origem o cabeçalho liberado para outra.
//
// Com CORS_ALLOWED_ORIGINS vazio (deploy de um container só) nada disso entra
// em ação: origem e destino são o mesmo host e o navegador nem faz preflight.
function applyCors(request: NextRequest, response: NextResponse): NextResponse {
  if (CORS_ALLOWED_ORIGINS.length === 0) return response;

  const origin = request.headers.get('origin');
  if (!isOriginAllowed(origin)) return response;

  response.headers.set('Access-Control-Allow-Origin', origin as string);
  response.headers.set('Access-Control-Allow-Credentials', 'true');
  response.headers.append('Vary', 'Origin');
  return response;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Preflight (OPTIONS) precisa responder ANTES da checagem de sessão: o
  // navegador manda o preflight sem cookie nenhum, então exigir sessão aqui
  // reprovaria toda requisição que precisasse dele — e o erro apareceria como
  // "falha de rede", sem pista do motivo.
  if (request.method === 'OPTIONS' && request.headers.get('access-control-request-method')) {
    const preflight = new NextResponse(null, { status: 204 });
    preflight.headers.set(
      'Access-Control-Allow-Methods',
      request.headers.get('access-control-request-method') || 'GET,POST,PUT,PATCH,DELETE'
    );
    preflight.headers.set(
      'Access-Control-Allow-Headers',
      request.headers.get('access-control-request-headers') || 'Content-Type'
    );
    preflight.headers.set('Access-Control-Max-Age', '86400');
    return applyCors(request, preflight);
  }

  if (isPublicPath(pathname)) {
    return applyCors(request, NextResponse.next());
  }

  const token = request.cookies.get('token')?.value;
  const session = token ? await verifyJWT(token) : null;

  if (!session?.id) {
    if (pathname.startsWith('/api/')) {
      return applyCors(request, NextResponse.json({ error: 'Não autenticado.' }, { status: 401 }));
    }
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return applyCors(request, NextResponse.next());
}

export const config = {
  // Só o que o Next serve sozinho fica de fora. A isenção por extensão de
  // arquivo saiu daqui e virou a checagem em isPublicPath() acima, que sabe
  // distinguir estático de public/ e anexo servido por /api/files.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
}
