<<<<<<< HEAD
import React from "react";

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "secondary" | "destructive";
  size?: "sm" | "md";
};

export function Button({ variant = "default", size = "md", className = "", ...rest }: Props) {
  const v =
    variant === "secondary" ? "bg-white/10 hover:bg-white/20 text-white border border-white/20" :
    variant === "destructive" ? "bg-red-600 hover:bg-red-700 text-white" :
    "bg-yellow-400 hover:bg-yellow-300 text-black";
  const s = size === "sm" ? "px-3 py-1.5 text-sm rounded-xl" : "px-4 py-2 rounded-xl";
  return <button className={`${v} ${s} ${className}`} {...rest} />;
}
=======
import * as React from "react";

function cn(...parts: Array<string | undefined | false>) {
  return parts.filter(Boolean).join(" ");
}

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "secondary" | "destructive";
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", ...props }, ref) => {
    const base =
      "inline-flex items-center justify-center rounded-xl px-3 py-2 transition focus:outline-none focus:ring-2 focus:ring-offset-0 focus:ring-yellow-400 disabled:opacity-50 disabled:pointer-events-none";
    const variants: Record<string, string> = {
      default: "bg-yellow-400 text-black font-semibold hover:bg-yellow-300",
      secondary:
        "bg-black text-yellow-400 border border-yellow-400 hover:bg-yellow-600 hover:text-black",
      destructive: "bg-red-600 text-white hover:bg-red-500",
    };
    return (
      <button
        ref={ref}
        className={cn(base, variants[variant], className)}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";
>>>>>>> 5c38c9d (Initial commit: Stage & Radio Open Decks kiosk)
