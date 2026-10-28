"use client";

import "./note-editor.css";
import { cn } from "@margin/ui/lib/utils";
import { TaskItem } from "@tiptap/extension-task-item";
import { TaskList } from "@tiptap/extension-task-list";
import {
  type Editor,
  EditorContent,
  mergeAttributes,
  Node,
  type NodeViewProps,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  useEditor,
} from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import {
  BoldIcon,
  CodeIcon,
  Heading2Icon,
  ItalicIcon,
  LinkIcon,
  ListIcon,
  ListOrderedIcon,
  ListTodoIcon,
  QuoteIcon,
} from "lucide-react";
import { createContext, useContext, useEffect, useRef } from "react";
import type { JsonNode, QuoteAttrs } from "@/lib/notes/doc";

/** What a quote node needs from the reader: live annotations and a way to open one. */
export interface QuoteHost {
  loaded: boolean;
  get(id: string): { color: string | null; quote: string; page: number } | undefined;
  /** Attributes for a new quote node, or undefined when the id is unknown. */
  attrsFor(id: string): QuoteAttrs | undefined;
  jump(id: string): void;
}

export const QuoteContext = createContext<QuoteHost | null>(null);
export const DRAG_TYPE = "application/x-margin-annotation";

function QuoteView({ node }: NodeViewProps) {
  const host = useContext(QuoteContext);
  const id = String(node.attrs.annotationId);
  const live = host?.get(id);
  const gone = Boolean(host?.loaded && !live);
  const color = live?.color ?? (node.attrs.color as string | null);
  const page = live?.page ?? Number(node.attrs.page);
  const text = live?.quote ?? String(node.attrs.quoteSnapshot);
  return (
    <NodeViewWrapper
      className="mr-quote"
      data-testid="note-quote"
      data-annotation-id={id}
      data-state={gone ? "deleted" : "live"}
      data-color={color ?? undefined}
      draggable="true"
      data-drag-handle=""
    >
      <button
        type="button"
        className="mr-quote-body"
        disabled={gone || !host}
        onClick={() => host?.jump(id)}
        title={gone ? "This highlight was deleted" : "Open in the book"}
      >
        <span className="mr-quote-text">{text}</span>
        <span className="mr-quote-meta">
          <span className="mr-quote-page">p. {page + 1}</span>
          {gone ? <em data-testid="quote-deleted"> highlight deleted</em> : null}
        </span>
      </button>
    </NodeViewWrapper>
  );
}

export const AnnotationQuote = Node.create({
  name: "annotationQuote",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return {
      annotationId: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-annotation-id") ?? "",
        renderHTML: (a) => ({ "data-annotation-id": a.annotationId }),
      },
      quoteSnapshot: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-snapshot") ?? "",
        renderHTML: (a) => ({ "data-snapshot": a.quoteSnapshot }),
      },
      color: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-color"),
        renderHTML: (a) => (a.color ? { "data-color": a.color } : {}),
      },
      page: {
        default: 0,
        parseHTML: (el) => Number(el.getAttribute("data-page") ?? 0),
        renderHTML: (a) => ({ "data-page": String(a.page) }),
      },
    };
  },
  parseHTML() {
    return [{ tag: "div[data-annotation-quote]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes({ "data-annotation-quote": "" }, HTMLAttributes)];
  },
  addNodeView() {
    return ReactNodeViewRenderer(QuoteView);
  },
});

const extensions = [
  StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: { openOnClick: false } }),
  TaskList,
  TaskItem.configure({ nested: true }),
  AnnotationQuote,
];

function Tool({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        "inline-flex size-7 items-center justify-center rounded-md hover:bg-accent/60",
        active && "bg-accent",
      )}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  const chain = () => editor.chain().focus();
  const setLink = () => {
    const previous = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Link address", previous ?? "https://");
    if (url === null) return;
    if (url === "") chain().extendMarkRange("link").unsetLink().run();
    else chain().extendMarkRange("link").setLink({ href: url }).run();
  };
  const icon = "size-4";
  return (
    <div className="mr-note-toolbar flex flex-wrap items-center gap-0.5 border-b px-1 py-1">
      <Tool
        label="Heading"
        active={editor.isActive("heading", { level: 2 })}
        onClick={() => chain().toggleHeading({ level: 2 }).run()}
      >
        <Heading2Icon className={icon} />
      </Tool>
      <Tool
        label="Bold"
        active={editor.isActive("bold")}
        onClick={() => chain().toggleBold().run()}
      >
        <BoldIcon className={icon} />
      </Tool>
      <Tool
        label="Italic"
        active={editor.isActive("italic")}
        onClick={() => chain().toggleItalic().run()}
      >
        <ItalicIcon className={icon} />
      </Tool>
      <Tool
        label="Code"
        active={editor.isActive("code")}
        onClick={() => chain().toggleCode().run()}
      >
        <CodeIcon className={icon} />
      </Tool>
      <Tool
        label="Bullet list"
        active={editor.isActive("bulletList")}
        onClick={() => chain().toggleBulletList().run()}
      >
        <ListIcon className={icon} />
      </Tool>
      <Tool
        label="Numbered list"
        active={editor.isActive("orderedList")}
        onClick={() => chain().toggleOrderedList().run()}
      >
        <ListOrderedIcon className={icon} />
      </Tool>
      <Tool
        label="Task list"
        active={editor.isActive("taskList")}
        onClick={() => chain().toggleTaskList().run()}
      >
        <ListTodoIcon className={icon} />
      </Tool>
      <Tool
        label="Quote"
        active={editor.isActive("blockquote")}
        onClick={() => chain().toggleBlockquote().run()}
      >
        <QuoteIcon className={icon} />
      </Tool>
      <Tool label="Link" active={editor.isActive("link")} onClick={setLink}>
        <LinkIcon className={icon} />
      </Tool>
    </div>
  );
}

export interface NoteEditorProps {
  /** Read once, when the editor is created. */
  initial: JsonNode;
  onChange(doc: JsonNode): void;
  /** Hands the live editor to the owner (so it can insert quotes), and null on unmount. */
  onEditor?(editor: Editor | null): void;
  host?: QuoteHost | null;
  className?: string;
}

export function NoteEditor({
  initial,
  onChange,
  onEditor,
  host = null,
  className,
}: NoteEditorProps) {
  const change = useRef(onChange);
  change.current = onChange;
  const hostRef = useRef(host);
  hostRef.current = host;

  const editor = useEditor({
    immediatelyRender: false,
    extensions,
    content: initial,
    editorProps: {
      attributes: { class: "mr-note-content", "data-testid": "note-editor" },
      handleDrop(view, event) {
        const id = event.dataTransfer?.getData(DRAG_TYPE);
        const attrs = id ? hostRef.current?.attrsFor(id) : undefined;
        if (!attrs) return false;
        event.preventDefault();
        const at = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
        const node = view.state.schema.nodes.annotationQuote?.create(attrs);
        if (!node) return false;
        const pos = at ?? view.state.doc.content.size;
        view.dispatch(view.state.tr.insert(pos, node));
        return true;
      },
    },
    onUpdate: ({ editor: e }) => change.current(e.getJSON() as JsonNode),
  });

  useEffect(() => {
    onEditor?.(editor);
    return () => onEditor?.(null);
  }, [editor, onEditor]);

  if (!editor) return <div className={className} aria-busy />;
  return (
    <QuoteContext.Provider value={host}>
      <div className={cn("flex min-h-0 flex-col", className)}>
        <Toolbar editor={editor} />
        <EditorContent editor={editor} className="min-h-0 flex-1 overflow-y-auto" />
      </div>
    </QuoteContext.Provider>
  );
}
