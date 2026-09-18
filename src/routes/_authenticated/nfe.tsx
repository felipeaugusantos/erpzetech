import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  Printer,
  RefreshCw,
  Send,
  Settings2,
} from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";

import { supabase } from "@/integrations/supabase/client";
import { arquivosNfe, consultarNfe, statusEmissor, transmitirNfe } from "@/lib/nfe-fiscal.functions";
import { brl, num } from "@/lib/format";
import { EmptyState, PageHeader, StatCard } from "@/components/app/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
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

export const Route = createFileRoute("/_authenticated/nfe")({
  head: () => ({
    meta: [
      { title: "Notas fiscais — Ze Obra" },
      {
        name: "description",
        content:
          "Gere a nota fiscal do pedido com cliente, produtos, depósito e valores, e acompanhe as pendências fiscais.",
      },
      { property: "og:title", content: "Notas fiscais — Ze Obra" },
      {
        property: "og:description",
        content: "Emissão de nota fiscal a partir do pedido no Ze Obra.",
      },
    ],
  }),
  component: Nfe,
});

const situacaoLabel: Record<string, { label: string; tone: string }> = {
  rascunho: { label: "Rascunho", tone: "bg-muted text-muted-foreground" },
  pronta: { label: "Pronta para transmitir", tone: "bg-accent/15 text-accent-foreground" },
  transmitida: { label: "Enviada — aguardando Receita", tone: "bg-primary/15 text-primary" },
  autorizada: { label: "Autorizada", tone: "bg-success/15 text-success" },
  rejeitada: { label: "Rejeitada", tone: "bg-destructive/15 text-destructive" },
  cancelada: { label: "Cancelada", tone: "bg-destructive/10 text-destructive" },
};

type Config = {
  id?: string;
  regime_tributario: string;
  serie: number;
  proximo_numero: number;
  ambiente: string;
  emissor: string | null;
  certificado_nome: string | null;
  certificado_validade: string | null;
  cfop_padrao: string;
  informacoes_complementares: string | null;
};

function Nfe() {
  const qc = useQueryClient();
  const [clienteId, setClienteId] = useState("");
  const [selecionados, setSelecionados] = useState<string[]>([]);
  const [abrirConfig, setAbrirConfig] = useState(false);
  const [detalhe, setDetalhe] = useState<string | null>(null);
  const [cfg, setCfg] = useState<Config | null>(null);

  const transmitir = useServerFn(transmitirNfe);
  const consultar = useServerFn(consultarNfe);
  const pegarArquivos = useServerFn(arquivosNfe);
  const verificarEmissor = useServerFn(statusEmissor);

  type StatusConta = {
    conectado: boolean;
    mensagem: string;
    empresas: { cpfCnpj: string; nome: string }[];
    certificados: { nome: string; validade: string }[];
  };
  const [statusConta, setStatusConta] = useState<StatusConta | null>(null);
  const testarEmissor = useMutation({
    mutationFn: async () => (await verificarEmissor()) as StatusConta,
    onSuccess: (r) => {
      setStatusConta(r);
      if (r.conectado) toast.success("Conexão com o emissor fiscal funcionando");
      else toast.error(r.mensagem);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const enviarSefaz = useMutation({
    mutationFn: async (nfeId: string) => transmitir({ data: { nfeId } }),
    onSuccess: (r: { status: string; mensagem: string | null }) => {
      if (r.status === "autorizado" || r.status === "autorizada") {
        toast.success("Nota autorizada pela Receita");
      } else {
        toast.info(`Nota enviada — situação: ${r.status}${r.mensagem ? ` · ${r.mensagem}` : ""}`);
      }
      qc.invalidateQueries({ queryKey: ["nfe"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const consultarSituacao = useMutation({
    mutationFn: async (nfeId: string) => consultar({ data: { nfeId } }),
    onSuccess: (r: { status: string }) => {
      toast.info(`Situação na Receita: ${r.status}`);
      qc.invalidateQueries({ queryKey: ["nfe"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const baixarArquivos = useMutation({
    mutationFn: async (nfeId: string) => pegarArquivos({ data: { nfeId } }),
    onSuccess: (r: { pdf: string | null; xml: string | null }) => {
      if (!r.pdf && !r.xml) {
        toast.error("O emissor ainda não disponibilizou o DANFE e o XML.");
        return;
      }
      if (r.pdf) window.open(r.pdf, "_blank");
      if (r.xml) {
        const a = document.createElement("a");
        a.href = r.xml;
        a.download = "nfe.xml";
        a.click();
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });


  const { data: config } = useQuery({
    queryKey: ["fiscal-config"],
    queryFn: async () => {
      const { data, error } = await supabase.from("fiscal_config").select("*").maybeSingle();
      if (error) throw error;
      return (data ?? null) as Config | null;
    },
  });
  useEffect(() => {
    if (config) setCfg(config);
  }, [config]);

  const { data: notas, isLoading } = useQuery({
    queryKey: ["nfe"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("nfe")
        .select(
          "id, numero, serie, situacao, ambiente, natureza_operacao, valor_total, valor_produtos, valor_frete, valor_desconto, pendencias, mensagem, created_at, emitente, destinatario, chave, protocolo, provider_id, provider_status, pedidos(numero), clientes(nome), depositos(nome)",
        )
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: itensNota } = useQuery({
    queryKey: ["nfe-itens", detalhe],
    enabled: !!detalhe,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("nfe_itens")
        .select("*")
        .eq("nfe_id", detalhe!)
        .order("descricao");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: pedidos } = useQuery({
    queryKey: ["pedidos-sem-nota"],
    queryFn: async () => {
      const [pedidos, vinculos] = await Promise.all([
        supabase
          .from("pedidos")
          .select(
            "id, numero, total, situacao, cliente_id, deposito_id, clientes(nome), depositos(nome, filiais(nome))",
          )
          .neq("situacao", "cancelado")
          .order("numero", { ascending: false }),
        supabase.from("nfe_pedidos").select("pedido_id, nfe(situacao)"),
      ]);
      if (pedidos.error) throw pedidos.error;
      const usados = new Set(
        (vinculos.data ?? [])
          .filter((v) => (v.nfe as { situacao: string } | null)?.situacao !== "cancelada")
          .map((v) => v.pedido_id),
      );
      return (pedidos.data ?? []).filter((p) => !usados.has(p.id));
    },
  });

  const { data: pedidosDaNota } = useQuery({
    queryKey: ["nfe-pedidos", detalhe],
    enabled: !!detalhe,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("nfe_pedidos")
        .select("pedido_id, pedidos(numero, total)")
        .eq("nfe_id", detalhe!);
      if (error) throw error;
      return data ?? [];
    },
  });

  const elegiveis = pedidos ?? [];
  const clientesComPedido = useMemo(() => {
    const mapa = new Map<string, { id: string; nome: string; qtd: number }>();
    for (const p of elegiveis) {
      const nome = (p.clientes as { nome: string } | null)?.nome ?? "Cliente";
      const atual = mapa.get(p.cliente_id) ?? { id: p.cliente_id, nome, qtd: 0 };
      atual.qtd += 1;
      mapa.set(p.cliente_id, atual);
    }
    return [...mapa.values()].sort((a, b) => a.nome.localeCompare(b.nome));
  }, [elegiveis]);

  const pedidosDoCliente = elegiveis.filter((p) => p.cliente_id === clienteId);
  const depositoTravado =
    pedidosDoCliente.find((p) => p.id === selecionados[0])?.deposito_id ?? null;
  const totalSelecionado = pedidosDoCliente
    .filter((p) => selecionados.includes(p.id))
    .reduce((s, p) => s + Number(p.total), 0);

  const gerar = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("gerar_nfe_agrupada", {
        p_pedido_ids: selecionados,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (id) => {
      toast.success(
        selecionados.length > 1
          ? `Nota única gerada com ${selecionados.length} pedidos`
          : "Nota gerada",
      );
      setSelecionados([]);
      setClienteId("");
      qc.invalidateQueries({ queryKey: ["nfe"] });
      qc.invalidateQueries({ queryKey: ["pedidos-sem-nota"] });
      qc.invalidateQueries({ queryKey: ["fiscal-config"] });
      setDetalhe(id);
    },
    onError: (e: Error) => toast.error("Não foi possível gerar a nota", { description: e.message }),
  });

  const salvarConfig = useMutation({
    mutationFn: async () => {
      if (!cfg) return;
      const { id, ...resto } = cfg;
      const { error } = id
        ? await supabase.from("fiscal_config").update(resto).eq("id", id)
        : await supabase.from("fiscal_config").insert(resto);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Configuração fiscal salva");
      setAbrirConfig(false);
      qc.invalidateQueries({ queryKey: ["fiscal-config"] });
    },
    onError: (e: Error) => toast.error("Não foi possível salvar", { description: e.message }),
  });

  const nota = (notas ?? []).find((n) => n.id === detalhe);
  const prontas = (notas ?? []).filter((n) => n.situacao === "pronta").length;
  const rascunhos = (notas ?? []).filter((n) => n.situacao === "rascunho").length;
  const valorTotal = (notas ?? []).reduce((s, n) => s + Number(n.valor_total), 0);

  const faltaConfig =
    !config?.certificado_nome || !config?.emissor
      ? "Para transmitir de verdade faltam o certificado digital A1 e o emissor fiscal contratado."
      : null;

  return (
    <div>
      <PageHeader
        title="Notas fiscais"
        description="Gere a nota a partir do pedido com cliente, produtos, depósito e valores."
        actions={
          <Button variant="outline" size="sm" onClick={() => setAbrirConfig(true)}>
            <Settings2 className="mr-2 size-4" />
            Configuração fiscal
          </Button>
        }
      />

      {faltaConfig && (
        <div className="mb-4 flex items-start gap-3 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
          <div>
            <p className="font-medium">A nota é gerada, mas ainda não é transmitida à Sefaz</p>
            <p className="text-muted-foreground">{faltaConfig}</p>
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Notas geradas" value={num(notas?.length ?? 0, 0)} icon={FileText} />
        <StatCard
          label="Prontas para transmitir"
          value={num(prontas, 0)}
          icon={CheckCircle2}
          tone="success"
        />
        <StatCard
          label="Com pendência"
          value={num(rascunhos, 0)}
          icon={AlertTriangle}
          tone="warning"
        />
        <StatCard label="Valor em notas" value={brl(valorTotal)} icon={FileText} tone="accent" />
      </div>

      <div className="panel mt-6 p-4">
        <h2 className="font-display text-sm font-semibold">Gerar nota de um ou vários pedidos</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Escolha o cliente e marque os pedidos: só é possível juntar em uma única nota os pedidos
          do mesmo cliente que saem do mesmo depósito.
        </p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <Select
            value={clienteId}
            onValueChange={(v) => {
              setClienteId(v);
              setSelecionados([]);
            }}
          >
            <SelectTrigger className="sm:max-w-md">
              <SelectValue placeholder="Escolha o cliente" />
            </SelectTrigger>
            <SelectContent>
              {clientesComPedido.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.nome} · {c.qtd} pedido(s) sem nota
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            disabled={selecionados.length === 0 || gerar.isPending}
            onClick={() => gerar.mutate()}
          >
            <FileText className="mr-2 size-4" />
            {selecionados.length > 1
              ? `Gerar nota única (${selecionados.length} pedidos)`
              : "Gerar nota fiscal"}
          </Button>
        </div>

        {clienteId && (
          <ul className="mt-3 divide-y divide-border rounded-lg border">
            {pedidosDoCliente.map((p) => {
              const bloqueado = !!depositoTravado && p.deposito_id !== depositoTravado;
              return (
                <li
                  key={p.id}
                  className={`flex items-center gap-3 p-3 text-sm ${bloqueado ? "opacity-50" : ""}`}
                >
                  <Checkbox
                    id={`ped-${p.id}`}
                    disabled={bloqueado}
                    checked={selecionados.includes(p.id)}
                    onCheckedChange={(v) =>
                      setSelecionados((atual) =>
                        v ? [...atual, p.id] : atual.filter((x) => x !== p.id),
                      )
                    }
                  />
                  <Label htmlFor={`ped-${p.id}`} className="flex-1 cursor-pointer font-normal">
                    Pedido nº {String(p.numero).padStart(4, "0")}
                    <span className="ml-2 text-xs text-muted-foreground">
                      {p.situacao.replace(/_/g, " ")}
                    </span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      Depósito: {(p.depositos as { nome: string } | null)?.nome ?? "—"}
                      {bloqueado ? " · outro depósito" : ""}
                    </span>
                  </Label>
                  <span className="text-numeric font-semibold">{brl(Number(p.total))}</span>
                </li>
              );
            })}
            {selecionados.length > 0 && (
              <li className="flex items-center justify-end gap-2 bg-muted/40 p-3 text-sm">
                Total da nota
                <strong className="text-numeric">{brl(totalSelecionado)}</strong>
              </li>
            )}
          </ul>
        )}

        {elegiveis.length === 0 && (
          <p className="mt-2 text-xs text-muted-foreground">
            Todos os pedidos já têm nota gerada.
          </p>
        )}
      </div>

      <div className="panel mt-4 overflow-hidden">
        {isLoading ? (
          <p className="p-4 text-sm text-muted-foreground">Carregando…</p>
        ) : (notas ?? []).length === 0 ? (
          <EmptyState
            title="Nenhuma nota gerada"
            description="Escolha um pedido acima e clique em gerar nota fiscal."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nota</TableHead>
                <TableHead>Pedido</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Depósito</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(notas ?? []).map((n) => {
                const s = situacaoLabel[n.situacao] ?? situacaoLabel["rascunho"]!;
                return (
                  <TableRow key={n.id}>
                    <TableCell className="font-medium">
                      {n.numero ? `nº ${String(n.numero).padStart(6, "0")}` : "sem número"}
                      <span className="block text-xs text-muted-foreground">
                        série {n.serie} · {n.ambiente === "producao" ? "produção" : "homologação"}
                      </span>
                    </TableCell>
                    <TableCell>
                      {(n.pedidos as { numero: number } | null)?.numero
                        ? `nº ${String((n.pedidos as { numero: number }).numero).padStart(4, "0")}`
                        : "—"}
                    </TableCell>
                    <TableCell>{(n.clientes as { nome: string } | null)?.nome ?? "—"}</TableCell>
                    <TableCell>{(n.depositos as { nome: string } | null)?.nome ?? "—"}</TableCell>
                    <TableCell className="text-numeric text-right font-semibold">
                      {brl(Number(n.valor_total))}
                    </TableCell>
                    <TableCell>
                      <Badge className={s.tone} variant="secondary">
                        {s.label}
                      </Badge>
                      {n.pendencias.length > 0 && (
                        <span className="block text-xs text-warning">
                          {n.pendencias.length} pendência(s)
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => setDetalhe(n.id)}>
                        Abrir
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>

      <Dialog open={!!detalhe} onOpenChange={(o) => !o && setDetalhe(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              Nota {nota?.numero ? `nº ${String(nota.numero).padStart(6, "0")}` : "em rascunho"}
            </DialogTitle>
          </DialogHeader>
          {nota && (
            <div className="space-y-4 text-sm">
              {nota.pendencias.length > 0 && (
                <div className="rounded-lg border border-warning/40 bg-warning/10 p-3">
                  <p className="font-medium">Pendências para poder transmitir</p>
                  <ul className="mt-1 list-disc pl-5 text-muted-foreground">
                    {nota.pendencias.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                </div>
              )}
              {(pedidosDaNota ?? []).length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Pedidos nesta nota:{" "}
                  {(pedidosDaNota ?? [])
                    .map(
                      (v) =>
                        `nº ${String((v.pedidos as { numero: number } | null)?.numero ?? 0).padStart(4, "0")}`,
                    )
                    .join(" · ")}
                </p>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border p-3">
                  <p className="text-xs uppercase text-muted-foreground">Emitente</p>
                  <Bloco dados={nota.emitente as Record<string, string> | null} />
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs uppercase text-muted-foreground">Destinatário</p>
                  <Bloco dados={nota.destinatario as Record<string, string> | null} />
                </div>
              </div>
              <div className="rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Produto</TableHead>
                      <TableHead>NCM</TableHead>
                      <TableHead>CFOP</TableHead>
                      <TableHead className="text-right">Qtd</TableHead>
                      <TableHead className="text-right">Unitário</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(itensNota ?? []).map((i) => (
                      <TableRow key={i.id}>
                        <TableCell>
                          {i.descricao}
                          <span className="block text-xs text-muted-foreground">{i.codigo}</span>
                        </TableCell>
                        <TableCell>{i.ncm ?? "—"}</TableCell>
                        <TableCell>{i.cfop ?? "—"}</TableCell>
                        <TableCell className="text-numeric text-right">
                          {num(Number(i.quantidade), 2)} {i.unidade}
                        </TableCell>
                        <TableCell className="text-numeric text-right">
                          {brl(Number(i.preco_unitario))}
                        </TableCell>
                        <TableCell className="text-numeric text-right font-semibold">
                          {brl(Number(i.total))}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="flex flex-wrap justify-end gap-6">
                <span className="text-muted-foreground">
                  Produtos <strong className="text-foreground">{brl(Number(nota.valor_produtos))}</strong>
                </span>
                <span className="text-muted-foreground">
                  Desconto <strong className="text-foreground">{brl(Number(nota.valor_desconto))}</strong>
                </span>
                <span className="text-muted-foreground">
                  Frete <strong className="text-foreground">{brl(Number(nota.valor_frete))}</strong>
                </span>
                <span className="text-base font-semibold">{brl(Number(nota.valor_total))}</span>
              </div>
              {nota.mensagem && <p className="text-xs text-muted-foreground">{nota.mensagem}</p>}
              {nota.chave && (
                <p className="break-all text-xs text-muted-foreground">
                  Chave de acesso: {nota.chave}
                  {nota.protocolo ? ` · protocolo ${nota.protocolo}` : ""}
                </p>
              )}
            </div>
          )}
          <DialogFooter className="flex-wrap gap-2">
            <Button variant="outline" onClick={() => window.print()}>
              <Printer className="mr-2 size-4" />
              Imprimir
            </Button>
            {nota && nota.situacao !== "autorizada" && nota.situacao !== "cancelada" && (
              <Button disabled={enviarSefaz.isPending} onClick={() => enviarSefaz.mutate(nota.id)}>
                <Send className="mr-2 size-4" /> Enviar à Receita
              </Button>
            )}
            {nota?.provider_id && (
              <Button
                variant="secondary"
                disabled={consultarSituacao.isPending}
                onClick={() => consultarSituacao.mutate(nota.id)}
              >
                <RefreshCw className="mr-2 size-4" /> Consultar situação
              </Button>
            )}
            {nota?.situacao === "autorizada" && (
              <Button
                variant="secondary"
                disabled={baixarArquivos.isPending}
                onClick={() => baixarArquivos.mutate(nota.id)}
              >
                <FileText className="mr-2 size-4" /> DANFE e XML
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={abrirConfig} onOpenChange={setAbrirConfig}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Configuração fiscal</DialogTitle>
          </DialogHeader>
          {cfg && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label>Regime tributário</Label>
                <Select
                  value={cfg.regime_tributario}
                  onValueChange={(v) => setCfg({ ...cfg, regime_tributario: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="simples">Simples Nacional</SelectItem>
                    <SelectItem value="presumido">Lucro presumido</SelectItem>
                    <SelectItem value="real">Lucro real</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Ambiente</Label>
                <Select value={cfg.ambiente} onValueChange={(v) => setCfg({ ...cfg, ambiente: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="homologacao">Teste (homologação)</SelectItem>
                    <SelectItem value="producao">Produção (vale como nota)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Série</Label>
                <Input
                  inputMode="numeric"
                  value={String(cfg.serie)}
                  onChange={(e) => setCfg({ ...cfg, serie: Number(e.target.value) || 1 })}
                />
              </div>
              <div>
                <Label>Próximo número</Label>
                <Input
                  inputMode="numeric"
                  value={String(cfg.proximo_numero)}
                  onChange={(e) => setCfg({ ...cfg, proximo_numero: Number(e.target.value) || 1 })}
                />
              </div>
              <div>
                <Label>CFOP padrão</Label>
                <Input
                  value={cfg.cfop_padrao}
                  onChange={(e) => setCfg({ ...cfg, cfop_padrao: e.target.value })}
                />
              </div>
              <div>
                <Label>Emissor fiscal contratado</Label>
                <Input
                  placeholder="Focus NFe, PlugNotas, eNotas…"
                  value={cfg.emissor ?? ""}
                  onChange={(e) => setCfg({ ...cfg, emissor: e.target.value })}
                />
              </div>
              <div>
                <Label>Certificado digital A1</Label>
                <Input
                  placeholder="Nome do arquivo .pfx"
                  value={cfg.certificado_nome ?? ""}
                  onChange={(e) => setCfg({ ...cfg, certificado_nome: e.target.value })}
                />
              </div>
              <div>
                <Label>Validade do certificado</Label>
                <Input
                  type="date"
                  value={cfg.certificado_validade ?? ""}
                  onChange={(e) => setCfg({ ...cfg, certificado_validade: e.target.value })}
                />
              </div>
            </div>
          )}
          <div className="rounded-lg border bg-muted/40 p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">Conta do emissor fiscal</span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => testarEmissor.mutate()}
                disabled={testarEmissor.isPending}
              >
                {testarEmissor.isPending ? "Testando…" : "Testar conexão"}
              </Button>
            </div>
            {statusConta && (
              <div className="mt-2 space-y-1 text-muted-foreground">
                <p>{statusConta.mensagem}</p>
                {statusConta.conectado && (
                  <>
                    <p>
                      Empresas cadastradas no emissor:{" "}
                      {statusConta.empresas.length > 0
                        ? statusConta.empresas.map((e) => `${e.nome || e.cpfCnpj}`).join(", ")
                        : "nenhuma ainda"}
                    </p>
                    <p>
                      Certificados digitais enviados:{" "}
                      {statusConta.certificados.length > 0
                        ? statusConta.certificados
                            .map((c) => `${c.nome}${c.validade ? ` (até ${c.validade.slice(0, 10)})` : ""}`)
                            .join(", ")
                        : "nenhum ainda"}
                    </p>
                  </>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAbrirConfig(false)}>
              Fechar
            </Button>
            <Button onClick={() => salvarConfig.mutate()} disabled={salvarConfig.isPending}>
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Bloco({ dados }: { dados: Record<string, string> | null }) {
  if (!dados) return <p className="text-muted-foreground">—</p>;
  const linha2 = [dados["endereco"], dados["numero"]].filter(Boolean).join(", ");
  const linha3 = [dados["bairro"], dados["cidade"], dados["estado"]].filter(Boolean).join(" · ");
  return (
    <div className="mt-1 space-y-0.5">
      <p className="font-medium">{dados["razao_social"] ?? dados["nome"]}</p>
      <p className="text-muted-foreground">
        {dados["cnpj"] ? `CNPJ ${dados["cnpj"]}` : dados["cpf"] ? `CPF ${dados["cpf"]}` : "sem documento"}
        {dados["inscricao_estadual"] ? ` · IE ${dados["inscricao_estadual"]}` : ""}
      </p>
      <p className="text-muted-foreground">{linha2 || "endereço não informado"}</p>
      <p className="text-muted-foreground">
        {linha3}
        {dados["cep"] ? ` · CEP ${dados["cep"]}` : ""}
      </p>
    </div>
  );
}
