import { useMemo, useRef, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileUp, ShoppingCart, Upload } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { brl, dateBR, num } from "@/lib/format";
import { EmptyState, PageHeader, StatCard } from "@/components/app/PageHeader";
import { lerXmlNfe, type NfeXmlLida } from "@/lib/nfe-xml";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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

export const Route = createFileRoute("/_authenticated/nfe-entrada")({
  head: () => ({
    meta: [
      { title: "Importar XML da nota de entrada — ERP Ze Tech" },
      {
        name: "description",
        content:
          "Importe o XML da NF-e do fornecedor para dar entrada no estoque, atualizar o custo de aquisição e gerar as contas a pagar.",
      },
      { property: "og:title", content: "Importar XML da nota de entrada — ERP Ze Tech" },
      {
        property: "og:description",
        content: "Entrada de mercadorias direto do XML da NF-e do fornecedor.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: NfeEntrada,
});

type ProdutoOpcao = {
  id: string;
  codigo_interno: string;
  codigo_barras: string | null;
  descricao: string;
  unidade: string;
  ncm: string | null;
};

const NOVO = "__novo__";

function normaliza(v: string | null | undefined) {
  return (v ?? "").trim().toUpperCase();
}

function NfeEntrada() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);

  const [lida, setLida] = useState<NfeXmlLida | null>(null);
  const [arquivo, setArquivo] = useState<string>("");
  const [depositoId, setDepositoId] = useState("");
  const [mapa, setMapa] = useState<Record<number, string>>({});
  const [gerarConta, setGerarConta] = useState(true);
  const [parcelas, setParcelas] = useState("1");
  const [vencimento, setVencimento] = useState("");

  const { data: depositos } = useQuery({
    queryKey: ["depositos-lista"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("depositos")
        .select("id, nome, tipo")
        .eq("ativo", true)
        .order("nome");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: produtos } = useQuery({
    queryKey: ["produtos-nfe-entrada"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("produtos")
        .select("id, codigo_interno, codigo_barras, descricao, unidade, ncm")
        .eq("ativo", true)
        .is("deleted_at", null)
        .order("descricao");
      if (error) throw error;
      return (data ?? []) as ProdutoOpcao[];
    },
  });

  const { data: vinculos } = useQuery({
    queryKey: ["nfe-entrada-vinculos"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("nfe_entrada_produtos")
        .select("codigo_fornecedor, codigo_barras, produto_id");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: importadas } = useQuery({
    queryKey: ["compras-xml"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("compras")
        .select("id, numero, nfe_numero, nfe_emissao, total, situacao, fornecedores(razao_social)")
        .eq("origem", "xml_nfe")
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data ?? [];
    },
  });

  function casarProduto(item: NfeXmlLida["itens"][number]): string {
    const porVinculo = (vinculos ?? []).find(
      (v) =>
        normaliza(v.codigo_fornecedor) === normaliza(item.codigo) ||
        (item.codigo_barras && normaliza(v.codigo_barras) === normaliza(item.codigo_barras)),
    );
    if (porVinculo?.produto_id) return porVinculo.produto_id;
    const lista = produtos ?? [];
    const porBarras = item.codigo_barras
      ? lista.find((p) => normaliza(p.codigo_barras) === normaliza(item.codigo_barras))
      : undefined;
    if (porBarras) return porBarras.id;
    const porCodigo = lista.find((p) => normaliza(p.codigo_interno) === normaliza(item.codigo));
    if (porCodigo) return porCodigo.id;
    const porDescricao = lista.find((p) => normaliza(p.descricao) === normaliza(item.descricao));
    if (porDescricao) return porDescricao.id;
    return NOVO;
  }

  async function aoEscolherArquivo(file: File) {
    try {
      const conteudo = await file.text();
      const parsed = lerXmlNfe(conteudo);
      if (parsed.itens.length === 0) {
        toast.error("O XML não tem itens de produto.");
        return;
      }
      setLida(parsed);
      setArquivo(file.name);
      const inicial: Record<number, string> = {};
      parsed.itens.forEach((item) => {
        inicial[item.seq] = casarProduto(item);
      });
      setMapa(inicial);
      setParcelas(String(parsed.nota.parcelas));
      setVencimento(parsed.nota.primeiro_vencimento ?? "");
      if (!depositoId && (depositos ?? []).length > 0) {
        setDepositoId(depositos?.[0]?.id ?? "");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível ler o arquivo.");
    }
  }

  const resumo = useMemo(() => {
    if (!lida) return { itens: 0, novos: 0, total: 0 };
    const novos = lida.itens.filter((i) => (mapa[i.seq] ?? NOVO) === NOVO).length;
    return {
      itens: lida.itens.length,
      novos,
      total: lida.itens.reduce((s, i) => s + i.total, 0),
    };
  }, [lida, mapa]);

  const importar = useMutation({
    mutationFn: async () => {
      if (!lida) throw new Error("Escolha o XML da nota.");
      if (!depositoId) throw new Error("Escolha o depósito que vai receber a mercadoria.");
      const itens = lida.itens.map((i) => {
        const escolha = mapa[i.seq] ?? NOVO;
        return {
          ...(escolha !== NOVO ? { produto_id: escolha } : {}),
          codigo: i.codigo,
          codigo_barras: i.codigo_barras,
          descricao: i.descricao,
          ncm: i.ncm,
          unidade: i.unidade,
          quantidade: i.quantidade,
          custo_unitario: i.custo_unitario,
        };
      });
      const { data, error } = await supabase.rpc("importar_nfe_entrada", {
        p_nota: {
          chave: lida.nota.chave,
          numero: lida.nota.numero,
          emissao: lida.nota.emissao,
          frete: lida.nota.frete,
          desconto: lida.nota.desconto,
          condicao_pagamento: lida.nota.condicao_pagamento,
          observacao: `NF-e ${lida.nota.numero ?? ""} — ${lida.fornecedor.razao_social}`,
          primeiro_vencimento: lida.nota.primeiro_vencimento,
        },
        p_fornecedor: lida.fornecedor,
        p_itens: itens,
        p_deposito_id: depositoId,
        p_gerar_conta: gerarConta,
        p_parcelas: Math.max(1, Number(parcelas) || 1),
        ...(vencimento ? { p_vencimento: vencimento } : {}),
      });
      if (error) throw error;
      return data as { compra_id: string; numero: number; produtos_criados: number };
    },
    onSuccess: (res) => {
      toast.success(
        res.produtos_criados > 0
          ? `Nota importada. Compra nº ${res.numero} criada e ${res.produtos_criados} produto(s) cadastrado(s).`
          : `Nota importada. Compra nº ${res.numero} criada e estoque atualizado.`,
      );
      queryClient.invalidateQueries();
      setLida(null);
      setArquivo("");
      void navigate({ to: "/compras/$id", params: { id: res.compra_id } });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Não foi possível importar."),
  });

  return (
    <div>
      <PageHeader
        title="Importar XML da nota de entrada"
        description="Leia o XML da NF-e do fornecedor para dar entrada no estoque, atualizar o custo de aquisição e gerar as contas a pagar."
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to="/compras">
                <ShoppingCart className="size-4" /> Pedidos de compra
              </Link>
            </Button>
            <Button onClick={() => inputRef.current?.click()}>
              <Upload className="size-4" /> Escolher arquivo XML
            </Button>
          </>
        }
      />

      <input
        ref={inputRef}
        type="file"
        accept=".xml,text/xml,application/xml"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void aoEscolherArquivo(f);
          e.target.value = "";
        }}
      />

      {!lida ? (
        <EmptyState
          title="Nenhuma nota carregada"
          description="Selecione o arquivo XML enviado pelo fornecedor. O sistema identifica o fornecedor pelo CNPJ, casa os produtos pelo código ou código de barras e cadastra os que ainda não existem."
          action={
            <Button onClick={() => inputRef.current?.click()}>
              <FileUp className="size-4" /> Escolher arquivo XML
            </Button>
          }
        />
      ) : (
        <>
          <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Fornecedor"
              value={lida.fornecedor.razao_social}
              hint={lida.fornecedor.cnpj ?? ""}
            />
            <StatCard
              label="Nota"
              value={`nº ${lida.nota.numero ?? "—"}`}
              hint={lida.nota.emissao ? dateBR(lida.nota.emissao) : arquivo}
            />
            <StatCard
              label="Itens"
              value={String(resumo.itens)}
              hint={`${resumo.novos} produto(s) novo(s)`}
              tone="warning"
            />
            <StatCard label="Valor dos produtos" value={brl(resumo.total)} tone="accent" />
          </div>

          <div className="panel mb-4 grid gap-4 p-4 sm:grid-cols-2 xl:grid-cols-4">
            <div>
              <Label>Depósito que recebe</Label>
              <Select value={depositoId} onValueChange={setDepositoId}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Escolha o depósito" />
                </SelectTrigger>
                <SelectContent>
                  {(depositos ?? []).map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Parcelas da nota</Label>
              <Input
                className="mt-1"
                type="number"
                min={1}
                value={parcelas}
                onChange={(e) => setParcelas(e.target.value)}
              />
            </div>
            <div>
              <Label>Primeiro vencimento</Label>
              <Input
                className="mt-1"
                type="date"
                value={vencimento}
                onChange={(e) => setVencimento(e.target.value)}
              />
            </div>
            <div className="flex items-end gap-3">
              <Switch id="gerar-conta" checked={gerarConta} onCheckedChange={setGerarConta} />
              <Label htmlFor="gerar-conta" className="mb-1">
                Gerar contas a pagar
              </Label>
            </div>
          </div>

          <div className="panel overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item da nota</TableHead>
                  <TableHead>Produto na loja</TableHead>
                  <TableHead className="text-right">Qtd.</TableHead>
                  <TableHead className="text-right">Custo unit.</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lida.itens.map((item) => {
                  const escolha = mapa[item.seq] ?? NOVO;
                  return (
                    <TableRow key={item.seq}>
                      <TableCell>
                        <p className="font-medium">{item.descricao}</p>
                        <p className="text-xs text-muted-foreground">
                          Cód. {item.codigo || "—"}
                          {item.codigo_barras ? ` · EAN ${item.codigo_barras}` : ""}
                          {item.ncm ? ` · NCM ${item.ncm}` : ""} · {item.unidade}
                        </p>
                      </TableCell>
                      <TableCell className="min-w-[280px]">
                        <Select
                          value={escolha}
                          onValueChange={(v) => setMapa((m) => ({ ...m, [item.seq]: v }))}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NOVO}>Cadastrar novo produto</SelectItem>
                            {(produtos ?? []).map((p) => (
                              <SelectItem key={p.id} value={p.id}>
                                {p.codigo_interno} — {p.descricao}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {escolha === NOVO && (
                          <Badge variant="outline" className="mt-1">
                            Novo cadastro
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-numeric">
                        {num(item.quantidade)}
                      </TableCell>
                      <TableCell className="text-right text-numeric">
                        {brl(item.custo_unitario)}
                      </TableCell>
                      <TableCell className="text-right text-numeric">{brl(item.total)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
            <Button variant="outline" onClick={() => setLida(null)}>
              Cancelar
            </Button>
            <Button disabled={importar.isPending} onClick={() => importar.mutate()}>
              <Upload className="size-4" />
              {importar.isPending ? "Importando..." : "Importar e dar entrada no estoque"}
            </Button>
          </div>
        </>
      )}

      {(importadas ?? []).length > 0 && (
        <div className="panel mt-6 overflow-x-auto">
          <p className="px-4 pt-4 font-display text-base font-semibold">Notas já importadas</p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Compra</TableHead>
                <TableHead>Fornecedor</TableHead>
                <TableHead>NF-e</TableHead>
                <TableHead>Emissão</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(importadas ?? []).map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <Link
                      className="font-medium underline-offset-2 hover:underline"
                      to="/compras/$id"
                      params={{ id: c.id }}
                    >
                      nº {c.numero}
                    </Link>
                  </TableCell>
                  <TableCell>{c.fornecedores?.razao_social ?? "—"}</TableCell>
                  <TableCell>{c.nfe_numero ?? "—"}</TableCell>
                  <TableCell>{c.nfe_emissao ? dateBR(c.nfe_emissao) : "—"}</TableCell>
                  <TableCell className="text-right text-numeric">
                    {brl(Number(c.total ?? 0))}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
