import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * 位号牌：`T22` 这类仪表位号统一装在这种 1px 描边的小牌子里，
 * 系统图、点位表和趋势标题用同一块牌，是这个界面唯一的签名细节。
 */
export function Tag({
  children,
  className,
  tone = "muted",
}: {
  children: React.ReactNode;
  className?: string;
  tone?: "muted" | "accent";
}) {
  return (
    <span
      className={cn(
        "inline-flex h-[18px] items-center rounded-[4px] border px-1.5 font-mono text-[10px] leading-none",
        tone === "accent" ? "border-primary/40 text-primary" : "border-border text-muted-foreground",
        className,
      )}
    >
      {children}
    </span>
  );
}

export type Tone = "neutral" | "ok" | "warn" | "danger" | "accent";

const dotTone: Record<Tone, string> = {
  neutral: "bg-muted-foreground/50",
  ok: "bg-ok",
  warn: "bg-warn",
  danger: "bg-danger",
  accent: "bg-primary",
};

/** 状态：一个 6px 点加文字，不用彩色药丸。 */
export function Status({
  tone = "neutral",
  children,
  className,
}: {
  tone?: Tone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap text-[11px] text-muted-foreground",
        className,
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", dotTone[tone])} aria-hidden="true" />
      {children}
    </span>
  );
}

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-[4px] border px-1.5 py-0.5 text-[10px] leading-4",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary/10 text-primary",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        outline: "border-border text-muted-foreground",
        success: "border-transparent bg-ok/10 text-ok",
        warning: "border-transparent bg-warn/10 text-warn",
        danger: "border-transparent bg-danger/10 text-danger",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

/** 配置页仍在用的紧凑标签；监控页优先使用 Tag / Status。 */
function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
