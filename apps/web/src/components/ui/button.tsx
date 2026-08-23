import { cva, type VariantProps } from 'class-variance-authority';
import type { ButtonHTMLAttributes } from 'react';
import { cn } from '../../lib/class-names';

export const buttonVariants = cva(
  'inline-flex cursor-pointer items-center justify-center rounded-[3px] transition-colors disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        ghost: 'bg-white/8 text-[#b9c4d5] hover:bg-white/14 hover:text-paper',
        primary:
          'border border-cobalt bg-cobalt px-[14px] py-[9px] text-[13px] font-[640] text-paper hover:bg-[#345f99]',
        secondary: 'min-h-11 bg-canvas px-4 text-sm font-[650] text-ink hover:bg-[#e8edf3]',
      },
      size: {
        icon: 'size-[30px]',
        default: 'h-auto',
      },
    },
    defaultVariants: {
      variant: 'ghost',
      size: 'icon',
    },
  },
);

export function Button({
  className,
  variant,
  size,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
