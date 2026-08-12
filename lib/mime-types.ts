// Tabela mínima de MIME por extensão. Não vale a pena uma dependência nova
// (`mime-types`) só pra isto: o conjunto de tipos que o produto aceita é
// fechado — imagem, áudio, vídeo e documento, o que o seletor de arquivo do
// chat/chamado permite.
const MIME_BY_EXTENSION: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  mp3: 'audio/mpeg',
  mpeg: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  opus: 'audio/ogg',
  webm: 'video/webm',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  mkv: 'video/x-matroska',
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv',
  txt: 'text/plain',
  json: 'application/json',
  zip: 'application/zip'
};

export function lookup(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  return MIME_BY_EXTENSION[ext] || 'application/octet-stream';
}
