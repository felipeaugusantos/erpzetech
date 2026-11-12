import type { TooltipProps } from "recharts";
import { brl, num } from "@/lib/format";

export function DashboardChartTooltip({
  active,
  payload,
  label,
  moeda = false,
}: TooltipProps<number, string> & { moeda?: boolean }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="min-w-40 rounded-lg border border-border bg-popover p-3 text-xs text-popover-foreground shadow-raised">
      <p className="mb-2 font-semibold capitalize">{label ?? payload[0]?.name}</p>
      <div className="space-y-2">
        {payload.map((item, index) => (
          <div key={`${item.dataKey}-${index}`} className="flex items-center justify-between gap-5">
            <span className="text-muted-foreground">{item.name}</span>
            <span className="text-numeric font-semibold">
              {moeda ? brl(Number(item.value ?? 0)) : num(Number(item.value ?? 0), 0)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}