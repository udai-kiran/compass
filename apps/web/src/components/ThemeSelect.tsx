import { THEMES, useTheme } from "../lib/theme.ts";
import { Icon } from "./icons.tsx";

/**
 * Color-theme dropdown. `header` is the compact control in the app bar;
 * `settings` is the labeled version for the Appearance section. Both drive the
 * same localStorage-backed preference, so switching in one place updates the
 * other live (and across tabs).
 */
export function ThemeSelect({ variant = "settings" }: { variant?: "header" | "settings" }) {
  const [theme, setTheme] = useTheme();
  const current = THEMES.find((t) => t.id === theme) ?? THEMES[0]!;

  const select = (
    <span className="relative inline-flex items-center">
      {/* Live swatch of the active theme sits where a leading icon would. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 rounded-full ring-1 ring-black/10"
        style={{ backgroundColor: current.swatch }}
      />
      <select
        aria-label="Color theme"
        value={theme}
        onChange={(e) => setTheme(e.target.value)}
        className={`appearance-none rounded-lg border border-slate-300 bg-white py-1.5 pl-8 pr-8 text-sm text-slate-600 transition hover:bg-slate-50 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 ${
          variant === "settings" ? "w-full" : ""
        }`}
      >
        {THEMES.map((t) => (
          <option key={t.id} value={t.id}>
            {t.label}
          </option>
        ))}
      </select>
      {/* Custom chevron, since appearance-none drops the native arrow. */}
      <svg
        aria-hidden="true"
        viewBox="0 0 20 20"
        className="pointer-events-none absolute right-2 h-4 w-4 text-slate-400"
      >
        <path d="M6 8l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );

  if (variant === "header") return select;

  return (
    <div className="max-w-xs">
      <label className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
        <Icon name="palette" className="h-4 w-4 text-slate-400" />
        Color theme
      </label>
      <div className="mt-1.5">{select}</div>
      <p className="mt-1.5 text-xs text-slate-400">
        Re-tints the app's accent color. Saved on this device.
      </p>
    </div>
  );
}
