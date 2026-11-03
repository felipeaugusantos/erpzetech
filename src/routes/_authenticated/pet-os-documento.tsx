import { Link, createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Printer } from "lucide-react";

import { ModuloBloqueado } from "@/components/app/ModuloCnae";
import { EmptyState, PageHeader } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useModulosCnae } from "@/lib/cnae";
import { brl, dateBR, dateTimeBR } from "@/lib/format";
import { ESPECIES, PELAGENS, PORTES, idadeDoPet, rotulo } from "@/lib/pet";
import {
  rotuloSituacaoOsPet,
  rotuloTipoItemOs,
  type ItemOsPet,
  type ResumoPetOs,
} from "@/lib/pet-os";

export const Route = createFileRoute("/_authenticated/pet-os-documento")({
  validateSearch: (search: Record<string, unknown>) => ({
    id: typeof search["id"] === "string" ? (search["id"] as string) : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Ordem de serviço do pet — EZRA ERP" },
      { name: "description", content: "Ordem de serviço do pet para imprimir." },
    ],
  }),
  component: DocumentoModulo,
});

function DocumentoModulo() {
  const modulos = useModulosCnae();
  if (modulos.carregando) return <div className="panel h-40 animate-pulse" />;
  if (!modulos.petshop) return <ModuloBloqueado modulo="petshop" />;
  return <Documento />;
}

function Documento() {
  const { id } = Route.useSearch();
  const { data, isLoading, error } = useQuery({
    queryKey: ["pet-os-documento", id],
    enabled: Boolean(id),
    queryFn: async () => {
      const [o, i] = await Promise.all([
        supabase
          .from("os_ordens")
          .select(
            "numero, situacao, abertura, previsao, defeito_relatado, observacoes, desconto, valor_pecas, valor_servicos, valor_total, tecnico_nome, prioridade, pet_resumo, pet_id",
          )
          .eq("id", id as string)
          .not("pet_id", "is", null)
          .maybeSingle(),
        supabase
          .from("os_itens")
          .select("id, tipo, descricao, quantidade, preco_unitario, total")
          .eq("os_id", id as string)
          .order("created_at"),
      ]);
      if (o.error) throw o.error;
      if (i.error) throw i.error;
      if (!o.data) throw new Error("Ordem de serviço não encontrada.");
      return { os: o.data, itens: (i.data ?? []) as ItemOsPet[] };
    },
  });

  if (!id)
    return (
      <EmptyState
        title="Nenhuma ordem escolhida"
        description="Abra a ordem pela lista de ordens de serviço do pet."
        action={
          <Button asChild variant="outline">
            <Link to="/pet-os">Ir para as ordens</Link>
          </Button>
        }
      />
    );
  if (isLoading) return <div className="panel h-40 animate-pulse" />;
  if (error || !data)
    return (
      <EmptyState
        title="Não foi possível abrir a ordem"
        description={(error as Error | null)?.message ?? "Ordem não encontrada."}
      />
    );

  const { os, itens } = data;
  const p = (os.pet_resumo ?? {}) as Partial<ResumoPetOs>;
  const cancelada = os.situacao === "cancelada";

  return (
    <div>
      <PageHeader
        title={`Ordem de serviço nº ${os.numero}`}
        description={`${p.nome ?? ""} · tutor(a) ${p.tutor ?? ""}`}
        actions={
          <Button onClick={() => window.print()}>
            <Printer className="size-4" /> Imprimir
          </Button>
        }
      />
      <div
        id="documento-impresso"
        className="relative mx-auto w-full max-w-[800px] bg-card p-8 text-sm leading-relaxed"
      >
        {cancelada && (
          <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-6xl font-bold uppercase text-destructive/20 -rotate-12">
            Cancelada
          </p>
        )}
        <div className="mb-4 flex items-baseline justify-between border-b border-border pb-3">
          <p className="font-display text-lg font-bold uppercase">
            Ordem de serviço nº {os.numero}
          </p>
          <p className="text-xs text-muted-foreground">
            Aberta em {dateTimeBR(os.abertura)} · {rotuloSituacaoOsPet(os.situacao)}
          </p>
        </div>

        <div className="mb-4 grid gap-1 rounded-md border border-border p-3 sm:grid-cols-2">
          <p>
            <span className="text-muted-foreground">Animal: </span>
            <strong>{p.nome}</strong>
          </p>
          <p>
            <span className="text-muted-foreground">Tutor(a): </span>
            {p.tutor}
            {p.tutor_telefone ? ` · ${p.tutor_telefone}` : ""}
          </p>
          <p>
            <span className="text-muted-foreground">Espécie / raça: </span>
            {rotulo(ESPECIES, p.especie)}
            {p.raca ? ` · ${p.raca}` : ""}
          </p>
          <p>
            <span className="text-muted-foreground">Sexo / idade: </span>
            {p.sexo === "macho" ? "Macho" : p.sexo === "femea" ? "Fêmea" : "—"}
            {p.nascimento ? ` · ${idadeDoPet(p.nascimento)}` : ""}
            {p.castrado !== null && p.castrado !== undefined
              ? ` · ${p.castrado ? "Castrado" : "Não castrado"}`
              : ""}
          </p>
          <p>
            <span className="text-muted-foreground">Porte / pelagem: </span>
            {[rotulo(PORTES, p.porte), rotulo(PELAGENS, p.pelagem)].filter(Boolean).join(" · ") ||
              "—"}
          </p>
          <p>
            <span className="text-muted-foreground">Peso / microchip: </span>
            {p.peso_kg ? `${String(p.peso_kg).replace(".", ",")} kg` : "—"}
            {p.microchip ? ` · ${p.microchip}` : ""}
          </p>
          {p.alergias && (
            <p className="sm:col-span-2">
              <span className="text-muted-foreground">Alergias: </span>
              <strong>{p.alergias}</strong>
            </p>
          )}
        </div>

        {os.defeito_relatado && (
          <p className="mb-3 whitespace-pre-wrap">
            <span className="text-muted-foreground">Motivo: </span>
            {os.defeito_relatado}
          </p>
        )}
        <p className="mb-3 text-xs text-muted-foreground">
          {[
            os.tecnico_nome ? `Profissional: ${os.tecnico_nome}` : null,
            os.previsao ? `Previsão: ${dateBR(os.previsao)}` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>

        <table className="mb-3 w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-border text-xs uppercase text-muted-foreground">
              <th className="py-1">Item</th>
              <th>Tipo</th>
              <th className="text-right">Qtd.</th>
              <th className="text-right">Preço</th>
              <th className="text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {itens.map((i) => (
              <tr key={i.id} className="border-b border-border/50">
                <td className="py-1">{i.descricao}</td>
                <td>{rotuloTipoItemOs(i.tipo)}</td>
                <td className="text-right">{String(i.quantidade).replace(".", ",")}</td>
                <td className="text-right">{brl(Number(i.preco_unitario))}</td>
                <td className="text-right">{brl(Number(i.total))}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="text-right">
          <p>
            Produtos {brl(Number(os.valor_pecas))} · Serviços {brl(Number(os.valor_servicos))}
            {Number(os.desconto) > 0 ? ` · Desconto ${brl(Number(os.desconto))}` : ""}
          </p>
          <p className="text-base font-bold">Total {brl(Number(os.valor_total))}</p>
        </div>

        {os.observacoes && (
          <p className="mt-4 whitespace-pre-wrap text-xs">Observações: {os.observacoes}</p>
        )}

        <div className="mt-12 grid gap-8 sm:grid-cols-2">
          <div className="border-t border-foreground pt-1 text-center">
            <p className="text-xs">Responsável pelo atendimento</p>
          </div>
          <div className="border-t border-foreground pt-1 text-center">
            <p className="text-xs">Tutor(a): {p.tutor}</p>
          </div>
        </div>
        <p className="mt-6 text-[11px] text-muted-foreground">
          Documento sem valor fiscal. A cobrança é feita na frente de caixa.
        </p>
      </div>
    </div>
  );
}
