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
  '/api/auth/login',
  '/api/auth/logout',
  '/api/whatsapp/webhook', // chamado pela Meta, sem sessão de usuário
  '/manifest.webmanifest',
  '/sw.js',
]);

// API de integração se autentica por chave própria (Authorization: Bearer),
// não por cookie de sessão — ver lib/integration-auth.ts.
const PUBLIC_PREFIXES = ['/api/integrations/v1/'];

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
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
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
