import erpIcon from "@/assets/erp-ze-tech-icon.png";
import { cn } from "@/lib/utils";

export function ZeLogo({ className }: { className?: string }) {
  return (
    <span className={cn("grid size-9 shrink-0 place-items-center overflow-hidden", className)}>
      <img
        src={erpIcon}
        alt="ERP Ze Tech"
        width={1024}
        height={1024}
        className="size-full object-contain"
      />
    </span>
  );
}
