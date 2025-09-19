<<<<<<< HEAD
import React from "react";

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const { className = "", ...rest } = props;
  return (
    <input
      className={`rounded-xl px-3 py-2 bg-white/5 border border-white/20 outline-none focus:ring-2 focus:ring-yellow-400 ${className}`}
      {...rest}
    />
  );
}
=======
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
>>>>>>> 5c38c9d (Initial commit: Stage & Radio Open Decks kiosk)
