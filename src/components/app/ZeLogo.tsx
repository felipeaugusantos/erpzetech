import zeIcon from "@/assets/ze-obra-icon.png.asset.json";
import { cn } from "@/lib/utils";

export function ZeLogo({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "grid size-9 shrink-0 place-items-center overflow-hidden rounded-md bg-card ring-1 ring-border",
        className,
      )}
    >
      <img src={zeIcon.url} alt="Ze Obra" className="size-full object-cover" />
    </span>
  );
}
