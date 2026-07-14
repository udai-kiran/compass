import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { useNotificationMutations, useNotifications } from "../lib/budget-queries.ts";

export function NotificationBell() {
  const { data } = useNotifications();
  const { markRead, markAllRead } = useNotificationMutations();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const unread = data?.unreadCount ?? 0;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="relative rounded-md border border-slate-300 px-2.5 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
        aria-label={`Notifications${unread > 0 ? ` (${unread} unread)` : ""}`}
      >
        🔔
        {unread > 0 && (
          <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-10 z-50 w-80 rounded-lg border border-slate-200 bg-white shadow-lg">
          <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
            <span className="text-sm font-semibold text-slate-700">Notifications</span>
            {unread > 0 && (
              <button className="text-xs text-slate-500 underline" onClick={() => markAllRead.mutate()}>
                Mark all read
              </button>
            )}
          </div>
          <ul className="max-h-96 overflow-y-auto">
            {data?.items.map((n) => (
              <li
                key={n.id}
                className={`border-b border-slate-50 px-3 py-2 ${n.readAt ? "opacity-60" : ""}`}
                onClick={() => !n.readAt && markRead.mutate(n.id)}
              >
                <p className="text-sm font-medium text-slate-700">{n.title}</p>
                {n.body && <p className="text-xs text-slate-500">{n.body}</p>}
                <p className="mt-0.5 text-[10px] text-slate-400">
                  {new Date(n.createdAt).toLocaleString()}
                </p>
              </li>
            ))}
            {(data?.items.length ?? 0) === 0 && (
              <li className="px-3 py-8 text-center text-sm text-slate-400">Nothing yet.</li>
            )}
          </ul>
          <Link
            to="/notifications"
            onClick={() => setOpen(false)}
            className="block border-t border-slate-100 px-3 py-2 text-center text-xs text-slate-500 underline"
          >
            View all & preferences
          </Link>
        </div>
      )}
    </div>
  );
}
