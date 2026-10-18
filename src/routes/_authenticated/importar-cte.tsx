import { useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileUp, Loader2, Search, Truck } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { lerDactes, lerXmlCte, type CteLido } from "@/lib/cte";
import { brl, dateBR } from "@/lib/format";
import { EmptyState, PageHeader } from "@/components/app/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/_authenticated/importar-cte")({
  head: () => ({
    meta: [
      { title: "Importar CT-e de frete — ERP Ze Tech" },
      {
        name: "description",
        content: "Importe o CT-e da transportadora e ligue o frete à NF-e de compra certa.",
      },
      { property: "og:title", content: "Importar CT-e de frete — ERP Ze Tech" },
      {
        property: "og:description",
        content: "Frete da transportadora no custo dos produtos e nas contas a pagar.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ImportarCte,
});

type Compra = {
  id: string;
  numero: number;
  nfe_numero: string | null;
  nfe_chave: string | null;
  nfe_emissao: string | null;
  total: number;
  fornecedores: { razao_social: string } | null;
};

function ImportarCte() {
  const qc = useQueryClient();
  const ref = useRef<HTMLInputElement>(null);
  const [ctes, setCtes] = useState<CteLido[]>([]);
  const [lendo, setLendo] = useState(false);

  const { data: compras = [] } = useQuery({
    queryKey: ["compras-nfe-para-cte"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("compras")
        .select("id, numero, nfe_numero, nfe_chave, nfe_emissao, total, fornecedores(razao_social)")
        .eq("origem", "xml_nfe")
        .neq("situacao", "cancelado")
        .order("created_at", { ascending: false })
        .limit(1000);
      if (error) throw error;
      return data as unknown as Compra[];
    },
  });

  const { data: jaVinculados = [] } = useQuery({
    queryKey: ["ctes-vinculados"],
    queryFn: async () => {
      const { data, error } = await supabase.from("compra_ctes").select("chave");
      if (error) throw error;
      return (data ?? []).map((c) => c.chave as string | null).filter(Boolean) as string[];
    },
  });

  async function ler(file: File) {
    setLendo(true);
    try {
      const ehPdf = file.name.toLowerCase().endsWith(".pdf") || file.type === "application/pdf";
      let lidos: CteLido[];
      if (ehPdf) {
        const { textoDoPdf } = await import("@/lib/danfe-pdf");
        lidos = lerDactes(await textoDoPdf(file));
      } else {
        lidos = [lerXmlCte(await file.text())];
      }
      setCtes(lidos);
      toast.success(`${lidos.length} CT-e encontrado(s) no arquivo.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível ler o arquivo.");
    } finally {
      setLendo(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Importar CT-e de frete"
        description="Envie o XML ou o PDF do CT-e que a transportadora mandou. O sistema procura a NF-e pela chave; se não achar, busque a nota pelo número ou fornecedor."
        actions={
          <Button onClick={() => ref.current?.click()} disabled={lendo}>
            {lendo ? <Loader2 className="size-4 animate-spin" /> : <FileUp className="size-4" />}{" "}
            Escolher arquivo do CT-e
          </Button>
        }
      />
      <input
        ref={ref}
        type="file"
        accept=".xml,text/xml,application/xml,.pdf,application/pdf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void ler(f);
          e.target.value = "";
        }}
      />

      {ctes.length === 0 ? (
        <EmptyState
          title="Nenhum CT-e carregado"
          description="Um PDF com vários CT-e é separado automaticamente, um por linha."
        />
      ) : (
        <div className="space-y-4">
          {ctes.map((c, i) => (
            <CartaoCte
              key={c.chave ?? i}
              cte={c}
              compras={compras}
              vinculado={Boolean(c.chave && jaVinculados.includes(c.chave))}
              onFeito={() => void qc.invalidateQueries()}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CartaoCte({
  cte,
  compras,
  vinculado,
  onFeito,
}: {
  cte: CteLido;
  compras: Compra[];
  vinculado: boolean;
  onFeito: () => void;
}) {
  const automatica =
    compras.find((c) => c.nfe_chave && cte.nfe_chaves.includes(c.nfe_chave)) ?? null;
  const [escolhida, setEscolhida] = useState<Compra | null>(automatica);
  const [busca, setBusca] = useState("");
  const [feito, setFeito] = useState(false);

  const resultados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return [];
    const dig = q.replace(/\D/g, "");
    return compras
      .filter(
        (c) =>
          (c.fornecedores?.razao_social ?? "").toLowerCase().includes(q) ||
          (dig &&
            (String(c.nfe_numero ?? "").includes(dig) ||
              (c.nfe_chave ?? "").includes(dig) ||
              String(c.numero) === dig)),
      )
      .slice(0, 8);
  }, [busca, compras]);

  const vincular = useMutation({
    mutationFn: async () => {
      if (!escolhida) throw new Error("Escolha a NF-e deste frete.");
      if (
        escolhida.nfe_chave &&
        cte.nfe_chaves.length > 0 &&
        !cte.nfe_chaves.includes(escolhida.nfe_chave)
      ) {
        throw new Error(
          "Este CT-e não transporta a NF-e escolhida (a chave da nota não aparece no CT-e).",
        );
      }
      const { data: parcelas } = await supabase
        .from("contas_pagar")
        .select("vencimento, categoria")
        .eq("compra_id", escolhida.id)
        .neq("situacao", "cancelado")
        .order("vencimento");
      const vencimento =
        (parcelas ?? []).find((p) => p.categoria !== "Frete")?.vencimento ?? undefined;
      const { data: res, error } = await supabase.rpc("nfe_entrada_vincular_cte", {
        p_compra_id: escolhida.id,
        p_cte: cte,
        ...(vencimento ? { p_vencimento: vencimento } : {}),
      });
      if (error) throw error;
      return { itens: (res as { itens?: number } | null)?.itens ?? 0, vencimento };
    },
    onSuccess: (r) => {
      setFeito(true);
      toast.success(
        `Frete de ${brl(cte.valor)} somado ao custo de ${r.itens} produto(s) e lançado nas contas a pagar${r.vencimento ? `, vencimento ${dateBR(r.vencimento)}` : ""}.`,
      );
      onFeito();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Não foi possível vincular."),
  });

  const pronto = vinculado || feito;

  return (
    <div className="panel space-y-4 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Truck className="mt-1 size-5 text-primary" />
          <div>
            <div className="font-semibold">
              CT-e nº {cte.numero ?? "—"} · {cte.razao_social ?? "Transportadora"}
            </div>
            <div className="text-sm text-muted-foreground">
              {cte.emissao ? dateBR(cte.emissao) : "sem data"} · frete {brl(cte.valor)}
              {cte.nfe_chaves.length > 0
                ? ` · ${cte.nfe_chaves.length} NF-e citada(s)`
                : " · nenhuma NF-e citada"}
            </div>
          </div>
        </div>
        {pronto ? (
          <Badge>Já vinculado</Badge>
        ) : automatica ? (
          <Badge variant="secondary">NF-e achada pela chave</Badge>
        ) : (
          <Badge variant="outline">Busque a NF-e</Badge>
        )}
      </div>

      {!pronto && (
        <>
          <div className="space-y-1">
            <Label htmlFor={`busca-${cte.chave}`}>Buscar NF-e de compra</Label>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
              <Input
                id={`busca-${cte.chave}`}
                className="pl-8"
                placeholder="Número da nota, chave, nº da compra ou fornecedor"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
              />
            </div>
            {resultados.length > 0 && (
              <div className="divide-y rounded-md border">
                {resultados.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-muted"
                    onClick={() => {
                      setEscolhida(c);
                      setBusca("");
                    }}
                  >
                    <span>
                      NF {c.nfe_numero ?? "—"} · {c.fornecedores?.razao_social ?? "—"}
                    </span>
                    <span className="text-muted-foreground">
                      {c.nfe_emissao ? dateBR(c.nfe_emissao) : ""} · {brl(Number(c.total))}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-muted/50 p-3 text-sm">
            <span>
              {escolhida
                ? `NF-e escolhida: nº ${escolhida.nfe_numero ?? "—"} · ${escolhida.fornecedores?.razao_social ?? "—"} · compra nº ${escolhida.numero}`
                : "Nenhuma NF-e escolhida ainda."}
            </span>
            <Button disabled={!escolhida || vincular.isPending} onClick={() => vincular.mutate()}>
              {vincular.isPending && <Loader2 className="size-4 animate-spin" />} Vincular frete
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
