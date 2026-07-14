import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export interface Toast {
  id: number;
  message: string;
  kind: "error" | "success";
  action?: { label: string; onClick: () => void };
}

type Listener = (t: Toast) => void;
const listeners = new Set<Listener>();
let nextId = 1;

/** Callable from anywhere (including the QueryClient, outside React). */
export function toast(
  message: string,
  kind: Toast["kind"] = "error",
  action?: Toast["action"],
): void {
  const t: Toast = { id: nextId++, message, kind, action };
  for (const fn of listeners) fn(t);
}

const ToastContext = createContext<null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    const onToast: Listener = (t) => {
      setToasts((prev) => [...prev, t]);
      setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== t.id)), t.action ? 8000 : 5000);
    };
    listeners.add(onToast);
    return () => {
      listeners.delete(onToast);
    };
  }, []);

  return (
    <ToastContext.Provider value={null}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="alert"
            className={`flex items-center gap-3 rounded-lg px-4 py-3 text-sm text-white shadow-lg ${
              t.kind === "error" ? "bg-red-600" : "bg-emerald-600"
            }`}
          >
            <span>{t.message}</span>
            {t.action && (
              <button
                className="rounded bg-white/20 px-2 py-0.5 font-medium hover:bg-white/30"
                onClick={() => {
                  t.action!.onClick();
                  setToasts((prev) => prev.filter((x) => x.id !== t.id));
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToastContext() {
  return useContext(ToastContext);
}
