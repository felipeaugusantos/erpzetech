import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, RotateCcw, Save, Undo2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  PAINEL_PET,
  alternarPecaDashboard,
  assinaturaDashboard,
  configDasLinhas,
  montarLinhasDashboard,
  moverPecaDashboard,
  type ConfigDashboard,
  type LinhaDashboard,
  type PecaDashboard,
} from "@/lib/dashboard-personalizado";
import { useRestaurarDashboard, useSalvarDashboard } from "@/lib/dashboard-personalizado-dados";

const TITULO_SECAO: Record<PecaDashboard["secao"], string> = {
  indicadores: "Cartões",
  paineis: "Painéis",
};

/** Administrador e gestor escolhem o que o dashboard mostra e em que ordem. Vale para todas as pessoas da empresa. */
export function PersonalizarDashboardDialog({
  aberto,
  aoMudar,
  disponiveis,
  config,
  painel = PAINEL_PET,
}: {
  aberto: boolean;
  aoMudar: (aberto: boolean) => void;
  /** peças que o dashboard já considera disponíveis para esta pessoa (a configuração não liga as outras) */
  disponiveis: readonly PecaDashboard[];
  config: ConfigDashboard | null;
  painel?: string;
}) {
  const salvar = useSalvarDashboard(painel);
  const restaurar = useRestaurarDashboard(painel);
  const salvo = useMemo(() => montarLinhasDashboard(disponiveis, config), [disponiveis, config]);
  const [linhas, setLinhas] = useState<LinhaDashboard[]>(salvo);
  const [confirmaRestaurar, setConfirmaRestaurar] = useState(false);
  // ao abrir (ou depois de salvar e restaurar), o desenho parte do que está salvo
  useEffect(() => {
    if (aberto) setLinhas(salvo);
  }, [aberto, salvo]);

  const alterado =
    assinaturaDashboard(linhas, disponiveis) !== assinaturaDashboard(salvo, disponiveis);
  const ocupado = salvar.isPending || restaurar.isPending;

  function gravar() {
    salvar.mutate(configDasLinhas(linhas, disponiveis), {
      onSuccess: () => {
        toast.success("Dashboard salvo", { description: "Vale para todas as pessoas da empresa." });
        aoMudar(false);
      },
      onError: (e: Error) => toast.error(e.message),
    });
  }

  return (
    <>
      <Dialog open={aberto} onOpenChange={(o) => !ocupado && aoMudar(o)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Personalizar o dashboard</DialogTitle>
            <DialogDescription>
              Ligue ou desligue os cartões e painéis e mude a ordem. Vale para todas as pessoas da
              empresa. Cada pessoa só vê o que o perfil dela permite, e o período de referência
              continua no topo.
            </DialogDescription>
          </DialogHeader>

          {(["indicadores", "paineis"] as const).map((secao) => {
            const daSecao = linhas.filter((l) => l.secao === secao);
            if (daSecao.length === 0) return null;
            return (
              <section key={secao} aria-label={TITULO_SECAO[secao]}>
                <h3 className="mb-1 font-display text-sm font-semibold">{TITULO_SECAO[secao]}</h3>
                <ul className="divide-y">
                  {daSecao.map((l, i) => (
                    <li key={l.id} className="flex items-center gap-2 py-2">
                      <Switch
                        checked={l.ligado}
                        disabled={ocupado}
                        onCheckedChange={() => setLinhas(alternarPecaDashboard(linhas, l.id))}
                        aria-label={`${l.ligado ? "Desligar" : "Ligar"} ${l.rotulo}`}
                      />
                      <span
                        className={
                          l.ligado
                            ? "flex-1 text-sm"
                            : "flex-1 text-sm text-muted-foreground line-through"
                        }
                      >
                        {l.rotulo}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Subir ${l.rotulo}`}
                        disabled={i === 0 || ocupado}
                        onClick={() => setLinhas(moverPecaDashboard(linhas, l.id, -1))}
                      >
                        <ArrowUp className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Descer ${l.rotulo}`}
                        disabled={i === daSecao.length - 1 || ocupado}
                        onClick={() => setLinhas(moverPecaDashboard(linhas, l.id, 1))}
                      >
                        <ArrowDown className="size-4" />
                      </Button>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}

          <DialogFooter className="gap-2 sm:justify-between">
            <Button variant="ghost" disabled={ocupado} onClick={() => setConfirmaRestaurar(true)}>
              <RotateCcw className="size-4" /> Restaurar o padrão
            </Button>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={!alterado || ocupado}
                onClick={() => setLinhas(salvo)}
              >
                <Undo2 className="size-4" /> Descartar
              </Button>
              <Button disabled={!alterado || ocupado} onClick={gravar}>
                <Save className="size-4" /> {salvar.isPending ? "Salvando…" : "Salvar"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmaRestaurar} onOpenChange={setConfirmaRestaurar}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Voltar ao dashboard padrão?</AlertDialogTitle>
            <AlertDialogDescription>
              Apaga a organização salva e todas as pessoas voltam a ver o dashboard do sistema. Isso
              vale para a empresa inteira.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={restaurar.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={restaurar.isPending}
              onClick={(e) => {
                e.preventDefault();
                restaurar.mutate(undefined, {
                  onSuccess: () => {
                    setConfirmaRestaurar(false);
                    toast.success("Dashboard padrão restaurado");
                    aoMudar(false);
                  },
                  onError: (err: Error) => toast.error(err.message),
                });
              }}
            >
              {restaurar.isPending ? "Restaurando…" : "Restaurar o padrão"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
