import {
  createContext,
  useContext,
  useId,
  useEffect,
  useRef,
  useImperativeHandle,
  forwardRef,
  type ComponentPropsWithoutRef,
  type ElementRef,
  type HTMLAttributes,
} from 'react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/class-names';

const dialogContentVariants = cva(
  'relative flex max-h-[calc(100dvh-2rem)] w-full flex-col overflow-hidden rounded-[5px] border border-line bg-paper shadow-[0_18px_55px_rgb(23_32_51/20%)]',
  {
    variants: {
      size: {
        compact: 'max-w-[520px]',
        default: 'max-w-[720px]',
      },
    },
    defaultVariants: {
      size: 'default',
    },
  },
);

const FormContext = createContext<string | null>(null);
const FormCloseContext = createContext<(() => void) | null>(null);
type FocusTarget = { focus(): void };
const TriggerContext = createContext<{ current: FocusTarget | null } | null>(null);
const focusableSelector =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

type FocusableElement = {
  autofocus?: boolean;
  closest(selector: string): unknown;
  focus(): void;
  getAttribute(name: string): string | null;
};

type InlineElement = {
  contains(node: unknown): boolean;
  focus(): void;
  querySelector(selector: string): FocusableElement | null;
  querySelectorAll(selector: string): ArrayLike<FocusableElement>;
};

type BrowserDocument = {
  activeElement: unknown;
  addEventListener(type: string, listener: (event: unknown) => void): void;
  removeEventListener(type: string, listener: (event: unknown) => void): void;
};

/** Full record work uses the page; confirmations retain the modal focus boundary. */
export function Dialog({
  presentation = 'dialog',
  ...props
}: ComponentPropsWithoutRef<typeof DialogPrimitive.Root> & { presentation?: 'dialog' | 'form' }) {
  const titleId = useId();
  const triggerRef = useRef<FocusTarget | null>(null);
  const previousOpen = useRef(Boolean(props.open));
  useEffect(() => {
    const open = Boolean(props.open);
    const wasOpen = previousOpen.current;
    previousOpen.current = open;
    if (presentation !== 'form' || !wasOpen || open) return;
    const frame = setTimeout(() => triggerRef.current?.focus(), 0);
    return () => clearTimeout(frame);
  }, [presentation, props.open]);
  return (
    <TriggerContext.Provider value={triggerRef}>
      <FormContext.Provider value={presentation === 'form' && props.open ? titleId : null}>
        <FormCloseContext.Provider value={() => props.onOpenChange?.(false)}>
          <DialogPrimitive.Root {...props} />
        </FormCloseContext.Provider>
      </FormContext.Provider>
    </TriggerContext.Provider>
  );
}

function InlineRecord({
  children,
  className,
  busy,
  descriptionId,
  onOpenAutoFocus,
  onCloseAutoFocus,
  contentRef,
  onEscapeKeyDown,
  contentProps,
}: {
  children: React.ReactNode;
  className?: string | undefined;
  busy?: React.AriaAttributes['aria-busy'];
  descriptionId?: string | undefined;
  onOpenAutoFocus?: ((event: Event) => void) | undefined;
  onCloseAutoFocus?: ((event: Event) => void) | undefined;
  contentRef: React.ForwardedRef<HTMLDivElement>;
  onEscapeKeyDown?: ((event: KeyboardEvent) => void) | undefined;
  contentProps: HTMLAttributes<HTMLDivElement>;
}) {
  const titleId = useContext(FormContext);
  const ref = useRef<HTMLDivElement | null>(null);
  const close = useContext(FormCloseContext);
  const triggerRef = useContext(TriggerContext);
  useImperativeHandle(contentRef, () => ref.current!);
  const callbacks = useRef({ onOpenAutoFocus, onCloseAutoFocus });
  callbacks.current = { onOpenAutoFocus, onCloseAutoFocus };
  useEffect(() => {
    const frame = setTimeout(() => {
      const event = new Event('openAutoFocus', { cancelable: true });
      callbacks.current.onOpenAutoFocus?.(event);
      if (!event.defaultPrevented) {
        const element = ref.current as unknown as InlineElement | null;
        const candidates = Array.from(element?.querySelectorAll(focusableSelector) ?? []);
        (candidates.find((candidate) => candidate.autofocus) ?? candidates[0] ?? element)?.focus();
      }
    });
    const browserDocument = (globalThis as unknown as { document: BrowserDocument }).document;
    function focusable(): FocusableElement[] {
      const element = ref.current as unknown as InlineElement | null;
      return Array.from(element?.querySelectorAll(focusableSelector) ?? []).filter(
        (candidate) =>
          !candidate.closest('[hidden]') && candidate.getAttribute('aria-hidden') !== 'true',
      );
    }
    function keepFocusInside(event: unknown): void {
      const keyboard = event as {
        defaultPrevented: boolean;
        key: string;
        preventDefault(): void;
        shiftKey: boolean;
      };
      if (keyboard.key !== 'Tab' || keyboard.defaultPrevented) return;
      const element = ref.current as unknown as InlineElement | null;
      if (!element) return;
      const active = browserDocument.activeElement;
      const targets = focusable();
      if (targets.length === 0) {
        keyboard.preventDefault();
        element.focus();
        return;
      }
      const index = targets.indexOf(active as FocusableElement);
      if (
        !element.contains(active) ||
        (keyboard.shiftKey ? index === 0 : index === targets.length - 1)
      ) {
        keyboard.preventDefault();
        (keyboard.shiftKey ? targets[targets.length - 1] : targets[0])?.focus();
      }
    }
    browserDocument.addEventListener('keydown', keepFocusInside);
    return () => {
      clearTimeout(frame);
      browserDocument.removeEventListener('keydown', keepFocusInside);
      const callback = callbacks.current.onCloseAutoFocus;
      if (callback) {
        setTimeout(() => callback(new Event('closeAutoFocus', { cancelable: true })), 0);
      } else {
        setTimeout(() => triggerRef?.current?.focus(), 0);
      }
    };
  }, [triggerRef]);
  return (
    <div
      {...contentProps}
      ref={ref}
      role="region"
      onKeyDown={(event) => {
        contentProps.onKeyDown?.(event);
        if (event.key === 'Escape') {
          onEscapeKeyDown?.(event.nativeEvent);
          if (!event.defaultPrevented && !event.nativeEvent.defaultPrevented) close?.();
        }
      }}
      tabIndex={-1}
      aria-labelledby={titleId ?? undefined}
      aria-busy={busy}
      aria-describedby={descriptionId}
      className={cn(
        'record-form flex min-w-0 flex-col rounded-[5px] border border-line bg-paper outline-none',
        className,
      )}
    >
      {children}
    </div>
  );
}
export const DialogTrigger = forwardRef<
  ElementRef<typeof DialogPrimitive.Trigger>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Trigger>
>(({ ...props }, forwardedRef) => {
  const triggerRef = useContext(TriggerContext);
  return (
    <DialogPrimitive.Trigger
      {...props}
      ref={(element) => {
        if (triggerRef) triggerRef.current = element as unknown as FocusTarget | null;
        if (typeof forwardedRef === 'function') forwardedRef(element);
        else if (forwardedRef) forwardedRef.current = element;
      }}
    />
  );
});
DialogTrigger.displayName = DialogPrimitive.Trigger.displayName;
export const DialogClose = DialogPrimitive.Close;

type DialogContentProps = ComponentPropsWithoutRef<typeof DialogPrimitive.Content> &
  VariantProps<typeof dialogContentVariants>;

export const DialogContent = forwardRef<
  ElementRef<typeof DialogPrimitive.Content>,
  DialogContentProps
>(({ className, onPointerDownOutside, size, ...props }, ref) => {
  const inline = useContext(FormContext);
  if (inline) {
    // Portal sizing and outside-interaction handlers apply only to modal dialogs.
    const {
      onOpenAutoFocus,
      onCloseAutoFocus,
      onEscapeKeyDown,
      onFocusOutside: _onFocusOutside,
      onInteractOutside: _onInteractOutside,
      forceMount: _forceMount,
      asChild: _asChild,
      ...contentProps
    } = props;
    void _onFocusOutside;
    void _onInteractOutside;
    void _forceMount;
    void _asChild;
    return (
      <InlineRecord
        contentRef={ref}
        contentProps={contentProps}
        className={className}
        busy={props['aria-busy']}
        descriptionId={props['aria-describedby']}
        onOpenAutoFocus={onOpenAutoFocus}
        onCloseAutoFocus={onCloseAutoFocus}
        onEscapeKeyDown={onEscapeKeyDown}
      >
        {props.children}
      </InlineRecord>
    );
  }
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-20 grid place-items-center overflow-y-auto bg-midnight/35 [padding:max(1rem,env(safe-area-inset-top))_max(1rem,env(safe-area-inset-right))_max(1rem,env(safe-area-inset-bottom))_max(1rem,env(safe-area-inset-left))]">
        <DialogPrimitive.Content
          ref={ref}
          className={cn(dialogContentVariants({ size }), className)}
          onPointerDownOutside={(event) => {
            event.preventDefault();
            onPointerDownOutside?.(event);
          }}
          {...props}
        />
      </DialogPrimitive.Overlay>
    </DialogPrimitive.Portal>
  );
});
DialogContent.displayName = DialogPrimitive.Content.displayName;

export const DialogHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'flex shrink-0 min-w-0 items-start justify-between gap-4 border-b border-line px-6 py-5 min-[621px]:px-8',
        className,
      )}
      {...props}
    />
  ),
);
DialogHeader.displayName = 'DialogHeader';

export const DialogTitle = forwardRef<
  ElementRef<typeof DialogPrimitive.Title>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => {
  const titleId = useContext(FormContext);
  return (
    <DialogPrimitive.Title
      ref={ref}
      className={cn('m-0 text-xl font-[680] tracking-[-0.025em] text-midnight', className)}
      {...props}
      {...(titleId ? { id: titleId } : {})}
    />
  );
});
DialogTitle.displayName = DialogPrimitive.Title.displayName;

export const DialogDescription = forwardRef<
  ElementRef<typeof DialogPrimitive.Description>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn('m-0 text-[13px] leading-[1.6] text-muted', className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export const DialogBody = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('min-h-0 flex-1 overflow-y-auto px-6 py-6 min-[621px]:px-8', className)}
      {...props}
    />
  ),
);
DialogBody.displayName = 'DialogBody';

export const DialogFooter = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'flex shrink-0 flex-col-reverse gap-3 border-t border-line px-6 py-5 min-[621px]:flex-row min-[621px]:justify-end min-[621px]:px-8',
        className,
      )}
      {...props}
    />
  ),
);
DialogFooter.displayName = 'DialogFooter';
