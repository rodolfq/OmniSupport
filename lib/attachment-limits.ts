// Teto de anexo que o CLIENTE barra antes de tentar enviar — alinhado ao
// client_max_body_size do Nginx em produção (300m, ver
// manuais/tecnico/guia-implementacao-servidor.html). Anexo vai em base64
// dentro do JSON da mensagem (~33% maior que o arquivo original) + o resto
// do payload (texto, ids, etc.) — por isso o teto aqui fica abaixo do valor
// bruto do Nginx, não igual a ele. Se o limite do Nginx mudar, atualize
// também este valor (e o comentário lá que aponta pra cá).
//
// Decisão do usuário em 2026-09-22: aceitar arquivo pesado (vídeo de tela
// numa nota de chamado, por exemplo) sem ir a ponto de 1GB — o mecanismo
// atual manda o anexo inteiro como base64 num único POST, sem streaming/
// chunks, então o navegador precisa montar essa string inteira em memória
// (arriscado em celular) e o servidor recebe tudo de uma vez (pico de
// memória no processo Node) — 1GB nesse esquema é perigoso demais pro
// container que também roda WhatsApp/schedulers.
export const MAX_ATTACHMENT_TOTAL_BYTES = 220 * 1024 * 1024;

export const MAX_ATTACHMENT_TOTAL_LABEL = '220MB';

// Soma os anexos já presentes com os arquivos recém-selecionados e devolve
// só os que cabem no orçamento (em ordem), pra descartar os excedentes sem
// derrubar os que já cabiam. `existingBytes` é a soma do que já está
// acumulado no composer (ex.: anexos de uma seleção anterior no mesmo
// envio) — normalmente 0.
export function splitAttachmentsByBudget(
  files: File[],
  existingBytes: number = 0
): { accepted: File[]; rejected: File[] } {
  const accepted: File[] = [];
  const rejected: File[] = [];
  let total = existingBytes;

  for (const file of files) {
    if (total + file.size > MAX_ATTACHMENT_TOTAL_BYTES) {
      rejected.push(file);
      continue;
    }
    total += file.size;
    accepted.push(file);
  }

  return { accepted, rejected };
}
