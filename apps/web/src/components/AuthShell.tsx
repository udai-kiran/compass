import type { InputHTMLAttributes, ReactNode } from "react";
import { Icon } from "./icons.tsx";
import { FEATURES, PRODUCT } from "../lib/product.ts";

/**
 * Split-screen scaffold shared by the landing/login and signup pages: a brand
 * hero (product story + feature highlights) on the left at lg+, and the form
 * column on the right. On small screens the hero collapses to a compact brand
 * bar so the form stays front and center.
 */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen bg-slate-50">
      {/* Brand hero — lg and up */}
      <div className="relative hidden w-1/2 flex-col justify-between overflow-hidden bg-gradient-to-br from-brand-700 via-brand-600 to-accent-600 p-10 text-white lg:flex xl:p-14">
        <div className="flex items-center gap-2 text-lg font-semibold">
          <Icon name="compass" className="h-7 w-7" />
          {PRODUCT.name}
        </div>
        <div className="max-w-md">
          <h1 className="text-3xl font-semibold leading-tight xl:text-[2.6rem]">
            {PRODUCT.tagline}
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-white/80">{PRODUCT.blurb}</p>
          <ul className="mt-8 space-y-4">
            {FEATURES.slice(0, 4).map((f) => (
              <li key={f.title} className="flex gap-3">
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/15">
                  <Icon name={f.icon} className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-sm font-medium">{f.title}</p>
                  <p className="text-xs leading-relaxed text-white/70">{f.description}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-white/60">Private · self-hosted · built for Indian finances</p>
      </div>

      {/* Form column */}
      <div className="flex w-full flex-col lg:w-1/2">
        <div className="flex items-center gap-2 p-6 text-lg font-semibold text-brand-700 lg:hidden">
          <Icon name="compass" className="h-6 w-6" />
          {PRODUCT.name}
        </div>
        <div className="flex flex-1 items-center justify-center px-6 pb-12 sm:px-10">
          <div className="w-full max-w-sm">{children}</div>
        </div>
      </div>
    </div>
  );
}

/** A labeled text input matching the auth cards. */
export function AuthField({
  label,
  ...props
}: { label: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="mt-4 block text-sm font-medium text-slate-700">
      {label}
      <input {...props} className="input mt-1 w-full px-3 py-2" />
    </label>
  );
}
