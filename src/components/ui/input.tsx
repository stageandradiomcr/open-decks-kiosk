import * as React from "react";

function cn(...parts: Array<string | undefined | false>) {
  return parts.filter(Boolean).join(" ");
}

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, ...props }, ref) => {
    return (
      <input
        ref={ref}
        className={cn(
          "h-10 w-full rounded-lg border bg-neutral-900 border-white/30 px-3 text-white placeholder-white/60 focus:outline-none focus:ring-2 focus:ring-yellow-400",
          className
        )}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";
