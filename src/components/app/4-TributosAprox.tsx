import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileSpreadsheet } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { lerCsvIbpt } from "@/lib/tributos-aprox";
import { consultarTributosIbpt } from "@/lib/ibpt-api.functions";
import { gtinValido } from "@/lib/ibpt-api";
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

  const consultarIbpt = useServerFn(consultarTributosIbpt);
  const [q, setQ] = useState({
    ncm: "",
    uf: "",
    ex: "0",
    descricao: "",
    unidadeMedida: "UN",
    valor: "",
    gtin: "",
  });
  const consultar = useMutation({
    mutationFn: async () => {
      const linha = await consultarIbpt({
        data: {
          ncm: q.ncm,
          uf: q.uf,
          ex: Number(q.ex || 0),
          descricao: q.descricao,
          unidadeMedida: q.unidadeMedida,
          valor: Number(q.valor.replace(",", ".")),
          gtin: q.gtin,
        },
      });
      // mesma gravação da importação do CSV: o banco confere papel e empresa
      const { error } = await supabase.rpc("tributos_aprox_importar", { p_linhas: [linha] });
      if (error) throw new Error(error.message);
      return linha;
    },
    onSuccess: async (l) => {
      toast.success(
        `NCM ${l.ncm}: federal ${l.aliq_nacional_federal}% (importado ${l.aliq_importado_federal}%), estadual ${l.aliq_estadual}%, municipal ${l.aliq_municipal}%.`,
      );
      await qc.invalidateQueries({ queryKey: ["tributos-aprox-resumo"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const campo = (k: keyof typeof q, v: string) => setQ((a) => ({ ...a, [k]: v }));
  const consultaOk =
    q.ncm.replace(/\D/g, "").length === 8 &&
    q.uf.trim().length === 2 &&
    q.descricao.trim() !== "" &&
    q.unidadeMedida.trim() !== "" &&
    Number(q.valor.replace(",", ".")) >= 0 &&
    q.valor.trim() !== "" &&
    gtinValido(q.gtin.replace(/\D/g, ""));

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
          <div className="space-y-2 rounded-md border p-3">
            <p className="text-sm font-medium">Consultar uma NCM na API da IBPT</p>
            <p className="text-xs text-muted-foreground">
              Disponível só para empresas habilitadas. O valor é aproximado (informativo na nota) e
              grava a alíquota vigente da NCM; não calcula o imposto devido.
            </p>
            <div className="grid grid-cols-3 gap-2">
              <Input
                placeholder="NCM (8 dígitos)"
                value={q.ncm}
                onChange={(e) => campo("ncm", e.target.value)}
              />
              <Input
                placeholder="UF"
                maxLength={2}
                value={q.uf}
                onChange={(e) => campo("uf", e.target.value)}
              />
              <Input
                placeholder="EX (0 se não há)"
                value={q.ex}
                onChange={(e) => campo("ex", e.target.value)}
              />
              <Input
                className="col-span-3"
                placeholder="Descrição do produto"
                value={q.descricao}
                onChange={(e) => campo("descricao", e.target.value)}
              />
              <Input
                placeholder="Unidade"
                value={q.unidadeMedida}
                onChange={(e) => campo("unidadeMedida", e.target.value)}
              />
              <Input
                placeholder="Valor unitário"
                value={q.valor}
                onChange={(e) => campo("valor", e.target.value)}
              />
              <Input
                placeholder="GTIN (obrigatório)"
                value={q.gtin}
                onChange={(e) => campo("gtin", e.target.value)}
              />
            </div>
            <Button
              size="sm"
              variant="secondary"
              disabled={!consultaOk || consultar.isPending}
              onClick={() => consultar.mutate()}
            >
              {consultar.isPending ? "Consultando…" : "Consultar na IBPT"}
            </Button>
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
