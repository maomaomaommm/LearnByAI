import Link from "next/link";

/** Shared page title block — replaces the per-page mono eyebrow + 3xl title markup. */
export function AdminPageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-3xl font-semibold">{title}</h1>
        {description && <p className="mt-2 text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}

/** Shared GET filter form — children are the inputs/selects; the submit + clear buttons are built in. */
export function AdminFilterBar({ clearHref, children }: { clearHref: string; children: React.ReactNode }) {
  return (
    <form className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-4">
      {children}
      <button className="rounded-md bg-foreground px-4 py-2 text-sm text-background">筛选</button>
      <Link href={clearHref} className="rounded-md border border-border px-4 py-2 text-sm text-muted-foreground hover:text-foreground">
        清空
      </Link>
    </form>
  );
}

/** Shared table shell — consistent header, divider rows, and empty state. */
export function AdminTable({
  head,
  isEmpty,
  empty,
  children,
}: {
  head: string[];
  isEmpty: boolean;
  empty: string;
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
          <tr>
            {head.map((label) => (
              <th key={label} className="px-4 py-3 font-medium">{label}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {isEmpty ? (
            <tr>
              <td colSpan={head.length} className="px-4 py-12 text-center text-muted-foreground">{empty}</td>
            </tr>
          ) : (
            children
          )}
        </tbody>
      </table>
    </div>
  );
}

/** Shared form field label wrapper used by the admin CRUD forms. */
export function AdminField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

export const ADMIN_INPUT_CLASS =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-foreground";
