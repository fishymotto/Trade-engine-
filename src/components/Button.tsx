import type { ButtonHTMLAttributes, PropsWithChildren } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
}

export const Button = ({
  children,
  className = "",
  variant = "secondary",
  ...props
}: PropsWithChildren<ButtonProps>) => (
  <button
    {...props}
    className={`button button-${variant} ${className}`.trim()}
  >
    {children}
  </button>
);
