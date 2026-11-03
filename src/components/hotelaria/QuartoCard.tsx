import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { LogIn, LogOut, Printer, Users } from "lucide-react";

import { AcaoDialog, CampoRotulo, CamposDeCaixa } from "@/components/hotelaria/AcaoDialog";
import { CheckinDialog } from "@/components/hotelaria/CheckinDialog";
import { CheckoutDialog } from "@/components/hotelaria/CheckoutDialog";
import { imprimirHtml } from "@/components/hotelaria/imprimir";
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
import { Textarea } from "@/components/ui/textarea";
import { useCaixasHotel } from "@/hooks/useCaixasHotel";
import { filtrarHospedes, useHospedes } from "@/hooks/useHospedes";
import { useSessionData } from "@/hooks/useSessionData";
import { htmlFichaHospedagem } from "@/lib/ficha-hospedagem";
import { brl, dateBR, dateTimeBR } from "@/lib/format";
import { isoBrasilia } from "@/lib/fuso";
import { somarDias, textoNoites, textoPessoas } from "@/lib/hotelaria";
import { hsRpc } from "@/lib/hotelaria-api";
import type {
  FichaHospedagemDados,
  Hotel,
  QuartoDaReserva,
  ReservaResumo,
  UhLivre,
} from "@/lib/hotelaria-tipos";

type Acao =
  | null
  | "alterar"
  | "trocar"
  | "cancelar"
  | "noshow"
  | "estender"
  | "encurtar"
  | "trocarEstadia"
  | "hospedes";

/** Um quarto da reserva com as ações que cabem na situação dele (alterar, trocar, cancelar, check-in/out, estender, encurtar). */
export function QuartoCard({
  hotel,
  quarto,
  resumo,
  gestao,
}: {
  hotel: Hotel;
  quarto: QuartoDaReserva;
  resumo: ReservaResumo;
  gestao: boolean;
}) {
  const qc = useQueryClient();
  const { data: sessao } = useSessionData();
  const caixas = useCaixasHotel(hotel.id);
  const { data: hospedes = [] } = useHospedes();
  const [acao, setAcao] = useState<Acao>(null);
  const [checkin, setCheckin] = useState(false);
  const [checkout, setCheckout] = useState(false);

  // campos compartilhados pelos diálogos
  const [entrada, setEntrada] = useState(quarto.entrada);
  const [saida, setSaida] = useState(quarto.saida);
  const [adultos, setAdultos] = useState(String(quarto.adultos));
  const [criancas, setCriancas] = useState(String(quarto.criancas));
  const [acordado, setAcordado] = useState("");
  const [voltarTarifa, setVoltarTarifa] = useState(false);
  const [novaUh, setNovaUh] = useState("");
  const [manter, setManter] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [valorNovas, setValorNovas] = useState("");
  const [devolverSinal, setDevolverSinal] = useState(true);
  const [cobrarDiaria, setCobrarDiaria] = useState(false);
  const [forma, setForma] = useState("pix");
  const [caixaId, setCaixaId] = useState("");
  const [busca, setBusca] = useState("");
  const [hospedeNovo, setHospedeNovo] = useState("");

  const abrir = (a: Acao) => {
    setEntrada(quarto.entrada);
    setSaida(
      a === "estender"
        ? somarDias(quarto.saida, 1)
        : a === "encurtar"
          ? somarDias(quarto.saida, -1)
          : quarto.saida,
    );
    setAdultos(String(quarto.adultos));
    setCriancas(String(quarto.criancas));
    setAcordado("");
    setVoltarTarifa(false);
    setNovaUh("");
    setManter(false);
    setMotivo("");
    setValorNovas("");
    setDevolverSinal(a === "cancelar");
    setCobrarDiaria(false);
    setBusca("");
    setHospedeNovo("");
    setAcao(a);
  };
  useEffect(() => {
    if (!caixaId && caixas.data?.[0]) setCaixaId(caixas.data[0].id);
  }, [caixas.data, caixaId]);

  const hoje = isoBrasilia();
  const credito = resumo.totais.saldo < 0 ? -resumo.totais.saldo : 0;
  const precisaLivres = acao === "trocar" || acao === "trocarEstadia";
  const livres = useQuery({
    queryKey: ["hotel-uhs-livres", hotel.id, acao, quarto.reserva_uh_id],
    enabled: precisaLivres,
    queryFn: () =>
      hsRpc<UhLivre[]>("hs_uhs_livres", {
        p_filial: hotel.id,
        p_entrada: acao === "trocarEstadia" ? hoje : quarto.entrada,
        p_saida: quarto.saida,
      }),
  });

  function terminou(msg: string) {
    toast.success(msg);
    setAcao(null);
    for (const k of [
      "hotel-reserva",
      "hotel-folio",
      "hotel-painel",
      "hotel-mapa",
      "hotel-reservas",
      "hotel-uhs-livres",
    ])
      void qc.invalidateQueries({ queryKey: [k] });
  }
  const falhou = (e: Error) => toast.error(e.message);
  const num = (v: string) => Number(v.replace(",", "."));

  const alterar = useMutation({
    mutationFn: () =>
      hsRpc("hs_reserva_uh_alterar", {
        p_reserva_uh: quarto.reserva_uh_id,
        p_dados: {
          entrada,
          saida,
          adultos: Number(adultos),
          criancas: Number(criancas),
          ...(gestao && acordado
            ? { valor_acordado_total: num(acordado) }
            : voltarTarifa
              ? { valor_acordado_total: null }
              : {}),
        },
      }),
    onSuccess: () => terminou("Quarto alterado."),
    onError: falhou,
  });
  const trocar = useMutation({
    mutationFn: () =>
      hsRpc("hs_reserva_uh_atribuir", {
        p_reserva_uh: quarto.reserva_uh_id,
        p_uh: novaUh,
        p_manter_preco: manter,
      }),
    onSuccess: () => terminou("Acomodação trocada."),
    onError: falhou,
  });
  const cancelar = useMutation({
    mutationFn: () =>
      hsRpc("hs_reserva_uh_cancelar", {
        p_reserva_uh: quarto.reserva_uh_id,
        p_motivo: motivo,
        p_devolver_sinal: devolverSinal,
        ...(credito > 0 && devolverSinal ? { p_caixa: caixaId, p_forma: forma } : {}),
      }),
    onSuccess: () => terminou("Quarto cancelado."),
    onError: falhou,
  });
  const noShow = useMutation({
    mutationFn: () =>
      hsRpc("hs_reserva_no_show", {
        p_reserva_uh: quarto.reserva_uh_id,
        p_cobrar_diaria: cobrarDiaria,
        p_devolver_sinal: devolverSinal,
        ...(credito > 0 && devolverSinal ? { p_caixa: caixaId, p_forma: forma } : {}),
      }),
    onSuccess: () => terminou("Não comparecimento registrado."),
    onError: falhou,
  });
  const estender = useMutation({
    mutationFn: () =>
      hsRpc("hs_estadia_estender", {
        p_reserva_uh: quarto.reserva_uh_id,
        p_nova_saida: saida,
        ...(gestao && valorNovas ? { p_valor_novas_noites: num(valorNovas) } : {}),
      }),
    onSuccess: () => terminou("Estadia estendida."),
    onError: falhou,
  });
  const encurtar = useMutation({
    mutationFn: () =>
      hsRpc("hs_estadia_encurtar", { p_reserva_uh: quarto.reserva_uh_id, p_nova_saida: saida }),
    onSuccess: () => terminou("Estadia encurtada."),
    onError: falhou,
  });
  const trocarEstadia = useMutation({
    mutationFn: () =>
      hsRpc("hs_estadia_trocar_uh", {
        p_reserva_uh: quarto.reserva_uh_id,
        p_nova_uh: novaUh,
        p_motivo: motivo,
        p_manter_preco: manter,
      }),
    onSuccess: () => terminou("Quarto trocado. A acomodação anterior ficou suja."),
    onError: falhou,
  });
  const adicionar = useMutation({
    mutationFn: () =>
      hsRpc("hs_reserva_hospede_adicionar", {
        p_reserva_uh: quarto.reserva_uh_id,
        p_hospede: hospedeNovo,
      }),
    onSuccess: () => {
      setHospedeNovo("");
      for (const k of ["hotel-reserva", "hotel-painel"])
        void qc.invalidateQueries({ queryKey: [k] });
    },
    onError: falhou,
  });
  const remover = useMutation({
    mutationFn: (id: string) =>
      hsRpc("hs_reserva_hospede_remover", { p_reserva_uh: quarto.reserva_uh_id, p_hospede: id }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["hotel-reserva"] }),
    onError: falhou,
  });
  const ficha = useMutation({
    mutationFn: () =>
      hsRpc<FichaHospedagemDados>("hs_checkin", { p_reserva_uh: quarto.reserva_uh_id }),
    onSuccess: (f) =>
      imprimirHtml(
        htmlFichaHospedagem({
          hotel: hotel.nome,
          empresa: sessao?.empresa?.nome_fantasia || sessao?.empresa?.razao_social || null,
          ficha: f,
        }),
      ),
    onError: falhou,
  });

  const reservada = quarto.situacao === "reservada";
  const hospedada = quarto.situacao === "hospedada";
  const titular = resumo.titular.nome;
  const paraCheckin = {
    reserva_uh_id: quarto.reserva_uh_id,
    reserva_numero: resumo.reserva.numero,
    titular,
    uh: quarto.uh,
    entrada: quarto.entrada,
    saida: quarto.saida,
    adultos: quarto.adultos,
    criancas: quarto.criancas,
  };

  const camposSinal = credito > 0 && (
    <div className="space-y-2 rounded-md border border-border p-3">
      <p className="text-sm">
        Há <strong>{brl(credito)}</strong> recebido de sinal. Se este for o último quarto da
        reserva:
      </p>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={devolverSinal} onCheckedChange={(v) => setDevolverSinal(v === true)} />{" "}
        Devolver o sinal ao hóspede
      </label>
      {!devolverSinal && !gestao && (
        <p className="text-xs text-destructive">Só a gestão pode reter o sinal.</p>
      )}
      {devolverSinal && (
        <CamposDeCaixa
          caixas={caixas.data}
          caixaId={caixaId}
          aoMudarCaixa={setCaixaId}
          forma={forma}
          aoMudarForma={setForma}
        />
      )}
    </div>
  );
  const seletorDeUh = (
    <CampoRotulo id="q-uh" rotulo="Nova acomodação">
      <Select value={novaUh} onValueChange={setNovaUh}>
        <SelectTrigger id="q-uh">
          <SelectValue
            placeholder={livres.isLoading ? "Buscando…" : "Escolha uma acomodação livre"}
          />
        </SelectTrigger>
        <SelectContent>
          {(livres.data ?? [])
            .filter((u) => u.id !== quarto.uh_id)
            .map((u) => (
              <SelectItem key={u.id} value={u.id}>
                {u.numero} — {u.tipo}
                {u.situacao_limpeza === "sujo" ? " (suja)" : ""}
              </SelectItem>
            ))}
        </SelectContent>
      </Select>
    </CampoRotulo>
  );
  const manterPreco = gestao && (
    <label className="flex items-center gap-2 text-sm">
      <Checkbox checked={manter} onCheckedChange={(v) => setManter(v === true)} /> Manter o preço
      combinado se o tipo mudar
    </label>
  );

  return (
    <div className="panel space-y-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-display text-base font-semibold">
            Acomodação {quarto.uh ?? "—"}{" "}
            <span className="text-sm font-normal text-muted-foreground">· {quarto.tipo}</span>
          </p>
          <p className="text-sm text-muted-foreground">
            {dateBR(quarto.entrada)} a {dateBR(quarto.saida)} · {textoNoites(quarto.noites)} ·{" "}
            {textoPessoas(quarto.adultos, quarto.criancas)}
          </p>
          <p className="text-sm">
            Diárias {brl(quarto.diarias.total)} · {quarto.diarias.lancadas} de{" "}
            {quarto.diarias.noites} lançada(s)
            {quarto.valor_acordado_total !== null && (
              <span className="text-muted-foreground"> · valor acordado</span>
            )}
          </p>
          {quarto.checkin_em && (
            <p className="text-xs text-muted-foreground">
              Check-in {dateTimeBR(quarto.checkin_em)}
              {quarto.checkout_em ? ` · check-out ${dateTimeBR(quarto.checkout_em)}` : ""}
            </p>
          )}
        </div>
        <SituacaoBadge situacao={quarto.situacao} quarto />
      </div>

      {quarto.hospedes.length > 0 && (
        <p className="text-sm">
          <Users className="mr-1 inline size-4 text-muted-foreground" />
          {quarto.hospedes.map((h) => h.nome).join(", ")}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {reservada && (
          <>
            <Button
              size="sm"
              onClick={() => setCheckin(true)}
              disabled={!quarto.uh || resumo.reserva.situacao === "pendente"}
              title={
                resumo.reserva.situacao === "pendente" ? "Confirme a reserva antes" : undefined
              }
            >
              <LogIn className="size-4" /> Check-in
            </Button>
            <Button size="sm" variant="outline" onClick={() => abrir("alterar")}>
              Alterar
            </Button>
            <Button size="sm" variant="outline" onClick={() => abrir("trocar")}>
              Trocar acomodação
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => abrir("noshow")}
              disabled={quarto.entrada > hoje}
            >
              Não compareceu
            </Button>
            <Button size="sm" variant="outline" onClick={() => abrir("cancelar")}>
              Cancelar quarto
            </Button>
          </>
        )}
        {hospedada && (
          <>
            <Button size="sm" onClick={() => setCheckout(true)}>
              <LogOut className="size-4" /> Check-out
            </Button>
            <Button size="sm" variant="outline" onClick={() => abrir("estender")}>
              Estender
            </Button>
            <Button size="sm" variant="outline" onClick={() => abrir("encurtar")}>
              Encurtar
            </Button>
            <Button size="sm" variant="outline" onClick={() => abrir("trocarEstadia")}>
              Trocar de quarto
            </Button>
            <Button size="sm" variant="outline" onClick={() => abrir("hospedes")}>
              Hóspedes
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => ficha.mutate()}
              disabled={ficha.isPending}
            >
              <Printer className="size-4" /> Ficha
            </Button>
          </>
        )}
      </div>

      <CheckinDialog
        hotel={hotel}
        quarto={checkin ? paraCheckin : null}
        onFechar={() => setCheckin(false)}
      />
      <CheckoutDialog
        hotel={hotel}
        quarto={
          checkout
            ? {
                reserva_uh_id: quarto.reserva_uh_id,
                reserva_id: resumo.reserva.id,
                reserva_numero: resumo.reserva.numero,
                titular,
                uh: quarto.uh,
              }
            : null
        }
        onFechar={() => setCheckout(false)}
      />

      <AcaoDialog
        titulo="Alterar o quarto"
        descricao="Mudar só as datas mantém o preço das noites que continuam; mudar as pessoas recota todas."
        aberto={acao === "alterar"}
        onFechar={() => setAcao(null)}
        rotulo="Salvar"
        pendente={alterar.isPending}
        aoConfirmar={() => alterar.mutate()}
      >
        <div className="grid grid-cols-2 gap-2">
          <CampoRotulo id="a-entrada" rotulo="Entrada">
            <Input
              id="a-entrada"
              type="date"
              value={entrada}
              onChange={(e) => setEntrada(e.target.value)}
            />
          </CampoRotulo>
          <CampoRotulo id="a-saida" rotulo="Saída">
            <Input
              id="a-saida"
              type="date"
              value={saida}
              onChange={(e) => setSaida(e.target.value)}
            />
          </CampoRotulo>
          <CampoRotulo id="a-adultos" rotulo="Adultos">
            <Input
              id="a-adultos"
              inputMode="numeric"
              value={adultos}
              onChange={(e) => setAdultos(e.target.value)}
            />
          </CampoRotulo>
          <CampoRotulo id="a-criancas" rotulo="Crianças">
            <Input
              id="a-criancas"
              inputMode="numeric"
              value={criancas}
              onChange={(e) => setCriancas(e.target.value)}
            />
          </CampoRotulo>
        </div>
        {gestao && (
          <>
            <CampoRotulo id="a-acordo" rotulo="Valor acordado para a estadia (gestão)">
              <Input
                id="a-acordo"
                inputMode="decimal"
                value={acordado}
                onChange={(e) => setAcordado(e.target.value)}
              />
            </CampoRotulo>
            {quarto.valor_acordado_total !== null && (
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={voltarTarifa}
                  onCheckedChange={(v) => setVoltarTarifa(v === true)}
                />{" "}
                Voltar para o preço da tarifa
              </label>
            )}
          </>
        )}
      </AcaoDialog>

      <AcaoDialog
        titulo="Trocar a acomodação"
        aberto={acao === "trocar"}
        onFechar={() => setAcao(null)}
        rotulo="Trocar"
        desabilitado={!novaUh}
        pendente={trocar.isPending}
        aoConfirmar={() => trocar.mutate()}
      >
        {seletorDeUh}
        {manterPreco}
      </AcaoDialog>

      <AcaoDialog
        titulo="Cancelar o quarto"
        aberto={acao === "cancelar"}
        onFechar={() => setAcao(null)}
        rotulo="Cancelar quarto"
        perigo
        pendente={cancelar.isPending}
        aoConfirmar={() => cancelar.mutate()}
      >
        <CampoRotulo id="c-motivo" rotulo="Motivo">
          <Textarea
            id="c-motivo"
            rows={2}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
          />
        </CampoRotulo>
        {camposSinal}
      </AcaoDialog>

      <AcaoDialog
        titulo="Não compareceu"
        descricao="O hóspede não chegou. A acomodação volta para o calendário."
        aberto={acao === "noshow"}
        onFechar={() => setAcao(null)}
        rotulo="Registrar"
        perigo
        pendente={noShow.isPending}
        aoConfirmar={() => noShow.mutate()}
      >
        {gestao && (
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={cobrarDiaria} onCheckedChange={(v) => setCobrarDiaria(v === true)} />{" "}
            Cobrar a primeira diária
          </label>
        )}
        {camposSinal}
      </AcaoDialog>

      <AcaoDialog
        titulo="Estender a estadia"
        descricao={`Saída atual: ${dateBR(quarto.saida)}`}
        aberto={acao === "estender"}
        onFechar={() => setAcao(null)}
        rotulo="Estender"
        pendente={estender.isPending}
        aoConfirmar={() => estender.mutate()}
      >
        <CampoRotulo id="e-saida" rotulo="Nova saída">
          <Input
            id="e-saida"
            type="date"
            value={saida}
            onChange={(e) => setSaida(e.target.value)}
          />
        </CampoRotulo>
        {gestao && (
          <CampoRotulo
            id="e-valor"
            rotulo="Valor combinado para as noites novas (gestão, opcional)"
          >
            <Input
              id="e-valor"
              inputMode="decimal"
              value={valorNovas}
              onChange={(e) => setValorNovas(e.target.value)}
            />
          </CampoRotulo>
        )}
      </AcaoDialog>

      <AcaoDialog
        titulo="Encurtar a estadia"
        descricao="Nenhuma noite cortada pode estar lançada na conta."
        aberto={acao === "encurtar"}
        onFechar={() => setAcao(null)}
        rotulo="Encurtar"
        pendente={encurtar.isPending}
        aoConfirmar={() => encurtar.mutate()}
      >
        <CampoRotulo id="en-saida" rotulo="Nova saída">
          <Input
            id="en-saida"
            type="date"
            value={saida}
            onChange={(e) => setSaida(e.target.value)}
          />
        </CampoRotulo>
      </AcaoDialog>

      <AcaoDialog
        titulo="Trocar de quarto"
        descricao="A troca vale a partir de hoje. A acomodação anterior fica suja."
        aberto={acao === "trocarEstadia"}
        onFechar={() => setAcao(null)}
        rotulo="Trocar"
        desabilitado={!novaUh || motivo.trim().length < 3}
        pendente={trocarEstadia.isPending}
        aoConfirmar={() => trocarEstadia.mutate()}
      >
        {seletorDeUh}
        <CampoRotulo id="te-motivo" rotulo="Motivo da troca">
          <Input id="te-motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
        </CampoRotulo>
        {manterPreco}
      </AcaoDialog>

      <AcaoDialog
        titulo="Hóspedes do quarto"
        aberto={acao === "hospedes"}
        onFechar={() => setAcao(null)}
        rotulo="Concluir"
        aoConfirmar={() => setAcao(null)}
      >
        <ul className="space-y-1 text-sm">
          {quarto.hospedes.map((h) => (
            <li key={h.hospede_id} className="flex items-center justify-between">
              <span>
                {h.nome}{" "}
                {h.principal && <span className="text-xs text-muted-foreground">(titular)</span>}
              </span>
              {!h.principal && (
                <Button size="sm" variant="ghost" onClick={() => remover.mutate(h.hospede_id)}>
                  Tirar
                </Button>
              )}
            </li>
          ))}
        </ul>
        <div className="space-y-2">
          <Input
            aria-label="Buscar hóspede"
            placeholder="Buscar para adicionar"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
          <div className="flex gap-2">
            <Select value={hospedeNovo} onValueChange={setHospedeNovo}>
              <SelectTrigger aria-label="Hóspede a adicionar">
                <SelectValue placeholder="Escolha" />
              </SelectTrigger>
              <SelectContent>
                {filtrarHospedes(hospedes, busca)
                  .slice(0, 30)
                  .map((h) => (
                    <SelectItem key={h.id} value={h.id}>
                      {h.nome}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <Button
              onClick={() => adicionar.mutate()}
              disabled={!hospedeNovo || adicionar.isPending}
            >
              Adicionar
            </Button>
          </div>
        </div>
      </AcaoDialog>
    </div>
  );
}
