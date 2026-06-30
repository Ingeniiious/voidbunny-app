import * as React from 'react';
import { Popover as PopoverPrimitive } from 'radix-ui';

import { cn } from '@/lib/utils';

function Popover({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />;
}

function PopoverTrigger({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}

function PopoverContent({
  className,
  align = 'center',
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        className={cn(
          // Layout / chrome
          'z-50 flex w-72 flex-col gap-2.5 rounded-lg border border-panel-border bg-panel-surface p-2.5 text-sm text-panel-text shadow-xl outline-none',
          // Origin tracks Radix's transform origin so the scale-in feels
          // anchored to the trigger / anchor instead of the popover center.
          'origin-[var(--radix-popover-content-transform-origin)]',
          // Enter + exit micro-animations via `tailwindcss-animate`. The
          // open state is a snappy 120 ms scale+fade from 96% → 100%; the
          // close mirrors it in reverse. Direction-specific slide gives a
          // tiny nudge from the anchor side so the motion feels intentional.
          'transition-opacity duration-100',
          'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
          'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
          'data-[side=bottom]:slide-in-from-top-1',
          'data-[side=top]:slide-in-from-bottom-1',
          'data-[side=left]:slide-in-from-right-1',
          'data-[side=right]:slide-in-from-left-1',
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}

function PopoverAnchor({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Anchor>) {
  return <PopoverPrimitive.Anchor data-slot="popover-anchor" {...props} />;
}

export { Popover, PopoverAnchor, PopoverContent, PopoverTrigger };
