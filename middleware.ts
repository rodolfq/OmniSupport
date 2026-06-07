import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  // TEMPORARIAMENTE DESATIVADO para debug
  // O auth é feito pelo cliente via useApp
  
  return NextResponse.next({
    request,
  })
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}