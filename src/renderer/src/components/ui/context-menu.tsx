import * as React from "react";
import { cn } from "@/lib/utils";
import { ContextMenu as ContextMenuPrimitive } from "radix-ui";
import { CheckIcon, ChevronRightIcon, MinusIcon } from "lucide-react";

function ContextMenu({ ...props }: React.ComponentProps<typeof ContextMenuPrimitive.Root>) {
    return <ContextMenuPrimitive.Root data-slot="context-menu" {...props} />;
}

function ContextMenuTrigger({
    className,
    onKeyDown,
    ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Trigger>) {
    return (
        <ContextMenuPrimitive.Trigger
            data-slot="context-menu-trigger"
            className={cn("select-none", className)}
            onKeyDown={(event) => {
                onKeyDown?.(event);
                if (event.defaultPrevented) return;
                // Radix 只在 contextmenu 手势打开:给键盘用户补 Shift+F10 与菜单键
                if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
                const trigger = event.currentTarget;
                const rect = trigger.getBoundingClientRect();
                trigger.dispatchEvent(
                    new MouseEvent("contextmenu", {
                        bubbles: true,
                        cancelable: true,
                        clientX: rect.left + rect.width / 2,
                        clientY: rect.top + rect.height / 2,
                    }),
                );
                event.preventDefault();
            }}
            {...props}
        />
    );
}

function ContextMenuGroup({ ...props }: React.ComponentProps<typeof ContextMenuPrimitive.Group>) {
    return <ContextMenuPrimitive.Group data-slot="context-menu-group" {...props} />;
}

function ContextMenuPortal({ ...props }: React.ComponentProps<typeof ContextMenuPrimitive.Portal>) {
    return <ContextMenuPrimitive.Portal data-slot="context-menu-portal" {...props} />;
}

function ContextMenuArrow({ className, ...props }: React.ComponentProps<typeof ContextMenuPrimitive.Arrow>) {
    return (
        <ContextMenuPrimitive.Arrow
            data-slot="context-menu-arrow"
            className={cn("fill-card stroke-border", className)}
            {...props}
        />
    );
}

function ContextMenuItemIndicator({
    className,
    ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.ItemIndicator>) {
    return (
        <ContextMenuPrimitive.ItemIndicator
            data-slot="context-menu-item-indicator"
            className={cn("flex items-center justify-center", className)}
            {...props}
        />
    );
}

function ContextMenuSub({ ...props }: React.ComponentProps<typeof ContextMenuPrimitive.Sub>) {
    return <ContextMenuPrimitive.Sub data-slot="context-menu-sub" {...props} />;
}

function ContextMenuRadioGroup({ ...props }: React.ComponentProps<typeof ContextMenuPrimitive.RadioGroup>) {
    return <ContextMenuPrimitive.RadioGroup data-slot="context-menu-radio-group" {...props} />;
}

function ContextMenuContent({
    className,
    collisionPadding = 8,
    ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Content>) {
    return (
        <ContextMenuPrimitive.Portal>
            <ContextMenuPrimitive.Content
                data-slot="context-menu-content"
                collisionPadding={collisionPadding}
                className={cn(
                    "z-50 max-h-(--radix-context-menu-content-available-height) min-w-36 origin-(--radix-context-menu-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-md bg-card p-1 text-xs text-card-foreground shadow-md ring-1 ring-foreground/10 duration-100 motion-reduce:animate-none motion-reduce:transition-none ease-[cubic-bezier(0.16,1,0.3,1)] data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
                    className,
                )}
                {...props}
            />
        </ContextMenuPrimitive.Portal>
    );
}

function ContextMenuItem({
    className,
    inset,
    variant = "default",
    ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Item> & {
    inset?: boolean;
    variant?: "default" | "destructive";
}) {
    return (
        <ContextMenuPrimitive.Item
            data-slot="context-menu-item"
            data-inset={inset}
            data-variant={variant}
            className={cn(
                "group/context-menu-item relative flex cursor-default items-center gap-1.5 rounded-md h-[30px] px-2 py-1.5 text-start text-xs outline-hidden select-none data-highlighted:bg-muted data-highlighted:text-foreground not-data-[variant=destructive]:focus:**:text-accent-foreground data-inset:ps-7 data-[variant=destructive]:text-destructive data-[variant=destructive]:data-highlighted:bg-destructive/10 data-[variant=destructive]:data-highlighted:text-destructive dark:data-[variant=destructive]:data-highlighted:bg-destructive/20 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 data-[variant=destructive]:*:[svg]:text-destructive",
                className,
            )}
            {...props}
        />
    );
}

function ContextMenuSubTrigger({
    className,
    inset,
    children,
    ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.SubTrigger> & {
    inset?: boolean;
}) {
    return (
        <ContextMenuPrimitive.SubTrigger
            data-slot="context-menu-sub-trigger"
            data-inset={inset}
            className={cn(
                "flex cursor-default items-center gap-1.5 rounded-md h-[30px] px-2 py-1.5 text-start text-xs outline-hidden select-none data-highlighted:bg-muted data-highlighted:text-foreground not-data-[variant=destructive]:focus:**:text-accent-foreground data-inset:ps-7 data-open:bg-muted data-open:text-accent-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
                className,
            )}
            {...props}
        >
            {children}
            <ChevronRightIcon className="ms-auto rtl:-scale-x-100" />
        </ContextMenuPrimitive.SubTrigger>
    );
}

function ContextMenuSubContent({
    className,
    sideOffset = 4,
    collisionPadding = 8,
    ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.SubContent>) {
    return (
        <ContextMenuPrimitive.SubContent
            data-slot="context-menu-sub-content"
            sideOffset={sideOffset}
            collisionPadding={collisionPadding}
            className={cn(
                "z-50 min-w-32 origin-(--radix-context-menu-sub-content-transform-origin) overflow-hidden rounded-md bg-card p-1 text-xs text-card-foreground shadow-lg ring-1 ring-foreground/10 duration-100 motion-reduce:animate-none motion-reduce:transition-none ease-[cubic-bezier(0.16,1,0.3,1)] data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
                className,
            )}
            {...props}
        />
    );
}

function ContextMenuCheckboxItem({
    className,
    children,
    checked,
    inset,
    ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.CheckboxItem> & {
    inset?: boolean;
}) {
    return (
        <ContextMenuPrimitive.CheckboxItem
            data-slot="context-menu-checkbox-item"
            data-inset={inset}
            className={cn(
                "relative flex cursor-default items-center gap-1.5 rounded-md h-[30px] py-1.5 pe-8 ps-2 text-start text-xs outline-hidden select-none data-highlighted:bg-muted data-highlighted:text-foreground focus:**:text-accent-foreground data-inset:ps-7 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
                className,
            )}
            checked={checked}
            {...props}
        >
            <span
                className="pointer-events-none absolute end-2 flex items-center justify-center"
                data-slot="context-menu-checkbox-item-indicator"
            >
                <ContextMenuItemIndicator>
                    {checked === "indeterminate" ? <MinusIcon /> : <CheckIcon />}
                </ContextMenuItemIndicator>
            </span>
            {children}
        </ContextMenuPrimitive.CheckboxItem>
    );
}

function ContextMenuRadioItem({
    className,
    children,
    inset,
    ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.RadioItem> & {
    inset?: boolean;
}) {
    return (
        <ContextMenuPrimitive.RadioItem
            data-slot="context-menu-radio-item"
            data-inset={inset}
            className={cn(
                "relative flex cursor-default items-center gap-1.5 rounded-md h-[30px] py-1.5 pe-8 ps-2 text-start text-xs outline-hidden select-none data-highlighted:bg-muted data-highlighted:text-foreground focus:**:text-accent-foreground data-inset:ps-7 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
                className,
            )}
            {...props}
        >
            <span
                className="pointer-events-none absolute end-2 flex items-center justify-center"
                data-slot="context-menu-radio-item-indicator"
            >
                <ContextMenuItemIndicator>
                    <CheckIcon />
                </ContextMenuItemIndicator>
            </span>
            {children}
        </ContextMenuPrimitive.RadioItem>
    );
}

function ContextMenuLabel({
    className,
    inset,
    ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Label> & {
    inset?: boolean;
}) {
    return (
        <ContextMenuPrimitive.Label
            data-slot="context-menu-label"
            data-inset={inset}
            className={cn(
                "h-[30px] px-2 py-1.5 text-start text-xs font-medium text-muted-foreground data-inset:ps-7",
                className,
            )}
            {...props}
        />
    );
}

function ContextMenuSeparator({ className, ...props }: React.ComponentProps<typeof ContextMenuPrimitive.Separator>) {
    return (
        <ContextMenuPrimitive.Separator
            data-slot="context-menu-separator"
            className={cn("-mx-1 my-1 h-px bg-border", className)}
            {...props}
        />
    );
}

function ContextMenuShortcut({ className, ...props }: React.ComponentProps<"span">) {
    return (
        <span
            data-slot="context-menu-shortcut"
            className={cn(
                "ms-auto text-xs tracking-widest text-muted-foreground group-focus/context-menu-item:text-accent-foreground",
                className,
            )}
            {...props}
        />
    );
}

export {
    ContextMenu,
    ContextMenuTrigger,
    ContextMenuContent,
    ContextMenuArrow,
    ContextMenuItem,
    ContextMenuCheckboxItem,
    ContextMenuRadioItem,
    ContextMenuItemIndicator,
    ContextMenuLabel,
    ContextMenuSeparator,
    ContextMenuShortcut,
    ContextMenuGroup,
    ContextMenuPortal,
    ContextMenuSub,
    ContextMenuSubContent,
    ContextMenuSubTrigger,
    ContextMenuRadioGroup,
};
