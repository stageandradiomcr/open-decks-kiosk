import * as React from "react";

function cn(...parts: Array<string | undefined | false>) {
  return parts.filter(Boolean).join(" ");
}

export function Card({
  className,
  children,
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("rounded-2xl border bg-neutral-900", className)}>
      {children}
    </div>
  );
}

export function CardContent({
  className,
  children,
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-4", className)}>{children}</div>;
}
