import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRightLeft, Banknote, Plus, Undo2 } from "lucide-react";
import { toast } from "sonner";

import { AcaoDialog, CampoRotulo, CamposDeCaixa } from "@/components/hotelaria/AcaoDialog";
import { Badge } from "@/components/ui/badge";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useCaixasHotel } from "@/hooks/useCaixasHotel";
import { brl, dateBR } from "@/lib/format";
import { labelForma } from "@/lib/financeiro";
import { rotuloLancamento } from "@/lib/hotelaria";
import { hsRpc } from "@/lib/hotelaria-api";
import type { FolioResumo, Hotel, ReservaResumo } from "@/lib/hotelaria-tipos";
import { cn } from "@/lib/utils";

type Acao = null | "lancar" | "receber" | "devolver" | "transferir" | "estornar";

/** Uma conta do hóspede: lançamentos (com estorno e transferência), pagamentos, saldo e a nota de serviço. */
export function ContaPanel({
  hotel,
  folioId,
  resumo,
  gestao,
}: {
  hotel: Hotel;
  folioId: string;
  resumo: ReservaResumo;
  gestao: boolean;
}) {
  const qc = useQueryClient();
  const folio = useQuery({
    queryKey: ["hotel-folio", folioId],
    queryFn: () => hsRpc<FolioResumo>("hs_folio_resumo", { p_folio: folioId }),
  });
  const caixas = useCaixasHotel(hotel.id);
  const [acao, setAcao] = useState<Acao>(null);
  const [selecionados, setSelecionados] = useState<string[]>([]);
  const [alvo, setAlvo] = useState<string | null>(null);

  // lançamento
  const [tipo, setTipo] = useState("consumo");
  const [descricao, setDescricao] = useState("");
  const [quantidade, setQuantidade] = useState("1");
  const [valor, setValor] = useState("");
  // pagamento
  const [tipoPag, setTipoPag] = useState("pagamento");
  const [forma, setForma] = useState("pix");
  const [caixaId, setCaixaId] = useState("");
  // estorno
  const [motivo, setMotivo] = useState("");
  const [destino, setDestino] = useState("");

  useEffect(() => {
    if (!caixaId && caixas.data?.[0]) setCaixaId(caixas.data[0].id);
  }, [caixas.data, caixaId]);
  useEffect(() => setSelecionados([]), [folioId]);

  const f = folio.data;
  const aberta = f?.folio.situacao === "aberto";
  const outras = resumo.contas.filter((c) => c.id !== folioId && c.situacao === "aberto");

  function terminou(mensagem: string) {
    toast.success(mensagem);
    setAcao(null);
    setMotivo("");
    setDescricao("");
    setValor("");
    setQuantidade("1");
    setSelecionados([]);
    for (const k of ["hotel-folio", "hotel-reserva", "hotel-painel", "hotel-reservas"])
      void qc.invalidateQueries({ queryKey: [k] });
  }

  const lancar = useMutation({
    mutationFn: () =>
      hsRpc("hs_lancar", {
        p_folio: folioId,
        p_dados: {
          tipo,
          descricao,
          quantidade: Number(quantidade.replace(",", ".")),
          valor_unitario: Number(valor.replace(",", ".")),
        },
      }),
    onSuccess: () => terminou("Lançamento feito."),
    onError: (e: Error) => toast.error(e.message),
  });
  const pagar = useMutation({
    mutationFn: () =>
      hsRpc("hs_pagamento_registrar", {
        p_folio: folioId,
        p_forma: forma,
        p_valor: Number(valor.replace(",", ".")),
        p_caixa: caixaId,
        p_tipo: tipoPag,
        p_chave: crypto.randomUUID(),
      }),
    onSuccess: () =>
      terminou(tipoPag === "devolucao" ? "Devolução registrada." : "Pagamento registrado."),
    onError: (e: Error) => toast.error(e.message),
  });
  const estornar = useMutation({
    mutationFn: () => hsRpc("hs_lancamento_estornar", { p_id: alvo, p_motivo: motivo }),
    onSuccess: () => terminou("Lançamento estornado."),
    onError: (e: Error) => toast.error(e.message),
  });
  const transferir = useMutation({
    mutationFn: () =>
      hsRpc("hs_lancamento_transferir", { p_ids: selecionados, p_folio_destino: destino }),
    onSuccess: () => terminou("Lançamentos transferidos."),
    onError: (e: Error) => toast.error(e.message),
  });

  if (folio.isLoading || !f) return <div className="panel h-40 animate-pulse" />;
  if (folio.error)
    return <p className="text-sm text-destructive">{(folio.error as Error).message}</p>;

  const abrir = (a: Acao, t?: string) => {
    if (t) setTipoPag(t);
    setValor("");
    setAcao(a);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="font-display text-base font-semibold">{f.folio.titulo}</h3>
          <Badge variant={aberta ? "outline" : "secondary"}>{aberta ? "Aberta" : "Fechada"}</Badge>
        </div>
        {aberta && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => abrir("lancar")}>
              <Plus className="size-4" /> Lançar
            </Button>
            <Button
              size="sm"
              onClick={() =>
                abrir("receber", resumo.reserva.situacao === "hospedada" ? "pagamento" : "sinal")
              }
            >
              <Banknote className="size-4" /> Receber
            </Button>
            {gestao && (
              <Button size="sm" variant="outline" onClick={() => abrir("devolver", "devolucao")}>
                <Undo2 className="size-4" /> Devolver
              </Button>
            )}
            {outras.length > 0 && selecionados.length > 0 && (
              <Button size="sm" variant="outline" onClick={() => setAcao("transferir")}>
                <ArrowRightLeft className="size-4" /> Transferir ({selecionados.length})
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="panel overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              {aberta && outras.length > 0 && <TableHead className="w-8" />}
              <TableHead>Dia</TableHead>
              <TableHead>Descrição</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead className="text-right">Valor</TableHead>
              <TableHead className="w-24 text-right" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {f.lancamentos.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                  Nada lançado ainda. As diárias entram ao fechar o dia.
                </TableCell>
              </TableRow>
            )}
            {f.lancamentos.map((l) => (
              <TableRow
                key={l.id}
                className={cn(l.estornado && "text-muted-foreground line-through")}
              >
                {aberta && outras.length > 0 && (
                  <TableCell>
                    {!l.estorna_id && (
                      <Checkbox
                        aria-label="Escolher para transferir"
                        checked={selecionados.includes(l.id)}
                        onCheckedChange={() =>
                          setSelecionados((s) =>
                            s.includes(l.id) ? s.filter((x) => x !== l.id) : [...s, l.id],
                          )
                        }
                      />
                    )}
                  </TableCell>
                )}
                <TableCell className="whitespace-nowrap">{dateBR(l.data_competencia)}</TableCell>
                <TableCell>
                  {l.descricao}
                  {l.motivo && (
                    <span className="block text-xs text-muted-foreground no-underline">
                      {l.motivo}
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{rotuloLancamento(l.tipo)}</Badge>
                </TableCell>
                <TableCell className="text-right">{brl(l.total)}</TableCell>
                <TableCell className="text-right">
                  {aberta &&
                    !l.estornado &&
                    !l.estorna_id &&
                    (l.tipo === "consumo" || l.tipo === "servico" || gestao) && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setAlvo(l.id);
                          setMotivo("");
                          setAcao("estornar");
                        }}
                      >
                        Estornar
                      </Button>
                    )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {f.pagamentos.length > 0 && (
        <div className="panel p-3 text-sm">
          <p className="mb-1 font-medium">Pagamentos</p>
          <ul className="space-y-1">
            {f.pagamentos.map((p) => (
              <li key={p.id} className="flex justify-between">
                <span>
                  {p.tipo === "sinal"
                    ? "Sinal"
                    : p.tipo === "devolucao"
                      ? "Devolução"
                      : "Pagamento"}{" "}
                  · {labelForma(p.forma)}
                </span>
                <span className={p.tipo === "devolucao" ? "text-destructive" : ""}>
                  {p.tipo === "devolucao" ? "−" : ""}
                  {brl(p.valor)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <Total rotulo="Lançado" valor={f.totais.lancado} />
        <Total rotulo="Recebido" valor={f.totais.recebido - f.totais.devolvido} />
        <Total
          rotulo={f.totais.saldo < 0 ? "Crédito do hóspede" : "Saldo a receber"}
          valor={Math.abs(f.totais.saldo)}
          destaque
        />
      </div>

      {f.nota && (
        <div className="panel p-3 text-sm">
          <p className="font-medium">
            NFS-e de hospedagem {f.nota.numero ? `nº ${f.nota.numero}` : ""} ·{" "}
            {f.nota.situacao === "pronta" ? "pronta para transmitir" : "rascunho"} ·{" "}
            {brl(f.nota.valor_total)}
          </p>
          {f.nota.pendencias && f.nota.pendencias.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-xs text-muted-foreground">
              {f.nota.pendencias.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <AcaoDialog
        titulo="Lançar na conta"
        aberto={acao === "lancar"}
        onFechar={() => setAcao(null)}
        rotulo="Lançar"
        pendente={lancar.isPending}
        aoConfirmar={() => lancar.mutate()}
      >
        <CampoRotulo id="l-tipo" rotulo="Tipo">
          <Select value={tipo} onValueChange={setTipo}>
            <SelectTrigger id="l-tipo">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="consumo">Consumo (frigobar, loja)</SelectItem>
              <SelectItem value="servico">Serviço (lavanderia, transfer)</SelectItem>
              {gestao && <SelectItem value="ajuste">Ajuste ou desconto (gestão)</SelectItem>}
            </SelectContent>
          </Select>
        </CampoRotulo>
        <CampoRotulo id="l-desc" rotulo="Descrição">
          <Input id="l-desc" value={descricao} onChange={(e) => setDescricao(e.target.value)} />
        </CampoRotulo>
        <div className="grid grid-cols-2 gap-2">
          <CampoRotulo id="l-qtd" rotulo="Quantidade">
            <Input
              id="l-qtd"
              inputMode="decimal"
              value={quantidade}
              onChange={(e) => setQuantidade(e.target.value)}
            />
          </CampoRotulo>
          <CampoRotulo
            id="l-valor"
            rotulo={tipo === "ajuste" ? "Valor (negativo = desconto)" : "Valor unitário"}
          >
            <Input
              id="l-valor"
              inputMode="decimal"
              value={valor}
              onChange={(e) => setValor(e.target.value)}
            />
          </CampoRotulo>
        </div>
      </AcaoDialog>

      <AcaoDialog
        titulo={
          tipoPag === "devolucao"
            ? "Devolver dinheiro"
            : tipoPag === "sinal"
              ? "Receber sinal"
              : "Receber pagamento"
        }
        descricao={
          tipoPag === "pagamento"
            ? `Saldo a receber: ${brl(Math.max(f.totais.saldo, 0))}`
            : undefined
        }
        aberto={acao === "receber" || acao === "devolver"}
        onFechar={() => setAcao(null)}
        rotulo="Confirmar"
        pendente={pagar.isPending}
        desabilitado={!caixaId}
        aoConfirmar={() => pagar.mutate()}
      >
        {acao === "receber" && (
          <CampoRotulo id="p-tipo" rotulo="Tipo">
            <Select value={tipoPag} onValueChange={setTipoPag}>
              <SelectTrigger id="p-tipo">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sinal">Sinal (antes da estadia)</SelectItem>
                <SelectItem value="pagamento">Pagamento</SelectItem>
              </SelectContent>
            </Select>
          </CampoRotulo>
        )}
        <CampoRotulo id="p-valor" rotulo="Valor">
          <Input
            id="p-valor"
            inputMode="decimal"
            value={valor}
            onChange={(e) => setValor(e.target.value)}
          />
        </CampoRotulo>
        <CamposDeCaixa
          caixas={caixas.data}
          caixaId={caixaId}
          aoMudarCaixa={setCaixaId}
          forma={forma}
          aoMudarForma={setForma}
        />
      </AcaoDialog>

      <AcaoDialog
        titulo="Estornar lançamento"
        descricao="O lançamento original não muda: o estorno grava uma linha de sinal oposto."
        aberto={acao === "estornar"}
        onFechar={() => setAcao(null)}
        rotulo="Estornar"
        perigo
        pendente={estornar.isPending}
        aoConfirmar={() => estornar.mutate()}
      >
        <CampoRotulo id="e-motivo" rotulo="Motivo">
          <Textarea
            id="e-motivo"
            rows={2}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
          />
        </CampoRotulo>
      </AcaoDialog>

      <AcaoDialog
        titulo="Transferir para outra conta"
        descricao={`${selecionados.length} lançamento(s) escolhido(s).`}
        aberto={acao === "transferir"}
        onFechar={() => setAcao(null)}
        rotulo="Transferir"
        desabilitado={!destino}
        pendente={transferir.isPending}
        aoConfirmar={() => transferir.mutate()}
      >
        <CampoRotulo id="t-destino" rotulo="Conta de destino">
          <Select value={destino} onValueChange={setDestino}>
            <SelectTrigger id="t-destino">
              <SelectValue placeholder="Escolha a conta" />
            </SelectTrigger>
            <SelectContent>
              {outras.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.titulo}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CampoRotulo>
      </AcaoDialog>
    </div>
  );
}

function Total({
  rotulo,
  valor,
  destaque = false,
}: {
  rotulo: string;
  valor: number;
  destaque?: boolean;
}) {
  return (
    <div className={cn("rounded-md border border-border p-3", destaque && "bg-secondary")}>
      <p className="text-xs text-muted-foreground">{rotulo}</p>
      <p className="font-display text-lg font-bold">{brl(valor)}</p>
    </div>
  );
}
