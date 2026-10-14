import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CalendarClock } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { dateBR, dateTimeBR, num } from "@/lib/format";
import { planejadoPorItem, saldoItem } from "@/lib/saldo-pedido";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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

type Item = {
  id: string;
  quantidade: number;
  quantidade_separada: number;
  quantidade_conferida: number;
  quantidade_entregue: number;
  produtos: unknown;
};
type Entrega = {
  id: string;
  numero: number | null;
  situacao: string;
  tipo?: string | null;
  data_entrega: string;
  previsao_data: string | null;
  endereco_entrega?: string | null;
  responsavel?: string | null;
  recebedor: string | null;
  reagendamentos?: number | null;
  entrega_itens?: unknown;
};

const TIPOS_OCORRENCIA: Record<string, string> = {
  falta: "Falta",
  sobra: "Sobra",
  avaria: "Avaria",
  substituicao: "Substituição",
};
const SITUACAO_ENTREGA: Record<string, string> = {
  planejada: "Agendada",
  em_rota: "Em rota",
  entregue: "Concluída",
  insucesso: "Não entregue",
  cancelada: "Cancelada",
};

const descricao = (p: unknown) => (p as { descricao?: string } | null)?.descricao ?? "—";

export function PedidoAtendimento({
  pedidoId,
  itens,
  entregas,
  enderecoObra,
  faturado,
}: {
  pedidoId: string;
  itens: Item[];
  entregas: Entrega[];
  enderecoObra: string | null;
  faturado: boolean;
}) {
  const qc = useQueryClient();
  const planejado = useMemo(
    () =>
      planejadoPorItem(
        entregas as {
          situacao: string;
          entrega_itens?: { pedido_item_id: string; quantidade: number }[];
        }[],
      ),
    [entregas],
  );

  const { data: ocorrencias = [], isError: erroOcorrencias } = useQuery({
    queryKey: ["pedido-ocorrencias", pedidoId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pedido_ocorrencias")
        .select(
          "id, pedido_item_id, etapa, tipo, quantidade, observacao, created_at, usuario_id, substituto:produtos!pedido_ocorrencias_produto_substituto_id_fkey(descricao)",
        )
        .eq("pedido_id", pedidoId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const usuarios = useMemo(
    () => [...new Set(ocorrencias.map((o) => o.usuario_id).filter(Boolean))] as string[],
    [ocorrencias],
  );
  const { data: nomes = {} } = useQuery({
    queryKey: ["nomes-usuarios", usuarios],
    enabled: usuarios.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("id, nome").in("id", usuarios);
      return Object.fromEntries((data ?? []).map((p) => [p.id, p.nome])) as Record<string, string>;
    },
  });

  const { data: produtos = [] } = useQuery({
    queryKey: ["produtos-substituto"],
    queryFn: async () => {
      const { data } = await supabase
        .from("produtos")
        .select("id, descricao, codigo_interno")
        .eq("ativo", true)
        .order("descricao")
        .limit(500);
      return data ?? [];
    },
  });

  // ocorrência
  const [ocItem, setOcItem] = useState<Item | null>(null);
  const [ocTipo, setOcTipo] = useState("falta");
  const [ocEtapa, setOcEtapa] = useState("separacao");
  const [ocQtd, setOcQtd] = useState("");
  const [ocObs, setOcObs] = useState("");
  const [ocSubst, setOcSubst] = useState("");

  const registrarOcorrencia = useMutation({
    mutationFn: async () => {
      if (!ocItem) return;
      const q = Number(ocQtd.replace(",", "."));
      if (!(q > 0)) throw new Error("Informe a quantidade");
      const { error } = await supabase.rpc("pedido_registrar_ocorrencia", {
        p_pedido_item_id: ocItem.id,
        p_tipo: ocTipo,
        p_quantidade: q,
        p_etapa: ocEtapa,
        ...(ocSubst ? { p_produto_substituto_id: ocSubst } : {}),
        ...(ocObs ? { p_observacao: ocObs } : {}),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Ocorrência registrada");
      setOcItem(null);
      qc.invalidateQueries({ queryKey: ["pedido-ocorrencias", pedidoId] });
    },
    onError: (e: Error) => toast.error("Não foi possível registrar", { description: e.message }),
  });

  // agendamento
  const [agEntrega, setAgEntrega] = useState<Entrega | null>(null);
  const [agData, setAgData] = useState("");
  const [agEndereco, setAgEndereco] = useState("");
  const [agResp, setAgResp] = useState("");
  const [agMotivo, setAgMotivo] = useState("");
  const abrirAgenda = (e: Entrega) => {
    setAgEntrega(e);
    setAgData(e.previsao_data ?? "");
    setAgEndereco(e.endereco_entrega ?? enderecoObra ?? "");
    setAgResp(e.responsavel ?? "");
    setAgMotivo("");
  };
  const agendar = useMutation({
    mutationFn: async () => {
      if (!agEntrega) return;
      if (!agData) throw new Error("Informe a data");
      const { error } = await supabase.rpc("entrega_agendar", {
        p_entrega_id: agEntrega.id,
        p_previsao: agData,
        ...(agEndereco ? { p_endereco: agEndereco } : {}),
        ...(agResp ? { p_responsavel: agResp } : {}),
        ...(agMotivo ? { p_motivo: agMotivo } : {}),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Agendamento salvo");
      setAgEntrega(null);
      qc.invalidateQueries({ queryKey: ["pedido", pedidoId] });
    },
    onError: (e: Error) => toast.error("Não foi possível agendar", { description: e.message }),
  });
  const reagendando = !!agEntrega?.previsao_data && agData !== agEntrega.previsao_data;

  return (
    <>
      <div className="panel overflow-x-auto">
        <div className="flex items-center justify-between px-4 pt-4">
          <p className="font-display font-semibold">Situação de cada item</p>
          <Badge variant={faturado ? "default" : "outline"}>
            {faturado ? "Faturado" : "Ainda não faturado"}
          </Badge>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Produto</TableHead>
              <TableHead className="text-right">Pedido</TableHead>
              <TableHead className="text-right">Separado</TableHead>
              <TableHead className="text-right">Conferido</TableHead>
              <TableHead className="text-right">Agendado</TableHead>
              <TableHead className="text-right">Saiu</TableHead>
              <TableHead className="text-right">Falta sair</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {itens.map((i) => {
              const s = saldoItem({ ...i, planejado: planejado[i.id] ?? 0 });
              return (
                <TableRow key={i.id}>
                  <TableCell className="text-sm">{descricao(i.produtos)}</TableCell>
                  <TableCell className="text-right">{num(s.pedido)}</TableCell>
                  <TableCell className="text-right">{num(s.separado)}</TableCell>
                  <TableCell className="text-right">{num(s.conferido)}</TableCell>
                  <TableCell className="text-right">{num(s.planejado)}</TableCell>
                  <TableCell className="text-right">{num(s.entregue)}</TableCell>
                  <TableCell className="text-right font-medium">
                    {s.pendente > 0 ? num(s.pendente) : <span className="text-success">0</span>}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setOcItem(i);
                        setOcTipo("falta");
                        setOcQtd("");
                        setOcObs("");
                        setOcSubst("");
                      }}
                    >
                      <AlertTriangle className="mr-1 size-4" /> Ocorrência
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <div className="panel p-4">
        <p className="font-display font-semibold">Ocorrências</p>
        {erroOcorrencias && (
          <p className="mt-2 text-sm text-destructive">Não foi possível carregar as ocorrências.</p>
        )}
        {!erroOcorrencias && ocorrencias.length === 0 && (
          <p className="mt-2 text-sm text-muted-foreground">
            Nenhuma falta, sobra, avaria ou substituição registrada.
          </p>
        )}
        <ul className="mt-2 space-y-2 text-sm">
          {ocorrencias.map((o) => {
            const item = itens.find((i) => i.id === o.pedido_item_id);
            const subst = (o.substituto as { descricao?: string } | null)?.descricao;
            return (
              <li key={o.id} className="rounded-md border border-border p-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{TIPOS_OCORRENCIA[o.tipo] ?? o.tipo}</Badge>
                  <span className="font-medium">
                    {num(Number(o.quantidade))} × {descricao(item?.produtos)}
                  </span>
                  {subst && <span className="text-muted-foreground">→ {subst}</span>}
                </div>
                <p className="text-xs text-muted-foreground">
                  {o.etapa === "separacao"
                    ? "Separação"
                    : o.etapa === "conferencia"
                      ? "Conferência"
                      : "Entrega"}{" "}
                  · {dateTimeBR(o.created_at)} ·{" "}
                  {(o.usuario_id && nomes[o.usuario_id]) || "Usuário"}
                </p>
                {o.observacao && <p className="text-xs">{o.observacao}</p>}
              </li>
            );
          })}
        </ul>
      </div>

      {entregas.length > 0 && (
        <div className="panel p-4">
          <p className="font-display font-semibold">Retiradas e entregas</p>
          <ul className="mt-3 space-y-3">
            {entregas.map((e) => {
              const aberta = ["planejada", "em_rota", "insucesso"].includes(e.situacao);
              return (
                <li key={e.id} className="rounded-md border border-border p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">
                      {e.tipo === "retirada" ? "Retirada" : "Entrega"} #
                      {String(e.numero ?? "").padStart(4, "0")}
                    </span>
                    <Badge variant="outline">{SITUACAO_ENTREGA[e.situacao] ?? e.situacao}</Badge>
                    {aberta ? (
                      <span className="text-muted-foreground">
                        Previsão: {e.previsao_data ? dateBR(e.previsao_data) : "sem data"}
                        {e.reagendamentos ? ` · reagendada ${e.reagendamentos}×` : ""}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">{dateTimeBR(e.data_entrega)}</span>
                    )}
                    {e.recebedor && (
                      <span className="text-muted-foreground">Recebido por {e.recebedor}</span>
                    )}
                    {aberta && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="ml-auto"
                        onClick={() => abrirAgenda(e)}
                      >
                        <CalendarClock className="mr-1 size-4" />
                        {e.previsao_data ? "Reagendar" : "Agendar"}
                      </Button>
                    )}
                  </div>
                  {(e.endereco_entrega || e.responsavel) && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {e.endereco_entrega}
                      {e.responsavel ? ` · Responsável: ${e.responsavel}` : ""}
                    </p>
                  )}
                  <ul className="mt-1 text-xs text-muted-foreground">
                    {(
                      (e.entrega_itens ?? []) as {
                        quantidade: number;
                        produtos: { descricao: string } | null;
                      }[]
                    ).map((ei, idx) => (
                      <li key={idx}>
                        {num(Number(ei.quantidade))} × {ei.produtos?.descricao}
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <Dialog open={!!ocItem} onOpenChange={(o) => !o && setOcItem(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Registrar ocorrência</DialogTitle>
            <DialogDescription>{descricao(ocItem?.produtos)}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Tipo</Label>
              <Select value={ocTipo} onValueChange={setOcTipo}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(TIPOS_OCORRENCIA).map(([v, l]) => (
                    <SelectItem key={v} value={v}>
                      {l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Etapa</Label>
              <Select value={ocEtapa} onValueChange={setOcEtapa}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="separacao">Separação</SelectItem>
                  <SelectItem value="conferencia">Conferência</SelectItem>
                  <SelectItem value="entrega">Entrega</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="oc-qtd">Quantidade</Label>
              <Input
                id="oc-qtd"
                inputMode="decimal"
                value={ocQtd}
                onChange={(e) => setOcQtd(e.target.value)}
              />
            </div>
            {ocTipo === "substituicao" && (
              <div>
                <Label>Produto que substitui</Label>
                <Select value={ocSubst} onValueChange={setOcSubst}>
                  <SelectTrigger>
                    <SelectValue placeholder="Escolha" />
                  </SelectTrigger>
                  <SelectContent>
                    {produtos.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.codigo_interno ? `${p.codigo_interno} · ` : ""}
                        {p.descricao}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="sm:col-span-2">
              <Label htmlFor="oc-obs">Descrição</Label>
              <Input
                id="oc-obs"
                value={ocObs}
                onChange={(e) => setOcObs(e.target.value)}
                placeholder="Ex.: 3 sacos rasgados no palete"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOcItem(null)}>
              Cancelar
            </Button>
            <Button
              onClick={() => registrarOcorrencia.mutate()}
              disabled={registrarOcorrencia.isPending}
            >
              Registrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!agEntrega} onOpenChange={(o) => !o && setAgEntrega(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Agendar entrega</DialogTitle>
            <DialogDescription>Data, endereço da obra e responsável pelo recebimento.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div>
              <Label htmlFor="ag-data">Data</Label>
              <Input
                id="ag-data"
                type="date"
                value={agData}
                onChange={(e) => setAgData(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="ag-end">Endereço</Label>
              <Input
                id="ag-end"
                value={agEndereco}
                onChange={(e) => setAgEndereco(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="ag-resp">Responsável na obra</Label>
              <Input id="ag-resp" value={agResp} onChange={(e) => setAgResp(e.target.value)} />
            </div>
            {reagendando && (
              <div>
                <Label htmlFor="ag-mot">Motivo do reagendamento</Label>
                <Input
                  id="ag-mot"
                  value={agMotivo}
                  onChange={(e) => setAgMotivo(e.target.value)}
                  placeholder="Ex.: obra fechada, cliente pediu outra data"
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAgEntrega(null)}>
              Cancelar
            </Button>
            <Button onClick={() => agendar.mutate()} disabled={agendar.isPending}>
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
