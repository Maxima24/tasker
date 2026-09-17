import * as React from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface Option {
  value: string;
  label: string;
}

interface MultiSelectProps {
  label?: string;
  selected: string[];
  options: Option[];
  onChange: (selected: string[]) => void;
  placeholder?: string;
  className?: string;
}

export function MultiSelect({
  label,
  selected,
  options,
  onChange,
  placeholder = "Select options",
  className,
}: MultiSelectProps) {
  const [isOpen, setIsOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const toggleOption = (val: string) => {
    if (selected.includes(val)) {
      onChange(selected.filter((item) => item !== val));
    } else {
      onChange([...selected, val]);
    }
  };

  const selectedLabels = selected.map(
    (val) => options.find((opt) => opt.value === val)?.label || val
  );

  return (
    <div className={cn("space-y-1.5", className)} ref={containerRef}>
      {label && <label className="text-sm font-medium text-ink-700">{label}</label>}
      <div className="relative">
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="flex min-h-8 min-w-40 w-full items-center justify-between gap-2 rounded-md border border-ink-300 bg-white px-2.5 py-1 text-left text-sm text-ink-900 shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <div className="flex flex-wrap gap-1 max-w-[12rem] truncate">
            {selected.length === 0 ? (
              <span className="text-ink-400">{placeholder}</span>
            ) : (
              selectedLabels.join(", ")
            )}
          </div>
          <ChevronDown className="size-4 shrink-0 text-ink-400" />
        </button>

        {isOpen && (
          <div className="absolute right-0 z-50 mt-1 max-h-60 min-w-48 overflow-auto rounded-md border border-ink-300 bg-white py-1 shadow-lg ring-1 ring-black/5 focus:outline-none">
            {options.map((option) => {
              const isChecked = selected.includes(option.value);
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => toggleOption(option.value)}
                  className="flex w-full items-center justify-between px-3 py-1.5 text-left text-sm text-ink-900 hover:bg-ink-50"
                >
                  <span>{option.label}</span>
                  <div
                    className={cn(
                      "flex size-4 items-center justify-center rounded border border-ink-300",
                      isChecked ? "bg-ink-600 border-ink-600 text-white" : "bg-white"
                    )}
                  >
                    {isChecked && <Check className="size-3" />}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
