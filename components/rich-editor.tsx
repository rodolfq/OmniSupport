'use client';

import React, { useCallback, useEffect, useRef } from 'react';
import { useEditor, EditorContent, Extension } from '@tiptap/react';
// Some versions of Tiptap export menus from a subpath
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
import { BubbleMenu } from '@tiptap/react/menus';
import StarterKit from '@tiptap/starter-kit';
import { ResizableImage } from './rich-editor-image';
import Link from '@tiptap/extension-link';
import Youtube from '@tiptap/extension-youtube';
import Placeholder from '@tiptap/extension-placeholder';
import BubbleMenuExtension from '@tiptap/extension-bubble-menu';
import FloatingMenuExtension from '@tiptap/extension-floating-menu';
import { 
  Bold, Italic, List, ListOrdered, Image as ImageIcon, 
  Youtube as YoutubeIcon, Link as LinkIcon, 
  Heading1, Heading2, Quote, Undo, Redo, ExternalLink, Unlink, Pencil
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { uploadAttachment } from '@/lib/attachment-upload';
import { createMentionExtension, MentionItem } from './rich-editor-mention';
import { isAllowedLinkHref, normalizeLinkUrl, displayLinkUrl } from '@/lib/rich-link';

// Ctrl+K (Cmd+K no Mac) abre o painel de link — atalho pedido em 2026-11-25,
// o mesmo do Google Docs/Word. O editor é criado uma vez só, então o atalho
// chama a função mais recente por uma ref.
function createLinkShortcut(open: () => void) {
  return Extension.create({
    name: 'linkShortcut',
    addKeyboardShortcuts() {
      return { 'Mod-k': () => { open(); return true; } };
    },
  });
}

interface LinkPanelState {
  text: string;
  url: string;
  // Texto selecionado quando o painel abriu — se a pessoa não mexer no campo
  // "Texto", o link é aplicado na própria seleção (preserva negrito, imagem
  // etc.); se mexer, a seleção é trocada pelo texto novo.
  originalText: string;
  from: number;
  to: number;
  editing: boolean;
}

// Imagem dentro do texto rico vira ARQUIVO no volume de anexos, e o HTML
// guarda só o link (/api/files/...). Achado em 2026-11-11: no modo 'full' a
// imagem colada/arrastada entrava no HTML como base64 (allowBase64) — uma nota
// de ticket interno ficou com 448 mil caracteres e travou o servidor de
// produção em 100% de CPU; havia ainda 50 descrições de chamado (25,8 MB) no
// mesmo formato. O servidor também converte o que escapar daqui (ver
// externalizeInlineImages em lib/services/attachment-storage.ts).
function imageFilesFrom(list: DataTransferItemList | FileList | null | undefined): File[] {
  if (!list) return [];
  const files: File[] = [];
  for (let i = 0; i < list.length; i++) {
    const entry = list[i] as DataTransferItem | File;
    const file = 'getAsFile' in entry ? (entry.kind === 'file' ? entry.getAsFile() : null) : entry;
    if (file && file.type.startsWith('image/')) files.push(file);
  }
  return files;
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  return res.blob();
}

interface RichEditorProps {
  content: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: string;
  // Sem isto o campo cresce sem limite com o texto — numa nota longa, empurra
  // tudo que vem depois dele (o botão "Enviar", no composer do chamado) pra
  // fora da área visível, sem nenhuma barra de rolagem pra alcançar. Com o
  // prop, a partir desta altura a rolagem passa a ser DENTRO do campo.
  maxHeight?: string;
  // Link (Ctrl+K) existe nos TRÊS modos desde 2026-11-25 — o que está escrito
  // abaixo sobre "sem link" é anterior a isso.
  //
  // 'full' (padrão): negrito, itálico, títulos, listas, citação, link,
  // imagem, vídeo do YouTube. 'simple': só negrito, itálico e desfazer/
  // refazer — usado na nota do chamado (Histórico Cliente/Nota Interna),
  // que agora também vira mensagem de WhatsApp/e-mail, onde formatação rica
  // (título, lista, embed) não tem como ser representada. As extensões
  // correspondentes nem entram no editor nesse modo — não é só esconder o
  // botão da barra, o atalho de teclado e o autoformat (ex.: "# " virar
  // título) também ficam desligados.
  //
  // 'basic' (2026-11-12, pedido do usuário — descrição de chamado e ticket
  // interno, e notas do ticket interno): mesmos recursos de texto do
  // 'simple' (só negrito e itálico; sem título, lista, citação, código, link,
  // vídeo), MAS mantém o node de imagem. Descrição tem print colado no meio
  // do texto, e sem o node o Tiptap descartaria essas imagens ao abrir pra
  // editar — elas sumiriam ao salvar. Colar/arrastar imagem continua subindo
  // como arquivo e entrando no texto, igual ao 'full'.
  toolbar?: 'full' | 'simple' | 'basic';
  // Colar uma imagem (print/screenshot, Ctrl+V) vira ANEXO de verdade via
  // este callback, em vez de tentar embutir no texto rico — necessário no
  // modo 'simple' (nem tem o node de imagem no schema, ver acima) e mantém
  // a mesma experiência do chat de atendimento (ver addFilesAsChatAttachments
  // em chat-widget.tsx). Sem este prop, colar imagem continua não fazendo
  // nada (comportamento de sempre em modo 'full').
  onPasteImages?: (files: File[]) => void;
  // Ocupa toda a altura disponível do pai (que precisa ser flex coluna) — a
  // área de texto estica e rola por dentro. Usado na descrição do ticket
  // interno, que vai até o fim da tela (2026-11-12). minHeight continua
  // valendo como piso.
  fill?: boolean;
  // Pessoas que podem ser marcadas com @ (2026-11-16, notas do ticket
  // interno). Sem a lista, o @ não abre sugestão — mas a marcação já gravada
  // continua aparecendo (o node é registrado sempre, ver rich-editor-mention.ts).
  mentionItems?: MentionItem[];
}

export function RichEditor({ content, onChange, placeholder = 'Comece a digitar...', minHeight = '150px', maxHeight, toolbar = 'full', onPasteImages, fill = false, mentionItems }: RichEditorProps) {
  // Lida a cada "@" (o editor é criado uma vez só; a lista pode chegar depois).
  const mentionItemsRef = useRef<MentionItem[]>(mentionItems || []);
  useEffect(() => { mentionItemsRef.current = mentionItems || []; }, [mentionItems]);
  const isSimple = toolbar === 'simple';
  // 'simple' e 'basic': só negrito/itálico (ver o prop). A diferença entre os
  // dois é só a imagem — isSimple continua decidindo isso.
  const isTextOnly = toolbar !== 'full';
  const [isUrlModalOpen, setIsUrlModalOpen] = React.useState<'image' | 'youtube' | null>(null);
  const [urlInputValue, setUrlInputValue] = React.useState('');
  // Painel de link (2026-11-25): Texto + Endereço, vale em todos os modos.
  const [linkPanel, setLinkPanel] = React.useState<LinkPanelState | null>(null);
  const [linkError, setLinkError] = React.useState<string | null>(null);
  const linkUrlInputRef = useRef<HTMLInputElement>(null);

  // onUpdate propaga pro pai via onChange, o que devolve um novo `content`
  // no próximo render — sem essa flag, o efeito de sync abaixo achava que
  // era uma mudança externa e rodava `setContent` (reparse completo do HTML,
  // perde posição do cursor) a cada letra digitada, travando o editor em
  // textos maiores.
  const isInternalUpdate = useRef(false);

  // useEditor só lê `editorProps`/extensões na CRIAÇÃO do editor (não
  // reage a mudança de props em re-renders, por isso o `content` também
  // precisa do efeito de sync mais abaixo) — capturar `onPasteImages` direto
  // no fechamento do handlePaste travaria na primeira versão da função.
  // Ref sempre atualizada resolve isso sem precisar recriar o editor.
  const onPasteImagesRef = useRef(onPasteImages);
  useEffect(() => { onPasteImagesRef.current = onPasteImages; }, [onPasteImages]);

  // handlePaste/handleDrop são lidos só na criação do editor (ver acima), e
  // precisam da instância do editor pra inserir a imagem depois do upload.
  const editorRef = useRef<ReturnType<typeof useEditor>>(null);
  // src base64 que já estão sendo enviados — a varredura roda a cada update
  // e não pode subir a mesma imagem duas vezes.
  const uploadingSrcsRef = useRef<Set<string>>(new Set());

  // Sobe as imagens como arquivo e insere no texto com o link, na posição em
  // que foram coladas/soltas (limitada ao tamanho atual do documento, que pode
  // ter mudado enquanto o upload rodava).
  const insertUploadedImages = useCallback(async (files: File[], pos: number) => {
    const ed = editorRef.current;
    if (!ed || files.length === 0) return;
    const toastId = toast.loading(files.length > 1 ? `Enviando ${files.length} imagens...` : 'Enviando imagem...');
    try {
      const uploaded = await Promise.all(files.map(f => uploadAttachment(f, f.name || 'imagem-colada.png')));
      const current = editorRef.current;
      if (!current || current.isDestroyed) return;
      const at = Math.min(pos, current.state.doc.content.size);
      current.chain().focus().insertContentAt(at, uploaded.map(a => ({ type: 'image', attrs: { src: a.url } }))).run();
      toast.dismiss(toastId);
    } catch (err: any) {
      toast.error(err?.message || 'Não foi possível enviar a imagem.', { id: toastId });
    }
  }, []);

  // Rede de segurança: imagem que entrou no texto como base64 por outro
  // caminho (HTML colado de outro site/app com a imagem embutida, conteúdo
  // antigo carregado no editor) é enviada como arquivo e o src é trocado pelo
  // link. Se o envio falhar, a imagem fica como está — o servidor ainda
  // converte ao salvar.
  const externalizeDataImages = useCallback(() => {
    const ed = editorRef.current;
    if (!ed || ed.isDestroyed) return;
    const pending: string[] = [];
    ed.state.doc.descendants(node => {
      const src = node.type.name === 'image' ? String(node.attrs.src || '') : '';
      if (src.startsWith('data:image/') && !uploadingSrcsRef.current.has(src)) pending.push(src);
    });
    for (const src of pending) {
      uploadingSrcsRef.current.add(src);
      dataUrlToBlob(src)
        .then(blob => uploadAttachment(blob, `imagem-colada.${(blob.type.split('/')[1] || 'png').replace(/[^a-z0-9]/gi, '')}`))
        .then(att => {
          const current = editorRef.current;
          if (!current || current.isDestroyed) return;
          const { tr } = current.state;
          let changed = false;
          current.state.doc.descendants((node, pos) => {
            if (node.type.name === 'image' && node.attrs.src === src) {
              tr.setNodeMarkup(pos, undefined, { ...node.attrs, src: att.url });
              changed = true;
            }
          });
          if (changed) current.view.dispatch(tr);
        })
        .catch(err => console.error('[rich-editor] Falha ao enviar imagem embutida, mantendo no texto:', err))
        .finally(() => uploadingSrcsRef.current.delete(src));
    }
  }, []);

  // Abre o painel de link a partir da seleção atual. Com o cursor dentro de um
  // link, seleciona o link inteiro e abre em modo edição.
  const openLinkPanel = useCallback(() => {
    const ed = editorRef.current;
    if (!ed || ed.isDestroyed) return;
    const editing = ed.isActive('link');
    if (editing) ed.chain().focus().extendMarkRange('link').run();
    const { from, to } = ed.state.selection;
    const text = ed.state.doc.textBetween(from, to, ' ');
    setIsUrlModalOpen(null);
    setLinkError(null);
    setLinkPanel({
      text,
      originalText: text,
      url: editing ? displayLinkUrl(String(ed.getAttributes('link').href || '')) : '',
      from,
      to,
      editing,
    });
  }, []);
  const openLinkPanelRef = useRef(openLinkPanel);
  useEffect(() => { openLinkPanelRef.current = openLinkPanel; }, [openLinkPanel]);

  const closeLinkPanel = useCallback(() => {
    setLinkPanel(null);
    setLinkError(null);
    editorRef.current?.commands.focus();
  }, []);

  const applyLink = useCallback((e?: React.FormEvent) => {
    e?.preventDefault();
    const ed = editorRef.current;
    if (!ed || ed.isDestroyed || !linkPanel) return;
    const href = normalizeLinkUrl(linkPanel.url);
    if (!href) {
      setLinkError('Endereço inválido. Use um site (ex.: site.com.br), um e-mail ou um telefone.');
      linkUrlInputRef.current?.focus();
      return;
    }
    const size = ed.state.doc.content.size;
    const from = Math.min(linkPanel.from, size);
    const to = Math.min(linkPanel.to, size);
    const text = linkPanel.text.trim() ? linkPanel.text : '';
    const linkMark = [{ type: 'link', attrs: { href } }];
    let end: number;
    const chain = ed.chain().focus();
    if (from === to) {
      // Sem seleção: insere o texto (ou o próprio endereço) já com o link.
      const label = text || displayLinkUrl(href);
      chain.insertContentAt(from, { type: 'text', text: label, marks: linkMark });
      end = from + label.length;
    } else if (text && text !== linkPanel.originalText) {
      chain.insertContentAt({ from, to }, { type: 'text', text, marks: linkMark });
      end = from + text.length;
    } else {
      chain.setTextSelection({ from, to }).setLink({ href });
      end = to;
    }
    // O link é "inclusive" (por causa do autolink): sem tirar a marca
    // guardada, o que se digita logo depois continuaria dentro do link.
    chain.setTextSelection(end).unsetMark('link').run();
    setLinkPanel(null);
    setLinkError(null);
  }, [linkPanel]);

  const removeLink = useCallback(() => {
    const ed = editorRef.current;
    if (!ed || ed.isDestroyed) return;
    if (linkPanel) {
      ed.chain().focus().setTextSelection({ from: linkPanel.from, to: linkPanel.to }).unsetLink().run();
    } else {
      ed.chain().focus().extendMarkRange('link').unsetLink().run();
    }
    setLinkPanel(null);
    setLinkError(null);
  }, [linkPanel]);

  const openHref = (href: string | null | undefined) => {
    if (href && isAllowedLinkHref(href)) window.open(href, '_blank', 'noopener,noreferrer');
  };

  // Esc dentro do painel fecha só o painel. stopPropagation: senão o Esc
  // chegaria ao listener do modal (useEscapeToClose, na window) e fecharia o
  // chamado/ticket inteiro por baixo.
  // Teclas do painel de link: Esc fecha SÓ o painel, Enter aplica (sem <form>,
  // ver o painel), Ctrl+K não abre a busca do navegador.
  //
  // Listener NATIVO no próprio painel, não onKeyDown do React: no App Router
  // o React escuta no `document`, o mesmo nó onde o modal do chamado ouve o
  // Esc — e stopPropagation de um handler React não barra outro listener do
  // mesmo nó. O Esc do painel fechava o chamado (achado no teste, 2026-11-25).
  // Parado aqui, ele não chega ao document nem à window (useEscapeToClose).
  const linkPanelElRef = useRef<HTMLDivElement>(null);
  const linkPanelKeyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  linkPanelKeyRef.current = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeLinkPanel();
    } else if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') {
      e.preventDefault();
      e.stopPropagation();
      applyLink();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      e.stopPropagation();
    }
  };
  const isLinkPanelOpen = !!linkPanel;
  useEffect(() => {
    const el = linkPanelElRef.current;
    if (!isLinkPanelOpen || !el) return;
    const onKey = (e: KeyboardEvent) => linkPanelKeyRef.current(e);
    el.addEventListener('keydown', onKey);
    return () => el.removeEventListener('keydown', onKey);
  }, [isLinkPanelOpen]);

  const editor = useEditor({
    immediatelyRender: false,
    // O editor se redesenha a cada transação (tecla, seleção) — só ELE, que é
    // barato. Necessário desde que telas grandes (ticket interno, 2026-11-12)
    // deixaram de guardar o texto em estado a cada tecla, por performance:
    // antes, era o redesenho do PAI que fazia os botões de negrito/itálico
    // acenderem conforme o cursor.
    shouldRerenderOnTransaction: true,
    extensions: [
      StarterKit.configure({
        link: false,
        ...(isTextOnly ? {
          heading: false,
          blockquote: false,
          bulletList: false,
          orderedList: false,
          codeBlock: false,
          horizontalRule: false,
          code: false,
        } : {}),
      }),
      BubbleMenuExtension,
      FloatingMenuExtension,
      // Link em TODOS os modos (2026-11-25, pedido do usuário: corpo e notas do
      // chamado e do ticket interno). Na nota do chamado, que vira WhatsApp/
      // e-mail, o link sai como "texto (endereço)" — ver htmlLinksToText.
      // Clique simples só posiciona o cursor (para editar); Ctrl+clique abre.
      // Só http(s), mailto e tel: o HTML é exibido sem sanitização, então um
      // href `javascript:` nunca pode ser gravado (isAllowedUri vale ao criar
      // E ao ler HTML já salvo).
      Link.configure({
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        defaultProtocol: 'https',
        isAllowedUri: (url, ctx) => isAllowedLinkHref(url) && ctx.defaultValidate(url),
        HTMLAttributes: {
          target: '_blank',
          rel: 'noopener noreferrer nofollow',
          class: 'text-[var(--accent-text)] underline font-medium [overflow-wrap:anywhere]',
        },
      }),
      createLinkShortcut(() => openLinkPanelRef.current()),
      // Imagem e vídeo embutido não existem no modo simples — nem como node
      // do editor, pra colar/atalho também não produzir um.
      ...(isSimple ? [] : [
        ResizableImage.configure({
          // Inline (2026-11-25): imagens ficam lado a lado quando cabem e
          // quebram linha como texto. HTML antigo com <img> solto entre
          // parágrafos é embrulhado num parágrafo ao abrir — nada se perde.
          inline: true,
          allowBase64: true,
          // NodeView cuida do visual dentro do editor — este HTMLAttributes é
          // o que garante que o HTML salvo (editor.getHTML(), usado fora do
          // editor: chamado, e-mail, nota interna) continue com a mesma classe.
          HTMLAttributes: {
            class: 'inline-block align-bottom rounded-xl max-w-full my-1 border border-[var(--border-default)] shadow-sm',
          },
        }),
        ...(isTextOnly ? [] : [
        Youtube.configure({
          width: 480,
          height: 320,
          HTMLAttributes: {
            class: 'rounded-xl overflow-hidden my-4 shadow-lg mx-auto',
          },
        })]),
      ]),
      Placeholder.configure({
        placeholder,
      }),
      createMentionExtension(() => mentionItemsRef.current),
    ],
    content,
    onUpdate: ({ editor }) => {
      isInternalUpdate.current = true;
      const html = editor.getHTML();
      onChange(html);
      if (!isSimple && html.includes('data:image/')) externalizeDataImages();
    },
    editorProps: {
      attributes: {
        class: cn(
          "prose prose-sm max-w-none text-base focus:outline-none focus:ring-0 p-4",
          "prose-headings:font-black prose-headings:tracking-tighter",
          "prose-p:text-[var(--text-secondary)] prose-p:font-medium leading-relaxed",
          "prose-a:text-[var(--accent-text)] prose-a:underline"
        ),
      },
      // Ctrl+V de imagem (print/screenshot) — vira ANEXO de verdade via
      // onPasteImages, em vez de embutida no texto rico (necessário no modo
      // 'simple', que nem tem o node de imagem no schema, ver o prop acima).
      // Sem onPasteImages (ou paste sem imagem), devolve `false` e o Tiptap
      // segue com o comportamento padrão de sempre.
      // Com onPasteImages: a imagem vira ANEXO (comportamento de sempre). Sem
      // ele, no modo 'full': sobe como arquivo e entra no texto com o link, em
      // vez de base64 (ver imageFilesFrom no topo).
      handlePaste: (view, event) => {
        const files = imageFilesFrom(event.clipboardData?.items);
        if (files.length === 0) return false;

        const callback = onPasteImagesRef.current;
        if (callback) {
          callback(files);
          return true;
        }
        if (isSimple) return false;

        insertUploadedImages(files, view.state.selection.from);
        return true;
      },
      // Ctrl+clique (Cmd no Mac) num link abre em outra aba; o clique simples
      // só posiciona o cursor, para dar para editar o texto do link.
      handleClick: (_view, _pos, event) => {
        if (!(event.ctrlKey || event.metaKey)) return false;
        const anchor = (event.target as HTMLElement | null)?.closest?.('a');
        const href = anchor?.getAttribute('href');
        if (!href || !isAllowedLinkHref(href)) return false;
        window.open(href, '_blank', 'noopener,noreferrer');
        return true;
      },
      // Arrastar imagem do computador pra dentro do editor — mesmo destino do
      // colar. Arrasto interno (mover um trecho do próprio texto) passa direto.
      handleDrop: (view, event, _slice, moved) => {
        if (moved || isSimple) return false;
        const files = imageFilesFrom(event.dataTransfer?.files);
        if (files.length === 0) return false;
        const coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
        event.preventDefault();
        insertUploadedImages(files, coords?.pos ?? view.state.selection.from);
        return true;
      },
    },
  });

  useEffect(() => {
    editorRef.current = editor;
    // Conteúdo carregado já com base64 (descrição antiga) também é convertido.
    if (editor && !isSimple && editor.getHTML().includes('data:image/')) externalizeDataImages();
  }, [editor, isSimple, externalizeDataImages]);

  // Ensure editor is editable
  useEffect(() => {
    if (editor) {
      editor.setEditable(true);
    }
  }, [editor]);

  // Handle click to focus
  const handleContainerClick = useCallback((e: React.MouseEvent) => {
    if (editor && e.target === e.currentTarget) {
      editor.chain().focus().run();
    }
  }, [editor]);


  // Sync content if it changes externally (and it's not the editor's own update)
  useEffect(() => {
    if (!editor) return;
    if (isInternalUpdate.current) {
      isInternalUpdate.current = false;
      return;
    }
    if (content !== editor.getHTML()) {
      editor.commands.setContent(content);
    }
  }, [content, editor]);

  const handleUrlSubmit = useCallback((e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!urlInputValue || !editor) {
      setIsUrlModalOpen(null);
      return;
    }

    if (isUrlModalOpen === 'image') {
      editor.chain().focus().setImage({ src: urlInputValue }).run();
    } else if (isUrlModalOpen === 'youtube') {
      editor.chain().focus().setYoutubeVideo({ src: urlInputValue }).run();
    }

    setUrlInputValue('');
    setIsUrlModalOpen(null);
  }, [editor, isUrlModalOpen, urlInputValue]);

  const openUrlModal = (type: 'image' | 'youtube') => {
    setLinkPanel(null);
    setUrlInputValue('');
    setIsUrlModalOpen(type);
  };

  if (!editor) return null;

  return (
    <div className={cn("w-full border border-[var(--border-default)] rounded-2xl overflow-hidden bg-[var(--surface-card)] group focus-within:ring-4 focus-within:ring-[var(--accent)]/10 focus-within:border-[var(--accent)] transition-all", fill && "flex-1 flex flex-col min-h-0")}>
      {/* Toolbar */}
      <div className="bg-[var(--surface-card)] border-b border-[var(--border-default)] p-2 flex flex-wrap gap-1 items-center">
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleBold().run()}
          className={cn("p-1.5 rounded-lg transition-all hover:bg-[var(--surface-card)] hover:shadow-sm", editor.isActive('bold') ? "bg-[var(--surface-card)] shadow-sm text-[var(--accent-text)]" : "text-[var(--text-tertiary)]")}
          title="Negrito"
        >
          <Bold size={16} />
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleItalic().run()}
          className={cn("p-1.5 rounded-lg transition-all hover:bg-[var(--surface-card)] hover:shadow-sm", editor.isActive('italic') ? "bg-[var(--surface-card)] shadow-sm text-[var(--accent-text)]" : "text-[var(--text-tertiary)]")}
          title="Itálico"
        >
          <Italic size={16} />
        </button>
        <button
          type="button"
          onClick={openLinkPanel}
          className={cn("p-1.5 rounded-lg transition-all hover:bg-[var(--surface-card)] hover:shadow-sm", editor.isActive('link') ? "bg-[var(--surface-card)] shadow-sm text-[var(--accent-text)]" : "text-[var(--text-tertiary)]")}
          title="Link (Ctrl+K)"
          aria-label="Inserir link (Ctrl+K)"
        >
          <LinkIcon size={16} />
        </button>
        {!isTextOnly && (
          <>
            <div className="w-px h-4 bg-[var(--text-tertiary)] mx-1" />
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
              className={cn("p-1.5 rounded-lg transition-all hover:bg-[var(--surface-card)] hover:shadow-sm", editor.isActive('heading', { level: 1 }) ? "bg-[var(--surface-card)] shadow-sm text-[var(--accent-text)]" : "text-[var(--text-tertiary)]")}
              title="Título 1"
            >
              <Heading1 size={16} />
            </button>
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
              className={cn("p-1.5 rounded-lg transition-all hover:bg-[var(--surface-card)] hover:shadow-sm", editor.isActive('heading', { level: 2 }) ? "bg-[var(--surface-card)] shadow-sm text-[var(--accent-text)]" : "text-[var(--text-tertiary)]")}
              title="Título 2"
            >
              <Heading2 size={16} />
            </button>
            <div className="w-px h-4 bg-[var(--text-tertiary)] mx-1" />
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleBulletList().run()}
              className={cn("p-1.5 rounded-lg transition-all hover:bg-[var(--surface-card)] hover:shadow-sm", editor.isActive('bulletList') ? "bg-[var(--surface-card)] shadow-sm text-[var(--accent-text)]" : "text-[var(--text-tertiary)]")}
              title="Lista"
            >
              <List size={16} />
            </button>
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleOrderedList().run()}
              className={cn("p-1.5 rounded-lg transition-all hover:bg-[var(--surface-card)] hover:shadow-sm", editor.isActive('orderedList') ? "bg-[var(--surface-card)] shadow-sm text-[var(--accent-text)]" : "text-[var(--text-tertiary)]")}
              title="Lista Numerada"
            >
              <ListOrdered size={16} />
            </button>
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleBlockquote().run()}
              className={cn("p-1.5 rounded-lg transition-all hover:bg-[var(--surface-card)] hover:shadow-sm", editor.isActive('blockquote') ? "bg-[var(--surface-card)] shadow-sm text-[var(--accent-text)]" : "text-[var(--text-tertiary)]")}
              title="Citação"
            >
              <Quote size={16} />
            </button>
            <div className="w-px h-4 bg-[var(--text-tertiary)] mx-1" />
            <button
              type="button"
              onClick={() => openUrlModal('image')}
              className="p-1.5 rounded-lg transition-all hover:bg-[var(--surface-card)] hover:shadow-sm text-[var(--text-tertiary)]"
              title="Imagem"
            >
              <ImageIcon size={16} />
            </button>
            <button
              type="button"
              onClick={() => openUrlModal('youtube')}
              className="p-1.5 rounded-lg transition-all hover:bg-[var(--surface-card)] hover:shadow-sm text-[var(--text-tertiary)]"
              title="Vídeo do YouTube"
            >
              <YoutubeIcon size={16} />
            </button>
          </>
        )}
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => editor.chain().focus().undo().run()}
          className="p-1.5 rounded-lg transition-all hover:bg-[var(--surface-card)] hover:shadow-sm text-[var(--text-tertiary)]"
          disabled={!editor.can().undo()}
        >
          <Undo size={16} />
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().redo().run()}
          className="p-1.5 rounded-lg transition-all hover:bg-[var(--surface-card)] hover:shadow-sm text-[var(--text-tertiary)]"
          disabled={!editor.can().redo()}
        >
          <Redo size={16} />
        </button>
      </div>

      {/* URL Input Modal (Internal) */}
      {isUrlModalOpen && (
        <div className="bg-[var(--surface-card)] border-b border-[var(--border-default)] p-3 animate-in slide-in-from-top-1 duration-200">
          <form onSubmit={handleUrlSubmit} className="flex gap-2">
            <input
              autoFocus
              type="text"
              value={urlInputValue}
              onChange={(e) => setUrlInputValue(e.target.value)}
              placeholder={isUrlModalOpen === 'image' ? "Cole a URL da imagem..." : "Cole a URL do vídeo do YouTube..."}
              className="flex-1 px-3 py-1.5 text-sm border border-[var(--border-default)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20 focus:border-[var(--accent)]"
            />
            <button
              type="submit"
              className="px-3 py-1.5 bg-[var(--accent)] text-white text-sm font-semibold rounded-lg hover:bg-[var(--accent-hover)] transition-colors"
            >
              Confirmar
            </button>
            <button
              type="button"
              onClick={() => setIsUrlModalOpen(null)}
              className="px-3 py-1.5 bg-[var(--surface-pill)] text-[var(--text-secondary)] text-sm font-semibold rounded-lg hover:bg-[var(--border-default)] transition-colors"
            >
              Cancelar
            </button>
          </form>
        </div>
      )}

      {/* Painel de link (Ctrl+K ou botão da barra). Enter aplica, Esc fecha. */}
      {/* <div> e não <form>: o editor fica dentro do <form> do "Novo Chamado",
          e um submit aqui dentro propagaria e enviaria o chamado inteiro. */}
      {linkPanel && (
        <div
          ref={linkPanelElRef}
          role="group"
          aria-label={linkPanel.editing ? 'Editar link' : 'Inserir link'}
          className="bg-[var(--surface-card)] border-b border-[var(--border-default)] p-3 flex flex-col gap-2 animate-in slide-in-from-top-1 duration-200"
        >
          <div className="flex flex-col sm:flex-row gap-2">
            <label className="flex-1 min-w-0">
              <span className="block text-[10px] font-semibold uppercase tracking-widest text-[var(--text-tertiary)] mb-1">Texto</span>
              <input
                type="text"
                value={linkPanel.text}
                onChange={e => setLinkPanel(p => p && { ...p, text: e.target.value })}
                placeholder="Texto exibido (opcional)"
                className="w-full px-3 py-1.5 text-sm bg-[var(--surface-card)] text-[var(--text-primary)] border border-[var(--border-default)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20 focus:border-[var(--accent)]"
              />
            </label>
            <label className="flex-[1.4] min-w-0">
              <span className="block text-[10px] font-semibold uppercase tracking-widest text-[var(--text-tertiary)] mb-1">Endereço</span>
              <input
                ref={linkUrlInputRef}
                autoFocus
                type="text"
                inputMode="url"
                value={linkPanel.url}
                onChange={e => { setLinkError(null); setLinkPanel(p => p && { ...p, url: e.target.value }); }}
                placeholder="site.com.br, e-mail ou telefone"
                aria-invalid={!!linkError}
                aria-describedby={linkError ? 'rich-link-error' : undefined}
                className={cn(
                  "w-full px-3 py-1.5 text-sm bg-[var(--surface-card)] text-[var(--text-primary)] border rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20 focus:border-[var(--accent)]",
                  linkError ? "border-[var(--text-danger)]" : "border-[var(--border-default)]"
                )}
              />
            </label>
          </div>
          {linkError && <p id="rich-link-error" role="alert" className="text-xs font-medium text-[var(--text-danger)]">{linkError}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => applyLink()} className="px-3 py-1.5 bg-[var(--accent)] text-white text-sm font-semibold rounded-lg hover:bg-[var(--accent-hover)] transition-colors">
              {linkPanel.editing ? 'Salvar link' : 'Inserir link'}
            </button>
            <button type="button" onClick={closeLinkPanel} className="px-3 py-1.5 bg-[var(--surface-pill)] text-[var(--text-secondary)] text-sm font-semibold rounded-lg hover:bg-[var(--border-default)] transition-colors">
              Cancelar
            </button>
            {linkPanel.editing && (
              <button type="button" onClick={removeLink} className="ml-auto flex items-center gap-1.5 px-3 py-1.5 text-[var(--text-danger)] text-sm font-semibold rounded-lg hover:bg-[var(--surface-danger)] transition-colors">
                <Unlink size={14} /> Remover link
              </button>
            )}
          </div>
        </div>
      )}

      {/* Cursor dentro de um link: mostra o destino e as ações, sem precisar
          abrir o painel (padrão de editores de texto). */}
      {!linkPanel && !isUrlModalOpen && editor.isActive('link') && (() => {
        const href = String(editor.getAttributes('link').href || '');
        return (
          <div className="bg-[var(--surface-card)] border-b border-[var(--border-default)] px-3 py-1.5 flex items-center gap-2 text-xs">
            <LinkIcon size={12} className="text-[var(--text-tertiary)] shrink-0" />
            <span className="truncate min-w-0 text-[var(--text-secondary)]" title={href}>{displayLinkUrl(href)}</span>
            <div className="ml-auto flex items-center gap-1 shrink-0">
              <button type="button" onClick={() => openHref(href)} className="flex items-center gap-1 px-2 py-1 rounded-md text-[var(--accent-text)] font-semibold hover:bg-[var(--surface-pill)]" title="Abrir em outra aba (ou Ctrl+clique no link)">
                <ExternalLink size={12} /> Abrir
              </button>
              <button type="button" onClick={openLinkPanel} className="flex items-center gap-1 px-2 py-1 rounded-md text-[var(--text-secondary)] font-semibold hover:bg-[var(--surface-pill)]" title="Editar link (Ctrl+K)">
                <Pencil size={12} /> Editar
              </button>
              <button type="button" onClick={removeLink} className="flex items-center gap-1 px-2 py-1 rounded-md text-[var(--text-danger)] font-semibold hover:bg-[var(--surface-danger)]" title="Remover link (mantém o texto)">
                <Unlink size={12} /> Remover
              </button>
            </div>
          </div>
        );
      })()}

{/* Editor Content Area */}
        <div
          style={maxHeight ? { minHeight, maxHeight, overflowY: 'auto' } : { minHeight }}
          className={cn("cursor-text bg-[var(--surface-card)] relative", fill && "flex-1 overflow-y-auto")}
          onClick={handleContainerClick}
        >
          <EditorContent editor={editor} className="outline-none focus:outline-none pointer-events-auto" />
        </div>

      {/* Bubble Menu for quick formatting */}
      {editor && (
        // @ts-expect-error - BubbleMenu type version mismatch
        <BubbleMenu editor={editor} tippyOptions={{ duration: 100 }} className="flex bg-slate-900 rounded-lg shadow-xl p-1 gap-1 overflow-hidden border border-slate-700">
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleBold().run()}
            className={cn("p-1 rounded transition-all", editor.isActive('bold') ? "text-[var(--accent-text)]" : "text-white")}
          >
            <Bold size={14} />
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleItalic().run()}
            className={cn("p-1 rounded transition-all", editor.isActive('italic') ? "text-[var(--accent-text)]" : "text-white")}
          >
            <Italic size={14} />
          </button>
          <button
            type="button"
            onClick={openLinkPanel}
            title="Link (Ctrl+K)"
            className={cn("p-1 rounded transition-all", editor.isActive('link') ? "text-[var(--accent-text)]" : "text-white")}
          >
            <LinkIcon size={14} />
          </button>
        </BubbleMenu>
      )}

      {/* Custom Paste handling for images/mídia */}
      <div className="hidden">
        <input 
          type="file" 
          accept="image/*" 
          onChange={(e) => {
            const file = e.target.files?.[0];
            // Sobe como arquivo (antes lia como base64 e embutia no texto).
            if (file) insertUploadedImages([file], editor.state.selection.from);
          }}
        />
      </div>
    </div>
  );
}


