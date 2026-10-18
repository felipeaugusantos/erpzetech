import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ChevronRight, XCircle } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { dateBR } from "@/lib/format";
import {
  etapasPersonalizacao,
  labelEtapa,
  proximaEtapa,
  totalGrade,
  type LinhaGrade,
} from "@/lib/personalizacao";
import { useSessionData } from "@/hooks/useSessionData";
import { PageHeader, EmptyState } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/personalizacao")({
  head: () => ({
    meta: [
      { title: "Personalização — ERP Ze Tech" },
      {
        name: "description",
        content: "Aprovação da arte, etapas de produção e grade por tamanho dos pedidos personalizados.",
      },
      { property: "og:title", content: "Personalização — ERP Ze Tech" },
      {
        property: "og:description",
        content: "Acompanhe arte, impressão, prensa e entrega de cada encomenda.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Personalizacao,
});

type Registro = {
  id: string;
  pedido_id: string;
  grade: LinhaGrade[];
  arte_descricao: string | null;
  arte_link: string | null;
  arte_situacao: string;
  arte_aprovada_em: string | null;
  etapa: string;
  observacoes: string | null;
  pedidos: {
    numero: number;
    previsao_entrega: string | null;
    clientes: { nome: string } | null;
  } | null;
};

function Personalizacao() {
  const { data: session } = useSessionData();
  const faz = Boolean(
    (session?.empresa as { faz_personalizacao?: boolean } | null)?.faz_personalizacao,
  );

  const { data = [], isLoading } = useQuery({
    queryKey: ["personalizacao"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pedido_personalizacao")
        .select("*, pedidos(numero, situacao, previsao_entrega, clientes(nome))")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return ((data ?? []) as unknown as (Registro & { pedidos: { situacao?: string } | null })[]).filter(
        (r) => !["cancelado", "rascunho"].includes(r.pedidos?.situacao ?? ""),
      );
    },
  });

  return (
    <>
      <PageHeader
        title="Personalização"
        description="Arte aprovada, etapas de produção e grade por tamanho de cada pedido. A grade vem da Grade rápida do novo pedido."
      />
      {!faz && (
        <p className="mb-3 text-sm text-muted-foreground">
          Ative "A empresa faz personalização" no Cadastro da empresa para usar a Grade rápida nos
          pedidos.
        </p>
      )}
      {isLoading ? (
        <div className="panel h-72 animate-pulse" />
      ) : data.length === 0 ? (
        <EmptyState
          title="Nenhum pedido personalizado"
          description="Crie um pedido usando a Grade rápida e ele aparece aqui."
          action={
            <Button asChild>
              <Link to="/pedidos">Ir para Pedidos</Link>
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-3 xl:grid-cols-6">
          {etapasPersonalizacao.map((e) => {
            const lista = data.filter((r) => r.etapa === e.value);
            return (
              <section key={e.value} className="min-w-0">
                <h2 className="mb-2 text-sm font-semibold">
                  {e.label} <span className="text-muted-foreground">({lista.length})</span>
                </h2>
                <div className="space-y-3">
                  {lista.map((r) => (
                    <Cartao key={r.id} r={r} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}

function Cartao({ r }: { r: Registro }) {
  const qc = useQueryClient();
  const [descricao, setDescricao] = useState(r.arte_descricao ?? "");
  const [link, setLink] = useState(r.arte_link ?? "");
  const [obs, setObs] = useState(r.observacoes ?? "");

  const salvar = useMutation({
    mutationFn: async (extra: Record<string, unknown>) => {
      const { error } = await supabase
        .from("pedido_personalizacao")
        .update({
          arte_descricao: descricao || null,
          arte_link: link || null,
          observacoes: obs || null,
          ...extra,
        })
        .eq("id", r.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Personalização atualizada");
      void qc.invalidateQueries({ queryKey: ["personalizacao"] });
    },
    onError: (e: Error) => toast.error("Não foi possível salvar", { description: e.message }),
  });

  const proxima = proximaEtapa(r.etapa, r.arte_situacao);
  const porModelo = new Map<string, LinhaGrade[]>();
  for (const l of r.grade ?? []) porModelo.set(l.modelo, [...(porModelo.get(l.modelo) ?? []), l]);

  return (
    <div className="panel space-y-3 p-3 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <Link
            to="/pedidos/$id"
            params={{ id: r.pedido_id }}
            className="font-semibold hover:underline"
          >
            Pedido nº {r.pedidos?.numero}
          </Link>
          <p className="truncate text-xs text-muted-foreground">{r.pedidos?.clientes?.nome}</p>
          {r.pedidos?.previsao_entrega && (
            <p className="text-xs text-muted-foreground">
              Entrega: {dateBR(r.pedidos.previsao_entrega)}
            </p>
          )}
        </div>
        <Badge variant={r.arte_situacao === "aprovada" ? "default" : "secondary"}>
          {r.arte_situacao === "aprovada"
            ? "Arte aprovada"
            : r.arte_situacao === "reprovada"
              ? "Arte reprovada"
              : "Arte pendente"}
        </Badge>
      </div>

      <div className="space-y-1">
        {[...porModelo.entries()].map(([modelo, linhas]) => (
          <div key={modelo}>
            <p className="text-xs font-medium">
              {modelo} — {totalGrade(linhas)} pares
            </p>
            <div className="flex flex-wrap gap-1">
              {linhas.map((l, i) => (
                <span key={i} className="rounded bg-secondary px-1.5 py-0.5 text-xs">
                  {l.tamanho}: <b>{l.quantidade}</b>
                </span>
              ))}
            </div>
          </div>
        ))}
        <p className="text-xs font-semibold">Total: {totalGrade(r.grade ?? [])} pares</p>
      </div>

      <div className="space-y-2">
        <div>
          <Label htmlFor={`arte-${r.id}`} className="text-xs">
            Arte (nome, tema, cores)
          </Label>
          <Input id={`arte-${r.id}`} value={descricao} onChange={(e) => setDescricao(e.target.value)} />
        </div>
        <div>
          <Label htmlFor={`link-${r.id}`} className="text-xs">
            Link da arte
          </Label>
          <Input
            id={`link-${r.id}`}
            value={link}
            placeholder="https://…"
            onChange={(e) => setLink(e.target.value)}
          />
          {r.arte_link && /^https?:\/\//.test(r.arte_link) && (
            <a
              href={r.arte_link}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-primary underline"
            >
              Abrir arte
            </a>
          )}
        </div>
        <div>
          <Label htmlFor={`obs-${r.id}`} className="text-xs">
            Observações
          </Label>
          <Textarea id={`obs-${r.id}`} rows={2} value={obs} onChange={(e) => setObs(e.target.value)} />
        </div>
        {r.arte_aprovada_em && (
          <p className="text-xs text-muted-foreground">
            Aprovada em {dateBR(r.arte_aprovada_em)}
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={salvar.isPending} onClick={() => salvar.mutate({})}>
          Salvar
        </Button>
        {r.etapa === "aguardando_arte" && r.arte_situacao !== "aprovada" && (
          <>
            <Button
              size="sm"
              disabled={salvar.isPending}
              onClick={() =>
                salvar.mutate({
                  arte_situacao: "aprovada",
                  arte_aprovada_em: new Date().toISOString(),
                })
              }
            >
              <CheckCircle2 className="size-4" /> Cliente aprovou
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={salvar.isPending}
              onClick={() => salvar.mutate({ arte_situacao: "reprovada" })}
            >
              <XCircle className="size-4" /> Reprovou
            </Button>
          </>
        )}
        {proxima && (
          <Button
            size="sm"
            variant="secondary"
            disabled={salvar.isPending}
            onClick={() => salvar.mutate({ etapa: proxima })}
          >
            {labelEtapa(proxima)} <ChevronRight className="size-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
