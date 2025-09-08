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