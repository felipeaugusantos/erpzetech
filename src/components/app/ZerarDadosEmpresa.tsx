import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const FRASE = "ZERAR TUDO";

/** Zona de risco: apaga os dados de teste da empresa (somente administrador). */
export function ZerarDadosEmpresa() {
  const qc = useQueryClient();
  const [aberto, setAberto] = useState(false);
  const [modo, setModo] = useState<"movimentacoes" | "tudo">("movimentacoes");
  const [frase, setFrase] = useState("");

  const zerar = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("empresa_zerar_dados", {
        _modo: modo,
        _confirmacao: frase,
      });
      if (error) throw error;
      return data as { registros: number };
    },
    onSuccess: (d) => {
      toast.success("Dados zerados", {
        description: `${d?.registros ?? 0} registros apagados. O sistema está pronto para começar.`,
      });
      setAberto(false);
      setFrase("");
      qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error("Não foi possível zerar", { description: e.message }),
  });

  return (
    <div className="mt-8 rounded-lg border border-destructive/40 bg-destructive/5 p-5">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 size-5 text-destructive" />
        <div className="flex-1">
          <h3 className="font-semibold text-destructive">Zona de risco — começar do zero</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Apaga vendas, pedidos, notas, compras, caixas, contas e estoque de teste. Não dá para
            desfazer.
          </p>
          <Button variant="destructive" className="mt-3" onClick={() => setAberto(true)}>
            Zerar tudo
          </Button>
        </div>
      </div>

      <Dialog open={aberto} onOpenChange={(v) => !zerar.isPending && setAberto(v)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Zerar dados da empresa</DialogTitle>
            <DialogDescription>
              Escolha o que apagar. Essa ação não pode ser desfeita.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            {(
              [
                [
                  "movimentacoes",
                  "Só movimentações (recomendado)",
                  "Apaga vendas, pedidos, notas, compras, caixas, contas e entregas. Estoque volta a zero. Mantém produtos, clientes, fornecedores e usuários.",
                ],
                [
                  "tudo",
                  "Tudo",
                  "Apaga também produtos, categorias, clientes, fornecedores e cardápio. Mantém empresa, filiais, usuários e configurações fiscais.",
                ],
              ] as const
            ).map(([v, t, d]) => (
              <label
                key={v}
                className={`flex cursor-pointer gap-3 rounded-md border p-3 ${modo === v ? "border-destructive bg-destructive/5" : "border-border"}`}
              >
                <input type="radio" name="modo" checked={modo === v} onChange={() => setModo(v)} />
                <span>
                  <span className="block text-sm font-medium">{t}</span>
                  <span className="block text-xs text-muted-foreground">{d}</span>
                </span>
              </label>
            ))}
          </div>

          <div className="space-y-1">
            <Label htmlFor="frase-zerar">Digite {FRASE} para confirmar</Label>
            <Input
              id="frase-zerar"
              value={frase}
              onChange={(e) => setFrase(e.target.value)}
              autoComplete="off"
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAberto(false)} disabled={zerar.isPending}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={frase !== FRASE || zerar.isPending}
              onClick={() => zerar.mutate()}
            >
              {zerar.isPending ? "Zerando..." : "Zerar agora"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
