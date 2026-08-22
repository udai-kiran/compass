import { EmptyState } from "../../components/States.tsx";

export function CartPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-6">
        <h1 className="text-xl font-semibold text-slate-800">Cart</h1>
      </header>
      <EmptyState
        title="Cart coming soon"
        hint="Cart review and checkout optimisation will appear here in a future update."
      />
    </div>
  );
}
