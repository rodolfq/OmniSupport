import sharp from 'sharp';

// Processa a logo da empresa em DUAS versões comprimidas — nenhuma delas é o
// upload original. Diferente do avatar de usuário (avatar_url guarda a foto
// enviada sem redimensionar, só a miniatura é gerada), aqui as duas colunas
// (logo_url e logo_thumb_url) recebem imagem já reduzida: logo não precisa da
// resolução de uma foto, e a tela nunca mostra a logo maior que um badge
// pequeno, então guardar o upload cru (que pode chegar a alguns MB) só
// infla o banco à toa — mesmo problema que os ~51MB de avatar_url em base64
// já causaram (ver CLAUDE.md).
//
// fit 'inside' (não 'cover') nas duas: logo não é rosto pra recortar em
// quadrado, cortar as bordas destruiria a marca. PNG com fundo transparente
// preservado (não JPEG+branco): logo costuma vir com fundo transparente, e a
// sidebar tem fundo escuro — achatar pra branco desenharia uma caixa branca
// em volta da marca.
const FULL_MAX_DIM = 400; // maior tela que exibe é o badge de 80px (160px em retina) — folga pra qualquer uso futuro sem exagerar
const THUMB_MAX_DIM = 160; // embutida inline em toda listagem de empresas (até ~800 linhas) — precisa ser bem pequena

function parseDataUrl(dataUrl: string): Buffer | null {
  const match = /^data:image\/[a-zA-Z0-9+.-]+;base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  return Buffer.from(match[1], 'base64');
}

async function resizeToPng(buffer: Buffer, maxDim: number): Promise<string> {
  const resized = await sharp(buffer)
    .resize(maxDim, maxDim, { fit: 'inside', withoutEnlargement: true })
    .png({ compressionLevel: 9 })
    .toBuffer();
  return `data:image/png;base64,${resized.toString('base64')}`;
}

// Falha não deve derrubar o salvamento — quem chama decide o que fazer
// (mesmo contrato de generateAvatarThumb).
export async function processCompanyLogo(rawDataUrl: string | null | undefined): Promise<{ full: string; thumb: string } | null> {
  if (!rawDataUrl) return null;
  const buffer = parseDataUrl(rawDataUrl);
  if (!buffer) return null;

  try {
    const [full, thumb] = await Promise.all([
      resizeToPng(buffer, FULL_MAX_DIM),
      resizeToPng(buffer, THUMB_MAX_DIM)
    ]);
    return { full, thumb };
  } catch (err) {
    console.error('[logo-thumb] Falha ao processar logo:', err);
    return null;
  }
}
