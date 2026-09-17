"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface AccordionItemData {
  id: string;
  title: React.ReactNode;
  content: React.ReactNode;
}

/** Minimal single-open accordion (no external deps). */
export function Accordion({
  items,
  defaultOpen,
}: {
  items: AccordionItemData[];
  defaultOpen?: string;
}) {
  const [open, setOpen] = React.useState<string | null>(defaultOpen ?? null);
  return (
    <div className="divide-y divide-ink-100 rounded-lg border border-ink-300">
      {items.map((item) => {
        const isOpen = open === item.id;
        return (
          <div key={item.id}>
            <button
              type="button"
              onClick={() => setOpen(isOpen ? null : item.id)}
              aria-expanded={isOpen}
              className="flex w-full items-center justify-between gap-3 px-5 py-3.5 text-left text-[0.95rem] font-medium text-ink-900 hover:bg-ink-100/50"
            >
              {item.title}
              <ChevronDown
                className={cn(
                  "size-4 shrink-0 text-ink-500 transition-transform",
                  isOpen && "rotate-180",
                )}
              />
            </button>
            {isOpen && (
              <div className="px-5 pb-4 text-sm leading-relaxed text-ink-700">
                {item.content}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
