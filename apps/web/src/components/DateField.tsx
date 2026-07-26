import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { formatDisplayDate, isoToDDMMYYYY, todayInIST } from "@compass/shared";
import { resolveDateInput } from "./date-field-commit.ts";

export interface DateFieldProps {
  value: string; // ISO YYYY-MM-DD, or "" for empty
  onChange: (iso: string) => void; // emits ISO YYYY-MM-DD, or "" when cleared
  className?: string;
  disabled?: boolean;
  id?: string;
  name?: string;
  required?: boolean;
  min?: string; // ISO lower bound (inclusive), optional
  max?: string; // ISO upper bound (inclusive), optional
  placeholder?: string; // default "DD-MM-YYYY"
  "aria-label"?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
  /** open the calendar popover on mount (used by the inline click-to-edit cell) */
  defaultOpen?: boolean;
  /** focus the text input on mount (used by the inline click-to-edit cell) */
  autoFocus?: boolean;
  /** fired whenever the popover closes — lets an inline editor exit edit mode */
  onClose?: () => void;
  /**
   * opt-in: commit valid dates to parent immediately on typing, not just on
   * blur/calendar-click, and keep invalid text on blur (reporting it via
   * `onValidityChange`) instead of silently reverting to the last valid value.
   */
  commitOnValidChange?: boolean;
  /** fired when typed text is invalid (parse/range failure) — lets parent show validation errors */
  onValidityChange?: (state: { valid: boolean; message?: string }) => void;
}

/** Fixed-position coordinates for the portalled popover, anchored to the trigger button. */
interface PopoverPos {
  left: number;
  width: number;
  placement: "above" | "below";
  top?: number;
  bottom?: number;
}

const POPOVER_MIN_WIDTH = 320; // wider than CategoryPicker for the calendar grid
const POPOVER_FLIP_THRESHOLD = 300;

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Compute year-month bounds for a given ISO date, or current IST month if empty */
function getMonthBounds(iso: string): { year: number; month: number } {
  if (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    const parts = iso.split("-");
    return { year: parseInt(parts[0]!, 10), month: parseInt(parts[1]!, 10) };
  }
  // fallback to current IST month
  const today = todayInIST();
  const parts = today.split("-");
  return { year: parseInt(parts[0]!, 10), month: parseInt(parts[1]!, 10) };
}

/** Generate day cells for a month. Returns array of { day, iso } or null for padding cells */
function generateMonthCells(
  year: number,
  month: number,
): Array<{ day: number; iso: string } | null> {
  const firstDay = new Date(Date.UTC(year, month - 1, 1));
  const firstWeekday = firstDay.getUTCDay(); // 0 = Sunday
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

  const cells: Array<{ day: number; iso: string } | null> = [];
  // Leading padding for days before the 1st
  for (let i = 0; i < firstWeekday; i++) {
    cells.push(null);
  }
  // Days of the month
  for (let day = 1; day <= daysInMonth; day++) {
    const iso = `${year}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
    cells.push({ day, iso });
  }
  return cells;
}

export function DateField({
  value,
  onChange,
  className = "",
  disabled = false,
  id,
  name,
  required = false,
  min,
  max,
  placeholder = "DD-MM-YYYY",
  "aria-label": ariaLabel,
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedBy,
  defaultOpen = false,
  autoFocus = false,
  onClose,
  commitOnValidChange = false,
  onValidityChange,
}: DateFieldProps) {
  // Local text state for in-progress typing
  const [localText, setLocalText] = useState<string>(() => (value ? isoToDDMMYYYY(value) : ""));
  const [open, setOpen] = useState(defaultOpen);
  const [pos, setPos] = useState<PopoverPos | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Calendar state: which month to display
  const [calendarMonth, setCalendarMonth] = useState<{ year: number; month: number }>(() =>
    getMonthBounds(value),
  );

  const close = () => {
    setOpen(false);
    onClose?.();
  };

  // Sync local text when prop value changes externally
  useEffect(() => {
    setLocalText(value ? isoToDDMMYYYY(value) : "");
  }, [value]);

  // Auto-focus the input on mount if requested (for inline editing)
  useEffect(() => {
    if (autoFocus) {
      inputRef.current?.focus();
    }
  }, [autoFocus]);

  // When calendar opens, reset to the month of the current value (or current IST month)
  useEffect(() => {
    if (open) {
      setCalendarMonth(getMonthBounds(value));
    }
  }, [open, value]);

  // The trigger is disabled, but an already-open popover would stay clickable and
  // could commit a date the parent has locked. Close it instead.
  useEffect(() => {
    if (disabled && open) close();
  }, [disabled, open]);

  /**
   * Apply one text event through the shared resolver. Invalid input is never
   * silently discarded for opted-in fields: the text stays put and the parent is
   * told it's invalid, so "Save" can block instead of persisting a null.
   */
  const applyTextEvent = (text: string, event: "change" | "blur") => {
    const result = resolveDateInput({
      text,
      committedValue: value,
      min,
      max,
      event,
      keepInvalid: commitOnValidChange,
    });
    setLocalText(result.text);
    if (result.commit !== null) onChange(result.commit);
    if (result.report) {
      onValidityChange?.(
        result.valid ? { valid: true } : { valid: false, message: result.message },
      );
    }
  };

  const handleBlur = () => applyTextEvent(localText, "blur");

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleBlur();
    }
  };

  const isInRange = (iso: string): boolean => {
    if (min && iso < min) return false;
    if (max && iso > max) return false;
    return true;
  };

  const cells = useMemo(() => generateMonthCells(calendarMonth.year, calendarMonth.month), [calendarMonth]);

  const today = todayInIST();

  const handleDayClick = (iso: string) => {
    // Belt and braces: the popover is closed and its buttons disabled when the field
    // is, but a click already in progress must not slip a value past the parent.
    if (disabled) return;
    if (!isInRange(iso)) return;
    // Set the text here as well as via the value effect: picking the date that is
    // already committed doesn't change `value`, so the effect wouldn't fire and
    // any half-typed text would linger while we report the field as valid.
    setLocalText(isoToDDMMYYYY(iso));
    onChange(iso);
    onValidityChange?.({ valid: true });
    close();
  };

  const prevMonth = () => {
    setCalendarMonth((prev) => {
      const { year, month } = prev;
      if (month === 1) {
        return { year: year - 1, month: 12 };
      }
      return { year, month: month - 1 };
    });
  };

  const nextMonth = () => {
    setCalendarMonth((prev) => {
      const { year, month } = prev;
      if (month === 12) {
        return { year: year + 1, month: 1 };
      }
      return { year, month: month + 1 };
    });
  };

  // Position the popover against the root wrapper (input + button together)
  useLayoutEffect(() => {
    if (!open) return;
    const computePosition = () => {
      const root = rootRef.current;
      if (!root) return;
      const rect = root.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const width = Math.min(Math.max(rect.width, POPOVER_MIN_WIDTH), vw * 0.9);
      const left = Math.min(Math.max(rect.left, 8), Math.max(8, vw - width - 8));
      const spaceBelow = vh - rect.bottom;
      const spaceAbove = rect.top;
      const placement: "above" | "below" =
        spaceBelow < POPOVER_FLIP_THRESHOLD && spaceAbove > spaceBelow ? "above" : "below";
      setPos(
        placement === "below"
          ? { left, width, placement, top: rect.bottom + 4 }
          : { left, width, placement, bottom: vh - rect.top + 4 },
      );
    };
    computePosition();
    const onScrollOrResize = () => close();
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [open]);

  // Close on outside click / Escape
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      const insideRoot = rootRef.current?.contains(target) ?? false;
      const insidePopover = popoverRef.current?.contains(target) ?? false;
      if (!insideRoot && !insidePopover) close();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div
      ref={rootRef}
      className={`relative inline-flex ${className}`}
      onBlur={(e) => {
        const next = e.relatedTarget as Node | null;
        const insideRoot = rootRef.current?.contains(next) ?? false;
        const insidePopover = popoverRef.current?.contains(next) ?? false;
        if (!next || (!insideRoot && !insidePopover)) {
          // focus left the whole component -> finish inline editing
          if (open) close();
          else onClose?.();
        }
      }}
    >
      {/* A flex child defaults to min-width:auto, and a text input's intrinsic
          width is ~20 characters, so without min-w-0 the input overflows a
          narrow container width (e.g. w-36) and pushes the calendar button
          on top of the next control. w-full ties its preferred width to the
          container instead of that intrinsic default. */}
      <input
        ref={inputRef}
        type="text"
        inputMode="numeric"
        id={id}
        name={name}
        required={required}
        disabled={disabled}
        value={localText}
        onChange={(e) => applyTextEvent(e.target.value, "change")}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        aria-label={ariaLabel}
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedBy}
        className="w-full min-w-0 flex-1 rounded-l-md border border-r-0 border-slate-300 bg-white px-2 py-1.5 text-sm disabled:opacity-50"
      />
      <button
        type="button"
        disabled={disabled}
        onClick={() => (open ? close() : setOpen(true))}
        aria-label="Open calendar"
        aria-haspopup="dialog"
        aria-expanded={open}
        className="flex shrink-0 items-center justify-center rounded-r-md border border-slate-300 bg-white px-2 disabled:opacity-50"
      >
        <svg viewBox="0 0 20 20" className="h-4 w-4 text-slate-600" fill="currentColor">
          <rect x="3" y="4" width="14" height="13" rx="2" stroke="currentColor" strokeWidth="1.5" fill="none" />
          <path d="M3 8h14M7 2v3M13 2v3" stroke="currentColor" strokeWidth="1.5" fill="none" />
        </svg>
      </button>

      {open &&
        !disabled &&
        pos &&
        createPortal(
          <div
            ref={popoverRef}
            role="dialog"
            aria-label="Choose date"
            style={{
              position: "fixed",
              left: pos.left,
              width: pos.width,
              ...(pos.placement === "below" ? { top: pos.top } : { bottom: pos.bottom }),
            }}
            className="z-50 rounded-md border border-slate-200 bg-white p-3 shadow-lg"
          >
            {/* Header: prev / next month + label */}
            <div className="mb-2 flex items-center justify-between">
              <button
                type="button"
                onClick={prevMonth}
                onMouseDown={(e) => e.preventDefault()}
                className="rounded p-1 text-slate-600 hover:bg-slate-100"
                aria-label="Previous month"
              >
                <svg viewBox="0 0 20 20" className="h-5 w-5" fill="currentColor">
                  <path d="M12 6 8 10l4 4" stroke="currentColor" strokeWidth="1.5" fill="none" />
                </svg>
              </button>
              <div className="text-sm font-medium text-slate-700">
                {MONTH_NAMES[calendarMonth.month - 1]} {calendarMonth.year}
              </div>
              <button
                type="button"
                onClick={nextMonth}
                onMouseDown={(e) => e.preventDefault()}
                className="rounded p-1 text-slate-600 hover:bg-slate-100"
                aria-label="Next month"
              >
                <svg viewBox="0 0 20 20" className="h-5 w-5" fill="currentColor">
                  <path d="M8 6 l4 4-4 4" stroke="currentColor" strokeWidth="1.5" fill="none" />
                </svg>
              </button>
            </div>

            {/* Weekday header */}
            <div className="mb-1 grid grid-cols-7 gap-1 text-center text-xs font-medium text-slate-500">
              {WEEKDAY_LABELS.map((label) => (
                <div key={label}>{label}</div>
              ))}
            </div>

            {/* Day grid */}
            <div className="grid grid-cols-7 gap-1">
              {cells.map((cell, i) => {
                if (!cell) {
                  return <div key={`empty-${i}`} />; // padding cell
                }
                const isSelected = cell.iso === value;
                const isToday = cell.iso === today;
                const isDisabled = !isInRange(cell.iso);
                return (
                  <button
                    key={cell.iso}
                    type="button"
                    disabled={isDisabled}
                    onClick={() => handleDayClick(cell.iso)}
                    onMouseDown={(e) => e.preventDefault()}
                    aria-label={formatDisplayDate(cell.iso)}
                    aria-current={isSelected ? "date" : undefined}
                    className={`h-8 w-full rounded text-sm ${
                      isDisabled
                        ? "cursor-not-allowed text-slate-300"
                        : isSelected
                          ? "bg-brand-600 font-medium text-white"
                          : isToday
                            ? "border border-brand-600 text-brand-700"
                            : "text-slate-700 hover:bg-slate-100"
                    }`}
                  >
                    {cell.day}
                  </button>
                );
              })}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
