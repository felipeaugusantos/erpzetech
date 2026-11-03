import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { HospedeDialog } from "@/components/hotelaria/HospedeDialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { filtrarHospedes, useHospedes } from "@/hooks/useHospedes";
import { useSessionData } from "@/hooks/useSessionData";
import { brl } from "@/lib/format";
import { isoBrasilia } from "@/lib/fuso";
import { ORIGENS_RESERVA, diasEntre, somarDias, textoNoites } from "@/lib/hotelaria";
import { hsDb, hsRpc, linhas } from "@/lib/hotelaria-api";
import type { CotacaoResposta, Hotel, HsTipoUh, UhLivre } from "@/lib/hotelaria-tipos";

type Quarto = { chave: number; uhId: string; adultos: string; criancas: string; acordado: string };
export type InicialReserva = { uhId?: string; entrada?: string; saida?: string };

let contador = 0;
const novoQuarto = (uhId = ""): Quarto => ({
  chave: ++contador,
  uhId,
  adultos: "2",
  criancas: "0",
  acordado: "",
});

/** Nova reserva do balcão: titular, datas, um ou mais quartos (acomodação escolhida na hora, com preço calculado pela tarifa) e observações. */
export function NovaReservaDialog({
  hotel,
  aberto,
  onFechar,
  inicial,
  aoCriar,
}: {
  hotel: Hotel;
  aberto: boolean;
  onFechar: () => void;
  inicial?: InicialReserva;
  aoCriar?: (reservaId: string) => void;
}) {
  const qc = useQueryClient();
  const { data: sessao } = useSessionData();
  const { data: hospedes = [] } = useHospedes();
  const gestao = (sessao?.roles ?? []).some((r) => r === "administrador" || r === "gestor");
  const chave = useRef<string>("");

  const [titularId, setTitularId] = useState("");
  const [busca, setBusca] = useState("");
  const [novoHospede, setNovoHospede] = useState(false);
  const [entrada, setEntrada] = useState("");
  const [saida, setSaida] = useState("");
  const [quartos, setQuartos] = useState<Quarto[]>([]);
  const [origem, setOrigem] = useState("balcao");
  const [pendente, setPendente] = useState(false);
  const [observacoes, setObservacoes] = useState("");

  useEffect(() => {
    if (!aberto) return;
    const hoje = isoBrasilia();
    chave.current = crypto.randomUUID();
    setTitularId("");
    setBusca("");
    setEntrada(inicial?.entrada ?? hoje);
    setSaida(inicial?.saida ?? somarDias(inicial?.entrada ?? hoje, 1));
    setQuartos([novoQuarto(inicial?.uhId)]);
    setOrigem("balcao");
    setPendente(false);
    setObservacoes("");
  }, [aberto]); // eslint-disable-line react-hooks/exhaustive-deps

  const datasOk = Boolean(entrada && saida && saida > entrada);

  const livres = useQuery({
    queryKey: ["hotel-uhs-livres", hotel.id, entrada, saida],
    enabled: aberto && datasOk,
    queryFn: () =>
      hsRpc<UhLivre[]>("hs_uhs_livres", { p_filial: hotel.id, p_entrada: entrada, p_saida: saida }),
  });
  const tipos = useQuery({
    queryKey: ["hotel-tipos", hotel.id],
    enabled: aberto,
    queryFn: async () =>
      linhas<HsTipoUh>(await hsDb.from("hs_tipos_uh").select("*").eq("filial_id", hotel.id)),
  });
  const capacidade = (uhId: string) => {
    const u = livres.data?.find((x) => x.id === uhId);
    return tipos.data?.find((t) => t.id === u?.tipo_id);
  };

  const parametros = quartos.map((q) => ({
    uh: q.uhId,
    tipo: livres.data?.find((u) => u.id === q.uhId)?.tipo_id,
    a: Number(q.adultos) || 0,
    c: Number(q.criancas) || 0,
  }));
  const cotacoes = useQuery({
    queryKey: ["hotel-cotacoes", hotel.id, entrada, saida, JSON.stringify(parametros)],
    enabled: aberto && datasOk && parametros.some((p) => p.tipo),
    queryFn: async () =>
      Promise.all(
        parametros.map(async (p) => {
          if (!p.tipo) return { total: null as number | null, erro: null as string | null };
          try {
            const r = await hsRpc<CotacaoResposta>("hs_cotar", {
              p_filial: hotel.id,
              p_tipo: p.tipo,
              p_entrada: entrada,
              p_saida: saida,
              p_adultos: p.a,
              p_criancas: p.c,
            });
            return { total: r.total, erro: null };
          } catch (e) {
            return { total: null, erro: (e as Error).message };
          }
        }),
      ),
  });

  const total = quartos.reduce((s, q, i) => {
    const acordo = Number(q.acordado.replace(",", "."));
    return (
      s +
      (q.acordado && gestao && !Number.isNaN(acordo) ? acordo : (cotacoes.data?.[i]?.total ?? 0))
    );
  }, 0);

  const titulares = useMemo(() => filtrarHospedes(hospedes, busca).slice(0, 30), [hospedes, busca]);

  const criar = useMutation({
    mutationFn: async () => {
      if (!titularId) throw new Error("Escolha o hóspede titular.");
      if (!datasOk) throw new Error("A saída precisa ser depois da entrada.");
      if (quartos.some((q) => !q.uhId)) throw new Error("Escolha a acomodação de cada quarto.");
      return hsRpc<{ reserva_id: string; numero: number; total: number }>("hs_reserva_criar", {
        p_dados: {
          filial_id: hotel.id,
          titular_id: titularId,
          origem,
          situacao: pendente ? "pendente" : "confirmada",
          observacoes,
          quartos: quartos.map((q) => ({
            uh_id: q.uhId,
            entrada,
            saida,
            adultos: Number(q.adultos) || 1,
            criancas: Number(q.criancas) || 0,
            ...(gestao && q.acordado
              ? { valor_acordado_total: Number(q.acordado.replace(",", ".")) }
              : {}),
          })),
        },
        p_chave: chave.current,
      });
    },
    onSuccess: (r) => {
      toast.success(`Reserva ${r.numero} criada (${brl(r.total)}).`);
      for (const k of ["hotel-painel", "hotel-mapa", "hotel-reservas", "hotel-uhs-livres"])
        void qc.invalidateQueries({ queryKey: [k] });
      aoCriar?.(r.reserva_id);
      onFechar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const mudarQuarto = (c: number, parte: Partial<Quarto>) =>
    setQuartos((l) => l.map((q) => (q.chave === c ? { ...q, ...parte } : q)));

  return (
    <>
      <Dialog open={aberto} onOpenChange={(o) => !o && onFechar()}>
        <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Nova reserva</DialogTitle>
            <DialogDescription>{hotel.nome}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="nr-entrada" className="mb-1 block text-xs">
                  Entrada
                </Label>
                <Input
                  id="nr-entrada"
                  type="date"
                  value={entrada}
                  onChange={(e) => setEntrada(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="nr-saida" className="mb-1 block text-xs">
                  Saída{" "}
                  {datasOk && (
                    <span className="text-muted-foreground">
                      · {textoNoites(diasEntre(entrada, saida))}
                    </span>
                  )}
                </Label>
                <Input
                  id="nr-saida"
                  type="date"
                  value={saida}
                  onChange={(e) => setSaida(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label className="block text-xs">Hóspede titular</Label>
              <div className="flex gap-2">
                <Input
                  aria-label="Buscar hóspede"
                  placeholder="Buscar por nome, documento ou telefone"
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                />
                <Button variant="outline" onClick={() => setNovoHospede(true)}>
                  <UserPlus className="size-4" /> Novo
                </Button>
              </div>
              <Select value={titularId} onValueChange={setTitularId}>
                <SelectTrigger aria-label="Titular">
                  <SelectValue placeholder="Escolha o titular" />
                </SelectTrigger>
                <SelectContent>
                  {titulares.map((h) => (
                    <SelectItem key={h.id} value={h.id}>
                      {h.nome}
                      {h.documento_numero ? ` · ${h.documento_numero}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="block text-xs">Quartos</Label>
              {quartos.map((q, i) => {
                const cap = capacidade(q.uhId);
                const cot = cotacoes.data?.[i];
                const usadas = new Set(
                  quartos.filter((x) => x.chave !== q.chave).map((x) => x.uhId),
                );
                return (
                  <div key={q.chave} className="space-y-2 rounded-md border border-border p-3">
                    <div className="grid gap-2 sm:grid-cols-[1fr_5rem_5rem_auto]">
                      <Select
                        value={q.uhId}
                        onValueChange={(v) => mudarQuarto(q.chave, { uhId: v })}
                      >
                        <SelectTrigger aria-label="Acomodação">
                          <SelectValue
                            placeholder={datasOk ? "Acomodação livre" : "Informe as datas"}
                          />
                        </SelectTrigger>
                        <SelectContent>
                          {(livres.data ?? [])
                            .filter((u) => !usadas.has(u.id))
                            .map((u) => (
                              <SelectItem key={u.id} value={u.id}>
                                {u.numero} — {u.tipo}
                                {u.situacao_limpeza === "sujo" ? " (suja)" : ""}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                      <Input
                        aria-label="Adultos"
                        inputMode="numeric"
                        value={q.adultos}
                        onChange={(e) => mudarQuarto(q.chave, { adultos: e.target.value })}
                      />
                      <Input
                        aria-label="Crianças"
                        inputMode="numeric"
                        value={q.criancas}
                        onChange={(e) => mudarQuarto(q.chave, { criancas: e.target.value })}
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Tirar quarto"
                        disabled={quartos.length === 1}
                        onClick={() => setQuartos((l) => l.filter((x) => x.chave !== q.chave))}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                      <span>
                        Adultos / crianças
                        {cap
                          ? ` · cabe até ${cap.capacidade_adultos} adulto(s) e ${cap.capacidade_criancas} criança(s)`
                          : ""}
                      </span>
                      {cot?.erro ? (
                        <span className="text-destructive">{cot.erro}</span>
                      ) : cot?.total != null ? (
                        <span className="text-sm font-medium text-foreground">
                          {brl(cot.total)}
                        </span>
                      ) : null}
                    </div>
                    {gestao && (
                      <Input
                        aria-label="Valor acordado (gestão)"
                        placeholder="Valor acordado para a estadia (opcional, só a gestão)"
                        inputMode="decimal"
                        value={q.acordado}
                        onChange={(e) => mudarQuarto(q.chave, { acordado: e.target.value })}
                      />
                    )}
                  </div>
                );
              })}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setQuartos((l) => [...l, novoQuarto()])}
                disabled={quartos.length >= 20}
              >
                <Plus className="size-4" /> Outro quarto
              </Button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="nr-origem" className="mb-1 block text-xs">
                  Origem
                </Label>
                <Select value={origem} onValueChange={setOrigem}>
                  <SelectTrigger id="nr-origem">
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
              </div>
              <label className="flex items-center gap-2 self-end text-sm">
                <Switch checked={pendente} onCheckedChange={setPendente} />
                Pendente (ainda sem garantia)
              </label>
            </div>
            <Textarea
              aria-label="Observações"
              placeholder="Observações da reserva"
              rows={2}
              value={observacoes}
              onChange={(e) => setObservacoes(e.target.value)}
            />
            <p className="text-right text-sm">
              Total da estadia: <strong>{brl(total)}</strong>
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={onFechar}>
              Cancelar
            </Button>
            <Button onClick={() => criar.mutate()} disabled={criar.isPending}>
              {criar.isPending ? "Criando…" : "Criar reserva"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <HospedeDialog
        aberto={novoHospede}
        onFechar={() => setNovoHospede(false)}
        aoSalvar={setTitularId}
      />
    </>
  );
}
