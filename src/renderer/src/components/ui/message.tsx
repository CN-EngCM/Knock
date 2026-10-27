import * as React from "react"
import { cn } from "@/lib/utils"

type MessageSide = "start" | "end"

function MessageGroup({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="message-group" className={cn("flex min-w-0 flex-col gap-2", className)} {...props} />
}

function Message({ side = "start", className, ...props }: React.ComponentProps<"article"> & { side?: MessageSide }) {
  return <article
    data-slot="message"
    data-side={side}
    className={cn(
      "group/message relative flex w-full min-w-0 items-start gap-2 text-xs leading-4",
      side === "end" && "flex-row-reverse",
      className,
    )}
    {...props}
  />
}

function MessageAvatar({ className, ...props }: React.ComponentProps<"div">) {
  return <div
    data-slot="message-avatar"
    className={cn(
      "flex size-8 min-w-8 shrink-0 items-center justify-center self-start overflow-hidden rounded-lg bg-muted text-small font-medium [&:empty]:bg-transparent [&>img]:size-full [&>img]:object-cover [&>[data-slot=avatar]]:size-full [&>[data-slot=avatar]]:rounded-[inherit] [&>[data-slot=avatar]]:shadow-none",
      // When a header is present the avatar aligns with the first bubble instead of the header line.
      "group-has-data-[slot=message-header]/message:mt-[25px]",
      className,
    )}
    {...props}
  />
}

function MessageContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div
    data-slot="message-content"
    className={cn(
      "flex min-w-0 flex-1 flex-col gap-2.5 [overflow-wrap:anywhere] group-data-[side=end]/message:items-end",
      className,
    )}
    {...props}
  />
}

function MessageHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div
    data-slot="message-header"
    className={cn(
      "flex max-w-full min-w-0 items-center gap-2 px-3 text-small leading-[15px] font-medium text-muted-foreground group-data-[side=end]/message:justify-end",
      className,
    )}
    {...props}
  />
}

function MessageFooter({ className, ...props }: React.ComponentProps<"div">) {
  return <div
    data-slot="message-footer"
    className={cn(
      "flex max-w-full min-w-0 items-center gap-2 px-3 text-small leading-[15px] font-medium text-muted-foreground group-data-[side=end]/message:justify-end",
      className,
    )}
    {...props}
  />
}

function MessageActions({ className, ...props }: React.ComponentProps<"div">) {
  return <div
    data-slot="message-actions"
    className={cn("flex min-h-5 flex-wrap items-center gap-1 px-1 group-data-[side=end]/message:justify-end", className)}
    {...props}
  />
}

export { Message, MessageGroup, MessageAvatar, MessageContent, MessageHeader, MessageFooter, MessageActions }
export type { MessageSide }
