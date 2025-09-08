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