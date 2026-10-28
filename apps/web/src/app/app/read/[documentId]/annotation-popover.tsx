"use client";

import { HIGHLIGHT_COLORS, type HighlightColor } from "@margin/annotation-model";
import { ClipboardCopyIcon, MessageSquareIcon, NotebookPenIcon, Trash2Icon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { flags } from "@/config/flags";

const COMMENT_DEBOUNCE_MS = 400;

export interface PopoverProps {
  mode: "create" | "edit";
  /** Viewport rect of the selection or highlight; null hides the popover. */
  anchor: () => DOMRect | null;
  labels: Record<HighlightColor, string>;
  color: HighlightColor | null;
  comment: string;
  /** Changes whenever the comment field should take focus (the N key). */
  focusNonce: number;
  copied: boolean;
  inNotebook?: boolean;
  onColor: (color: HighlightColor) => void;
  onNote: () => void;
  onCopy: () => void;
  onDelete: () => void;
  onComment: (text: string) => void;
}

const BTN =
  "inline-flex size-7 items-center justify-center rounded-md text-foreground/80 hover:bg-accent/60 pointer-coarse:size-11";

export function AnnotationPopover(props: PopoverProps) {
  const { mode, anchor, labels, color, focusNonce, onComment } = props;
  const box = useRef<HTMLDivElement>(null);
  const anchorRef = useRef(anchor);
  anchorRef.current = anchor;

  // Follow the anchor on every frame while open: it moves with scroll and zoom.
  useLayoutEffect(() => {
    let raf = 0;
    const place = () => {
      const el = box.current;
      const rect = anchorRef.current();
      if (el) {
        if (!rect) {
          el.style.visibility = "hidden";
        } else {
          const w = el.offsetWidth;
          const h = el.offsetHeight;
          const above = rect.top - h - 8;
          const top = above >= 56 ? above : Math.min(rect.bottom + 8, window.innerHeight - h - 8);
          const left = Math.min(
            Math.max(8, rect.left + rect.width / 2 - w / 2),
            window.innerWidth - w - 8,
          );
          el.style.visibility = "visible";
          el.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
        }
      }
      raf = requestAnimationFrame(place);
    };
    place();
    return () => cancelAnimationFrame(raf);
  }, []);

  const [text, setText] = useState(props.comment);
  const area = useRef<HTMLTextAreaElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const dirty = useRef(false);
  const latest = useRef({ text, onComment });
  latest.current = { text, onComment };

  const flush = () => {
    clearTimeout(timer.current);
    if (!dirty.current) return;
    dirty.current = false;
    latest.current.onComment(latest.current.text);
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: flush on unmount only
  useEffect(() => flush, []);

  useEffect(() => {
    if (focusNonce > 0) area.current?.focus();
  }, [focusNonce]);

  return (
    <div
      ref={box}
      data-annot-popover=""
      data-testid="annotation-popover"
      data-mode={mode}
      role="toolbar"
      aria-label="Highlight"
      className="fixed top-0 left-0 z-50 flex w-max max-w-[min(20rem,calc(100vw-16px))] flex-col gap-2 rounded-lg bg-popover p-2 text-popover-foreground text-sm shadow-md ring-1 ring-foreground/10"
      style={{ visibility: "hidden" }}
      // Keep the text selection alive while the buttons are used.
      onMouseDown={(e) => {
        if (!(e.target instanceof HTMLTextAreaElement)) e.preventDefault();
      }}
    >
      <div className="flex items-center gap-1">
        {HIGHLIGHT_COLORS.map((c, i) => (
          <button
            key={c}
            type="button"
            title={`${labels[c]} (${i + 1})`}
            aria-label={labels[c]}
            aria-pressed={color === c}
            data-testid={`color-${c}`}
            className={`${BTN} ${color === c ? "ring-2 ring-foreground/60" : ""}`}
            onClick={() => props.onColor(c)}
          >
            <span
              className="size-4 rounded-full pointer-coarse:size-6"
              style={{ background: `var(--hl-${c}-chip)` }}
            />
          </button>
        ))}
        <span className="mx-1 h-5 w-px bg-border" aria-hidden />
        {mode === "create" ? (
          <button
            type="button"
            title="Note (N)"
            aria-label="Note"
            data-testid="popover-note"
            className={BTN}
            onClick={props.onNote}
          >
            <MessageSquareIcon className="size-4" />
          </button>
        ) : null}
        <button
          type="button"
          title={props.copied ? "Copied" : "Copy with citation (Shift+C)"}
          aria-label="Copy with citation"
          data-testid="popover-copy"
          className={BTN}
          onClick={props.onCopy}
        >
          <ClipboardCopyIcon className="size-4" />
        </button>
        {mode === "edit" ? (
          <button
            type="button"
            title="Delete highlight (Del)"
            aria-label="Delete highlight"
            data-testid="popover-delete"
            className="inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-destructive text-xs hover:bg-destructive/10 pointer-coarse:h-11"
            onClick={props.onDelete}
          >
            <Trash2Icon className="size-4" />
            Delete
          </button>
        ) : null}
        {/* Reserved slots (docs/design/reader-layout.md): they keep their place, hidden until the flag. */}
        <button type="button" hidden={!flags.ai} data-slot="explain" title="Explain (E)">
          Explain
        </button>
        <button type="button" hidden={!flags.ai} data-slot="make-card" title="Make card (C)">
          Make card
        </button>
      </div>
      {props.inNotebook ? (
        <p
          className="flex items-center gap-1 px-1 text-muted-foreground text-xs"
          data-testid="popover-in-notebook"
        >
          <NotebookPenIcon className="size-3" /> In notebook
        </p>
      ) : null}
      {mode === "edit" ? (
        <textarea
          ref={area}
          value={text}
          rows={3}
          placeholder="Add a comment"
          aria-label="Comment"
          data-testid="comment-input"
          className="w-72 max-w-full resize-none rounded-md border bg-background p-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onChange={(e) => {
            setText(e.target.value);
            latest.current.text = e.target.value;
            dirty.current = true;
            clearTimeout(timer.current);
            timer.current = setTimeout(flush, COMMENT_DEBOUNCE_MS);
          }}
          onBlur={flush}
        />
      ) : null}
    </div>
  );
}
