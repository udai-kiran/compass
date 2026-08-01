import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  formatDisplayDate,
  formatINR,
  todayInIST,
  type UserTask,
  type UserTaskTransaction,
} from "@compass/shared";
import { toast } from "../../lib/toast.tsx";
import { useUserTaskMutations, useUserTasks } from "../../lib/user-task-queries.ts";
import { DateField } from "../../components/DateField.tsx";
import { doneWithoutLinkPatch, isOverdue, linkPanelPrimaryPatch } from "./task-helpers.ts";
import { TransactionPicker } from "./TransactionPicker.tsx";

export function TasksPage() {
  const { data: tasks, isLoading, isError } = useUserTasks();
  const { create, update, remove } = useUserTaskMutations();
  const formRef = useRef<HTMLFormElement>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  // Live mirror of editingId. Async mutation completions (update/delete/
  // toggle settling AFTER a user switched the form to a different task) must
  // check this ref, not the render-time editingId captured by their closure.
  const editingIdRef = useRef<string | null>(null);
  useEffect(() => {
    editingIdRef.current = editingId;
  }, [editingId]);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [selectedTxn, setSelectedTxn] = useState<UserTaskTransaction | null>(null);
  // True once the user selects or clears a link in the picker. While editing a
  // task whose linked transaction is unavailable (soft-deleted), an untouched
  // picker must NOT silently strip the link by PATCHing transactionId: null.
  const [txnTouched, setTxnTouched] = useState(false);
  const [editingLinkUnavailable, setEditingLinkUnavailable] = useState(false);
  // Component-local per-row busy tracking. The shared mutation observer only
  // exposes the MOST RECENT call's variables/isPending, so it cannot scope
  // "row A still busy" once row B's mutation starts. This Set does.
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  // The row whose inline link panel is open, or null. A single id (not a set)
  // is what enforces "one panel at a time": opening another row's panel
  // replaces this and closes the first. Ordinary local state — it is NOT
  // part of pendingIds, which tracks in-flight requests only.
  const [linkPanelTaskId, setLinkPanelTaskId] = useState<string | null>(null);
  // The transaction picked inside the open panel (prefilled from the task's
  // existing link). Reset by openLinkPanel each time the panel (re)opens.
  const [panelTxn, setPanelTxn] = useState<UserTaskTransaction | null>(null);
  // mutateAsync (not .mutate + per-call onSettled) because one shared
  // useMutation observer DISPLACES a previous call's per-call callbacks when
  // a second .mutate() fires before the first settles — A's onSettled would
  // never run and row A would stay disabled forever. The promise returned by
  // mutateAsync is tied to that specific call and settles independently, so
  // this finally runs no matter what other rows do afterward.
  async function withPending(id: string, fn: () => Promise<void>): Promise<void> {
    setPendingIds((prev) => new Set(prev).add(id));
    try {
      await fn();
    } finally {
      clearPending(id);
    }
  }
  function clearPending(id: string) {
    setPendingIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  // The app's calendar is IST (see todayInIST / TransactionsPage) — never
  // new Date().toISOString().slice(0, 10), which is UTC.
  const today = todayInIST();

  function resetForm() {
    setEditingId(null);
    setTitle("");
    setNotes("");
    setDueDate("");
    setSelectedTxn(null);
    setTxnTouched(false);
    setEditingLinkUnavailable(false);
  }

  function beginEdit(task: UserTask) {
    setEditingId(task.id);
    setTitle(task.title);
    setNotes(task.notes);
    setDueDate(task.dueDate ?? "");
    setSelectedTxn(task.transaction);
    setTxnTouched(false);
    setEditingLinkUnavailable(task.transactionId !== null && task.transaction === null);
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (editingId) {
      // Capture NOW: by the time this save settles, the user may already be
      // editing a different task, and resetForm() must not wipe that edit.
      const savedTaskId = editingId;
      void withPending(savedTaskId, async () => {
        try {
          await update.mutateAsync({
            id: savedTaskId,
            title,
            notes,
            dueDate: dueDate || null,
            ...(txnTouched ? { transactionId: selectedTxn?.id ?? null } : {}),
          });
          if (editingIdRef.current === savedTaskId) resetForm();
          toast("Task updated", "success");
        } catch {
          toast("Couldn't update the task — try again.", "error");
        }
      });
    } else {
      create.mutate(
        { title, notes, dueDate: dueDate || null, transactionId: selectedTxn?.id ?? null },
        {
          onSuccess: () => {
            toast("Task added", "success");
            if (editingIdRef.current === null) resetForm();
          },
        },
      );
    }
  }

  function toggleComplete(task: UserTask) {
    if (task.completedAt === null) {
      // Ticking an incomplete task issues NO request — it opens the row's
      // link panel, and a panel button decides the PATCH. The checkbox is
      // controlled by `completed`, so it stays visually unticked meanwhile.
      openLinkPanel(task);
      return;
    }
    // Un-ticking is immediate and panel-less. `completed: false` alone —
    // transactionId is deliberately omitted so the historical link survives.
    void withPending(task.id, async () => {
      try {
        await update.mutateAsync({ id: task.id, completed: false });
        if (editingIdRef.current === task.id) resetForm();
        toast("Task reopened", "success");
      } catch {
        toast("Couldn't update the task — try again.", "error");
      }
    });
  }

  function openLinkPanel(task: UserTask) {
    setLinkPanelTaskId(task.id);
    setPanelTxn(task.transaction);
  }

  // Functional close: a late-settling PATCH for row A must not close a panel
  // the user has since opened on row B.
  function closeLinkPanel(taskId: string) {
    setLinkPanelTaskId((prev) => (prev === taskId ? null : prev));
  }

  // Primary panel action: "Mark done" when completing, "Save link" when the
  // task is already completed (transactionId only, never `completed`).
  function submitLinkPanel(task: UserTask) {
    const patch = linkPanelPrimaryPatch(
      task.completedAt === null ? "complete" : "link-only",
      panelTxn?.id ?? null,
    );
    if (patch === null) return; // button is disabled in this state
    const taskId = task.id;
    const completing = task.completedAt === null;
    void withPending(taskId, async () => {
      try {
        await update.mutateAsync({ id: taskId, ...patch });
        closeLinkPanel(taskId);
        if (editingIdRef.current === taskId) resetForm();
        toast(completing ? "Task completed" : "Transaction linked", "success");
      } catch {
        toast("Couldn't update the task — try again.", "error");
      }
    });
  }

  function doneWithoutLink(task: UserTask) {
    const taskId = task.id;
    void withPending(taskId, async () => {
      try {
        await update.mutateAsync({ id: taskId, ...doneWithoutLinkPatch() });
        closeLinkPanel(taskId);
        if (editingIdRef.current === taskId) resetForm();
        toast("Task completed", "success");
      } catch {
        toast("Couldn't update the task — try again.", "error");
      }
    });
  }

  // Per-row in-flight scoping: a row's controls disable only while a mutation
  // targeting that row is pending (AC18) — other rows stay interactive.
  const rowBusy = (taskId: string) => pendingIds.has(taskId);
  // The form/picker disable only for the form's OWN submission: a create in
  // flight, or an update targeting the task currently loaded in the form —
  // never for some other row's pending toggle/delete.
  const formBusy = create.isPending || (editingId !== null && pendingIds.has(editingId));

  if (isLoading) return <p className="p-6 text-sm text-slate-400">Loading…</p>;
  if (isError) {
    return (
      <p className="p-6 text-sm text-rose-600">
        Couldn’t load your tasks. Check your connection and try again.
      </p>
    );
  }

  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-800">Tasks</h1>
      <p className="mt-1 text-sm text-slate-500">
        Track money to-dos — optionally tied to a due date or a ledger transaction.
      </p>

      <form
        ref={formRef}
        onSubmit={submit}
        className={`mt-5 rounded-xl border bg-white p-4 ${editingId ? "border-brand-300 ring-2 ring-brand-100" : "border-slate-200"}`}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-700">
            {editingId ? "Edit task" : "Add task"}
          </h2>
          {editingId && (
            <button type="button" onClick={resetForm} className="text-xs text-slate-500 underline">
              Cancel edit
            </button>
          )}
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <input
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Task title"
            aria-label="Task title"
            className="input"
          />
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notes (optional)"
            aria-label="Notes"
            className="input"
          />
          <DateField value={dueDate} onChange={setDueDate} aria-label="Due date" />
          <button
            disabled={formBusy}
            className="rounded-md bg-brand-600 px-3 py-2 text-sm text-white disabled:opacity-50"
          >
            {editingId ? "Save" : "Add"}
          </button>
        </div>
        <div className="mt-3">
          <p className="mb-1 text-xs font-medium text-slate-500">Linked transaction (optional)</p>
          <TransactionPicker
            selected={selectedTxn}
            linkUnavailable={editingLinkUnavailable && !txnTouched}
            disabled={formBusy}
            onSelect={(txn) => {
              setSelectedTxn(txn);
              setTxnTouched(true);
            }}
            onClear={() => {
              setSelectedTxn(null);
              setTxnTouched(true);
            }}
          />
        </div>
      </form>

      <div className="mt-6 space-y-2">
        {tasks?.map((task) => {
          const busy = rowBusy(task.id);
          const completed = task.completedAt !== null;
          const overdue = isOverdue(task, today);
          return (
            <article
              key={task.id}
              className={`rounded-xl border border-slate-200 bg-white p-4 ${completed ? "opacity-60" : ""}`}
            >
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={completed}
                  disabled={busy}
                  onChange={() => toggleComplete(task)}
                  aria-label={completed ? `Mark “${task.title}” not done` : `Mark “${task.title}” done`}
                  className="mt-1 h-4 w-4 accent-brand-600 disabled:opacity-50"
                />
                <div className="min-w-0 flex-1">
                  <h3
                    className={`font-medium text-slate-800 ${completed ? "line-through" : ""}`}
                  >
                    {task.title}
                  </h3>
                  {task.notes !== "" && (
                    <p className="mt-1 whitespace-pre-wrap text-sm text-slate-500">{task.notes}</p>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                    {task.dueDate !== null && (
                      <span className={overdue ? "font-medium text-rose-600" : "text-slate-500"}>
                        Due {formatDisplayDate(task.dueDate)}
                        {overdue && (
                          <span className="badge ml-1.5 bg-rose-100 text-rose-700">Overdue</span>
                        )}
                      </span>
                    )}
                    {task.transaction !== null && (
                      <span className="text-slate-500">
                        {task.transaction.merchant} · {formatINR(task.transaction.amountPaise)}
                        {completed && <> · {formatDisplayDate(task.transaction.date)}</>}
                      </span>
                    )}
                    {task.transactionId !== null && task.transaction === null && (
                      <span className="italic text-amber-700">Transaction unavailable</span>
                    )}
                    {completed && task.transactionId === null && (
                      <button
                        className="text-slate-500 underline disabled:opacity-50"
                        disabled={busy}
                        onClick={() => openLinkPanel(task)}
                      >
                        Link transaction
                      </button>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 gap-3 text-xs">
                  <button
                    className="font-medium text-brand-700 underline disabled:opacity-50"
                    disabled={busy}
                    onClick={() => beginEdit(task)}
                  >
                    Edit
                  </button>
                  <button
                    className="text-rose-600 underline disabled:opacity-50"
                    disabled={busy}
                    onClick={() => {
                      if (confirm(`Delete task “${task.title}”?`)) {
                        void withPending(task.id, async () => {
                          try {
                            await remove.mutateAsync(task.id);
                            if (editingIdRef.current === task.id) resetForm();
                            toast("Task deleted", "success");
                          } catch {
                            toast("Couldn't delete the task — try again.", "error");
                          }
                        });
                      }
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
              {linkPanelTaskId === task.id && (
                <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <h4 className="text-sm font-medium text-slate-700">
                    Link a related transaction?
                  </h4>
                  <div className="mt-2">
                    <TransactionPicker
                      selected={panelTxn}
                      disabled={busy}
                      onSelect={setPanelTxn}
                      onClear={() => setPanelTxn(null)}
                    />
                  </div>
                  <div className="mt-3 flex items-center gap-2 text-xs">
                    <button
                      className="rounded-md bg-brand-600 px-3 py-1.5 font-medium text-white disabled:opacity-50"
                      disabled={busy || (completed && panelTxn === null)}
                      onClick={() => submitLinkPanel(task)}
                    >
                      {completed ? "Save link" : "Mark done"}
                    </button>
                    {!completed && (
                      <button
                        className="rounded-md border border-slate-300 px-3 py-1.5 font-medium text-slate-600 disabled:opacity-50"
                        disabled={busy}
                        onClick={() => doneWithoutLink(task)}
                      >
                        Done without a link
                      </button>
                    )}
                    <button
                      className="px-2 py-1.5 text-slate-500 underline disabled:opacity-50"
                      disabled={busy}
                      onClick={() => closeLinkPanel(task.id)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </article>
          );
        })}
        {tasks?.length === 0 && (
          <p className="rounded-xl border border-dashed border-slate-300 p-10 text-center text-sm text-slate-400">
            Add your first task above.
          </p>
        )}
      </div>
    </div>
  );
}
