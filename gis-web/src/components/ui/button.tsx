import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Adapted from shadcn/ui Button (MIT); only the variants used by this page.
const buttonVariants = cva(
  'inline-flex min-h-11 items-center justify-center rounded-[6px] px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 aria-disabled:opacity-50 aria-disabled:cursor-not-allowed',
  {
    variants: {
      variant: {
        default: 'bg-[var(--primary)] text-white hover:bg-[var(--primary)] hover:brightness-95',
        outline: 'border border-[var(--border)] bg-[var(--bg)] text-[var(--text)] hover:bg-[var(--surface)]',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);
export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>;
export function Button({ className, variant, type = 'button', ...props }: ButtonProps) {
  return <button type={type} className={twMerge(clsx(buttonVariants({ variant }), className))} {...props} />;
}
