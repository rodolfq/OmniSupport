"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { Check, ChevronDown, Search } from "lucide-react";
import { cn } from "@/lib/utils";

type SelectOption = {
  value: string;
  label: React.ReactNode;
  disabled: boolean;
};

type StyledSelectProps = Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "children"> & {
  children: React.ReactNode;
};

const MIN_MENU_WIDTH = 200;

function optionToText(node: React.ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(optionToText).join(" ");
  if (React.isValidElement(node)) return optionToText((node.props as any)?.children);
  return "";
}

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

export function StyledSelect({
  children,
  className,
  value,
  defaultValue,
  onChange,
  onBlur,
  onFocus,
  disabled,
  id,
  name,
  required,
  "aria-label": ariaLabel,
  ...selectProps
}: StyledSelectProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const selectRef = useRef<HTMLSelectElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [internalValue, setInternalValue] = useState(String(defaultValue ?? ""));
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 0, maxHeight: 280 });

  const options = useMemo<SelectOption[]>(() => {
    return React.Children.toArray(children).flatMap((child) => {
      if (!React.isValidElement<React.OptionHTMLAttributes<HTMLOptionElement>>(child) || child.type !== "option") {
        return [];
      }

      const label = child.props.children;
      return [{
        value: String(child.props.value ?? (typeof label === "string" || typeof label === "number" ? label : "")),
        label,
        disabled: Boolean(child.props.disabled),
      }];
    });
  }, [children]);

  const filteredOptions = useMemo(() => {
    const q = normalize(query);
    if (!q) return options;
    return options.filter((option) => normalize(optionToText(option.label)).includes(q));
  }, [options, query]);

  const currentValue = value === undefined ? internalValue : String(value ?? "");
  const selectedOption = options.find((option) => option.value === currentValue) ?? options[0];

  const updatePosition = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const menuWidth = Math.max(rect.width, MIN_MENU_WIDTH);
    const roomBelow = window.innerHeight - rect.bottom - 12;
    const roomAbove = rect.top - 12;
    const openAbove = roomBelow < 220 && roomAbove > roomBelow;
    const maxHeight = Math.max(160, Math.min(320, openAbove ? roomAbove : roomBelow));
    setPosition({
      top: openAbove ? Math.max(8, rect.top - maxHeight - 6) : rect.bottom + 6,
      left: Math.min(rect.left, Math.max(8, window.innerWidth - menuWidth - 8)),
      width: menuWidth,
      maxHeight,
    });
  };

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => searchInputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  const openMenu = () => {
    if (disabled) return;
    updatePosition();
    setQuery("");
    const selectedIndex = options.findIndex((option) => option.value === currentValue);
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
    setOpen(true);
  };

  const closeMenu = () => {
    setOpen(false);
    setQuery("");
  };

  const selectOption = (option: SelectOption) => {
    if (option.disabled) return;
    if (value === undefined) setInternalValue(option.value);

    if (selectRef.current) {
      selectRef.current.value = option.value;
      const event = new Event("change", { bubbles: true });
      selectRef.current.dispatchEvent(event);
    }
    closeMenu();
    triggerRef.current?.focus();
  };

  const moveActive = (direction: 1 | -1) => {
    if (!filteredOptions.length) return;
    let next = activeIndex;
    do {
      next = (next + direction + filteredOptions.length) % filteredOptions.length;
    } while (filteredOptions[next]?.disabled && next !== activeIndex);
    setActiveIndex(next);
  };

  return (
    <div className={cn("relative inline-flex min-w-0", className?.includes("w-full") && "w-full", className?.includes("flex-1") && "flex-1")}>
      <select
        {...selectProps}
        ref={selectRef}
        id={id}
        name={name}
        required={required}
        disabled={disabled}
        value={currentValue}
        onChange={(event) => {
          if (value === undefined) setInternalValue(event.target.value);
          onChange?.(event);
        }}
        className="pointer-events-none absolute h-px w-px opacity-0"
        tabIndex={-1}
        aria-hidden="true"
      >
        {children}
      </select>

      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onFocus={(event) => onFocus?.(event as unknown as React.FocusEvent<HTMLSelectElement>)}
        onBlur={(event) => {
          if (!open) onBlur?.(event as unknown as React.FocusEvent<HTMLSelectElement>);
        }}
        onClick={() => open ? closeMenu() : openMenu()}
        onKeyDown={(event) => {
          if (event.key === "Escape") closeMenu();
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            if (!open) openMenu();
            else moveActive(event.key === "ArrowDown" ? 1 : -1);
          }
          if (event.key === "Enter" && open && filteredOptions[activeIndex]) {
            event.preventDefault();
            selectOption(filteredOptions[activeIndex]);
          }
        }}
        className={cn(
          "flex min-h-9 min-w-0 items-center justify-between gap-2 text-left cursor-pointer",
          "focus-visible:ring-4 focus-visible:ring-[var(--accent)]/10 focus-visible:border-[var(--accent)]",
          "disabled:cursor-not-allowed disabled:opacity-60",
          className,
        )}
      >
        <span className="min-w-0 flex-1 truncate">{selectedOption?.label}</span>
        <ChevronDown size={15} className={cn("shrink-0 text-[var(--text-tertiary)] transition-transform duration-200", open && "rotate-180 text-[var(--accent-text)]")} />
      </button>

      {mounted && createPortal(
        <AnimatePresence>
          {open && (
            <>
              <div className="fixed inset-0" style={{ zIndex: 2147483000 }} onMouseDown={() => closeMenu()} />
              <motion.div
                role="listbox"
                initial={{ opacity: 0, y: -6, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -4, scale: 0.98 }}
                transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
                className="fixed flex flex-col overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] shadow-2xl shadow-slate-900/15"
                style={{ ...position, zIndex: 2147483001 }}
              >
                {options.length > 1 && (
                  <div className="flex items-center gap-2 border-b border-[var(--border-default)] px-2.5 py-2 shrink-0">
                    <Search size={14} className="shrink-0 text-[var(--text-tertiary)]" />
                    <input
                      ref={searchInputRef}
                      type="text"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          event.preventDefault();
                          closeMenu();
                          triggerRef.current?.focus();
                        }
                        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                          event.preventDefault();
                          moveActive(event.key === "ArrowDown" ? 1 : -1);
                        }
                        if (event.key === "Enter" && filteredOptions[activeIndex]) {
                          event.preventDefault();
                          selectOption(filteredOptions[activeIndex]);
                        }
                      }}
                      placeholder="Pesquisar..."
                      className="w-full min-w-0 bg-transparent text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] outline-none"
                    />
                  </div>
                )}
                <div className="overflow-y-auto p-1.5">
                  {filteredOptions.length === 0 ? (
                    <p className="px-3 py-2.5 text-sm text-[var(--text-tertiary)]">Nenhum resultado encontrado</p>
                  ) : (
                    filteredOptions.map((option, index) => {
                      const selected = option.value === currentValue;
                      return (
                        <button
                          key={`${option.value}-${index}`}
                          type="button"
                          role="option"
                          aria-selected={selected}
                          disabled={option.disabled}
                          onMouseEnter={() => setActiveIndex(index)}
                          onClick={() => selectOption(option)}
                          className={cn(
                            "flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm transition-colors",
                            activeIndex === index && "bg-[var(--surface-pill)]",
                            selected ? "font-bold text-[var(--accent-text)]" : "font-medium text-[var(--text-secondary)]",
                            option.disabled && "cursor-not-allowed opacity-40",
                          )}
                        >
                          <span className="min-w-0 flex-1">{option.label}</span>
                          {selected && <Check size={15} className="shrink-0" />}
                        </button>
                      );
                    })
                  )}
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </div>
  );
}
