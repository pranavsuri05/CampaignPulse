import { cn } from "@/lib/utils";

export function Card({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-lg border bg-card shadow-card", className)} {...p} />;
}
export function CardHeader({ className, title, description, action, ...p }: Omit<React.HTMLAttributes<HTMLDivElement>, "title"> & { title: React.ReactNode; description?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className={cn("flex items-start justify-between gap-4 border-b px-5 py-4", className)} {...p}>
      <div><h2>{title}</h2>{description && <p className="mt-0.5 text-[13px] text-muted-foreground">{description}</p>}</div>
      {action}
    </div>
  );
}
export function CardBody({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-5", className)} {...p} />;
}
