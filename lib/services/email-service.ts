import nodemailer from 'nodemailer';
import { query } from '../db';

interface EmailSettingsRow {
  enabled: boolean;
  smtp_host: string | null;
  smtp_port: number | null;
  smtp_secure: boolean;
  smtp_user: string | null;
  smtp_password: string | null;
  from_name: string | null;
  from_email: string | null;
}

async function getSettings(): Promise<EmailSettingsRow | null> {
  const res = await query('SELECT * FROM public.config_email_settings WHERE id = 1');
  return res.rows[0] || null;
}

export class EmailService {
  // Sem cache de transporter — o SMTP não mantém sessão persistente como o
  // WhatsApp (sem QR/socket), então é mais simples e seguro reler a
  // configuração do banco a cada envio do que arriscar usar credenciais
  // desatualizadas depois de uma troca em Configurações > E-mail.
  static async send(to: string, subject: string, html: string): Promise<void> {
    const settings = await getSettings();
    if (!settings?.enabled || !settings.smtp_host || !settings.from_email) {
      throw new Error('SMTP não configurado. Preencha e ative em Configurações > E-mail.');
    }

    const transporter = nodemailer.createTransport({
      host: settings.smtp_host,
      port: settings.smtp_port || 587,
      secure: settings.smtp_secure,
      auth: settings.smtp_user ? { user: settings.smtp_user, pass: settings.smtp_password || '' } : undefined
    });

    await transporter.sendMail({
      from: settings.from_name ? `"${settings.from_name}" <${settings.from_email}>` : settings.from_email,
      to,
      subject,
      html
    });
  }

  static async sendTest(to: string): Promise<void> {
    await EmailService.send(
      to,
      'E-mail de teste — SSX Desk',
      '<p>Este é um e-mail de teste enviado a partir das configurações de SMTP do SSX Desk.</p><p>Se você recebeu esta mensagem, a configuração está funcionando corretamente.</p>'
    );
  }
}
