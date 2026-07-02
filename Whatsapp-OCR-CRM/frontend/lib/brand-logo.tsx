import { Zap } from "lucide-react";
import { BRAND } from "./branding";
import { cn } from "./utils";

type BrandLogoProps = {
  size?: "sm" | "md" | "lg";
  showTagline?: boolean;
  className?: string;
};

const SIZES = {
  sm: { icon: "h-7 w-7", iconInner: "h-3.5 w-3.5", title: "text-sm", tagline: "text-[10px]" },
  md: { icon: "h-8 w-8", iconInner: "h-4 w-4", title: "text-base", tagline: "text-[11px]" },
  lg: { icon: "h-9 w-9", iconInner: "h-5 w-5", title: "text-lg", tagline: "text-xs" },
};

export function BrandLogo({ size = "md", showTagline = true, className }: BrandLogoProps) {
  const s = SIZES[size];

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div
        className={cn(
          s.icon,
          "rounded-md bg-brand flex items-center justify-center shadow-sm"
        )}
        aria-hidden
      >
        <Zap className={cn(s.iconInner, "text-white fill-white/20")} />
      </div>
      <div>
        <div className={cn("font-display font-semibold leading-none text-ink", s.title)}>
          {BRAND.shortName}
        </div>
        {showTagline ? (
          <div className={cn("text-ink-muted mt-1", s.tagline)}>{BRAND.tagline}</div>
        ) : null}
      </div>
    </div>
  );
}
