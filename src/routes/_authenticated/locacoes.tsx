import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarClock,
  CheckCircle2,
  Code2,
  Download,
  FileText,
  Plus,
  Receipt,
  Search,
  ThumbsUp,
  Truck,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useModulosCnae } from "@/lib/cnae";
import { ModuloBloqueado } from "@/components/app/ModuloCnae";
import { useSessionData } from "@/hooks/useSessionData";
import { brl, dateBR } from "@/lib/format";
import {
  baixarTexto,
  gerarPdfNota,
  gerarXmlNota,
  nomeArquivoNota,
  type ItemArquivo,
  type NotaArquivo,
} from "@/lib/nfe-arquivos";
import { ClienteCombobox } from "@/components/app/ClienteCombobox";
import { EmptyState, PageHeader, StatCard } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/locacoes")({
  head: () => ({
    meta: [
      { title: "Locação de equipamentos — ERP Ze Tech" },
      {
        name: "description",
        content:
          "Contratos de locação: cliente, obra, equipamento, período, diária, caução e devolução.",
      },
      { property: "og:title", content: "Locação de equipamentos — ERP Ze Tech" },
      {
        property: "og:description",
        content: "Reserve, entregue e receba de volta os equipamentos alugados.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: LocacoesModulo,
});

const SITUACOES = [
  { value: "reservada", label: "Reservada" },
  { value: "em_andamento", label: "Em locação" },
  { value: "devolvida", label: "Devolvida" },
  { value: "cancelada", label: "Cancelada" },
];

type Form = {
  cliente_id: string;
  obra_id: string;
  equipamento_id: string;
  inicio: string;
  previsao_devolucao: string;
  valor_diaria: string;
  dias: string;
  caucao: string;
  observacoes: string;
};

const hojeISO = () => new Date().toISOString().slice(0, 10);

const vazio = (): Form => ({
  cliente_id: "",
  obra_id: "",
  equipamento_id: "",
  inicio: hojeISO(),
  previsao_devolucao: "",
  valor_diaria: "0",
  dias: "1",
  caucao: "0",
  observacoes: "",
});

type Cobranca = { id: string; numero: number; valor: number; forma: string; parcelas: string; vencimento: string };

const cobrancaVazia: Cobranca = {
  id: "",
  numero: 0,
  valor: 0,
  forma: "dinheiro",
  parcelas: "1",
  vencimento: hojeISO(),
};

function Locacoes() {
  const { data: session } = useSessionData();
  const profile = session?.profile;
  const queryClient = useQueryClient();
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState("ativas");
  const [aberto, setAberto] = useState(false);
  const [form, setForm] = useState<Form>(vazio);
  const [cobranca, setCobranca] = useState<Cobranca>({ ...cobrancaVazia });

  const { data: caixaAberto } = useQuery({
    queryKey: ["caixa-aberto-locacao"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("caixas")
        .select("id")
        .eq("situacao", "aberto")
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: locacoes = [], isLoading } = useQuery({
    queryKey: ["locacoes"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("locacoes")
        .select("*, clientes(nome), obras(nome), locacao_equipamentos(nome, codigo)")
        .order("numero", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  /** Notas de serviço já geradas, com itens, para baixar em PDF e XML. */
  const { data: notasServico = [] } = useQuery({
    queryKey: ["locacao-notas-servico"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("nfe")
        .select(
          "id, locacao_id, numero, serie, situacao, ambiente, natureza_operacao, cfop, modelo, codigo_servico, municipio_prestacao, iss_retido, valor_produtos, valor_desconto, valor_frete, valor_total, base_icms, valor_icms, base_icms_st, valor_icms_st, valor_pis, valor_cofins, valor_iss, chave, protocolo, created_at, pdf_url, xml_url, emitente, destinatario, nfe_itens(*)",
        )
        .not("locacao_id", "is", null);
      if (error) throw error;
      return data ?? [];
    },
  });

  /** Baixa o documento da nota de serviço: PDF da prefeitura quando houver, senão o espelho. */
  function baixarNota(locacaoId: string, tipo: "pdf" | "xml") {
    const nota = notasServico.find((n) => n.locacao_id === locacaoId);
    if (!nota) {
      toast.error("Gere a nota de serviço desta locação primeiro.");
      return;
    }
    const itens = (nota.nfe_itens ?? []) as ItemArquivo[];
    const dados = nota as unknown as NotaArquivo & {
      pdf_url?: string | null;
      xml_url?: string | null;
    };
    if (tipo === "pdf") {
      if (dados.pdf_url) {
        window.open(dados.pdf_url, "_blank");
        return;
      }
      gerarPdfNota(dados, itens);
      toast.success("PDF da nota de serviço baixado");
      return;
    }
    if (dados.xml_url) {
      const a = document.createElement("a");
      a.href = dados.xml_url;
      a.download = `${nomeArquivoNota(dados)}.xml`;
      a.click();
      return;
    }
    baixarTexto(`${nomeArquivoNota(dados)}.xml`, gerarXmlNota(dados, itens), "application/xml");
    toast.success("XML da nota de serviço baixado");
  }



  const { data: clientes = [] } = useQuery({
    queryKey: ["clientes-basico"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clientes")
        .select("id, nome, cpf, cnpj, telefone")
        .eq("ativo", true)
        .order("nome");
      if (error) throw error;
      return data;
    },
  });

  const { data: obras = [] } = useQuery({
    queryKey: ["obras-locacao"],
    queryFn: async () => {
      const { data, error } = await supabase.from("obras").select("id, nome, cliente_id").order("nome");
      if (error) throw error;
      return data;
    },
  });

  const { data: equipamentos = [] } = useQuery({
    queryKey: ["locacao-equipamentos"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("locacao_equipamentos")
        .select("*")
        .eq("ativo", true)
        .order("nome");
      if (error) throw error;
      return data;
    },
  });

  const lista = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return locacoes.filter((l) => {
      const okFiltro =
        filtro === "todas"
          ? true
          : filtro === "ativas"
            ? ["reservada", "em_andamento"].includes(l.situacao)
            : l.situacao === filtro;
      if (!okFiltro) return false;
      if (!t) return true;
      return [l.clientes?.nome, l.locacao_equipamentos?.nome, l.obras?.nome, String(l.numero)]
        .filter(Boolean)
        .some((x) => String(x).toLowerCase().includes(t));
    });
  }, [locacoes, busca, filtro]);

  const emLocacao = locacoes.filter((l) => l.situacao === "em_andamento");
  const atrasadas = emLocacao.filter(
    (l) => l.previsao_devolucao && l.previsao_devolucao < hojeISO(),
  );

  const total = useMemo(
    () => Number(form.valor_diaria.replace(",", ".") || 0) * Number(form.dias || 0),
    [form.valor_diaria, form.dias],
  );

  const salvar = useMutation({
    mutationFn: async () => {
      if (!profile?.tenant_id) throw new Error("Usuário sem empresa vinculada");
      if (!form.cliente_id) throw new Error("Escolha o cliente");
      if (!form.equipamento_id) throw new Error("Escolha o equipamento");
      const dias = Number(form.dias || 0);
      if (dias <= 0) throw new Error("Informe a quantidade de dias");
      const { error } = await supabase.from("locacoes").insert({
        tenant_id: profile.tenant_id,
        empresa_id: profile.empresa_id ?? null,
        filial_id: profile.filial_id ?? null,
        cliente_id: form.cliente_id,
        obra_id: form.obra_id || null,
        equipamento_id: form.equipamento_id,
        inicio: form.inicio,
        previsao_devolucao: form.previsao_devolucao || null,
        valor_diaria: Number(form.valor_diaria.replace(",", ".") || 0),
        dias,
        valor_total: Number(total.toFixed(2)),
        caucao: Number(form.caucao.replace(",", ".") || 0),
        situacao: "reservada" as never,
        observacoes: form.observacoes || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Locação registrada.");
      setAberto(false);
      setForm(vazio());
      void queryClient.invalidateQueries({ queryKey: ["locacoes"] });
      void queryClient.invalidateQueries({ queryKey: ["locacao-equipamentos"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const recarregar = () => {
    void queryClient.invalidateQueries({ queryKey: ["locacoes"] });
    void queryClient.invalidateQueries({ queryKey: ["locacao-equipamentos"] });
    void queryClient.invalidateQueries({ queryKey: ["locacao-notas-servico"] });
  };

  const acao = useMutation({
    mutationFn: async ({ id, tipo }: { id: string; tipo: "aprovar" | "entregar" | "devolver" | "cancelar" }) => {
      if (tipo === "aprovar") {
        const { error } = await supabase.rpc("locacao_aprovar", { p_locacao_id: id });
        if (error) throw error;
        return "Solicitação aprovada.";
      }
      if (tipo === "entregar") {
        const { error } = await supabase.rpc("locacao_entregar", { p_locacao_id: id, p_data: hojeISO() });
        if (error) throw error;
        return "Equipamento entregue ao cliente.";
      }
      if (tipo === "devolver") {
        const { error } = await supabase.rpc("locacao_devolver", {
          p_locacao_id: id,
          p_data: hojeISO(),
          p_observacao: "",
          p_multa: 0,
        });
        if (error) throw error;
        return "Devolução registrada — o valor foi recalculado pelos dias reais.";
      }
      const { error } = await supabase
        .from("locacoes")
        .update({ situacao: "cancelada" as never })
        .eq("id", id);
      if (error) throw error;
      return "Locação cancelada.";
    },
    onSuccess: (msg) => {
      toast.success(msg);
      recarregar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const faturar = useMutation({
    mutationFn: async () => {
      if (!cobranca.id) throw new Error("Escolha a locação");
      const { error } = await supabase.rpc("locacao_faturar", {
        p_locacao_id: cobranca.id,
        p_forma: cobranca.forma as never,
        p_parcelas: Number(cobranca.parcelas || 1),
        p_primeiro_vencimento: cobranca.vencimento,
        ...(caixaAberto?.id ? { p_caixa_id: caixaAberto.id } : {}),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Locação faturada em contas a receber.");
      setCobranca({ ...cobrancaVazia });
      recarregar();
      void queryClient.invalidateQueries({ queryKey: ["contas-receber"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const gerarNota = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("locacao_gerar_nfse", { p_locacao_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(
        "Nota fiscal de serviço (NFS-e) gerada — confira em Fiscal › Notas fiscais.",
      );
      recarregar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const obrasDoCliente = obras.filter((o) => !form.cliente_id || o.cliente_id === form.cliente_id);

  return (
    <div>
      <PageHeader
        title="Locação de equipamentos"
        description="Contratos de aluguel: cliente, obra, equipamento, período, caução e devolução."
        actions={
          <Button
            onClick={() => {
              setForm(vazio());
              setAberto(true);
            }}
          >
            <Plus className="size-4" /> Nova locação
          </Button>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Em locação" value={String(emLocacao.length)} icon={Truck} tone="accent" />
        <StatCard
          label="Reservadas"
          value={String(locacoes.filter((l) => l.situacao === "reservada").length)}
          icon={CalendarClock}
        />
        <StatCard label="Devolução atrasada" value={String(atrasadas.length)} tone="danger" />
        <StatCard
          label="Valor em locação"
          value={brl(emLocacao.reduce((s, l) => s + Number(l.valor_total ?? 0), 0))}
          tone="success"
        />
      </div>

      <div className="panel mb-4 flex flex-wrap items-center gap-2 p-3">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Buscar por número, cliente, obra ou equipamento"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>
        <Select value={filtro} onValueChange={setFiltro}>
          <SelectTrigger className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ativas">Reservadas e em locação</SelectItem>
            <SelectItem value="todas">Todas</SelectItem>
            {SITUACOES.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="panel p-6 text-sm text-muted-foreground">Carregando…</div>
      ) : lista.length === 0 ? (
        <EmptyState
          title="Nenhuma locação registrada."
          description="Registre a primeira locação escolhendo o cliente, o equipamento e o período."
          action={
            <Button
              onClick={() => {
                setForm(vazio());
                setAberto(true);
              }}
            >
              <Plus className="size-4" /> Nova locação
            </Button>
          }
        />
      ) : (
        <div className="panel overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nº</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Equipamento</TableHead>
                <TableHead>Obra</TableHead>
                <TableHead>Início</TableHead>
                <TableHead>Previsão</TableHead>
                <TableHead>Devolução</TableHead>
                <TableHead className="text-right">Dias</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {lista.map((l) => {
                const atrasada =
                  l.situacao === "em_andamento" &&
                  !!l.previsao_devolucao &&
                  l.previsao_devolucao < hojeISO();
                return (
                  <TableRow key={l.id}>
                    <TableCell className="text-numeric font-semibold">{l.numero}</TableCell>
                    <TableCell>{l.clientes?.nome ?? "—"}</TableCell>
                    <TableCell>{l.locacao_equipamentos?.nome ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{l.obras?.nome ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{dateBR(l.inicio)}</TableCell>
                    <TableCell className={atrasada ? "font-semibold text-destructive" : "text-muted-foreground"}>
                      {dateBR(l.previsao_devolucao)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{dateBR(l.devolvido_em)}</TableCell>
                    <TableCell className="text-right text-numeric">{l.dias}</TableCell>
                    <TableCell className="text-right text-numeric font-semibold">
                      {brl(Number(l.valor_total ?? 0))}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={l.situacao === "cancelada" ? "outline" : "secondary"}
                        className={
                          l.situacao === "devolvida"
                            ? "bg-success/15 text-success"
                            : atrasada
                              ? "bg-destructive/15 text-destructive"
                              : l.situacao === "em_andamento"
                                ? "bg-primary/15 text-primary"
                                : undefined
                        }
                      >
                        {!l.aprovada && l.situacao === "reservada"
                          ? "Solicitada"
                          : atrasada
                            ? "Atrasada"
                            : (SITUACOES.find((s) => s.value === l.situacao)?.label ?? l.situacao)}
                      </Badge>
                      {Number(l.valor_faturado ?? 0) > 0 && (
                        <span className="ml-1 text-xs text-success">faturada</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex flex-wrap justify-end gap-1">
                        {!l.aprovada && l.situacao !== "cancelada" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => acao.mutate({ id: l.id, tipo: "aprovar" })}
                          >
                            <ThumbsUp className="size-4" /> Aprovar
                          </Button>
                        )}
                        {l.aprovada && l.situacao === "reservada" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => acao.mutate({ id: l.id, tipo: "entregar" })}
                          >
                            <Truck className="size-4" /> Entregar
                          </Button>
                        )}
                        {l.situacao === "em_andamento" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => acao.mutate({ id: l.id, tipo: "devolver" })}
                          >
                            <CheckCircle2 className="size-4" /> Devolver
                          </Button>
                        )}
                        {l.situacao !== "cancelada" && Number(l.valor_faturado ?? 0) <= 0 && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              setCobranca({
                                ...cobrancaVazia,
                                id: l.id,
                                numero: l.numero,
                                valor: Number(l.valor_total ?? 0),
                              })
                            }
                          >
                            <Receipt className="size-4" /> Cobrar
                          </Button>
                        )}
                        {l.situacao !== "cancelada" && !l.nfe_id && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => gerarNota.mutate(l.id)}
                            disabled={gerarNota.isPending}
                          >
                            <FileText className="size-4" /> Nota de serviço
                          </Button>
                        )}
                        {!!l.nfe_id && (
                          <>
                            <Button variant="ghost" size="sm" onClick={() => baixarNota(l.id, "pdf")}>
                              <Download className="size-4" /> PDF
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => baixarNota(l.id, "xml")}>
                              <Code2 className="size-4" /> XML
                            </Button>
                          </>
                        )}
                        {["reservada", "em_andamento"].includes(l.situacao) && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => acao.mutate({ id: l.id, tipo: "cancelar" })}
                          >
                            <XCircle className="size-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Nova locação</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label>Cliente</Label>
              <ClienteCombobox
                clientes={clientes}
                value={form.cliente_id}
                onChange={(id) => setForm({ ...form, cliente_id: id, obra_id: "" })}
              />
            </div>
            <div>
              <Label>Obra (opcional)</Label>
              <Select value={form.obra_id} onValueChange={(v) => setForm({ ...form, obra_id: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="Sem obra" />
                </SelectTrigger>
                <SelectContent>
                  {obrasDoCliente.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Equipamento</Label>
              <Select
                value={form.equipamento_id}
                onValueChange={(v) => {
                  const eq = equipamentos.find((x) => x.id === v);
                  setForm({
                    ...form,
                    equipamento_id: v,
                    valor_diaria: String(eq?.valor_diaria ?? 0),
                    caucao: String(eq?.valor_caucao ?? 0),
                  });
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Escolha o equipamento" />
                </SelectTrigger>
                <SelectContent>
                  {equipamentos.map((e) => (
                    <SelectItem key={e.id} value={e.id} disabled={e.situacao === "manutencao"}>
                      {e.nome}
                      {e.situacao === "locado" ? " (locado)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Início</Label>
              <Input
                type="date"
                value={form.inicio}
                onChange={(e) => setForm({ ...form, inicio: e.target.value })}
              />
            </div>
            <div>
              <Label>Previsão de devolução</Label>
              <Input
                type="date"
                value={form.previsao_devolucao}
                onChange={(e) => setForm({ ...form, previsao_devolucao: e.target.value })}
              />
            </div>
            <div>
              <Label>Valor da diária</Label>
              <Input
                value={form.valor_diaria}
                onChange={(e) => setForm({ ...form, valor_diaria: e.target.value })}
              />
            </div>
            <div>
              <Label>Dias</Label>
              <Input value={form.dias} onChange={(e) => setForm({ ...form, dias: e.target.value })} />
            </div>
            <div>
              <Label>Caução</Label>
              <Input value={form.caucao} onChange={(e) => setForm({ ...form, caucao: e.target.value })} />
            </div>
            <div className="sm:col-span-2">
              <Label>Observações</Label>
              <Input
                value={form.observacoes}
                onChange={(e) => setForm({ ...form, observacoes: e.target.value })}
              />
            </div>
            <div className="rounded-md border border-border p-3 text-sm sm:col-span-2">
              <div className="flex justify-between font-semibold">
                <span>Total da locação</span>
                <span className="text-numeric">{brl(total)}</span>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAberto(false)}>
              Cancelar
            </Button>
            <Button onClick={() => salvar.mutate()} disabled={salvar.isPending}>
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!cobranca.id}
        onOpenChange={(v) => !v && setCobranca({ ...cobrancaVazia })}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Cobrar locação nº {cobranca.numero}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="rounded-md border border-border p-3 text-sm">
              <div className="flex justify-between font-semibold">
                <span>Valor a cobrar</span>
                <span className="text-numeric">{brl(cobranca.valor)}</span>
              </div>
            </div>
            <div>
              <Label>Forma de pagamento</Label>
              <Select
                value={cobranca.forma}
                onValueChange={(v) => setCobranca({ ...cobranca, forma: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="dinheiro">Dinheiro</SelectItem>
                  <SelectItem value="pix">PIX</SelectItem>
                  <SelectItem value="cartao_debito">Cartão de débito</SelectItem>
                  <SelectItem value="cartao_credito">Cartão de crédito</SelectItem>
                  <SelectItem value="boleto">Boleto</SelectItem>
                  <SelectItem value="transferencia">Transferência</SelectItem>
                  <SelectItem value="crediario">Crediário</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>Parcelas</Label>
                <Input
                  value={cobranca.parcelas}
                  onChange={(e) => setCobranca({ ...cobranca, parcelas: e.target.value })}
                />
              </div>
              <div>
                <Label>Primeiro vencimento</Label>
                <Input
                  type="date"
                  value={cobranca.vencimento}
                  onChange={(e) => setCobranca({ ...cobranca, vencimento: e.target.value })}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Dinheiro, PIX e cartão de débito entram no caixa aberto na hora. As outras formas ficam
              em contas a receber.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCobranca({ ...cobrancaVazia })}>
              Cancelar
            </Button>
            <Button onClick={() => faturar.mutate()} disabled={faturar.isPending}>
              Faturar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** O módulo só abre quando o CNAE da empresa permite. */
function LocacoesModulo() {
  const modulos = useModulosCnae();
  if (modulos.carregando) return <div className="panel h-40 animate-pulse" />;
  if (!modulos.locacao) return <ModuloBloqueado modulo="locacao" />;
  return <Locacoes />;
}
