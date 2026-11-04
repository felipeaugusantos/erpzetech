import { useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Upload } from "lucide-react";
import { toast } from "sonner";

import { EmptyState, PageHeader } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { FONTE_MAPA, URL_MAPA, emLotes, lerBulario } from "@/lib/bulario";
import { carregarBularioDoMapa, importarLoteBulario } from "@/lib/bulario.functions";
import { decodificar } from "@/lib/importacao";
import { useSaasOperador } from "@/lib/saas";

export const Route = createFileRoute("/_authenticated/ze-tech-bulario")({
  head: () => ({
    meta: [
      { title: "Bulário veterinário (carga) — EZRA ERP" },
      {
        name: "description",
        content: "Carga da base de produtos veterinários do MAPA para o bulário das clínicas.",
      },
    ],
  }),
  component: CargaBulario,
});

function CargaBulario() {
  const qc = useQueryClient();
  const { data: operador, isLoading: carregandoAcesso } = useSaasOperador();
  const arquivo = useRef<HTMLInputElement>(null);
  const [progresso, setProgresso] = useState<string | null>(null);
  const carregar = useServerFn(carregarBularioDoMapa);
  const enviarLote = useServerFn(importarLoteBulario);

  const { data: total } = useQuery({
    queryKey: ["bulario-carga-total"],
    enabled: operador === true,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("bulario_total");
      if (error) throw error;
      return data ?? 0;
    },
  });

  const atualizar = () => {
    void qc.invalidateQueries({ queryKey: ["bulario"] });
    void qc.invalidateQueries({ queryKey: ["bulario-resumo"] });
    void qc.invalidateQueries({ queryKey: ["bulario-carga-total"] });
  };

  const doMapa = useMutation({
    mutationFn: () => carregar(),
    onSuccess: (r) => {
      toast.success(`${r.gravados.toLocaleString("pt-BR")} produtos do MAPA carregados`);
      atualizar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const doArquivo = useMutation({
    mutationFn: async (f: File) => {
      const leitura = lerBulario(decodificar(new Uint8Array(await f.arrayBuffer())));
      if (leitura.erro) throw new Error(leitura.erro);
      let feitos = 0;
      for (const lote of emLotes(leitura.itens)) {
        await enviarLote({ data: { itens: lote } });
        feitos += lote.length;
        setProgresso(
          `${feitos.toLocaleString("pt-BR")} de ${leitura.itens.length.toLocaleString("pt-BR")}`,
        );
      }
      return leitura.itens.length;
    },
    onSuccess: (n) => {
      toast.success(`${n.toLocaleString("pt-BR")} produtos carregados`);
      atualizar();
    },
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => setProgresso(null),
  });

  if (carregandoAcesso) {
    return <div className="panel p-6 text-sm text-muted-foreground">Carregando…</div>;
  }
  if (operador !== true) {
    return (
      <EmptyState
        title="Área exclusiva da equipe EZRA."
        description="Entre com um acesso da equipe para carregar o bulário."
      />
    );
  }
  const ocupado = doMapa.isPending || doArquivo.isPending;
  return (
    <div className="space-y-4">
      <PageHeader
        title="Bulário veterinário (carga)"
        description="Carrega a base de produtos veterinários registrados no MAPA. Vale para todas as clínicas; repetir a carga atualiza o que já existe."
      />
      <div className="panel space-y-3 p-4 text-sm">
        <p>
          Produtos na base: <strong>{(total ?? 0).toLocaleString("pt-BR")}</strong>
        </p>
        <p className="text-muted-foreground">
          Fonte: {FONTE_MAPA}. O download usa o endereço oficial do MAPA; se ele estiver fora do ar,
          baixe o CSV em{" "}
          <a className="underline" href={URL_MAPA} target="_blank" rel="noreferrer">
            dados.agricultura.gov.br
          </a>{" "}
          e envie o arquivo aqui.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={ocupado} onClick={() => doMapa.mutate()}>
            {doMapa.isPending ? "Baixando do MAPA…" : "Carregar do MAPA"}
          </Button>
          <Button variant="outline" disabled={ocupado} onClick={() => arquivo.current?.click()}>
            <Upload className="mr-2 size-4" /> Enviar CSV
          </Button>
          {progresso && <span className="text-muted-foreground">{progresso}</span>}
        </div>
        <input
          ref={arquivo}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) doArquivo.mutate(f);
          }}
        />
      </div>
    </div>
  );
}
