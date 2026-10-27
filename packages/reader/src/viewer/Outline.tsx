"use client";

import { useState } from "react";
import type { OutlineItem } from "../engine";
import { currentChapter, flattenOutline } from "./outline-utils";

export interface OutlineProps {
  items: OutlineItem[];
  /** 0-based current page, to highlight the current section. */
  page: number;
  onSelect: (item: OutlineItem) => void;
}

/** Collapsible outline tree (the left rail's Outline tab). */
export function Outline({ items, page, onSelect }: OutlineProps) {
  const current = currentChapter(items, page);
  if (!items.length) return <p className="mr-empty">This document has no outline.</p>;
  return (
    <nav aria-label="Outline" className="mr-outline" data-testid="outline">
      <OutlineList items={items} current={current} onSelect={onSelect} depth={0} />
    </nav>
  );
}

interface ListProps {
  items: OutlineItem[];
  current: OutlineItem | undefined;
  onSelect: (item: OutlineItem) => void;
  depth: number;
}

function OutlineList({ items, current, onSelect, depth }: ListProps) {
  return (
    <ul className="mr-outline-list" data-depth={depth}>
      {items.map((item, i) => (
        <OutlineRow
          // biome-ignore lint/suspicious/noArrayIndexKey: outline items have no id; the list is static
          key={i}
          item={item}
          current={current}
          onSelect={onSelect}
          depth={depth}
        />
      ))}
    </ul>
  );
}

function OutlineRow({
  item,
  current,
  onSelect,
  depth,
}: Omit<ListProps, "items"> & { item: OutlineItem }) {
  const [open, setOpen] = useState(false);
  const hasChildren = item.children.length > 0;
  // A collapsed parent stands in for the current section when that section is one of its children.
  const isCurrent =
    current === item ||
    (!open && current !== undefined && flattenOutline(item.children).includes(current as never));
  return (
    <li>
      <div className="mr-outline-row" data-current={isCurrent ? "true" : undefined}>
        {hasChildren ? (
          <button
            type="button"
            className="mr-outline-toggle"
            aria-label={open ? "Collapse" : "Expand"}
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            {open ? "▾" : "▸"}
          </button>
        ) : (
          <span className="mr-outline-toggle" />
        )}
        <button
          type="button"
          className="mr-outline-link"
          disabled={item.page === undefined}
          onClick={() => onSelect(item)}
        >
          {item.title || "Untitled"}
        </button>
      </div>
      {hasChildren && open ? (
        <OutlineList
          items={item.children}
          current={current}
          onSelect={onSelect}
          depth={depth + 1}
        />
      ) : null}
    </li>
  );
}
