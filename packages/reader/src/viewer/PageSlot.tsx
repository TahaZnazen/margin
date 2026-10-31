"use client";

import { mergeLineRects, type PageView, pageToViewport, type Rect } from "@margin/annotation-model";
import { memo, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type { LinkTarget, PageGeometry, PageLink, PageText, ReaderDocument } from "../engine";
import { externalLinkLabel, internalLinkLabel } from "../links";
import { baselineRatio, canvasMeasure, rangeBoxes } from "../text";

/** Canvas backing stores above this many pixels are rendered at a lower pixel ratio. */
const MAX_CANVAS_PIXELS = 20_000_000;
/** Wait this long after a scale change before re-rendering, so zooming stays smooth. */
const RERENDER_DELAY_MS = 120;

export interface OverlayContext {
  page: number;
  view: PageView;
  /** Page rect (points, unrotated) to rect in this page's viewport pixels. */
  toViewport: (rect: Rect) => Rect;
}

export interface PageHit {
  start: number;
  end: number;
  current: boolean;
}

export interface PageSlotProps {
  doc: ReaderDocument;
  index: number;
  geometry: PageGeometry;
  scale: number;
  top: number;
  left: number;
  hits?: PageHit[];
  renderOverlay?: (ctx: OverlayContext) => ReactNode;
  onPainted: (index: number) => void;
  /** A link was activated (mouse hit-test or keyboard). */
  onLink?: (target: LinkTarget) => void;
}

/** CSS matrix that maps page space (points, top-left, unrotated) to the page box in pixels. */
export function spaceMatrix(g: PageGeometry, s: number): string {
  switch (g.rotation) {
    case 90:
      return `matrix(0,${s},${-s},0,${s * g.height},0)`;
    case 180:
      return `matrix(${-s},0,0,${-s},${s * g.width},${s * g.height})`;
    case 270:
      return `matrix(0,${-s},${s},0,0,${s * g.width})`;
    default:
      return `matrix(${s},0,0,${s},0,0)`;
  }
}

export const rotatedSize = (g: PageGeometry) =>
  g.rotation === 90 || g.rotation === 270
    ? { width: g.height, height: g.width }
    : { width: g.width, height: g.height };

function fillTextLayer(layer: HTMLElement, page: PageText, pageIndex: number) {
  const frag = document.createDocumentFragment();
  page.runs.forEach((run, i) => {
    if (run.str === "") return;
    const span = document.createElement("span");
    span.textContent = run.str;
    span.dataset.page = String(pageIndex);
    span.dataset.run = String(i);
    span.dir = run.dir;
    const ratio = baselineRatio(run.fontFamily);
    const s = span.style;
    s.left = `${run.x}px`;
    s.top = `${run.y - ratio * run.fontSize}px`;
    s.fontSize = `${run.fontSize}px`;
    s.fontFamily = run.fontFamily;
    s.transformOrigin = `0 ${ratio * run.fontSize}px`;
    const measured = canvasMeasure(run.str, run.fontSize, run.fontFamily);
    const stretch = measured > 0 && run.width > 0 ? run.width / measured : 1;
    const parts: string[] = [];
    if (run.angle !== 0) parts.push(`rotate(${-run.angle}deg)`);
    if (Math.abs(stretch - 1) > 0.005) parts.push(`scaleX(${stretch})`);
    if (parts.length) s.transform = parts.join(" ");
    frag.append(span);
    if (run.hasEOL) frag.append(document.createElement("br"));
  });
  const end = document.createElement("div");
  end.className = "mr-end";
  end.setAttribute("aria-hidden", "true");
  frag.append(end);
  layer.replaceChildren(frag);
}

const linkKey = (t: LinkTarget) =>
  t.kind === "internal" ? `p${t.pageIndex}-${t.offsetPt ?? 0}` : t.url;

/**
 * One link as a real control: focusable, named, activated by Enter. It takes no pointer events (the
 * text layer above the page must keep selecting text); the viewer hit-tests mouse clicks itself.
 */
function LinkBox({ link, onLink }: { link: PageLink; onLink?: (target: LinkTarget) => void }) {
  const { rect, target } = link;
  const style = {
    left: rect[0],
    top: rect[1],
    width: rect[2] - rect[0],
    height: rect[3] - rect[1],
  };
  if (target.kind === "external") {
    return (
      // biome-ignore lint/a11y/useAnchorContent: an empty hit box over the PDF's own text; aria-label names it
      <a
        className="mr-link"
        data-link="external"
        href={target.url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={externalLinkLabel(target.url)}
        style={style}
        onClick={(event) => event.stopPropagation()}
      />
    );
  }
  return (
    <button
      type="button"
      className="mr-link"
      data-link="internal"
      data-target-page={target.pageIndex}
      data-target-offset={target.offsetPt}
      aria-label={internalLinkLabel(target.pageIndex)}
      style={style}
      onClick={(event) => {
        event.stopPropagation();
        onLink?.(target);
      }}
    />
  );
}

function PageSlotImpl({
  doc,
  index,
  geometry,
  scale,
  top,
  left,
  hits,
  renderOverlay,
  onPainted,
  onLink,
}: PageSlotProps) {
  const { width: boxW, height: boxH } = rotatedSize(geometry);
  const cssW = boxW * scale;
  const cssH = boxH * scale;
  const host = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const [text, setText] = useState<PageText | null>(null);
  const [links, setLinks] = useState<PageLink[]>([]);
  const painted = useRef(false);
  const onPaintedRef = useRef(onPainted);
  onPaintedRef.current = onPainted;

  // Canvas: render on mount, re-render (debounced) after a scale change; the old bitmap stays
  // on screen, stretched, until the new one is ready.
  useEffect(() => {
    const controller = new AbortController();
    const delay = painted.current ? RERENDER_DELAY_MS : 0;
    const timer = setTimeout(async () => {
      const canvas = document.createElement("canvas");
      canvas.className = "mr-canvas";
      const dpr = window.devicePixelRatio || 1;
      const ratio = Math.max(1, Math.min(dpr, Math.sqrt(MAX_CANVAS_PIXELS / (cssW * cssH))));
      try {
        await doc.renderPage(index, canvas, {
          scale,
          pixelRatio: ratio,
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        host.current?.replaceChildren(canvas);
        painted.current = true;
        onPaintedRef.current(index);
      } catch {
        // Cancelled or failed render: the previous bitmap (or the blank page) stays.
      }
    }, delay);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [doc, index, scale, cssW, cssH]);

  // Text: loaded once per page; the layer is laid out in page points and scaled with CSS.
  useEffect(() => {
    let cancelled = false;
    doc.pageText(index).then((pageText) => {
      if (cancelled) return;
      setText(pageText);
      if (layer.current) fillTextLayer(layer.current, pageText, index);
    });
    return () => {
      cancelled = true;
    };
  }, [doc, index]);

  // Links: loaded once per page.
  useEffect(() => {
    let cancelled = false;
    doc.links(index).then(
      (found) => !cancelled && setLinks(found),
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [doc, index]);

  // Free the engine's memory for this page when it leaves the render window.
  useEffect(() => () => doc.releasePage(index), [doc, index]);

  const view: PageView = useMemo(
    () => ({
      pageWidth: geometry.width,
      pageHeight: geometry.height,
      rotation: geometry.rotation,
      scale,
    }),
    [geometry, scale],
  );

  const hitRects = useMemo(() => {
    if (!text || !hits?.length) return [];
    return hits.flatMap((hit) =>
      mergeLineRects(rangeBoxes(text, hit.start, hit.end, canvasMeasure)).map((rect) => ({
        rect,
        current: hit.current,
      })),
    );
  }, [text, hits]);

  const spaceStyle = {
    width: geometry.width,
    height: geometry.height,
    transform: spaceMatrix(geometry, scale),
  };

  return (
    <div
      className="mr-page"
      data-page={index}
      data-rotation={geometry.rotation}
      style={{ top, left, width: cssW, height: cssH }}
    >
      <div className="mr-canvas-host" ref={host} />
      <div className="mr-space" style={spaceStyle} aria-hidden>
        {hitRects.map(({ rect, current }) => (
          <div
            key={rect.join(",")}
            className={current ? "mr-hit mr-hit-current" : "mr-hit"}
            data-hit={current ? "current" : "other"}
            style={{
              left: rect[0],
              top: rect[1],
              width: rect[2] - rect[0],
              height: rect[3] - rect[1],
            }}
          />
        ))}
      </div>
      {renderOverlay ? (
        <div className="mr-overlay">
          {renderOverlay({
            page: index,
            view,
            toViewport: (rect) => pageToViewport(rect, view),
          })}
        </div>
      ) : null}
      <div className="mr-space mr-textlayer" style={spaceStyle} ref={layer} />
      {links.length ? (
        <div className="mr-space mr-links" style={spaceStyle}>
          {links.map((link) => (
            <LinkBox
              key={`${link.rect.join(",")}-${linkKey(link.target)}`}
              link={link}
              onLink={onLink}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export const PageSlot = memo(PageSlotImpl);
