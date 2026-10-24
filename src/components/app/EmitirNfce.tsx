import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { cpfSalvo, erroCpf, formatarCpf, resumirNfce, soDigitos } from "@/lib/nfce-consumidor";

const COR = {
  ok: "border-success/40 bg-success/10",
  aviso: "border-warning/40 bg-warning/10",
  erro: "border-destructive/40 bg-destructive/10",
} as const;

/**
 * NFC-e da venda do balcão (pedido) ou da comanda fechada do restaurante: CPF opcional do consumidor,
 * criação da nota e o que falta (se faltar). Informe `pedidoId` ou `comandaId`.
 */
export function EmitirNfce({ pedidoId, comandaId }: { pedidoId?: string; comandaId?: string }) {
  const coluna = comandaId ? "comanda_id" : "pedido_id";
  const origem = (comandaId ?? pedidoId) as string;
  const qc = useQueryClient();
  /** Texto digitado; enquanto o operador não mexe, vale o CPF já guardado na nota. */
  const [editado, setEditado] = useState<string | null>(null);
  const chave = ["nfce-da-venda", coluna, origem];

  const { data: nota, isLoading } = useQuery({
    queryKey: chave,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("nfe")
        .select("id, situacao, numero, serie, pendencias, mensagem, contingencia, destinatario")
        .eq(coluna, origem)
        .eq("modelo", "nfce")
        .neq("situacao", "cancelada")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const cpf = editado ?? cpfSalvo(nota?.destinatario);

  const emitir = useMutation({
    mutationFn: async () => {
      const problema = erroCpf(cpf);
      if (problema) throw new Error(problema);
      const digitos = soDigitos(cpf);
      const cpfArg = digitos ? { p_cpf: digitos } : {};
      const { error } = comandaId
        ? await supabase.rpc("nfce_criar_comanda", { p_comanda_id: comandaId, ...cpfArg })
        : await supabase.rpc("nfce_criar", { p_pedido_id: origem, ...cpfArg });
      if (error) throw error;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: chave });
      void qc.invalidateQueries({ queryKey: ["pendencias-fiscais-notas"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Não foi possível criar a NFC-e"),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Verificando a NFC-e…</p>;

  const resumo = nota ? resumirNfce(nota) : null;
  // rascunho se refaz com os dados de agora (a pendência resolvida some); as demais situações não se refazem
  const podeEmitir = !nota || nota.situacao === "rascunho";

  return (
    <div className="space-y-3">
      {resumo ? (
        <div className={`rounded border p-3 text-sm ${COR[resumo.tom]}`}>
          <p className="font-medium">{resumo.titulo}</p>
          {resumo.detalhes.length > 0 ? (
            <ul className="mt-1 list-disc pl-4">
              {resumo.detalhes.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {podeEmitir ? (
        <>
          <div>
            <Label htmlFor="nfce-cpf">CPF na nota (opcional)</Label>
            <Input
              mascara="cpf"
              id="nfce-cpf"
              className="mt-1"
              inputMode="numeric"
              placeholder="000.000.000-00"
              value={cpf}
              onChange={(e) => setEditado(formatarCpf(e.target.value))}
            />
            {erroCpf(cpf) ? <p className="mt-1 text-xs text-destructive">{erroCpf(cpf)}</p> : null}
          </div>
          <Button onClick={() => emitir.mutate()} disabled={emitir.isPending || !!erroCpf(cpf)}>
            <FileText className="mr-1 h-4 w-4" />
            {emitir.isPending ? "Criando…" : nota ? "Tentar de novo" : "Emitir NFC-e"}
          </Button>
        </>
      ) : null}
    </div>
  );
}
