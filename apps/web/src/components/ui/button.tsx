import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '../../lib/class-names';

/**
 * `primary` is the one committing action in a region, `secondary` sits beside it, and `quiet`
 * is for low-emphasis actions such as closing a dialog. Links can borrow the classes through
 * `buttonVariants`.
 */
export const buttonVariants = cva(
  'inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-control border text-small font-[600] whitespace-nowrap no-underline transition-colors disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none',
  {
    variants: {
      variant: {
        primary:
          'border-primary bg-primary text-surface hover:border-primary-hover hover:bg-primary-hover',
        secondary: 'border-primary bg-surface text-primary hover:bg-canvas',
        quiet: 'border-transparent bg-transparent text-ink-muted hover:bg-canvas hover:text-ink',
      },
      size: {
        default: 'min-h-9 px-4',
        icon: 'size-9 text-body',
      },
    },
    defaultVariants: {
      variant: 'quiet',
      size: 'default',
    },
  },
);

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>
>(({ className, variant, size, ...props }, ref) => (
  <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
));
Button.displayName = 'Button';
