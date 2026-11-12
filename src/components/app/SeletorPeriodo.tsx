import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ATALHOS_PERIODO, atalhoAtivo, periodoDoAtalho, type Periodo } from "@/lib/periodo";
import { cn } from "@/lib/utils";

/** Atalhos de período em pílulas e as datas manuais, igual aos painéis. */
export function SeletorPeriodo({
  periodo,
  aoMudar,
}: {
  periodo: Periodo;
  aoMudar: (p: Periodo) => void;
}) {
  const ativo = atalhoAtivo(periodo);
  return (
    <div className="panel p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-sm font-semibold">Período</h2>
        <div
          role="group"
          aria-label="Atalhos de período"
          className="inline-flex flex-wrap gap-1 rounded-lg bg-secondary p-1"
        >
          {ATALHOS_PERIODO.map((a) => (
            <Button
              key={a.id}
              type="button"
              variant="ghost"
              size="sm"
              aria-pressed={ativo === a.id}
              onClick={() => aoMudar(periodoDoAtalho(a.id))}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-medium",
                ativo === a.id
                  ? "bg-primary text-primary-foreground shadow-sm hover:bg-primary"
                  : "text-muted-foreground hover:bg-background hover:text-foreground",
              )}
            >
              {a.rotulo}
            </Button>
          ))}
        </div>
      </div>
      <div className="mt-3 grid max-w-md grid-cols-2 gap-3">
        <div>
          <Label htmlFor="periodo-de">De</Label>
          <Input
            id="periodo-de"
            type="date"
            value={periodo.de}
            onChange={(e) => aoMudar({ ...periodo, de: e.target.value })}
          />
        </div>
        <div>
          <Label htmlFor="periodo-ate">Até</Label>
          <Input
            id="periodo-ate"
            type="date"
            value={periodo.ate}
            onChange={(e) => aoMudar({ ...periodo, ate: e.target.value })}
          />
        </div>
      </div>
    </div>
  );
}
