// Template de e-mail compartilhado — sem dependências de servidor (nodemailer,
// pg), então pode ser importado tanto do lado do servidor (automation-service.ts,
// automation-scheduler.ts) quanto direto de um componente cliente
// (ticket-detail-modal.tsx, no envio de resposta ao cliente).
const ACCENT = '#0FA694';

export function wrapEmailHtml(opts: { bodyHtml: string; ctaUrl?: string | null; ctaLabel?: string }): string {
  const { bodyHtml, ctaUrl, ctaLabel = 'Abrir chamado' } = opts;

  const cta = ctaUrl
    ? `
      <div style="margin:28px 0 4px;">
        <a href="${ctaUrl}" style="display:inline-block;background:${ACCENT};color:#ffffff;text-decoration:none;font-weight:700;font-size:13px;letter-spacing:0.4px;text-transform:uppercase;padding:13px 28px;border-radius:10px;">${ctaLabel}</a>
      </div>
      <p style="margin:12px 0 0;font-size:11px;color:#9ca3af;">Ou copie e cole este link no navegador: <span style="color:#6b7280;">${ctaUrl}</span></p>
    `
    : '';

  return `
<div style="font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#f4f5f7;padding:32px 16px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e5e7eb;">
    <tr>
      <td style="background:${ACCENT};padding:22px 32px;">
        <span style="color:#ffffff;font-size:17px;font-weight:800;letter-spacing:0.3px;">SSX Desk</span>
      </td>
    </tr>
    <tr>
      <td style="padding:32px;">
        <div style="font-size:14px;color:#111827;line-height:1.6;">${bodyHtml}</div>
        ${cta}
      </td>
    </tr>
    <tr>
      <td style="padding:18px 32px;background:#f9fafb;border-top:1px solid #e5e7eb;">
        <p style="margin:0;font-size:11px;color:#6b7280;line-height:1.6;">
          Este é um e-mail automático — <strong>não responda a esta mensagem</strong>, ela não é monitorada.
          Para acompanhar, comentar ou anexar arquivos ao seu chamado, acesse a plataforma pelo botão acima.
        </p>
      </td>
    </tr>
  </table>
</div>
  `.trim();
}
