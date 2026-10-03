import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, FileText, Package, Warehouse } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useSessionData } from "@/hooks/useSessionData";
import { useSaasOperador } from "@/lib/saas";
import { brl, num } from "@/lib/format";
import { EmptyState, PageHeader, StatCard } from "@/components/app/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

export const Route = createFileRoute("/_authenticated/filial-extra")({
  head: () => ({
    meta: [
      { title: "Filial extra — ERP Ze Tech" },
      {
        name: "description",
        content:
          "Monte a segunda loja antes de pagar a implantação: depósito próprio, produtos com custo e numeração de NF-e da filial.",
      },
      { property: "og:title", content: "Filial extra — ERP Ze Tech" },
      {
        property: "og:description",
        content: "Depósito, produtos, custos e NF-e própria da filial extra.",
      },
    ],
  }),
  component: FilialExtra,
});

function FilialExtra() {
  const qc = useQueryClient();
  const { data: session } = useSessionData();
  /** Abrir filial é operação exclusiva da equipe Ze Tech. */
  const { data: operadorSaas } = useSaasOperador();
  const empresaId = session?.profile?.empresa_id ?? session?.empresa?.id ?? null;
  const tenantId = session?.profile?.tenant_id ?? null;

  const [filialId, setFilialId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["filial-extra"],
    queryFn: async () => {
      const [filiaisRes, depositosRes, produtosRes, fiscaisRes] = await Promise.all([
        supabase.from("filiais").select("*").order("created_at"),
        supabase.from("depositos").select("*").order("nome"),
        supabase
          .from("produtos")
          .select(
            "id, codigo_interno, descricao, unidade, custo, preco_venda, ncm, cfop, cst_csosn",
          )
          .eq("ativo", true)
          .order("descricao"),
        supabase.from("fiscal_config").select("*"),
      ]);
      return {
        filiais: filiaisRes.data ?? [],
        depositos: depositosRes.data ?? [],
        produtos: produtosRes.data ?? [],
        fiscais: fiscaisRes.data ?? [],
      };
    },
  });

  const filiais = data?.filiais ?? [];
  const filial = filiais.find((f) => f.id === filialId) ?? filiais[1] ?? filiais[0] ?? null;
  const depositos = (data?.depositos ?? []).filter((d) => d.filial_id === filial?.id);
  const fiscal = (data?.fiscais ?? []).find((f) => f.filial_id === filial?.id) ?? null;
  const produtos = data?.produtos ?? [];

  const { data: estoques } = useQuery({
    queryKey: ["filial-extra-estoque", depositos.map((d) => d.id).join(",")],
    enabled: depositos.length > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from("estoques")
        .select("id, produto_id, deposito_id, quantidade, custo_medio")
        .in(
          "deposito_id",
          depositos.map((d) => d.id),
        );
      return data ?? [];
    },
  });

  const linhas = useMemo(() => {
    const porProduto = new Map<string, { qtd: number; custo: number; id: string | null }>();
    for (const e of estoques ?? []) {
      const atual = porProduto.get(e.produto_id) ?? { qtd: 0, custo: 0, id: null };
      porProduto.set(e.produto_id, {
        qtd: atual.qtd + Number(e.quantidade),
        custo: Number(e.custo_medio) > 0 ? Number(e.custo_medio) : atual.custo,
        id: e.id,
      });
    }
    return produtos.map((p) => {
      const info = porProduto.get(p.id);
      const custo = info && info.custo > 0 ? info.custo : Number(p.custo);
      return {
        produto: p,
        estoqueId: info?.id ?? null,
        quantidade: info?.qtd ?? 0,
        custo,
        margem:
          Number(p.preco_venda) > 0 && custo > 0
            ? ((Number(p.preco_venda) - custo) / Number(p.preco_venda)) * 100
            : 0,
        fiscalOk: !!p.ncm && !!p.cfop && !!p.cst_csosn,
      };
    });
  }, [produtos, estoques]);

  const [busca, setBusca] = useState("");
  const visiveis = linhas.filter(
    (l) =>
      !busca.trim() ||
      l.produto.descricao.toLowerCase().includes(busca.toLowerCase()) ||
      l.produto.codigo_interno.toLowerCase().includes(busca.toLowerCase()),
  );

  /* ---------- nova filial ---------- */
  const [novaAberta, setNovaAberta] = useState(false);
  const [nova, setNova] = useState({
    nome: "",
    codigo: "",
    cnpj: "",
    inscricao_estadual: "",
    cidade: "",
    estado: "",
    bairro: "",
    endereco: "",
    numero: "",
    telefone: "",
  });

  const criarFilial = useMutation({
    mutationFn: async () => {
      if (!tenantId || !empresaId) throw new Error("Empresa não identificada");
      if (nova.nome.trim().length < 2) throw new Error("Informe o nome da filial");
      const { data: filialNova, error } = await supabase
        .from("filiais")
        .insert({
          tenant_id: tenantId,
          empresa_id: empresaId,
          nome: nova.nome.trim(),
          codigo: nova.codigo.trim() || null,
          cnpj: nova.cnpj.trim() || null,
          inscricao_estadual: nova.inscricao_estadual.trim() || null,
          cidade: nova.cidade.trim() || null,
          estado: nova.estado.trim() || null,
          bairro: nova.bairro.trim() || null,
          endereco: nova.endereco.trim() || null,
          numero: nova.numero.trim() || null,
          telefone: nova.telefone.trim() || null,
          situacao: "implantacao",
        })
        .select("id")
        .single();
      if (error) throw error;

      const { error: errDep } = await supabase.from("depositos").insert({
        tenant_id: tenantId,
        filial_id: filialNova.id,
        nome: `Depósito ${nova.nome.trim()}`,
        tipo: "loja",
      });
      if (errDep) throw errDep;

      const { error: errFiscal } = await supabase.from("fiscal_config").insert({
        tenant_id: tenantId,
        empresa_id: empresaId,
        filial_id: filialNova.id,
        serie: 2,
        proximo_numero: 1,
        ambiente: "homologacao",
        cfop_padrao: "5102",
      });
      if (errFiscal) throw errFiscal;
      return filialNova.id;
    },
    onSuccess: (id) => {
      toast.success("Filial extra criada em implantação");
      setNovaAberta(false);
      setFilialId(id);
      qc.invalidateQueries({ queryKey: ["filial-extra"] });
      qc.invalidateQueries({ queryKey: ["session-data"] });
    },
    onError: (e: Error) => toast.error("Erro", { description: e.message }),
  });

  /* ---------- fiscal da filial ---------- */
  const [fiscalAberto, setFiscalAberto] = useState(false);
  const [formFiscal, setFormFiscal] = useState({
    serie: "2",
    proximo_numero: "1",
    ambiente: "homologacao",
    cfop_padrao: "5102",
  });

  function abrirFiscal() {
    setFormFiscal({
      serie: String(fiscal?.serie ?? 2),
      proximo_numero: String(fiscal?.proximo_numero ?? 1),
      ambiente: fiscal?.ambiente ?? "homologacao",
      cfop_padrao: fiscal?.cfop_padrao ?? "5102",
    });
    setFiscalAberto(true);
  }

  const salvarFiscal = useMutation({
    mutationFn: async () => {
      if (!filial || !tenantId) throw new Error("Selecione a filial");
      const valores = {
        serie: Number(formFiscal.serie) || 2,
        proximo_numero: Number(formFiscal.proximo_numero) || 1,
        ambiente: formFiscal.ambiente,
        cfop_padrao: formFiscal.cfop_padrao.trim() || "5102",
      };
      if (fiscal) {
        const { error } = await supabase.from("fiscal_config").update(valores).eq("id", fiscal.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("fiscal_config").insert({
          tenant_id: tenantId,
          empresa_id: empresaId,
          filial_id: filial.id,
          ...valores,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("NF-e da filial atualizada");
      setFiscalAberto(false);
      qc.invalidateQueries({ queryKey: ["filial-extra"] });
    },
    onError: (e: Error) => toast.error("Erro", { description: e.message }),
  });

  /* ---------- custo por produto na filial ---------- */
  const salvarCusto = useMutation({
    mutationFn: async ({
      produtoId,
      estoqueId,
      custo,
    }: {
      produtoId: string;
      estoqueId: string | null;
      custo: number;
    }) => {
      const deposito = depositos[0];
      if (!deposito || !tenantId) throw new Error("Crie o depósito da filial primeiro");
      if (estoqueId) {
        const { error } = await supabase
          .from("estoques")
          .update({ custo_medio: custo })
          .eq("id", estoqueId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("estoques").insert({
          tenant_id: tenantId,
          produto_id: produtoId,
          deposito_id: deposito.id,
          quantidade: 0,
          custo_medio: custo,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Custo da filial atualizado");
      qc.invalidateQueries({ queryKey: ["filial-extra-estoque"] });
    },
    onError: (e: Error) => toast.error("Erro", { description: e.message }),
  });

  const ativarFilial = useMutation({
    mutationFn: async () => {
      if (!filial) return;
      const { error } = await supabase
        .from("filiais")
        .update({ situacao: "ativa" })
        .eq("id", filial.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Filial ativada");
      qc.invalidateQueries({ queryKey: ["filial-extra"] });
    },
    onError: (e: Error) => toast.error("Erro", { description: e.message }),
  });

  const semFiscal = linhas.filter((l) => !l.fiscalOk).length;
  const comCusto = linhas.filter((l) => l.custo > 0).length;

  return (
    <>
      <PageHeader
        title="Filial extra"
        description="Monte a segunda loja com depósito, produtos, custos e NF-e própria antes de pagar a implantação."
        actions={
          <>
            {filiais.length > 1 && (
              <Select value={filial?.id ?? ""} onValueChange={setFilialId}>
                <SelectTrigger className="w-56">
                  <SelectValue placeholder="Filial" />
                </SelectTrigger>
                <SelectContent>
                  {filiais.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {operadorSaas && (
              <Button variant="outline" onClick={() => setNovaAberta(true)}>
                <Building2 className="mr-2 size-4" /> Nova filial
              </Button>
            )}
          </>
        }
      />

      {isLoading ? (
        <div className="panel h-52 animate-pulse" />
      ) : !filial ? (
        <EmptyState
          title="Nenhuma filial cadastrada."
          description="A abertura de uma nova filial é feita pela equipe Ze Tech. Fale com a Ze Tech para liberar a filial extra."
          action={
            operadorSaas ? (
              <Button onClick={() => setNovaAberta(true)}>Nova filial</Button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Filial"
              value={filial.nome}
              hint={[filial.cidade, filial.estado].filter(Boolean).join(" / ") || "Sem endereço"}
              icon={Building2}
              tone="accent"
            />
            <StatCard
              label="Depósito"
              value={depositos[0]?.nome ?? "—"}
              hint={`${depositos.length} depósito(s) da filial`}
              icon={Warehouse}
            />
            <StatCard
              label="Produtos com custo"
              value={`${comCusto}/${linhas.length}`}
              hint="Custo de aquisição definido nesta filial"
              icon={Package}
            />
            <StatCard
              label="NF-e da filial"
              value={
                fiscal ? `Série ${fiscal.serie} · nº ${fiscal.proximo_numero}` : "não configurada"
              }
              hint={fiscal?.ambiente === "producao" ? "Ambiente real" : "Ambiente de teste"}
              icon={FileText}
              tone={semFiscal > 0 ? "warning" : "success"}
            />
          </div>

          <div className="panel flex flex-wrap items-center gap-3 p-5">
            <Badge variant={filial.situacao === "ativa" ? "default" : "secondary"}>
              {filial.situacao === "ativa" ? "Ativa" : "Em implantação"}
            </Badge>
            <span className="text-sm text-muted-foreground">
              CNPJ {filial.cnpj || "—"} · IE {filial.inscricao_estadual || "—"}
            </span>
            {semFiscal > 0 && (
              <span className="text-sm text-warning-foreground">
                {semFiscal} produto(s) sem NCM, CFOP ou CST
              </span>
            )}
            <div className="ml-auto flex gap-2">
              <Button variant="outline" onClick={abrirFiscal}>
                Configurar NF-e da filial
              </Button>
              {filial.situacao !== "ativa" && (
                <Button onClick={() => ativarFilial.mutate()} disabled={ativarFilial.isPending}>
                  Ativar filial
                </Button>
              )}
            </div>
          </div>

          <div className="panel">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
              <p className="font-display text-sm font-semibold">Produtos e custos desta filial</p>
              <Input
                className="w-64"
                placeholder="Buscar produto ou código"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
              />
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Produto</TableHead>
                    <TableHead>Estoque</TableHead>
                    <TableHead className="w-40">Custo na filial</TableHead>
                    <TableHead className="text-right">Preço de venda</TableHead>
                    <TableHead className="text-right">Margem</TableHead>
                    <TableHead>Fiscal</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visiveis.slice(0, 60).map((l) => (
                    <TableRow key={l.produto.id}>
                      <TableCell>
                        <p className="text-sm font-medium">{l.produto.descricao}</p>
                        <p className="text-xs text-muted-foreground">{l.produto.codigo_interno}</p>
                      </TableCell>
                      <TableCell className="text-sm">
                        {num(l.quantidade, 2)} {l.produto.unidade}
                      </TableCell>
                      <TableCell>
                        <Input
                          inputMode="decimal"
                          defaultValue={l.custo.toFixed(2)}
                          onBlur={(e) => {
                            const valor = Number(e.target.value.replace(",", "."));
                            if (!Number.isFinite(valor) || valor < 0) return;
                            if (Math.abs(valor - l.custo) < 0.005) return;
                            salvarCusto.mutate({
                              produtoId: l.produto.id,
                              estoqueId: l.estoqueId,
                              custo: valor,
                            });
                          }}
                        />
                      </TableCell>
                      <TableCell className="text-right text-numeric">
                        {brl(Number(l.produto.preco_venda))}
                      </TableCell>
                      <TableCell className="text-right text-numeric">{num(l.margem, 1)}%</TableCell>
                      <TableCell>
                        {l.fiscalOk ? (
                          <Badge variant="outline">OK</Badge>
                        ) : (
                          <Badge variant="destructive">pendente</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </div>
      )}

      {/* nova filial */}
      <Dialog open={novaAberta} onOpenChange={setNovaAberta}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Nova filial extra</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            {(
              [
                ["nome", "Nome da filial"],
                ["codigo", "Código"],
                ["cnpj", "CNPJ"],
                ["inscricao_estadual", "Inscrição estadual"],
                ["endereco", "Endereço"],
                ["numero", "Número"],
                ["bairro", "Bairro"],
                ["cidade", "Cidade"],
                ["estado", "Estado (UF)"],
                ["telefone", "Telefone"],
              ] as const
            ).map(([campo, label]) => (
              <div key={campo}>
                <Label>{label}</Label>
                <Input
                  className="mt-1"
                  value={nova[campo]}
                  onChange={(e) => setNova({ ...nova, [campo]: e.target.value })}
                />
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            A filial nasce em implantação, já com um depósito próprio e a numeração de NF-e série 2.
            A cobrança da filial extra só entra quando você ativá-la em Plano e assinatura.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNovaAberta(false)}>
              Cancelar
            </Button>
            <Button onClick={() => criarFilial.mutate()} disabled={criarFilial.isPending}>
              Criar filial
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* fiscal da filial */}
      <Dialog open={fiscalAberto} onOpenChange={setFiscalAberto}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>NF-e da filial</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Série</Label>
              <Input
                className="mt-1"
                inputMode="numeric"
                value={formFiscal.serie}
                onChange={(e) => setFormFiscal({ ...formFiscal, serie: e.target.value })}
              />
            </div>
            <div>
              <Label>Próximo número</Label>
              <Input
                className="mt-1"
                inputMode="numeric"
                value={formFiscal.proximo_numero}
                onChange={(e) => setFormFiscal({ ...formFiscal, proximo_numero: e.target.value })}
              />
            </div>
            <div>
              <Label>Ambiente</Label>
              <Select
                value={formFiscal.ambiente}
                onValueChange={(v) => setFormFiscal({ ...formFiscal, ambiente: v })}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="homologacao">Teste (homologação)</SelectItem>
                  <SelectItem value="producao">Real (produção)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>CFOP padrão</Label>
              <Input
                className="mt-1"
                value={formFiscal.cfop_padrao}
                onChange={(e) => setFormFiscal({ ...formFiscal, cfop_padrao: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFiscalAberto(false)}>
              Cancelar
            </Button>
            <Button onClick={() => salvarFiscal.mutate()} disabled={salvarFiscal.isPending}>
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
