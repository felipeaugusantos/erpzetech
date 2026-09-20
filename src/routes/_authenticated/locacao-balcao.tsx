import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, FileText, Minus, Plus, Receipt, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useModulosCnae } from "@/lib/cnae";
import { ModuloBloqueado } from "@/components/app/ModuloCnae";
import { brl } from "@/lib/format";
import { ClienteCombobox } from "@/components/app/ClienteCombobox";
import { EmptyState, PageHeader, StatCard } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/locacao-balcao")({
  head: () => ({
    meta: [
      { title: "Balcão de locação — ERP Ze Tech" },
      {
        name: "description",
        content:
          "O cliente escolhe os equipamentos, o período e paga na hora, com nota fiscal de serviço.",
      },
      { property: "og:title", content: "Balcão de locação — ERP Ze Tech" },
      {
        property: "og:description",
        content: "Locação rápida no balcão: equipamentos, período, pagamento e NFS-e.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: BalcaoModulo,
});

const FORMAS = [
  { value: "dinheiro", label: "Dinheiro" },
  { value: "pix", label: "PIX" },
  { value: "cartao_debito", label: "Cartão de débito" },
  { value: "cartao_credito", label: "Cartão de crédito" },
  { value: "boleto", label: "Boleto" },
  { value: "transferencia", label: "Transferência" },
  { value: "crediario", label: "Crediário" },
];

const hojeISO = () => new Date().toISOString().slice(0, 10);

type ItemCarrinho = { equipamento_id: string; nome: string; codigo: string; quantidade: number; valor_diaria: number };

function Balcao() {
  const queryClient = useQueryClient();
  const [busca, setBusca] = useState("");
  const [carrinho, setCarrinho] = useState<ItemCarrinho[]>([]);
  const [clienteId, setClienteId] = useState("");
  const [obraId, setObraId] = useState("");
  const [inicio, setInicio] = useState(hojeISO());
  const [dias, setDias] = useState("1");
  const [caucao, setCaucao] = useState("0");
  const [forma, setForma] = useState("dinheiro");
  const [parcelas, setParcelas] = useState("1");
  const [vencimento, setVencimento] = useState(hojeISO());
  const [entregar, setEntregar] = useState(true);
  const [gerarNfse, setGerarNfse] = useState(true);
  const [observacoes, setObservacoes] = useState("");

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

  const { data: equipamentos = [], isLoading } = useQuery({
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

  const numeroDias = Math.max(Number(dias || 0), 1);

  const lista = useMemo(() => {
    const t = busca.trim().toLowerCase();
    if (!t) return equipamentos;
    return equipamentos.filter((e) =>
      [e.nome, e.codigo, e.marca, e.modelo]
        .filter(Boolean)
        .some((x) => String(x).toLowerCase().includes(t)),
    );
  }, [equipamentos, busca]);

  const total = useMemo(
    () => carrinho.reduce((s, i) => s + i.valor_diaria * i.quantidade * numeroDias, 0),
    [carrinho, numeroDias],
  );

  const adicionar = (eq: (typeof equipamentos)[number]) => {
    setCarrinho((atual) => {
      const existe = atual.find((i) => i.equipamento_id === eq.id);
      if (existe) {
        return atual.map((i) =>
          i.equipamento_id === eq.id ? { ...i, quantidade: i.quantidade + 1 } : i,
        );
      }
      return [
        ...atual,
        {
          equipamento_id: eq.id,
          nome: eq.nome,
          codigo: eq.codigo ?? "",
          quantidade: 1,
          valor_diaria: Number(eq.valor_diaria ?? 0),
        },
      ];
    });
  };

  const mudarQtd = (id: string, delta: number) =>
    setCarrinho((atual) =>
      atual
        .map((i) =>
          i.equipamento_id === id ? { ...i, quantidade: Math.max(i.quantidade + delta, 0) } : i,
        )
        .filter((i) => i.quantidade > 0),
    );

  const limpar = () => {
    setCarrinho([]);
    setClienteId("");
    setObraId("");
    setDias("1");
    setCaucao("0");
    setObservacoes("");
    setParcelas("1");
  };

  const registrar = useMutation({
    mutationFn: async () => {
      if (!clienteId) throw new Error("Escolha o cliente");
      if (carrinho.length === 0) throw new Error("Escolha pelo menos um equipamento");
      const { data, error } = await supabase.rpc("locacao_balcao_registrar", {
        p_cliente_id: clienteId,
        p_itens: carrinho.map((i) => ({
          equipamento_id: i.equipamento_id,
          quantidade: i.quantidade,
          valor_diaria: i.valor_diaria,
        })) as never,
        p_inicio: inicio,
        p_dias: numeroDias,
        p_obra_id: obraId || null,
        p_caucao: Number(caucao.replace(",", ".") || 0),
        p_observacoes: observacoes || null,
        p_forma: forma as never,
        p_parcelas: Number(parcelas || 1),
        p_vencimento: vencimento,
        p_entregar: entregar,
        p_gerar_nfse: gerarNfse,
        ...(caixaAberto?.id ? { p_caixa_id: caixaAberto.id } : {}),
      });
      if (error) throw error;
      return data as { numero: number; total: number; nfse_id: string | null };
    },
    onSuccess: (r) => {
      toast.success(
        `Locação nº ${r?.numero} registrada — ${brl(Number(r?.total ?? 0))}${
          r?.nfse_id ? " com nota fiscal de serviço gerada." : "."
        }`,
      );
      if (gerarNfse && !r?.nfse_id) {
        toast.info(
          "A nota de serviço ficou pendente: confira inscrição municipal, código do serviço e ISS em Impostos da empresa.",
        );
      }
      limpar();
      void queryClient.invalidateQueries({ queryKey: ["locacoes"] });
      void queryClient.invalidateQueries({ queryKey: ["locacao-equipamentos"] });
      void queryClient.invalidateQueries({ queryKey: ["contas-receber"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const obrasDoCliente = obras.filter((o) => !clienteId || o.cliente_id === clienteId);
  const aVista = ["dinheiro", "pix", "cartao_debito"].includes(forma);

  return (
    <div>
      <PageHeader
        title="Balcão de locação"
        description="O cliente escolhe os equipamentos, o período e paga na hora — com nota fiscal de serviço."
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Itens escolhidos" value={String(carrinho.length)} icon={CalendarClock} />
        <StatCard label="Dias de locação" value={String(numeroDias)} />
        <StatCard label="Total da locação" value={brl(total)} tone="success" icon={Receipt} />
        <StatCard
          label="Caixa"
          value={caixaAberto?.id ? "Aberto" : "Fechado"}
          hint={aVista ? "Pagamento à vista entra no caixa" : "Vai para contas a receber"}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="panel p-4">
          <div className="relative mb-3">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Buscar equipamento por nome, código, marca ou modelo"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
          </div>

          {isLoading ? (
            <div className="h-40 animate-pulse rounded-md bg-secondary" />
          ) : lista.length === 0 ? (
            <EmptyState
              title="Nenhum equipamento encontrado."
              description="Cadastre os equipamentos em Locação de equipamentos › Equipamentos."
            />
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {lista.map((eq) => (
                <button
                  key={eq.id}
                  type="button"
                  onClick={() => adicionar(eq)}
                  className="rounded-lg border p-3 text-left transition hover:border-primary hover:bg-secondary/60"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium">{eq.nome}</p>
                      <p className="text-xs text-muted-foreground">
                        {eq.codigo ?? "—"}
                        {eq.marca ? ` · ${eq.marca}` : ""}
                      </p>
                    </div>
                    <Badge variant="secondary">{brl(Number(eq.valor_diaria ?? 0))}/dia</Badge>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="panel space-y-3 p-4">
          <div>
            <Label>Cliente</Label>
            <ClienteCombobox
              clientes={clientes}
              value={clienteId}
              onChange={(id) => {
                setClienteId(id);
                setObraId("");
              }}
            />
          </div>

          <div>
            <Label>Obra (opcional)</Label>
            <Select value={obraId} onValueChange={setObraId}>
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

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Início</Label>
              <Input type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} />
            </div>
            <div>
              <Label>Dias</Label>
              <Input
                inputMode="numeric"
                value={dias}
                onChange={(e) => setDias(e.target.value.replace(/\D/g, ""))}
              />
            </div>
          </div>

          <div className="rounded-lg border">
            {carrinho.length === 0 ? (
              <p className="p-3 text-sm text-muted-foreground">
                Toque nos equipamentos ao lado para montar a locação.
              </p>
            ) : (
              <ul className="divide-y">
                {carrinho.map((i) => (
                  <li key={i.equipamento_id} className="flex items-center gap-2 p-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{i.nome}</p>
                      <p className="text-xs text-muted-foreground">
                        {brl(i.valor_diaria)}/dia × {numeroDias} dia(s)
                      </p>
                    </div>
                    <Button variant="ghost" size="icon" onClick={() => mudarQtd(i.equipamento_id, -1)}>
                      <Minus className="size-4" />
                    </Button>
                    <span className="w-6 text-center text-numeric">{i.quantidade}</span>
                    <Button variant="ghost" size="icon" onClick={() => mudarQtd(i.equipamento_id, 1)}>
                      <Plus className="size-4" />
                    </Button>
                    <span className="w-24 text-right text-numeric font-semibold">
                      {brl(i.valor_diaria * i.quantidade * numeroDias)}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        setCarrinho((a) => a.filter((x) => x.equipamento_id !== i.equipamento_id))
                      }
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Forma de pagamento</Label>
              <Select value={forma} onValueChange={setForma}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FORMAS.map((f) => (
                    <SelectItem key={f.value} value={f.value}>
                      {f.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Parcelas</Label>
              <Input
                inputMode="numeric"
                value={parcelas}
                onChange={(e) => setParcelas(e.target.value.replace(/\D/g, ""))}
              />
            </div>
            <div>
              <Label>1º vencimento</Label>
              <Input type="date" value={vencimento} onChange={(e) => setVencimento(e.target.value)} />
            </div>
            <div>
              <Label>Caução</Label>
              <Input value={caucao} onChange={(e) => setCaucao(e.target.value)} />
            </div>
          </div>

          <div>
            <Label>Observações</Label>
            <Textarea
              rows={2}
              value={observacoes}
              onChange={(e) => setObservacoes(e.target.value)}
              placeholder="Combinado de retirada, acessórios, responsável…"
            />
          </div>

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">Entregar agora</p>
              <p className="text-xs text-muted-foreground">
                O equipamento sai como em locação; desligue para apenas reservar.
              </p>
            </div>
            <Switch checked={entregar} onCheckedChange={setEntregar} />
          </div>

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">Gerar nota fiscal de serviço</p>
              <p className="text-xs text-muted-foreground">
                Locação é serviço: a nota sai como NFS-e com ISS, e entra no balanço e no relatório
                fiscal.
              </p>
            </div>
            <Switch checked={gerarNfse} onCheckedChange={setGerarNfse} />
          </div>

          <div className="flex items-center justify-between border-t pt-3">
            <span className="text-sm text-muted-foreground">Total</span>
            <span className="font-display text-2xl font-bold">{brl(total)}</span>
          </div>

          <Button
            className="w-full"
            size="lg"
            onClick={() => registrar.mutate()}
            disabled={registrar.isPending}
          >
            <FileText className="size-4" /> Fechar locação e cobrar
          </Button>
        </div>
      </div>
    </div>
  );
}

/** O módulo só abre quando o CNAE da empresa permite. */
function BalcaoModulo() {
  const modulos = useModulosCnae();
  if (modulos.carregando) return <div className="panel h-40 animate-pulse" />;
  if (!modulos.locacao) return <ModuloBloqueado modulo="locacao" />;
  return <Balcao />;
}
