
/**
 * Checks if a string is a valid image URL for display.
 * Filters out revoked blob URLs or invalid formats.
 */
export function isValidImageUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  if (url.startsWith('blob:')) return false; // Blobs are temporary and prone to ERR_FILE_NOT_FOUND
  if (url.startsWith('data:image/')) return true; // Base64 is okay for small previews/mock persistence
  if (url.startsWith('http://') || url.startsWith('https://')) return true;
  // Caminho relativo do próprio app — é o formato que /api/users/<id>/avatar
  // e /api/files/... devolvem. Sem isto a foto de perfil não aparecia mais na
  // tela de Configurações depois que a listagem passou a mandar o endereço da
  // imagem no lugar do base64. `//` fica de fora de propósito: é URL de
  // protocolo relativo, aponta pra outro host.
  if (url.startsWith('/') && !url.startsWith('//')) return true;
  return false;
}

/**
 * Converts a File object to a Base64 encoded string.
 */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = (error) => reject(error);
  });
}

/**
 * Redimensiona e recomprime uma imagem antes de virar Base64 — usado só pra
 * avatar (foto de celular sem tratamento vira MBs direto na coluna
 * profiles.avatar_url, e toda tela que lista usuários paga esse peso). Não
 * usar em anexos/attachments: ali o arquivo original importa.
 */
export function fileToCompressedAvatarBase64(file: File, maxDim = 256, quality = 0.82): Promise<string> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);

      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const width = Math.max(1, Math.round(img.width * scale));
      const height = Math.max(1, Math.round(img.height * scale));

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('Canvas não suportado neste navegador.')); return; }

      // Fundo branco antes de desenhar — PNG com transparência não pode virar
      // JPEG com cantos pretos.
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);

      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Falha ao carregar a imagem.'));
    };
    img.src = objectUrl;
  });
}
