import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Adapted from shadcn/ui Button (MIT); only the variants used by this page.
const buttonVariants = cva(
  'inline-flex min-h-11 items-center justify-center rounded-[3px] px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B2A3A] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 aria-disabled:opacity-50 aria-disabled:cursor-not-allowed',
  {
    variants: {
      variant: {
        default: 'bg-[#1B2A3A] text-[#FBF9F4] hover:bg-[#0F1B28]',
        outline: 'border border-[#B9AF99] bg-[#FBF9F4] text-[#1B2A3A] hover:bg-[#EFE9DA]',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);
export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>;
export function Button({ className, variant, type = 'button', ...props }: ButtonProps) {
  return <button type={type} className={twMerge(clsx(buttonVariants({ variant }), className))} {...props} />;
}
