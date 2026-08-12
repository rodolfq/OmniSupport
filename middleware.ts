import { NextResponse, type NextRequest } from 'next/server'
import { verifyJWT } from '@/lib/jwt'

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
  '/api/health', // healthcheck do container (Dockerfile), sem sessão de usuário
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

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const token = request.cookies.get('token')?.value;
  const session = token ? await verifyJWT(token) : null;

  if (!session?.id) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
    }
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return NextResponse.next();
}

export const config = {
  // Só o que o Next serve sozinho fica de fora. A isenção por extensão de
  // arquivo saiu daqui e virou a checagem em isPublicPath() acima, que sabe
  // distinguir estático de public/ e anexo servido por /api/files.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
}
