import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Ban,
  CalendarClock,
  ConciergeBell,
  MoreVertical,
  Plus,
  ScanBarcode,
  Users,
} from "lucide-react";
import { toast } from "sonner";

import { ModuloBloqueado } from "@/components/app/ModuloCnae";
import { EmptyState, PageHeader } from "@/components/app/PageHeader";
import { AbrirComandaDialog } from "@/components/restaurante/AbrirComandaDialog";
import { ComandaDialog } from "@/components/restaurante/ComandaDialog";
import { ChamadosBar } from "@/components/restaurante/ChamadosBar";
import { MesaAcoesDialog } from "@/components/restaurante/MesaAcoesDialog";
import { RestauranteOffline } from "@/components/restaurante/RestauranteOffline";
import { useOnline } from "@/lib/offline";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useRealtimeTabelas } from "@/hooks/useRealtimeTabelas";
import { useRelogio } from "@/hooks/useRelogio";
import { useSessionData } from "@/hooks/useSessionData";
import { brl } from "@/lib/format";
import { useModulosCnae } from "@/lib/cnae";
import { acharMesa, interpretarLeitura } from "@/lib/leitor-comanda";
import { ROTULO_STATUS_MESA, minutosDesde, statusMesa, type StatusMesa } from "@/lib/restaurante";
import {
  CHAVE_REST,
  tabela,
  type Comanda,
  type ComandaItem,
  type Mesa,
  type MesaReserva,
} from "@/lib/restaurante-dados";

export const Route = createFileRoute("/_authenticated/salao")({
  head: () => ({
    meta: [
      { title: "PDV do restaurante — EZRA ERP" },
      { name: "description", content: "Mesas, comandas e pedidos do restaurante." },
      { property: "og:title", content: "PDV do restaurante — EZRA ERP" },
      { property: "og:description", content: "Mesas, comandas e pedidos do restaurante." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
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
  const online = useOnline();
  const [mesaAcoes, setMesaAcoes] = useState<Mesa | null>(null);
  const [filtroStatus, setFiltroStatus] = useState<StatusMesa | "todas">("todas");
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

  useRealtimeTabelas(["comandas", "comanda_itens", "mesas", "mesa_reservas"], () =>
    qc.invalidateQueries({ queryKey: [CHAVE_REST] }),
  );

  const { data, isLoading } = useQuery({
    queryKey: [CHAVE_REST, "salao"],
    queryFn: async () => {
      const [mesas, comandas, reservas] = await Promise.all([
        tabela("mesas").select("*"),
        tabela("comandas").select("*").eq("situacao", "aberta").order("aberta_em"),
        tabela("mesa_reservas").select("*").eq("situacao", "ativa").order("reservada_para"),
      ]);
      if (reservas.error) throw new Error(reservas.error.message);
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
      return {
        mesas: ordenadas,
        comandas: lista,
        itens,
        reservas: (reservas.data ?? []) as unknown as MesaReserva[],
      };
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

  if (!online)
    return (
      <>
        <PageHeader title="PDV do restaurante" description="Modo sem internet" />
        <RestauranteOffline modo="salao" />
      </>
    );
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
  const mesasLivres = mesas.filter((m) => m.ativa && !m.bloqueada && !porMesa.has(m.id));
  const reservas = data?.reservas ?? [];
  const reservasDa = (mesaId: string) => reservas.filter((r) => r.mesa_id === mesaId);
  const situacaoDa = (m: Mesa): StatusMesa =>
    statusMesa({
      bloqueada: m.bloqueada,
      ocupada: porMesa.has(m.id),
      reservas: reservasDa(m.id),
      agora: agora.getTime(),
    });
  const contagem: Record<StatusMesa, number> = { livre: 0, ocupada: 0, reservada: 0, bloqueada: 0 };
  for (const m of mesas) contagem[situacaoDa(m)] += 1;
  const mesasVisiveis = mesas.filter(
    (m) => filtroStatus === "todas" || situacaoDa(m) === filtroStatus,
  );
  const avulsas = (data?.comandas ?? []).filter((c) => !c.mesa_id && c.tipo !== "delivery");

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
        else if (mesa.bloqueada) toast.error(`Mesa ${mesa.numero} está bloqueada`);
        else setAbrindo({ mesa });
      }
    }
    leitorRef.current?.focus();
  }

  return (
    <>
      <PageHeader
        title="PDV do restaurante"
        description="Bipe a comanda ou digite o número da mesa. Verde: livre · vermelha: ocupada · roxa: reservada · cinza: bloqueada."
        actions={
          <Button variant="outline" onClick={() => setAbrindo({ mesa: null })}>
            <Plus className="mr-1 size-4" /> Comanda avulsa
          </Button>
        }
      />

      <RestauranteOffline modo="salao" pendencias />
      <ChamadosBar mesas={mesas} />

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
        <div className="ml-auto flex flex-wrap items-center gap-1 text-sm">
          {(
            [
              ["todas", "Todas", "bg-foreground", mesas.length],
              ["livre", "Livre", "bg-emerald-500", contagem.livre],
              ["ocupada", "Ocupada", "bg-red-500", contagem.ocupada],
              ["reservada", "Reservada", "bg-violet-500", contagem.reservada],
              ["bloqueada", "Bloqueada", "bg-slate-400", contagem.bloqueada],
            ] as const
          ).map(([valor, rotulo, cor, qtd]) => (
            <Button
              key={valor}
              type="button"
              size="sm"
              variant={filtroStatus === valor ? "default" : "outline"}
              aria-pressed={filtroStatus === valor}
              onClick={() => setFiltroStatus(valor)}
            >
              <span className={`mr-1.5 size-2.5 rounded-full ${cor}`} /> {rotulo} {qtd}
            </Button>
          ))}
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
        {mesasVisiveis.map((m) => {
          const c = porMesa.get(m.id);
          const r = c ? resumo(c.id) : null;
          const status = situacaoDa(m);
          const proxima = reservasDa(m.id)[0];
          const estilo: Record<StatusMesa, string> = {
            livre: "border-emerald-500 bg-emerald-50",
            ocupada: `border-red-500 bg-red-50 ${r && r.prontos > 0 ? "ring-2 ring-amber-400 ring-offset-1" : ""}`,
            reservada: "border-violet-500 bg-violet-50",
            bloqueada: "border-slate-400 bg-slate-100 text-slate-600",
          };
          return (
            <div key={m.id} className="relative">
              <button
                type="button"
                onClick={() => {
                  if (c) setComandaAberta(c.id);
                  else if (m.bloqueada) setMesaAcoes(m);
                  else setAbrindo({ mesa: m });
                }}
                aria-label={`Mesa ${m.numero}, ${ROTULO_STATUS_MESA[status]}`}
                className={`h-full w-full rounded-xl border-2 p-3 text-left transition hover:shadow-md ${estilo[status]}`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-display text-2xl font-bold">{m.numero}</span>
                  {m.capacidade && (
                    <span className="mr-6 flex items-center gap-1 text-xs text-muted-foreground">
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
                ) : status === "bloqueada" ? (
                  <p className="mt-2 flex items-center gap-1 text-sm font-medium">
                    <Ban className="size-3.5" /> Bloqueada
                    {m.bloqueio_motivo && (
                      <span className="truncate text-xs font-normal">· {m.bloqueio_motivo}</span>
                    )}
                  </p>
                ) : (
                  <div className="mt-2 text-sm">
                    <p
                      className={`font-medium ${status === "reservada" ? "text-violet-700" : "text-emerald-700"}`}
                    >
                      {ROTULO_STATUS_MESA[status]}
                    </p>
                    {proxima && (
                      <p className="flex items-center gap-1 text-xs text-violet-700">
                        <CalendarClock className="size-3" />
                        {new Date(proxima.reservada_para).toLocaleTimeString("pt-BR", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}{" "}
                        · {proxima.nome}
                      </p>
                    )}
                  </div>
                )}
              </button>
              {!c && (
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="absolute right-1 top-1 size-7"
                  aria-label={`Reservar ou bloquear a mesa ${m.numero}`}
                  onClick={() => setMesaAcoes(m)}
                >
                  <MoreVertical className="size-4" />
                </Button>
              )}
            </div>
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
                  <span className="font-display text-xl font-bold">
                    {c.senha ? `Senha ${c.senha}` : `Nº ${c.numero}`}
                  </span>
                  {c.senha && <p className="text-xs text-muted-foreground">Comanda {c.numero}</p>}
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

      <MesaAcoesDialog mesa={mesaAcoes} reservas={reservas} onFechar={() => setMesaAcoes(null)} />

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
