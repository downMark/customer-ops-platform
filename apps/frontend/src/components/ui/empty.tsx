import * as React from "react";
import { cn } from "@/lib/utils";

function Empty({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 px-5 py-14 text-center text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

function EmptyTitle({
  className,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("font-semibold text-foreground", className)} {...props} />;
}

function EmptyDescription({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("max-w-sm text-sm", className)} {...props} />;
}

export { Empty, EmptyDescription, EmptyTitle };
