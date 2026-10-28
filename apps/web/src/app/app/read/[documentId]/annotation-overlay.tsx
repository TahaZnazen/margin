"use client";

import type { OverlayContext } from "@margin/reader";
import { useLayoutEffect } from "react";
import type { Annotation } from "@/lib/annotations/annotations-repo";

const markName = (id: string) => `annot-create-${id}`;

/** Marks the moment a user action creates an annotation; the overlay measures create -> visible. */
export function markCreate(id: string) {
  performance.mark(markName(id));
}

function useVisibleMeasure(id: string) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: measure once, when first committed
  useLayoutEffect(() => {
    if (performance.getEntriesByName(markName(id)).length === 0) return;
    performance.measure("annotation-create-visible", markName(id));
    requestAnimationFrame(() => {
      performance.measure("annotation-create-painted", markName(id));
      performance.clearMarks(markName(id));
    });
  }, []);
}

function Rect({
  annotation,
  box,
  first,
  flash,
  active,
}: {
  annotation: Annotation;
  box: [number, number, number, number];
  first: boolean;
  flash: boolean;
  active: boolean;
}) {
  return (
    <div
      className="mr-annot"
      data-testid="highlight-rect"
      data-annotation-id={annotation.id}
      data-color={annotation.color ?? undefined}
      data-active={active || undefined}
      data-flash={flash || undefined}
      style={{
        left: box[0],
        top: box[1],
        width: box[2] - box[0],
        height: box[3] - box[1],
      }}
    >
      {first ? <FirstMark id={annotation.id} /> : null}
    </div>
  );
}

function FirstMark({ id }: { id: string }) {
  useVisibleMeasure(id);
  return null;
}

/** Highlights, comment markers and bookmark ribbons of one rendered page. */
export function PageAnnotations({
  ctx,
  items,
  flashId,
  activeId,
  hoverId,
}: {
  ctx: OverlayContext;
  items: readonly Annotation[];
  flashId: string | null;
  activeId: string | null;
  hoverId: string | null;
}) {
  const rotated = ctx.view.rotation === 90 || ctx.view.rotation === 270;
  const pageW = (rotated ? ctx.view.pageHeight : ctx.view.pageWidth) * ctx.view.scale;
  return (
    <>
      {items.map((annotation) => {
        if (annotation.kind === "bookmark") {
          return (
            <div
              key={annotation.id}
              className="mr-bookmark"
              data-testid="bookmark-ribbon"
              data-annotation-id={annotation.id}
              style={{ left: pageW - 40 }}
            />
          );
        }
        const flash = flashId === annotation.id;
        const active = activeId === annotation.id || hoverId === annotation.id;
        const out: React.ReactNode[] = [];
        let commentTop: number | null = null;
        for (const segment of annotation.target.segments) {
          if (segment.page !== ctx.page) continue;
          segment.rects.forEach((rect, i) => {
            const box = ctx.toViewport(rect);
            if (commentTop === null) commentTop = box[1];
            out.push(
              <Rect
                key={`${annotation.id}-${segment.page}-${rect.join(",")}`}
                annotation={annotation}
                box={box}
                first={annotation.pageStart === ctx.page && i === 0}
                flash={flash}
                active={active}
              />,
            );
          });
        }
        if (annotation.comment && commentTop !== null) {
          out.push(
            <div
              key={`${annotation.id}-note`}
              className="mr-annot-note"
              data-testid="comment-marker"
              data-annotation-id={annotation.id}
              data-color={annotation.color ?? undefined}
              style={{ left: pageW - 22, top: commentTop }}
            />,
          );
        }
        return out;
      })}
    </>
  );
}
