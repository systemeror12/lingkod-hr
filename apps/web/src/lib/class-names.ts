import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// Teach tailwind-merge the workbench type scale and shape tokens from globals.css.
// Without this, `text-body` reads as a colour and is dropped beside `text-ink`.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ['page-title', 'panel-title', 'body', 'small', 'caption'],
      radius: ['control', 'panel', 'tag'],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
