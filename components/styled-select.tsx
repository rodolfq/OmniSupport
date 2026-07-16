"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

type SelectOption = {
  value: string;
  label: React.ReactNode;
  disabled: boolean;
};

type StyledSelectProps = Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "children"> & {
  children: React.ReactNode;
};

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
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [internalValue, setInternalValue] = useState(String(defaultValue ?? ""));
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

  const currentValue = value === undefined ? internalValue : String(value ?? "");
  const selectedOption = options.find((option) => option.value === currentValue) ?? options[0];

  const updatePosition = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const roomBelow = window.innerHeight - rect.bottom - 12;
    const roomAbove = rect.top - 12;
    const openAbove = roomBelow < 180 && roomAbove > roomBelow;
    const maxHeight = Math.max(120, Math.min(280, openAbove ? roomAbove : roomBelow));
    setPosition({
      top: openAbove ? Math.max(8, rect.top - maxHeight - 6) : rect.bottom + 6,
      left: Math.min(rect.left, Math.max(8, window.innerWidth - rect.width - 8)),
      width: rect.width,
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

  const openMenu = () => {
    if (disabled) return;
    updatePosition();
    const selectedIndex = options.findIndex((option) => option.value === currentValue);
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
    setOpen(true);
  };

  const selectOption = (option: SelectOption) => {
    if (option.disabled) return;
    if (value === undefined) setInternalValue(option.value);

    if (selectRef.current) {
      selectRef.current.value = option.value;
      const event = new Event("change", { bubbles: true });
      selectRef.current.dispatchEvent(event);
    }
    setOpen(false);
    triggerRef.current?.focus();
  };

  const moveActive = (direction: 1 | -1) => {
    if (!options.length) return;
    let next = activeIndex;
    do {
      next = (next + direction + options.length) % options.length;
    } while (options[next]?.disabled && next !== activeIndex);
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
        onClick={() => open ? setOpen(false) : openMenu()}
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false);
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            if (!open) openMenu();
            else moveActive(event.key === "ArrowDown" ? 1 : -1);
          }
          if (event.key === "Enter" && open && options[activeIndex]) {
            event.preventDefault();
            selectOption(options[activeIndex]);
          }
        }}
        className={cn(
          "flex min-h-9 min-w-0 items-center justify-between gap-2 text-left cursor-pointer",
          "focus-visible:ring-4 focus-visible:ring-indigo-500/10 dark:focus-visible:ring-[var(--accent)]/10 focus-visible:border-indigo-500 dark:focus-visible:border-[var(--accent)]",
          "disabled:cursor-not-allowed disabled:opacity-60",
          className,
        )}
      >
        <span className="min-w-0 flex-1 truncate">{selectedOption?.label}</span>
        <ChevronDown size={15} className={cn("shrink-0 text-slate-400 dark:text-[var(--text-tertiary)] transition-transform duration-200", open && "rotate-180 text-indigo-500 dark:text-[var(--accent-text)]")} />
      </button>

      {mounted && createPortal(
        <AnimatePresence>
          {open && (
            <>
              <div className="fixed inset-0" style={{ zIndex: 2147483000 }} onMouseDown={() => setOpen(false)} />
              <motion.div
                role="listbox"
                initial={{ opacity: 0, y: -6, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -4, scale: 0.98 }}
                transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
                className="fixed overflow-y-auto rounded-xl border border-slate-200 dark:border-[var(--border-default)] bg-white dark:bg-[var(--surface-card)] p-1.5 shadow-2xl shadow-slate-900/15"
                style={{ ...position, zIndex: 2147483001 }}
              >
                {options.map((option, index) => {
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
                        activeIndex === index && "bg-slate-100 dark:bg-[var(--surface-pill)]",
                        selected ? "font-bold text-indigo-600 dark:text-[var(--accent-text)]" : "font-medium text-slate-700 dark:text-[var(--text-secondary)]",
                        option.disabled && "cursor-not-allowed opacity-40",
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate">{option.label}</span>
                      {selected && <Check size={15} className="shrink-0" />}
                    </button>
                  );
                })}
              </motion.div>
            </>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </div>
  );
}
