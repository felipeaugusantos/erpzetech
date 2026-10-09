import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ConciergeBell, Plus, ScanBarcode, Users } from "lucide-react";
import { toast } from "sonner";

import { ModuloBloqueado } from "@/components/app/ModuloCnae";
import { EmptyState, PageHeader } from "@/components/app/PageHeader";
import { AbrirComandaDialog } from "@/components/restaurante/AbrirComandaDialog";
import { ComandaDialog } from "@/components/restaurante/ComandaDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useRealtimeTabelas } from "@/hooks/useRealtimeTabelas";
import { useRelogio } from "@/hooks/useRelogio";
import { useSessionData } from "@/hooks/useSessionData";
import { brl } from "@/lib/format";
import { useModulosCnae } from "@/lib/cnae";
import { acharMesa, interpretarLeitura } from "@/lib/leitor-comanda";
import { minutosDesde } from "@/lib/restaurante";
import {
  CHAVE_REST,
  tabela,
  type Comanda,
  type ComandaItem,
  type Mesa,
} from "@/lib/restaurante-dados";

export const Route = createFileRoute("/_authenticated/salao")({
  head: () => ({
    meta: [
      { title: "PDV do restaurante — ERP Ze Tech" },
      { name: "description", content: "Mesas, comandas e pedidos do restaurante." },
    ],
  }),
  component: Salao,
});

const PERFIS_SALAO = ["administrador", "gestor", "garcom", "caixa"];

function Salao() {
  const qc = useQueryClient();
  const { data: session } = useSessionData();
  const modulos = useModulosCnae();
  const roles = session?.roles ?? [];
  const agora = useRelogio();
  const [abrindo, setAbrindo] = useState<{ mesa: Mesa | null } | null>(null);
  const [comandaAberta, setComandaAberta] = useState<string | null>(null);
  const [leitura, setLeitura] = useState("");
  const leitorRef = useRef<HTMLInputElement>(null);

  // F2 leva o cursor ao leitor, como no PDV da loja
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "F2") {
        e.preventDefault();
        leitorRef.current?.focus();
      }
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, []);

  useRealtimeTabelas(["comandas", "comanda_itens"], () =>
    qc.invalidateQueries({ queryKey: [CHAVE_REST] }),
  );

  const { data, isLoading } = useQuery({
    queryKey: [CHAVE_REST, "salao"],
    queryFn: async () => {
      const [mesas, comandas] = await Promise.all([
        tabela("mesas").select("*"),
        tabela("comandas").select("*").eq("situacao", "aberta").order("aberta_em"),
      ]);
      if (mesas.error) throw new Error(mesas.error.message);
      if (comandas.error) throw new Error(comandas.error.message);
      const lista = (comandas.data ?? []) as unknown as Comanda[];
      let itens: Pick<ComandaItem, "comanda_id" | "situacao" | "total">[] = [];
      if (lista.length > 0) {
        const r = await tabela("comanda_itens")
          .select("comanda_id, situacao, total")
          .in(
            "comanda_id",
            lista.map((c) => c.id),
          );
        if (r.error) throw new Error(r.error.message);
        itens = (r.data ?? []) as unknown as typeof itens;
      }
      const ordenadas = ((mesas.data ?? []) as unknown as Mesa[]).sort((a, b) =>
        a.numero.localeCompare(b.numero, "pt-BR", { numeric: true }),
      );
      return { mesas: ordenadas, comandas: lista, itens };
    },
    enabled: modulos.restaurante,
  });

  const porMesa = useMemo(() => {
    const m = new Map<string, Comanda>();
    for (const c of data?.comandas ?? []) if (c.mesa_id) m.set(c.mesa_id, c);
    return m;
  }, [data]);

  const resumo = (comandaId: string) => {
    const itens = (data?.itens ?? []).filter((i) => i.comanda_id === comandaId);
    return {
      total: itens
        .filter((i) => i.situacao !== "cancelado")
        .reduce((s, i) => s + Number(i.total), 0),
      prontos: itens.filter((i) => i.situacao === "pronto").length,
      pendentes: itens.filter((i) => i.situacao === "pendente").length,
    };
  };

  if (session && !modulos.carregando && !modulos.restaurante)
    return <ModuloBloqueado modulo="restaurante" />;
  if (session && !roles.some((r) => PERFIS_SALAO.includes(r)))
    return (
      <EmptyState
        title="Sem acesso ao salão"
        description="Seu perfil não atende mesas. Fale com a gestão."
      />
    );

  // mesa desativada some do mapa, menos enquanto ainda tem comanda aberta (senão ela ficaria inacessível)
  const mesas = (data?.mesas ?? []).filter((m) => m.ativa || porMesa.has(m.id));
  const mesasLivres = mesas.filter((m) => m.ativa && !porMesa.has(m.id));
  const avulsas = (data?.comandas ?? []).filter((c) => !c.mesa_id && c.tipo !== "delivery");

  const ocupadas = mesas.filter((m) => porMesa.has(m.id)).length;

  /** Bipa o código da comanda ou digita o número da mesa: abre a comanda (ou pergunta para abrir a mesa). */
  async function ler(texto: string) {
    const l = interpretarLeitura(texto);
    if (l.tipo === "vazio") return;
    setLeitura("");
    if (l.tipo === "comanda") {
      const { data, error } = await tabela("comandas")
        .select("id, numero, situacao")
        .eq("numero", l.numero)
        .maybeSingle();
      if (error) toast.error(error.message);
      else if (!data) toast.error(`Comanda ${l.numero} não encontrada`);
      else {
        const c = data as unknown as Pick<Comanda, "id" | "numero" | "situacao">;
        if (c.situacao !== "aberta")
          toast.error(
            `A comanda ${c.numero} já foi ${c.situacao === "fechada" ? "fechada" : "cancelada"}`,
          );
        else setComandaAberta(c.id);
      }
    } else {
      const mesa = acharMesa(mesas, l.numero);
      if (!mesa) toast.error(`Mesa ${l.numero} não existe ou está desativada`);
      else {
        const aberta = porMesa.get(mesa.id);
        if (aberta) setComandaAberta(aberta.id);
        else setAbrindo({ mesa });
      }
    }
    leitorRef.current?.focus();
  }

  return (
    <>
      <PageHeader
        title="PDV do restaurante"
        description="Bipe a comanda ou digite o número da mesa. Mesa vermelha está ocupada; verde está livre."
        actions={
          <Button variant="outline" onClick={() => setAbrindo({ mesa: null })}>
            <Plus className="mr-1 size-4" /> Comanda avulsa
          </Button>
        }
      />

      <form
        className="mb-4 flex flex-wrap items-center gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void ler(leitura);
        }}
      >
        <div className="relative w-full max-w-md">
          <ScanBarcode className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={leitorRef}
            autoFocus
            className="h-12 pl-10 text-lg"
            placeholder="Código da comanda ou nº da mesa (F2)"
            aria-label="Leitor de comanda ou número da mesa"
            value={leitura}
            onChange={(e) => setLeitura(e.target.value)}
          />
        </div>
        <Button type="submit" size="lg">
          Abrir
        </Button>
        <div className="ml-auto flex items-center gap-4 text-sm">
          <span className="flex items-center gap-1.5">
            <span className="size-3 rounded-full bg-emerald-500" /> Livre {mesas.length - ocupadas}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-3 rounded-full bg-red-500" /> Ocupada {ocupadas}
          </span>
        </div>
      </form>

      {isLoading && <p className="text-sm text-muted-foreground">Carregando mesas...</p>}

      {!isLoading && mesas.length === 0 && avulsas.length === 0 && (
        <EmptyState
          title="Nenhuma mesa cadastrada"
          description="A gestão informa a quantidade de mesas em Restaurante > Cardápio e mesas. Você já pode abrir uma comanda avulsa."
        />
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
        {mesas.map((m) => {
          const c = porMesa.get(m.id);
          const r = c ? resumo(c.id) : null;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => (c ? setComandaAberta(c.id) : setAbrindo({ mesa: m }))}
              className={`rounded-xl border-2 p-3 text-left transition hover:shadow-md ${
                !c
                  ? "border-emerald-500 bg-emerald-50"
                  : `border-red-500 bg-red-50 ${r && r.prontos > 0 ? "ring-2 ring-amber-400 ring-offset-1" : ""}`
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-display text-2xl font-bold">{m.numero}</span>
                {m.capacidade && (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Users className="size-3" /> {m.capacidade}
                  </span>
                )}
              </div>
              {c && r ? (
                <div className="mt-2 space-y-0.5 text-sm">
                  <p className="font-medium">{brl(r.total)}</p>
                  <p className="text-xs text-muted-foreground">
                    há {minutosDesde(c.aberta_em, agora)} min
                    {c.pessoas ? ` · ${c.pessoas} pessoas` : ""}
                  </p>
                  {r.prontos > 0 && (
                    <p className="flex items-center gap-1 text-xs font-semibold text-amber-700">
                      <ConciergeBell className="size-3.5" />
                      {r.prontos === 1 ? "1 item pronto" : `${r.prontos} itens prontos`}
                    </p>
                  )}
                  {r.pendentes > 0 && (
                    <p className="text-xs text-muted-foreground">{r.pendentes} a enviar</p>
                  )}
                </div>
              ) : (
                <p className="mt-2 text-sm font-medium text-emerald-700">Livre</p>
              )}
            </button>
          );
        })}
      </div>

      {avulsas.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-2 font-display text-lg font-semibold">Comandas avulsas</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
            {avulsas.map((c) => {
              const r = resumo(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setComandaAberta(c.id)}
                  className={`rounded-xl border-2 border-red-500 bg-red-50 p-3 text-left hover:shadow-md ${r.prontos > 0 ? "ring-2 ring-amber-400 ring-offset-1" : ""}`}
                >
                  <span className="font-display text-xl font-bold">Nº {c.numero}</span>
                  {c.cliente_nome && <p className="text-sm">{c.cliente_nome}</p>}
                  <p className="text-sm font-medium">{brl(r.total)}</p>
                  {r.prontos > 0 && (
                    <p className="text-xs font-semibold text-amber-700">{r.prontos} pronto(s)</p>
                  )}
                </button>
              );
            })}
          </div>
        </section>
      )}

      <AbrirComandaDialog
        aberto={abrindo !== null}
        mesa={abrindo?.mesa ?? null}
        onFechar={() => setAbrindo(null)}
        onAberta={(id) => {
          setAbrindo(null);
          setComandaAberta(id);
        }}
      />

      {comandaAberta && (
        <ComandaDialog
          comandaId={comandaAberta}
          roles={roles}
          mesas={mesas}
          mesasLivres={mesasLivres}
          onFechar={() => setComandaAberta(null)}
        />
      )}
    </>
  );
}
