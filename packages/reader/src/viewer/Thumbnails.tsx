"use client";

import { useEffect, useRef, useState } from "react";
import type { PageGeometry, ReaderDocument } from "../engine";
import { rotatedSize } from "./PageSlot";

export interface ThumbnailsProps {
  doc: ReaderDocument | null;
  /** 0-based current page. */
  page: number;
  onSelect: (page: number) => void;
  /** Thumbnail width in CSS pixels. */
  width?: number;
}

/** Page thumbnails (the left rail's Thumbnails tab). A thumbnail renders only once it scrolls near view. */
export function Thumbnails({ doc, page, onSelect, width = 120 }: ThumbnailsProps) {
  // Every page gets a placeholder at the first page's aspect ratio at once, so the list has its
  // full height (and a scrollbar) before anything renders; each one corrects itself when it loads.
  const [ratio, setRatio] = useState(1.294);
  useEffect(() => {
    if (!doc || doc.pageCount === 0) return;
    let live = true;
    doc
      .pageGeometry(0)
      .then((g) => {
        const size = rotatedSize(g);
        if (live) setRatio(size.height / size.width);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [doc]);
  if (!doc) return null;
  return (
    <ol className="mr-thumbs" data-testid="thumbnails" aria-label="Pages">
      {Array.from({ length: doc.pageCount }, (_, i) => (
        <Thumb
          // biome-ignore lint/suspicious/noArrayIndexKey: pages are identified by their index
          key={i}
          doc={doc}
          index={i}
          width={width}
          ratio={ratio}
          current={i === page}
          onSelect={onSelect}
        />
      ))}
    </ol>
  );
}

interface ThumbProps {
  doc: ReaderDocument;
  index: number;
  width: number;
  ratio: number;
  current: boolean;
  onSelect: (page: number) => void;
}

function Thumb({ doc, index, width, ratio, current, onSelect }: ThumbProps) {
  const item = useRef<HTMLLIElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [geometry, setGeometry] = useState<PageGeometry | null>(null);
  const [rendered, setRendered] = useState(false);

  useEffect(() => {
    const el = item.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => entry?.isIntersecting && setVisible(true),
      {
        rootMargin: "200px",
      },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Keep the current page in view as the book scrolls.
  useEffect(() => {
    if (current) item.current?.scrollIntoView({ block: "nearest" });
  }, [current]);

  useEffect(() => {
    if (!visible) return;
    const controller = new AbortController();
    (async () => {
      const g = await doc.pageGeometry(index);
      setGeometry(g);
      const canvas = document.createElement("canvas");
      await doc.renderPage(index, canvas, {
        scale: width / rotatedSize(g).width,
        pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      host.current?.replaceChildren(canvas);
      setRendered(true);
    })().catch(() => {});
    return () => controller.abort();
  }, [visible, doc, index, width]);

  const size = geometry ? rotatedSize(geometry) : null;
  const height = size ? (width * size.height) / size.width : width * ratio;
  return (
    <li
      ref={item}
      className="mr-thumb"
      data-testid="thumb"
      data-page={index + 1}
      data-current={current ? "true" : undefined}
    >
      <button type="button" onClick={() => onSelect(index)} aria-label={`Page ${index + 1}`}>
        <div
          className="mr-thumb-page"
          ref={host}
          data-rendered={rendered}
          style={{ width, height }}
        />
        <span>{index + 1}</span>
      </button>
    </li>
  );
}
