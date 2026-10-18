import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";

import { cn } from "@/lib/utils";

// GaN.UI Button(v0.1.0 源码接入):一套原语两种配方。
// desktop 外观 = 桌面软件按钮(默认 22px secondary);standard 外观 = 通用按钮
// (默认 25px,蓝色主操作显式 variant="primary")。提交按钮必须显式 type="submit"。
const buttonBase =
    "app-no-drag relative inline-flex shrink-0 cursor-default select-none items-center justify-center overflow-hidden whitespace-nowrap rounded-md font-[inherit] font-normal outline-none disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0";
const primaryFill =
    "bg-primary text-primary-foreground shadow-[inset_0_1px_0_rgb(255_255_255/18%),inset_0_0_0_0.5px_rgb(0_0_0/20%)] enabled:hover:brightness-110 enabled:active:shadow-[inset_0_1px_2px_rgb(0_0_0/30%)] enabled:data-pressed:shadow-[inset_0_1px_2px_rgb(0_0_0/30%)]";
const desktopMedium = "h-[25px] px-3 text-xs";

const desktopButtonVariants = cva(
    buttonBase + " group/button gap-1.5 disabled:opacity-55 aria-disabled:opacity-55 [&_svg]:size-[14px]",
    {
        variants: {
            variant: {
                default: primaryFill,
                primary: primaryFill,
                secondary:
                    "bg-[var(--button-background,rgb(255_255_255/15%))] text-white shadow-[inset_0_0_0_0.5px_rgb(0_0_0/20%)] disabled:text-white/65 enabled:active:not-data-active:shadow-[inset_0_0_0_100px_rgb(255_255_255/8%),inset_0_0_0_0.5px_rgb(0_0_0/20%)] enabled:data-pressed:not-data-active:shadow-[inset_0_0_0_100px_rgb(255_255_255/8%),inset_0_0_0_0.5px_rgb(0_0_0/20%)]",
                outline:
                    "border border-border bg-transparent text-foreground enabled:hover:not-data-active:bg-white/8 enabled:active:not-data-active:bg-white/5 enabled:data-pressed:not-data-active:bg-white/5",
                ghost: "bg-transparent text-foreground enabled:hover:not-data-active:bg-white/10 enabled:active:not-data-active:bg-white/8 enabled:data-pressed:not-data-active:bg-white/8",
                destructive:
                    "bg-destructive text-white shadow-[inset_0_1px_0_rgb(255_255_255/15%),inset_0_0_0_0.5px_rgb(0_0_0/25%)] enabled:hover:brightness-110",
                link: "bg-transparent text-primary underline-offset-3 hover:underline",
            },
            size: {
                xs: "h-5 gap-1 rounded-[calc(var(--radius)-2px)] px-1.5 text-xs [&_svg]:size-3",
                sm: "h-[22px] px-2 text-xs",
                default: desktopMedium,
                md: desktopMedium,
                lg: "h-8 px-[18px] text-[13px]",
                "icon-xs": "size-5 rounded-[calc(var(--radius)-2px)] [&_svg]:size-3",
                "icon-sm": "size-[22px]",
                icon: "size-[25px]",
                "icon-lg": "size-8",
            },
            active: {
                true: "data-active:bg-[color-mix(in_srgb,var(--button-active-tint,var(--primary))_80%,#000)] data-active:text-white data-active:shadow-[inset_0_0_0_0.5px_rgb(0_0_0/20%),inset_0_1px_0_rgb(255_255_255/6%)] enabled:data-active:active:brightness-[0.97] enabled:data-active:data-pressed:brightness-[0.97]",
                false: "",
            },
        },
        defaultVariants: { variant: "secondary", size: "sm", active: false },
    },
);

const standardMedium = "h-[25px] gap-1.5 px-4 has-[>svg]:px-3";
const standardButtonVariants = cva(
    buttonBase +
        " border-0 text-xs leading-[18px] transition-none disabled:opacity-50 aria-disabled:opacity-50 [&_svg:not([class*='size-'])]:size-4 shadow-[inset_0_0_0_0.5px_rgb(0_0_0/20%)] enabled:active:shadow-[inset_0_0_0_100px_rgb(255_255_255/8.2%)] aria-invalid:shadow-[inset_0_0_0_1px_var(--button-invalid)]",
    {
        variants: {
            variant: {
                default: "bg-white/15 text-foreground",
                primary: primaryFill,
                outline: "bg-white/7 text-foreground",
                secondary: "bg-[var(--button-standard-secondary)] text-white",
                ghost: "bg-transparent text-foreground shadow-none enabled:hover:bg-white/7",
                destructive: "bg-[var(--button-standard-destructive)] text-white",
                link: "bg-transparent text-[var(--button-standard-link)] shadow-none underline-offset-4 hover:underline",
            },
            size: {
                xs: "h-5 gap-1 px-2 text-[11px] leading-[16.5px] has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
                sm: "h-[22px] gap-1.5 px-3 has-[>svg]:px-2.5",
                default: standardMedium,
                md: standardMedium,
                lg: "h-8 gap-1.5 px-6 has-[>svg]:px-4",
                "icon-xs": "size-5 p-0 [&_svg:not([class*='size-'])]:size-3",
                "icon-sm": "size-[22px] p-0",
                icon: "size-[25px] p-0",
                "icon-lg": "size-8",
            },
            active: {
                true: "data-active:bg-[var(--control-selection)] data-active:text-white data-active:shadow-[inset_0_0.5px_0_rgb(255_255_255/15.7%),inset_0_-1px_0_rgb(0_0_0/20%)]",
                false: "",
            },
        },
        defaultVariants: { variant: "default", size: "default", active: false },
    },
);

type ButtonAppearance = "desktop" | "standard";
type ButtonVariantOptions = VariantProps<typeof desktopButtonVariants> & {
    appearance?: ButtonAppearance;
    className?: string;
};

function buttonVariants({ appearance = "desktop", className, ...options }: ButtonVariantOptions = {}) {
    return cn(appearance === "standard" ? standardButtonVariants(options) : desktopButtonVariants(options), className);
}

type ButtonProps = React.ComponentProps<"button"> &
    ButtonVariantOptions & {
        asChild?: boolean;
        activeTint?: string;
        backgroundTint?: string;
        plain?: boolean;
        fullWidth?: boolean;
        topHighlightOpacity?: number;
        hoverEffect?: boolean;
    };

function preventActivation(event: React.SyntheticEvent) {
    event.preventDefault();
    event.stopPropagation();
}

function Button({
    appearance = "desktop",
    variant,
    size,
    active,
    activeTint,
    backgroundTint,
    plain = false,
    fullWidth = false,
    topHighlightOpacity = 0.35,
    hoverEffect = false,
    asChild = false,
    className,
    style,
    disabled = false,
    type,
    "aria-pressed": ariaPressed,
    "aria-disabled": ariaDisabled,
    tabIndex,
    onClickCapture,
    onAuxClickCapture,
    onKeyDownCapture,
    onPointerDown,
    onPointerCancel,
    onPointerLeave,
    onKeyDown,
    onKeyUp,
    onBlur,
    onClick,
    children,
    ...props
}: ButtonProps) {
    const Comp = asChild ? Slot.Root : "button";
    const selected = active ?? (ariaPressed === true || ariaPressed === "true");
    const blocked = disabled || ariaDisabled === true || ariaDisabled === "true";
    // 按压材质保持到 mouse-up:受控 active 切换与松手同帧落位,不闪回空闲填充
    const [pressed, setPressed] = React.useState(false);
    const resolvedVariant = variant ?? (appearance === "standard" ? "default" : "secondary");
    const resolvedSize = size ?? (appearance === "standard" ? "default" : "sm");
    // Slot 下子元素 props 优先,禁用语义先归一化到子元素上
    const content =
        asChild && blocked && React.isValidElement<React.HTMLAttributes<HTMLElement>>(children)
            ? React.cloneElement(children, {
                  "aria-disabled": true,
                  tabIndex: -1,
                  onClickCapture: preventActivation,
                  onAuxClickCapture: preventActivation,
                  onKeyDownCapture: (event) => {
                      if (event.key === "Enter" || event.key === " ") preventActivation(event);
                      else children.props.onKeyDownCapture?.(event);
                  },
              })
            : children;
    return (
        <Comp
            {...props}
            type={asChild ? type : (type ?? "button")}
            disabled={asChild ? undefined : blocked}
            aria-disabled={blocked || undefined}
            aria-pressed={active == null ? ariaPressed : active}
            tabIndex={asChild && blocked ? -1 : tabIndex}
            data-slot="button"
            data-appearance={appearance}
            data-variant={resolvedVariant}
            data-size={resolvedSize}
            data-active={selected || undefined}
            data-pressed={pressed || undefined}
            className={cn(
                buttonVariants({
                    appearance,
                    variant: resolvedVariant,
                    size: resolvedSize,
                    active: selected,
                }),
                plain && "rounded-none",
                fullWidth && "w-full",
                hoverEffect && !blocked && "hover:brightness-[1.025]",
                className,
            )}
            style={
                {
                    "--button-active-tint": activeTint,
                    "--button-background": backgroundTint,
                    ...(backgroundTint && !selected ? { background: backgroundTint } : null),
                    "--button-fill-opacity": selected || backgroundTint ? 1 : 0.15,
                    "--button-highlight-opacity": selected ? Math.min(topHighlightOpacity, 0.1) : topHighlightOpacity,
                    "--button-highlight-start": selected || backgroundTint ? "0.5px" : "1px",
                    "--button-highlight-end": selected || backgroundTint ? "2px" : "3px",
                    ...style,
                } as React.CSSProperties
            }
            onClickCapture={(event) => {
                if (blocked) {
                    preventActivation(event);
                    return;
                }
                onClickCapture?.(event);
            }}
            onAuxClickCapture={(event) => {
                if (blocked) preventActivation(event);
                else onAuxClickCapture?.(event);
            }}
            onKeyDownCapture={(event) => {
                if (blocked && (event.key === "Enter" || event.key === " ")) preventActivation(event);
                else onKeyDownCapture?.(event);
            }}
            onPointerDown={(event) => {
                onPointerDown?.(event);
                if (!event.defaultPrevented && !blocked && event.button === 0) setPressed(true);
            }}
            onPointerCancel={(event) => {
                setPressed(false);
                onPointerCancel?.(event);
            }}
            onPointerLeave={(event) => {
                setPressed(false);
                onPointerLeave?.(event);
            }}
            onKeyDown={(event) => {
                onKeyDown?.(event);
                const activates = event.key === "Enter" || (!asChild && event.key === " ");
                if (!event.defaultPrevented && !blocked && activates) setPressed(true);
            }}
            onKeyUp={(event) => {
                onKeyUp?.(event);
                if (event.defaultPrevented) setPressed(false);
            }}
            onBlur={(event) => {
                setPressed(false);
                onBlur?.(event);
            }}
            onClick={(event) => {
                try {
                    onClick?.(event);
                } finally {
                    setPressed(false);
                }
            }}
        >
            {content}
        </Comp>
    );
}

export { Button, buttonVariants };
export type { ButtonProps, ButtonAppearance };
