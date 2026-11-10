import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Percent } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { UFS_BR, validarRegraUf } from "@/lib/difal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type Linha = { interna: string; fcp: string; metodo: "dupla" | "unica" | "" };
const vazia: Linha = { interna: "", fcp: "", metodo: "" };

/** Cadastro da alíquota interna, do FCP e do método do DIFAL por UF de destino (venda interestadual a consumidor final). */
export function AliquotasDifal() {
  const qc = useQueryClient();
  const [aberto, setAberto] = useState(false);
  const [edicao, setEdicao] = useState<Record<string, Linha>>({});

  const { data: salvas = [] } = useQuery({
    queryKey: ["icms-uf-destino"],
    enabled: aberto,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("icms_uf_destino")
        .select("uf, aliquota_interna, fcp, metodo");
      if (error) throw error;
      return data ?? [];
    },
  });

  const valor = (uf: string): Linha => {
    if (edicao[uf]) return edicao[uf]!;
    const s = salvas.find((x) => x.uf === uf);
    return s
      ? {
          interna: String(s.aliquota_interna),
          fcp: String(s.fcp),
          metodo: s.metodo as "dupla" | "unica",
        }
      : vazia;
  };
  const mudar = (uf: string, parte: Partial<Linha>) =>
    setEdicao({ ...edicao, [uf]: { ...valor(uf), ...parte } });

  const salvar = useMutation({
    mutationFn: async () => {
      const alteradas = Object.entries(edicao).filter(([, l]) => l.interna.trim() || l.metodo);
      if (alteradas.length === 0) throw new Error("Nada para salvar.");
      for (const [uf, l] of alteradas) {
        const r = validarRegraUf({
          uf,
          aliquotaInterna: l.interna.replace(",", "."),
          fcp: l.fcp.replace(",", ".") || 0,
          metodo: l.metodo,
        });
        const { error } = await supabase.rpc("icms_uf_destino_salvar", {
          p_uf: r.uf,
          p_aliquota_interna: r.aliquota_interna,
          p_fcp: r.fcp,
          p_metodo: r.metodo,
        });
        if (error) throw new Error(`${uf}: ${error.message}`);
      }
    },
    onSuccess: async () => {
      toast.success("Alíquotas de DIFAL salvas.");
      setEdicao({});
      await qc.invalidateQueries({ queryKey: ["icms-uf-destino"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setAberto(true)}>
        <Percent className="mr-2 size-4" />
        DIFAL / FCP
      </Button>
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>DIFAL e FCP por UF de destino</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Vale para venda para outro estado a consumidor final que não é contribuinte do ICMS
            (empresa do regime normal). Informe, para cada UF de destino que você atende, a alíquota
            interna do ICMS, o adicional de FCP e o método de base de cálculo que o estado adota. O
            sistema não traz valores prontos: peça ao seu contador. Sem o cadastro da UF, a nota
            dessa venda não é enviada.
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-14">UF</TableHead>
                <TableHead>Alíquota interna %</TableHead>
                <TableHead>FCP %</TableHead>
                <TableHead>Método</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {UFS_BR.map((uf) => {
                const l = valor(uf);
                return (
                  <TableRow key={uf}>
                    <TableCell className="font-medium">{uf}</TableCell>
                    <TableCell>
                      <Input
                        inputMode="decimal"
                        value={l.interna}
                        onChange={(e) => mudar(uf, { interna: e.target.value })}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        inputMode="decimal"
                        value={l.fcp}
                        onChange={(e) => mudar(uf, { fcp: e.target.value })}
                      />
                    </TableCell>
                    <TableCell>
                      <Select
                        value={l.metodo}
                        onValueChange={(v) => mudar(uf, { metodo: v as "dupla" | "unica" })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Escolha" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="unica">Base única</SelectItem>
                          <SelectItem value="dupla">Base dupla</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAberto(false)}>
              Fechar
            </Button>
            <Button disabled={salvar.isPending} onClick={() => salvar.mutate()}>
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
