import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileSpreadsheet } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { lerCsvIbpt } from "@/lib/tributos-aprox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const LOTE = 1000;

/** Importa a tabela da IBPT (CSV da UF da empresa) usada no valor aproximado dos tributos (Lei 12.741). */
export function TributosAprox() {
  const qc = useQueryClient();
  const [aberto, setAberto] = useState(false);
  const [arquivo, setArquivo] = useState<File | null>(null);

  const { data: resumo } = useQuery({
    queryKey: ["tributos-aprox-resumo"],
    enabled: aberto,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("tributos_aprox_ncm")
        .select("id", { count: "exact", head: true });
      if (error) throw error;
      const { data, error: erro2 } = await supabase
        .from("tributos_aprox_ncm")
        .select("versao, vigencia_fim, fonte")
        .order("atualizado_em", { ascending: false })
        .limit(1);
      if (erro2) throw erro2;
      return { total: count ?? 0, ultima: data?.[0] ?? null };
    },
  });

  const importar = useMutation({
    mutationFn: async () => {
      if (!arquivo) throw new Error("Escolha o arquivo CSV da IBPT.");
      const { linhas, ignoradas } = lerCsvIbpt(await arquivo.text());
      if (linhas.length === 0) throw new Error("Nenhuma linha de produto (NCM) válida no arquivo.");
      let gravadas = 0;
      for (let i = 0; i < linhas.length; i += LOTE) {
        const { data, error } = await supabase.rpc("tributos_aprox_importar", {
          p_linhas: linhas.slice(i, i + LOTE),
        });
        if (error) throw new Error(error.message);
        gravadas += Number(data ?? 0);
      }
      return { gravadas, ignoradas };
    },
    onSuccess: async (r) => {
      toast.success(`${r.gravadas} NCMs importados (${r.ignoradas} linhas ignoradas).`);
      setArquivo(null);
      await qc.invalidateQueries({ queryKey: ["tributos-aprox-resumo"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setAberto(true)}>
        <FileSpreadsheet className="mr-2 size-4" />
        Tributos (IBPT)
      </Button>
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Valor aproximado dos tributos (IBPT)</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Na venda a consumidor final, a nota informa o valor aproximado dos tributos (Lei
            12.741). As alíquotas por NCM vêm da tabela da IBPT, que você baixa no site deles
            (arquivo CSV do seu estado) e importa aqui; o sistema não traz valores prontos. A tabela
            vence a cada vigência: importe a nova quando sair. Se algum NCM da nota não tiver
            alíquota vigente, a nota é enviada sem essa informação e o sistema avisa.
          </p>
          <p className="text-sm">
            {resumo
              ? `${resumo.total} NCMs cadastrados${resumo.ultima ? ` · versão ${resumo.ultima.versao ?? "—"} · vigência até ${resumo.ultima.vigencia_fim ?? "—"}` : ""}`
              : "Carregando…"}
          </p>
          <div>
            <Label htmlFor="ibpt-arquivo">Arquivo CSV da IBPT</Label>
            <Input
              id="ibpt-arquivo"
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAberto(false)}>
              Fechar
            </Button>
            <Button disabled={!arquivo || importar.isPending} onClick={() => importar.mutate()}>
              {importar.isPending ? "Importando…" : "Importar tabela"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
