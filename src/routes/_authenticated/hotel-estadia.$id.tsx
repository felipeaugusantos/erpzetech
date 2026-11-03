import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Plus } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/app/PageHeader";
import { AcaoDialog, CampoRotulo, CamposDeCaixa } from "@/components/hotelaria/AcaoDialog";
import { ContaPanel } from "@/components/hotelaria/ContaPanel";
import { ModuloHotelaria } from "@/components/hotelaria/ModuloHotelaria";
import { QuartoCard } from "@/components/hotelaria/QuartoCard";
import { SituacaoBadge } from "@/components/hotelaria/SituacaoBadge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useCaixasHotel } from "@/hooks/useCaixasHotel";
import { useHotel } from "@/hooks/useHotel";
import { filtrarHospedes, useHospedes } from "@/hooks/useHospedes";
import { useSessionData } from "@/hooks/useSessionData";
import { brl, dateTimeBR } from "@/lib/format";
import { ORIGENS_RESERVA, rotuloOrigem } from "@/lib/hotelaria";
import { hsRpc } from "@/lib/hotelaria-api";
import type { Hotel, ReservaResumo } from "@/lib/hotelaria-tipos";

export const Route = createFileRoute("/_authenticated/hotel-estadia/$id")({
  head: () => ({
    meta: [
      { title: "Reserva e conta do hóspede — EZRA ERP" },
      {
        name: "description",
        content:
          "Quartos da reserva, check-in e check-out, conta do hóspede, pagamentos e nota fiscal de serviço.",
      },
    ],
  }),
  component: () => <ModuloHotelaria>{(hotel) => <Estadia hotel={hotel} />}</ModuloHotelaria>,
});

function Estadia({ hotel: escolhido }: { hotel: Hotel }) {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const { hoteis } = useHotel();
  const { data: sessao } = useSessionData();
  const gestao = (sessao?.roles ?? []).some((r) => r === "administrador" || r === "gestor");
  const { data: hospedes = [] } = useHospedes();

  const q = useQuery({
    queryKey: ["hotel-reserva", id],
    queryFn: () => hsRpc<ReservaResumo>("hs_reserva_resumo", { p_reserva: id }),
  });
  const r = q.data;
  const hotel = hoteis.find((h) => h.id === r?.reserva.filial_id) ?? escolhido;
  const caixas = useCaixasHotel(hotel.id);

  const [conta, setConta] = useState("");
  const [dialogo, setDialogo] = useState<null | "dados" | "cancelar" | "conta">(null);
  const [titularId, setTitularId] = useState("");
  const [busca, setBusca] = useState("");
  const [origem, setOrigem] = useState("balcao");
  const [observacoes, setObservacoes] = useState("");
  const [motivo, setMotivo] = useState("");
  const [devolver, setDevolver] = useState(true);
  const [forma, setForma] = useState("pix");
  const [caixaId, setCaixaId] = useState("");
  const [tituloConta, setTituloConta] = useState("");

  useEffect(() => {
    if (r && !r.contas.some((c) => c.id === conta)) setConta(r.contas[0]?.id ?? "");
  }, [r, conta]);
  useEffect(() => {
    if (!caixaId && caixas.data?.[0]) setCaixaId(caixas.data[0].id);
  }, [caixas.data, caixaId]);

  const credito = r && r.totais.saldo < 0 ? -r.totais.saldo : 0;
  const atualizar = () => {
    for (const k of [
      "hotel-reserva",
      "hotel-folio",
      "hotel-painel",
      "hotel-mapa",
      "hotel-reservas",
    ])
      void qc.invalidateQueries({ queryKey: [k] });
  };

  const abrirDados = () => {
    if (!r) return;
    setTitularId(r.titular.id);
    setBusca("");
    setOrigem(r.reserva.origem);
    setObservacoes(r.reserva.observacoes ?? "");
    setDialogo("dados");
  };

  const salvarDados = useMutation({
    mutationFn: () =>
      hsRpc("hs_reserva_alterar", {
        p_id: id,
        p_dados: { titular_id: titularId, origem, observacoes },
      }),
    onSuccess: () => {
      toast.success("Dados da reserva atualizados.");
      setDialogo(null);
      atualizar();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const confirmar = useMutation({
    mutationFn: () => hsRpc("hs_reserva_confirmar", { p_id: id }),
    onSuccess: () => {
      toast.success("Reserva confirmada.");
      atualizar();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const cancelar = useMutation({
    mutationFn: () =>
      hsRpc("hs_reserva_cancelar", {
        p_id: id,
        p_motivo: motivo,
        p_devolver_sinal: devolver,
        ...(credito > 0 && devolver ? { p_caixa: caixaId, p_forma: forma } : {}),
      }),
    onSuccess: () => {
      toast.success("Reserva cancelada.");
      setDialogo(null);
      atualizar();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const novaConta = useMutation({
    mutationFn: () => hsRpc<string>("hs_folio_abrir", { p_reserva: id, p_titulo: tituloConta }),
    onSuccess: (nova) => {
      toast.success("Conta aberta.");
      setDialogo(null);
      setTituloConta("");
      setConta(nova);
      atualizar();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const abrirContaPrincipal = useMutation({
    mutationFn: () => hsRpc<string>("hs_folio_principal", { p_reserva: id }),
    onSuccess: (nova) => {
      setConta(nova);
      atualizar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (q.isLoading) return <div className="panel h-48 animate-pulse" />;
  if (q.error || !r)
    return (
      <p className="text-sm text-destructive">
        {(q.error as Error | null)?.message ?? "Reserva não encontrada."}
      </p>
    );

  const encerrada = ["cancelada", "no_show", "finalizada"].includes(r.reserva.situacao);
  const podeCancelar =
    !r.quartos.some((x) => x.situacao === "hospedada" || x.situacao === "finalizada") &&
    !["cancelada", "no_show"].includes(r.reserva.situacao);

  return (
    <div>
      <Link
        to="/hotel-reservas"
        className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Reservas
      </Link>
      <PageHeader
        title={`Reserva ${r.reserva.numero}`}
        description={`${r.titular.nome} · ${hotel.nome}`}
        actions={
          <>
            <SituacaoBadge situacao={r.reserva.situacao} />
            {r.reserva.situacao === "pendente" && (
              <Button size="sm" onClick={() => confirmar.mutate()} disabled={confirmar.isPending}>
                Confirmar reserva
              </Button>
            )}
            {!encerrada && (
              <Button size="sm" variant="outline" onClick={abrirDados}>
                Editar dados
              </Button>
            )}
            {podeCancelar && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setMotivo("");
                  setDevolver(true);
                  setDialogo("cancelar");
                }}
              >
                Cancelar reserva
              </Button>
            )}
          </>
        }
      />

      <div className="mb-4 grid gap-3 text-sm sm:grid-cols-3">
        <div className="panel p-3">
          <p className="text-xs text-muted-foreground">Titular</p>
          <p className="font-medium">{r.titular.nome}</p>
          <p className="text-xs text-muted-foreground">
            {[r.titular.documento_numero, r.titular.telefone, r.titular.email]
              .filter(Boolean)
              .join(" · ") || "Sem contato cadastrado"}
          </p>
        </div>
        <div className="panel p-3">
          <p className="text-xs text-muted-foreground">Origem · criada em</p>
          <p className="font-medium">
            {rotuloOrigem(r.reserva.origem)} · {dateTimeBR(r.reserva.criada_em)}
          </p>
          {r.reserva.observacoes && (
            <p className="text-xs text-muted-foreground">{r.reserva.observacoes}</p>
          )}
        </div>
        <div className="panel p-3">
          <p className="text-xs text-muted-foreground">Valores</p>
          <p className="font-medium">
            Diárias {brl(r.totais.diarias)} ·{" "}
            {r.totais.saldo < 0
              ? `crédito ${brl(-r.totais.saldo)}`
              : `saldo ${brl(r.totais.saldo)}`}
          </p>
          {r.totais.sinal_liquido > 0 && (
            <p className="text-xs text-muted-foreground">Sinal {brl(r.totais.sinal_liquido)}</p>
          )}
        </div>
      </div>
      {r.reserva.motivo_cancelamento && (
        <p className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm">
          Motivo do cancelamento: {r.reserva.motivo_cancelamento}
        </p>
      )}

      <h2 className="mb-2 font-display text-lg font-semibold">Quartos</h2>
      <div className="mb-6 grid gap-3 lg:grid-cols-2">
        {r.quartos.map((qt) => (
          <QuartoCard key={qt.reserva_uh_id} hotel={hotel} quarto={qt} resumo={r} gestao={gestao} />
        ))}
      </div>

      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-lg font-semibold">Conta do hóspede</h2>
        {!encerrada && r.contas.length > 0 && (
          <Button size="sm" variant="outline" onClick={() => setDialogo("conta")}>
            <Plus className="size-4" /> Nova conta
          </Button>
        )}
      </div>
      {r.contas.length === 0 ? (
        <div className="panel p-4 text-sm">
          <p className="mb-2 text-muted-foreground">
            A conta é aberta no primeiro sinal ou no check-in.
          </p>
          {!encerrada && (
            <Button
              size="sm"
              onClick={() => abrirContaPrincipal.mutate()}
              disabled={abrirContaPrincipal.isPending}
            >
              Abrir a conta agora
            </Button>
          )}
        </div>
      ) : (
        <>
          {r.contas.length > 1 && (
            <Tabs value={conta} onValueChange={setConta} className="mb-3">
              <TabsList>
                {r.contas.map((c) => (
                  <TabsTrigger key={c.id} value={c.id}>
                    {c.titulo}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          )}
          {conta && <ContaPanel hotel={hotel} folioId={conta} resumo={r} gestao={gestao} />}
        </>
      )}

      <AcaoDialog
        titulo="Editar dados da reserva"
        aberto={dialogo === "dados"}
        onFechar={() => setDialogo(null)}
        rotulo="Salvar"
        pendente={salvarDados.isPending}
        aoConfirmar={() => salvarDados.mutate()}
      >
        <CampoRotulo id="d-busca" rotulo="Titular">
          <Input
            id="d-busca"
            placeholder="Buscar hóspede"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="mb-2"
          />
          <Select value={titularId} onValueChange={setTitularId}>
            <SelectTrigger aria-label="Titular">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[
                ...(titularId === r.titular.id &&
                !filtrarHospedes(hospedes, busca).some((h) => h.id === r.titular.id)
                  ? [{ id: r.titular.id, nome: r.titular.nome }]
                  : []),
                ...filtrarHospedes(hospedes, busca).slice(0, 30),
              ].map((h) => (
                <SelectItem key={h.id} value={h.id}>
                  {h.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CampoRotulo>
        <CampoRotulo id="d-origem" rotulo="Origem">
          <Select value={origem} onValueChange={setOrigem}>
            <SelectTrigger id="d-origem">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ORIGENS_RESERVA.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CampoRotulo>
        <CampoRotulo id="d-obs" rotulo="Observações">
          <Textarea
            id="d-obs"
            rows={3}
            value={observacoes}
            onChange={(e) => setObservacoes(e.target.value)}
          />
        </CampoRotulo>
      </AcaoDialog>

      <AcaoDialog
        titulo="Cancelar a reserva"
        descricao="Libera as acomodações no calendário."
        aberto={dialogo === "cancelar"}
        onFechar={() => setDialogo(null)}
        rotulo="Cancelar reserva"
        perigo
        pendente={cancelar.isPending}
        aoConfirmar={() => cancelar.mutate()}
      >
        <CampoRotulo id="cr-motivo" rotulo="Motivo">
          <Textarea
            id="cr-motivo"
            rows={2}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
          />
        </CampoRotulo>
        {credito > 0 && (
          <div className="space-y-2 rounded-md border border-border p-3">
            <p className="text-sm">
              Há <strong>{brl(credito)}</strong> recebido de sinal.
            </p>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={devolver} onCheckedChange={(v) => setDevolver(v === true)} />{" "}
              Devolver o sinal ao hóspede
            </label>
            {!devolver && !gestao && (
              <p className="text-xs text-destructive">Só a gestão pode reter o sinal.</p>
            )}
            {devolver && (
              <CamposDeCaixa
                caixas={caixas.data}
                caixaId={caixaId}
                aoMudarCaixa={setCaixaId}
                forma={forma}
                aoMudarForma={setForma}
              />
            )}
          </div>
        )}
      </AcaoDialog>

      <AcaoDialog
        titulo="Nova conta"
        descricao="Ex.: a empresa paga as diárias e o hóspede paga o resto. Depois, transfira os lançamentos para ela."
        aberto={dialogo === "conta"}
        onFechar={() => setDialogo(null)}
        rotulo="Abrir conta"
        desabilitado={!tituloConta.trim()}
        pendente={novaConta.isPending}
        aoConfirmar={() => novaConta.mutate()}
      >
        <CampoRotulo id="nc-titulo" rotulo="Nome da conta">
          <Input
            id="nc-titulo"
            value={tituloConta}
            onChange={(e) => setTituloConta(e.target.value)}
          />
        </CampoRotulo>
      </AcaoDialog>
    </div>
  );
}
