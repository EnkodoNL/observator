// SPDX-License-Identifier: MIT
// From shadcn/ui (https://ui.shadcn.com), MIT licensed.
import { cn } from "cn";

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="skeleton" className={cn("animate-pulse rounded-md bg-muted", className)} {...props} />
  );
}

export { Skeleton };
