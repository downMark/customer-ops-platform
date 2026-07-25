import * as React from "react";
import { cn } from "@/lib/utils";

function Item({
  className,
  ...props
}: React.HTMLAttributes<HTMLElement>) {
  return <article className={cn("p-4", className)} {...props} />;
}

function ItemContent({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("min-w-0 flex-1", className)} {...props} />;
}

function ItemTitle({
  className,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("font-semibold text-foreground", className)} {...props} />;
}

function ItemDescription({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-sm text-muted-foreground", className)} {...props} />;
}

export { Item, ItemContent, ItemDescription, ItemTitle };
