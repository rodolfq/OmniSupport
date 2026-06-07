'use client';

import React, { useCallback, useEffect } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
// Some versions of Tiptap export menus from a subpath
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
import { BubbleMenu } from '@tiptap/react/menus';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import Youtube from '@tiptap/extension-youtube';
import Placeholder from '@tiptap/extension-placeholder';
import BubbleMenuExtension from '@tiptap/extension-bubble-menu';
import FloatingMenuExtension from '@tiptap/extension-floating-menu';
import { 
  Bold, Italic, List, ListOrdered, Image as ImageIcon, 
  Youtube as YoutubeIcon, Link as LinkIcon, 
  Heading1, Heading2, Quote, Undo, Redo
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface RichEditorProps {
  content: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: string;
}

export function RichEditor({ content, onChange, placeholder = 'Comece a digitar...', minHeight = '150px' }: RichEditorProps) {
  const [isUrlModalOpen, setIsUrlModalOpen] = React.useState<'link' | 'image' | 'youtube' | null>(null);
  const [urlInputValue, setUrlInputValue] = React.useState('');

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        link: false,
      }),
      BubbleMenuExtension,
      FloatingMenuExtension,
      Image.configure({
        allowBase64: true,
        HTMLAttributes: {
          class: 'rounded-xl max-w-full my-4 border border-slate-200 shadow-sm',
        },
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: 'text-indigo-600 underline font-medium',
        },
      }),
      Youtube.configure({
        width: 480,
        height: 320,
        HTMLAttributes: {
          class: 'rounded-xl overflow-hidden my-4 shadow-lg mx-auto',
        },
      }),
      Placeholder.configure({
        placeholder,
      }),
    ],
    content,
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },
    editorProps: {
      attributes: {
        class: cn(
          "prose prose-sm max-w-none focus:outline-none focus:ring-0 p-4",
          "prose-headings:font-black prose-headings:tracking-tighter",
          "prose-p:text-slate-600 prose-p:font-medium leading-relaxed",
          "prose-a:text-indigo-600 prose-a:underline"
        ),
      },
    },
  });

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
    if (editor && content !== editor.getHTML()) {
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
    } else if (isUrlModalOpen === 'link') {
      if (urlInputValue === '') {
        editor.chain().focus().extendMarkRange('link').unsetLink().run();
      } else {
        editor.chain().focus().extendMarkRange('link').setLink({ href: urlInputValue }).run();
      }
    }

    setUrlInputValue('');
    setIsUrlModalOpen(null);
  }, [editor, isUrlModalOpen, urlInputValue]);

  const openUrlModal = (type: 'link' | 'image' | 'youtube') => {
    const previousUrl = type === 'link' ? editor?.getAttributes('link').href : '';
    setUrlInputValue(previousUrl || '');
    setIsUrlModalOpen(type);
  };

  if (!editor) return null;

  return (
    <div className="w-full border border-slate-200 rounded-2xl overflow-hidden bg-white group focus-within:ring-4 focus-within:ring-indigo-500/10 focus-within:border-indigo-500 transition-all">
      {/* Toolbar */}
      <div className="bg-slate-50 border-b border-slate-200 p-2 flex flex-wrap gap-1 items-center">
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleBold().run()}
          className={cn("p-1.5 rounded-lg transition-all hover:bg-white hover:shadow-sm", editor.isActive('bold') ? "bg-white shadow-sm text-indigo-600" : "text-slate-400")}
          title="Negrito"
        >
          <Bold size={16} />
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleItalic().run()}
          className={cn("p-1.5 rounded-lg transition-all hover:bg-white hover:shadow-sm", editor.isActive('italic') ? "bg-white shadow-sm text-indigo-600" : "text-slate-400")}
          title="ItÃ¡lico"
        >
          <Italic size={16} />
        </button>
        <div className="w-px h-4 bg-slate-300 mx-1" />
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          className={cn("p-1.5 rounded-lg transition-all hover:bg-white hover:shadow-sm", editor.isActive('heading', { level: 1 }) ? "bg-white shadow-sm text-indigo-600" : "text-slate-400")}
          title="Título 1"
        >
          <Heading1 size={16} />
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          className={cn("p-1.5 rounded-lg transition-all hover:bg-white hover:shadow-sm", editor.isActive('heading', { level: 2 }) ? "bg-white shadow-sm text-indigo-600" : "text-slate-400")}
          title="Título 2"
        >
          <Heading2 size={16} />
        </button>
        <div className="w-px h-4 bg-slate-300 mx-1" />
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          className={cn("p-1.5 rounded-lg transition-all hover:bg-white hover:shadow-sm", editor.isActive('bulletList') ? "bg-white shadow-sm text-indigo-600" : "text-slate-400")}
          title="Lista"
        >
          <List size={16} />
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          className={cn("p-1.5 rounded-lg transition-all hover:bg-white hover:shadow-sm", editor.isActive('orderedList') ? "bg-white shadow-sm text-indigo-600" : "text-slate-400")}
          title="Lista Numerada"
        >
          <ListOrdered size={16} />
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          className={cn("p-1.5 rounded-lg transition-all hover:bg-white hover:shadow-sm", editor.isActive('blockquote') ? "bg-white shadow-sm text-indigo-600" : "text-slate-400")}
          title="CitaÃ§Ã£o"
        >
          <Quote size={16} />
        </button>
        <div className="w-px h-4 bg-slate-300 mx-1" />
        <button
          type="button"
          onClick={() => openUrlModal('link')}
          className={cn("p-1.5 rounded-lg transition-all hover:bg-white hover:shadow-sm", editor.isActive('link') ? "bg-white shadow-sm text-indigo-600" : "text-slate-400")}
          title="Link"
        >
          <LinkIcon size={16} />
        </button>
        <button
          type="button"
          onClick={() => openUrlModal('image')}
          className="p-1.5 rounded-lg transition-all hover:bg-white hover:shadow-sm text-slate-400"
          title="Imagem"
        >
          <ImageIcon size={16} />
        </button>
        <button
          type="button"
          onClick={() => openUrlModal('youtube')}
          className="p-1.5 rounded-lg transition-all hover:bg-white hover:shadow-sm text-slate-400"
          title="VÃ­deo do YouTube"
        >
          <YoutubeIcon size={16} />
        </button>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => editor.chain().focus().undo().run()}
          className="p-1.5 rounded-lg transition-all hover:bg-white hover:shadow-sm text-slate-400"
          disabled={!editor.can().undo()}
        >
          <Undo size={16} />
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().redo().run()}
          className="p-1.5 rounded-lg transition-all hover:bg-white hover:shadow-sm text-slate-400"
          disabled={!editor.can().redo()}
        >
          <Redo size={16} />
        </button>
      </div>

      {/* URL Input Modal (Internal) */}
      {isUrlModalOpen && (
        <div className="bg-white border-b border-slate-200 p-3 animate-in slide-in-from-top-1 duration-200">
          <form onSubmit={handleUrlSubmit} className="flex gap-2">
            <input
              autoFocus
              type="text"
              value={urlInputValue}
              onChange={(e) => setUrlInputValue(e.target.value)}
              placeholder={
                isUrlModalOpen === 'link' ? "Digite a URL do link..." :
                isUrlModalOpen === 'image' ? "Cole a URL da imagem..." :
                "Cole a URL do vÃ­deo do YouTube..."
              }
              className="flex-1 px-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
            />
            <button
              type="submit"
              className="px-3 py-1.5 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 transition-colors"
            >
              Confirmar
            </button>
            <button
              type="button"
              onClick={() => setIsUrlModalOpen(null)}
              className="px-3 py-1.5 bg-slate-100 text-slate-600 text-sm font-semibold rounded-lg hover:bg-slate-200 transition-colors"
            >
              Cancelar
            </button>
          </form>
        </div>
      )}

{/* Editor Content Area */}
        <div 
          style={{ minHeight }} 
          className="cursor-text bg-white relative"
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
            className={cn("p-1 rounded transition-all", editor.isActive('bold') ? "text-indigo-400" : "text-white")}
          >
            <Bold size={14} />
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleItalic().run()}
            className={cn("p-1 rounded transition-all", editor.isActive('italic') ? "text-indigo-400" : "text-white")}
          >
            <Italic size={14} />
          </button>
          <button
            type="button"
            onClick={() => openUrlModal('link')}
            className={cn("p-1 rounded transition-all", editor.isActive('link') ? "text-indigo-400" : "text-white")}
          >
            <LinkIcon size={14} />
          </button>
        </BubbleMenu>
      )}

      {/* Custom Paste handling for images/mÃ­dia */}
      <div className="hidden">
        <input 
          type="file" 
          accept="image/*" 
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) {
              const reader = new FileReader();
              reader.onload = (event) => {
                const src = event.target?.result as string;
                editor.chain().focus().setImage({ src }).run();
              };
              reader.readAsDataURL(file);
            }
          }}
        />
      </div>
    </div>
  );
}


