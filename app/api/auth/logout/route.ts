import { NextResponse } from 'next/server';
import { sessionCookieOptions } from '@/lib/runtime-config';

export async function POST() {
  const response = NextResponse.json({ success: true });
  // Mesmas opções do login (lib/runtime-config.ts). Cookie só é apagado quando
  // nome, path E domain coincidem com os da criação: com front e back em
  // subdomínios, o cookie nasce em `.empresa.com` e apagá-lo sem o domain
  // simplesmente não surte efeito — o usuário clica em "Sair", a tela volta
  // para o login e a sessão continua válida.
  response.cookies.set('token', '', {
    ...sessionCookieOptions(),
    expires: new Date(0)
  });
  return response;
}
