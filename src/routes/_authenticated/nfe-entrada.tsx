import { useMemo, useRef, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Eye,
  FileUp,
  Grid3x3,
  PackagePlus,
  ShoppingCart,
  Trash2,
  Upload,
} from "lucide-react";
import { ajusteComercial, ratearValorReal } from "@/lib/conferencia-fisica";
import { lerDanfePdf } from "@/lib/danfe-pdf.functions";
import { GradeEntradaDialog } from "@/components/app/GradeEntradaDialog";
import { ehTira, tamanhoNaDescricao, type GradeEntrada } from "@/lib/personalizacao";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { brl, dateBR, num } from "@/lib/format";
import { EmptyState, PageHeader, StatCard } from "@/components/app/PageHeader";
import { DetalhesNotaEntrada, textoComposicao } from "@/components/app/DetalhesNotaEntrada";
import { custosEntrada, impostosRecuperaveis, lerXmlNfe, type NfeXmlLida } from "@/lib/nfe-xml";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
      { title: "Importar XML da nota de entrada — EZRA ERP" },
      {
        name: "description",
        content:
          "Importe o XML da NF-e do fornecedor para dar entrada no estoque, atualizar o custo de aquisição e gerar as contas a pagar.",
      },
      { property: "og:title", content: "Importar XML da nota de entrada — EZRA ERP" },
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
/** itens recebidos fora da nota usam números de linha a partir daqui */
const SEQ_EXTRA = 100_000;

type Extra = { seq: number; produto_id: string; quantidade: string; valor_ref: string };

function numero(v: string | undefined) {
  const n = Number((v ?? "").replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

/** Passado este tempo sem resposta, a importação é abandonada e a tela volta a ficar livre. */
const LIMITE_IMPORTACAO_MS = 45_000;

class ImportacaoAbandonada extends Error {
  constructor() {
    super("Importação interrompida");
  }
}

function normaliza(v: string | null | undefined) {
  return (v ?? "").trim().toUpperCase();
}

function NfeEntrada() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  // Chamada de importação em andamento: dá para abandonar uma que travou e seguir com outra nota.
  const envio = useRef<AbortController | null>(null);

  const [lida, setLida] = useState<NfeXmlLida | null>(null);
  // compra que já recebeu esta nota (mesma chave, ou mesmo número, série e fornecedor)
  const [duplicada, setDuplicada] = useState<{ compra_id: string; numero: number } | null>(null);
  const [arquivo, setArquivo] = useState<string>("");
  const [depositoId, setDepositoId] = useState("");
  const [mapa, setMapa] = useState<Record<number, string>>({});
  const [gerarConta, setGerarConta] = useState(true);
  const [parcelas, setParcelas] = useState("1");
  const [vencimento, setVencimento] = useState("");
  const [notaDetalhesId, setNotaDetalhesId] = useState<string | null>(null);
  const [grades, setGrades] = useState<Record<number, GradeEntrada>>({});
  const [gradeSeq, setGradeSeq] = useState<number | null>(null);
  // conferência física: o que realmente chegou e o que foi pago, quando o fornecedor fatura diferente
  const [qtdFisica, setQtdFisica] = useState<Record<number, string>>({});
  const [extras, setExtras] = useState<Extra[]>([]);
  const [valorReal, setValorReal] = useState("");
  const qtdRecebida = (item: { seq: number; quantidade: number }) => {
    const v = numero(qtdFisica[item.seq]);
    return v > 0 ? v : item.quantidade;
  };
  const somaGrade = (seq: number) => (grades[seq] ?? []).reduce((s, l) => s + l.quantidade, 0);
  const gradeOk = (item: { seq: number; quantidade: number }) =>
    somaGrade(item.seq) === qtdRecebida(item);

  const { data: depositos } = useQuery({
    queryKey: ["depositos-lista"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("depositos")
        .select("id, nome, tipo, filiais(empresas(regime_tributario))")
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

  async function conferirDuplicada(parsed: NfeXmlLida) {
    const { data } = await supabase.rpc("nfe_entrada_ja_importada", {
      ...(parsed.nota.chave ? { p_chave: parsed.nota.chave } : {}),
      ...(parsed.nota.numero ? { p_numero: parsed.nota.numero } : {}),
      ...(parsed.nota.serie ? { p_serie: parsed.nota.serie } : {}),
      ...(parsed.fornecedor.cnpj ? { p_cnpj: parsed.fornecedor.cnpj } : {}),
    });
    setDuplicada((data as { compra_id: string; numero: number } | null) ?? null);
  }

  async function aoEscolherArquivo(file: File) {
    abandonarEnvio();
    try {
      const ehPdf = file.name.toLowerCase().endsWith(".pdf") || file.type === "application/pdf";
      let parsed: NfeXmlLida;
      if (ehPdf) {
        const t = toast.loading("Lendo o PDF da nota...");
        try {
          const { textoDoPdf } = await import("@/lib/danfe-pdf");
          parsed = await lerDanfePdf({ data: { texto: await textoDoPdf(file) } });
        } finally {
          toast.dismiss(t);
        }
        toast.warning(
          "Nota lida do PDF: confira produtos, quantidades e valores antes de importar.",
        );
      } else {
        parsed = lerXmlNfe(await file.text());
      }
      if (parsed.itens.length === 0) {
        toast.error("O XML não tem itens de produto.");
        return;
      }
      setLida(parsed);
      setArquivo(file.name);
      setDuplicada(null);
      void conferirDuplicada(parsed);
      const inicial: Record<number, string> = {};
      parsed.itens.forEach((item) => {
        inicial[item.seq] = casarProduto(item);
      });
      setMapa(inicial);
      // tira com o tamanho na descrição já vem com a grade preenchida
      const gradesIniciais: Record<number, GradeEntrada> = {};
      parsed.itens.forEach((item) => {
        const t = ehTira(item.descricao) ? tamanhoNaDescricao(item.descricao) : null;
        if (t) gradesIniciais[item.seq] = [{ tamanho: t, quantidade: item.quantidade }];
      });
      setGrades(gradesIniciais);
      setQtdFisica({});
      setExtras([]);
      setValorReal("");
      setParcelas(String(parsed.nota.parcelas));
      setVencimento(parsed.nota.primeiro_vencimento ?? "");
      if (!depositoId && (depositos ?? []).length > 0) {
        setDepositoId(depositos?.[0]?.id ?? "");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível ler o arquivo.");
    }
  }

  const regime =
    (
      (depositos ?? []).find((d) => d.id === depositoId) as
        { filiais?: { empresas?: { regime_tributario?: string | null } | null } | null } | undefined
    )?.filiais?.empresas?.regime_tributario ?? null;
  const custos = useMemo(
    () => (lida ? custosEntrada(lida.itens, lida.nota, regime) : []),
    [lida, regime],
  );
  const creditos = impostosRecuperaveis(regime);

  const valorRealNum = numero(valorReal) > 0 ? numero(valorReal) : null;
  const custosReais = useMemo(() => {
    if (!lida) return { nota: [] as number[], extras: [] as number[] };
    const linhas = [
      ...lida.itens.map((i, idx) => ({
        quantidade: qtdRecebida(i),
        base: custos[idx]?.composicao.total ?? i.total,
      })),
      ...extras.map((e) => ({
        quantidade: numero(e.quantidade),
        base: numero(e.quantidade) * numero(e.valor_ref),
      })),
    ];
    const r = ratearValorReal(linhas, valorRealNum);
    return { nota: r.slice(0, lida.itens.length), extras: r.slice(lida.itens.length) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lida, custos, extras, qtdFisica, valorRealNum]);
  const conferenciaAtiva =
    valorRealNum != null ||
    extras.length > 0 ||
    Object.values(qtdFisica).some((v) => numero(v) > 0);
  const ajuste = lida ? ajusteComercial(lida.nota.total, valorRealNum) : 0;

  const resumo = useMemo(() => {
    if (!lida) return { itens: 0, novos: 0, total: 0 };
    const novos = lida.itens.filter((i) => (mapa[i.seq] ?? NOVO) === NOVO).length;
    return {
      itens: lida.itens.length,
      novos,
      total: lida.itens.reduce((s, i) => s + i.total, 0),
    };
  }, [lida, mapa]);

  function abandonarEnvio() {
    envio.current?.abort();
    envio.current = null;
    importar.reset();
  }

  const importar = useMutation({
    mutationFn: async () => {
      if (!lida) throw new Error("Escolha o XML da nota.");
      if (!depositoId) throw new Error("Escolha o depósito que vai receber a mercadoria.");
      const semGrade = lida.itens.find((i) => ehTira(i.descricao) && !gradeOk(i));
      if (semGrade)
        throw new Error(`Informe a grade da tira "${semGrade.descricao}" antes de importar.`);
      const gradeErrada = lida.itens.find((i) => (grades[i.seq] ?? []).length > 0 && !gradeOk(i));
      if (gradeErrada)
        throw new Error(
          `A grade de "${gradeErrada.descricao}" não bate com a quantidade recebida.`,
        );
      for (const e of extras) {
        if (!e.produto_id) throw new Error("Escolha o produto de cada item recebido fora da nota.");
        if (!(numero(e.quantidade) > 0))
          throw new Error("Informe a quantidade de cada item recebido fora da nota.");
        if ((grades[e.seq] ?? []).length > 0 && somaGrade(e.seq) !== numero(e.quantidade))
          throw new Error("A grade de um item recebido fora da nota não bate com a quantidade.");
      }
      const itens = lida.itens.map((i, idx) => {
        const escolha = mapa[i.seq] ?? NOVO;
        return {
          ...(escolha !== NOVO ? { produto_id: escolha } : {}),
          codigo: i.codigo,
          codigo_barras: i.codigo_barras,
          descricao: i.descricao,
          ncm: i.ncm,
          cfop: i.cfop,
          impostos: {
            ...i.impostos,
            composicao: custos[idx]?.composicao ?? null,
            regime,
            ...(grades[i.seq]?.length ? { grade: grades[i.seq] } : {}),
            ...(conferenciaAtiva
              ? {
                  conferencia: {
                    quantidade_nota: i.quantidade,
                    quantidade_recebida: qtdRecebida(i),
                    custo_nota: custos[idx]?.custo_unitario ?? i.custo_unitario,
                  },
                }
              : {}),
          },
          unidade: i.unidade,
          quantidade: qtdRecebida(i),
          custo_unitario: conferenciaAtiva
            ? (custosReais.nota[idx] ?? 0)
            : (custos[idx]?.custo_unitario ?? i.custo_unitario),
          ...(qtdRecebida(i) !== i.quantidade
            ? {
                observacao: `Na nota: ${num(i.quantidade)} ${i.unidade}; recebido: ${num(qtdRecebida(i))}`,
              }
            : {}),
          // lote, tonalidade e calibre entram na mesma transação da compra
          ...(i.lote
            ? { lote: i.lote, tonalidade: i.tonalidade ?? "", calibre: i.calibre ?? "" }
            : {}),
        };
      });
      extras.forEach((e, k) => {
        const p = (produtos ?? []).find((x) => x.id === e.produto_id);
        itens.push({
          produto_id: e.produto_id,
          codigo: "",
          codigo_barras: null,
          descricao: p?.descricao ?? "",
          ncm: p?.ncm ?? null,
          cfop: null,
          impostos: {
            fora_da_nota: true,
            ...(grades[e.seq]?.length ? { grade: grades[e.seq] } : {}),
          },
          unidade: p?.unidade ?? "UN",
          quantidade: numero(e.quantidade),
          custo_unitario: custosReais.extras[k] ?? 0,
          observacao: "Recebido fisicamente sem constar na nota fiscal",
        } as unknown as (typeof itens)[number]);
      });
      // Uma importação que não responde não prende a tela: passado o limite, a chamada é abandonada e o usuário
      // pode conferir em "Notas já importadas" ou tentar outra nota. O banco recusa a mesma nota duas vezes.
      const controle = new AbortController();
      envio.current = controle;
      const limite = setTimeout(() => controle.abort(), LIMITE_IMPORTACAO_MS);
      try {
        const { data, error } = await supabase
          .rpc("importar_nfe_entrada", {
            p_nota: {
              chave: lida.nota.chave,
              numero: lida.nota.numero,
              emissao: lida.nota.emissao,
              frete: lida.nota.frete,
              desconto: lida.nota.desconto,
              condicao_pagamento: lida.nota.condicao_pagamento,
              observacao: `NF-e ${lida.nota.numero ?? ""} — ${lida.fornecedor.razao_social}`,
              primeiro_vencimento: lida.nota.primeiro_vencimento,
              total: valorRealNum ?? lida.nota.total,
              natureza: lida.nota.natureza,
              impostos: {
                ...lida.nota.impostos,
                ...(valorRealNum != null
                  ? {
                      total_fiscal: lida.nota.total,
                      valor_real_pago: valorRealNum,
                      ajuste_comercial: ajuste,
                    }
                  : {}),
                ...(extras.length ? { itens_fora_da_nota: extras.length } : {}),
              },
            },
            p_fornecedor: lida.fornecedor,
            p_itens: itens,
            p_deposito_id: depositoId,
            p_gerar_conta: gerarConta,
            p_parcelas: Math.max(1, Number(parcelas) || 1),
            ...(vencimento ? { p_vencimento: vencimento } : {}),
          })
          .abortSignal(controle.signal);
        if (error) throw error;
        return data as { compra_id: string; numero: number; produtos_criados: number };
      } catch (e) {
        if (controle.signal.aborted) throw new ImportacaoAbandonada();
        throw e;
      } finally {
        clearTimeout(limite);
        if (envio.current === controle) envio.current = null;
      }
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
    onError: async (e) => {
      if (e instanceof ImportacaoAbandonada) {
        // a chamada pode ter chegado ao banco: atualiza a lista para o usuário conferir antes de tentar de novo
        // e de novo depois, porque o servidor pode terminar a transação já com a tela livre
        for (const atraso of [0, 5_000, 15_000, 30_000]) {
          setTimeout(
            () => void queryClient.invalidateQueries({ queryKey: ["compras-xml"] }),
            atraso,
          );
        }
        toast.error(
          'A importação demorou e foi interrompida. Confira em "Notas já importadas" se a nota entrou; se não entrou, tente de novo.',
        );
        return;
      }
      const msg = e instanceof Error ? e.message : "Não foi possível importar.";
      if (msg.includes("já está importada") && lida) {
        const { data } = await supabase.rpc("nfe_entrada_ja_importada", {
          ...(lida.nota.chave ? { p_chave: lida.nota.chave } : {}),
          ...(lida.nota.numero ? { p_numero: lida.nota.numero } : {}),
          ...(lida.nota.serie ? { p_serie: lida.nota.serie } : {}),
          ...(lida.fornecedor.cnpj ? { p_cnpj: lida.fornecedor.cnpj } : {}),
        });
        const existente = data as { compra_id: string; numero: number } | null;
        if (existente) {
          setDuplicada(existente);
          toast.error(`Esta nota já está importada (compra nº ${existente.numero}).`, {
            action: {
              label: "Abrir compra",
              onClick: () =>
                void navigate({ to: "/compras/$id", params: { id: existente.compra_id } }),
            },
          });
          return;
        }
      }
      toast.error(msg);
    },
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
              <Upload className="size-4" /> Escolher XML ou PDF
            </Button>
          </>
        }
      />

      <input
        ref={inputRef}
        type="file"
        accept=".xml,text/xml,application/xml,.pdf,application/pdf"
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
          {duplicada && (
            <Alert variant="destructive" className="mb-4">
              <AlertTriangle className="size-4" />
              <AlertTitle>Esta nota já está importada ou em processo de importação</AlertTitle>
              <AlertDescription>
                A chave, ou o número, a série e o fornecedor desta nota já constam na compra nº{" "}
                {duplicada.numero}.{" "}
                <Link
                  className="font-medium underline underline-offset-2"
                  to="/compras/$id"
                  params={{ id: duplicada.compra_id }}
                >
                  Abrir compra
                </Link>
              </AlertDescription>
            </Alert>
          )}
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

          <div className="panel mb-4 p-4">
            <p className="font-display text-sm font-semibold">Impostos da nota</p>
            <p className="text-xs text-muted-foreground">
              Valores destacados no XML do fornecedor. ST, IPI, frete, seguro e outras despesas
              entram no custo e o desconto sai.{" "}
              {creditos.icms
                ? `Pelo regime da empresa, ${creditos.pis ? "ICMS, PIS e COFINS saem" : "o ICMS sai"} do custo (crédito).`
                : "No Simples Nacional os impostos não dão crédito e ficam no custo."}
            </p>
            <div className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-3 xl:grid-cols-6">
              {(
                [
                  ["Base do ICMS", lida.nota.impostos.base_icms],
                  ["ICMS", lida.nota.impostos.icms],
                  ["Base do ICMS-ST", lida.nota.impostos.base_st],
                  ["ICMS-ST", lida.nota.impostos.icms_st],
                  ["FCP-ST", lida.nota.impostos.fcp_st],
                  ["IPI", lida.nota.impostos.ipi],
                  ["PIS", lida.nota.impostos.pis],
                  ["COFINS", lida.nota.impostos.cofins],
                  ["Frete", lida.nota.frete],
                  ["Seguro", lida.nota.impostos.seguro],
                  ["Outras despesas", lida.nota.impostos.outras],
                  ["Desconto", lida.nota.desconto],
                ] as const
              ).map(([rotulo, valor]) => (
                <div key={rotulo}>
                  <p className="text-xs text-muted-foreground">{rotulo}</p>
                  <p className="text-numeric font-medium">{brl(valor)}</p>
                </div>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap justify-between gap-2 border-t border-border pt-3 text-sm">
              <span className="text-muted-foreground">
                Tributos aproximados: {brl(lida.nota.impostos.tributos_aprox)}
              </span>
              <span>
                Total da nota: <strong className="text-numeric">{brl(lida.nota.total)}</strong>
              </span>
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
                  <TableHead className="text-right">Custo final unit.</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lida.itens.map((item, idx) => {
                  const custo = custos[idx];
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
                        <p className="text-xs text-muted-foreground">
                          {item.cfop ? `CFOP ${item.cfop} · ` : ""}
                          {item.impostos.cst ? `CST ${item.impostos.cst} · ` : ""}
                          ICMS {brl(item.impostos.icms)}
                          {item.impostos.aliquota_icms
                            ? ` (${num(item.impostos.aliquota_icms)}%)`
                            : ""}
                          {item.impostos.icms_st ? ` · ST ${brl(item.impostos.icms_st)}` : ""}
                          {` · IPI ${brl(item.impostos.ipi)}`}
                          {item.impostos.aliquota_ipi
                            ? ` (${num(item.impostos.aliquota_ipi)}%)`
                            : ""}
                          {` · PIS ${brl(item.impostos.pis)} · COFINS ${brl(item.impostos.cofins)}`}
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
                        {
                          <div className="mt-2">
                            <Button
                              size="sm"
                              variant={
                                gradeOk(item) || !ehTira(item.descricao) ? "outline" : "default"
                              }
                              onClick={() => setGradeSeq(item.seq)}
                            >
                              <Grid3x3 className="size-4" />
                              {gradeOk(item)
                                ? "Grade informada"
                                : ehTira(item.descricao)
                                  ? "Informar grade da tira"
                                  : "Informar grade"}
                            </Button>
                            {(grades[item.seq] ?? []).length > 0 && (
                              <p className="mt-1 text-xs text-muted-foreground">
                                {(grades[item.seq] ?? [])
                                  .map((l) => `${l.tamanho}: ${l.quantidade}`)
                                  .join(" · ")}
                              </p>
                            )}
                          </div>
                        }
                      </TableCell>
                      <TableCell className="text-right text-numeric">
                        <p>{num(item.quantidade)}</p>
                        <Label
                          htmlFor={`rec-${item.seq}`}
                          className="mt-1 block text-xs font-normal text-muted-foreground"
                        >
                          Recebido
                        </Label>
                        <Input
                          id={`rec-${item.seq}`}
                          className="ml-auto h-8 w-24 text-right"
                          inputMode="decimal"
                          placeholder={num(item.quantidade)}
                          value={qtdFisica[item.seq] ?? ""}
                          onChange={(e) =>
                            setQtdFisica((m) => ({ ...m, [item.seq]: e.target.value }))
                          }
                        />
                      </TableCell>
                      <TableCell className="text-right text-numeric">
                        {brl(item.custo_unitario)}
                      </TableCell>
                      <TableCell className="text-right text-numeric">{brl(item.total)}</TableCell>
                      <TableCell
                        className="text-right text-numeric font-semibold"
                        title={custo ? textoComposicao(custo.composicao) : ""}
                      >
                        {conferenciaAtiva
                          ? brl(custosReais.nota[idx] ?? 0)
                          : custo
                            ? brl(custo.custo_unitario)
                            : "—"}
                        {conferenciaAtiva ? (
                          <p className="text-xs font-normal text-muted-foreground">
                            real · total {brl((custosReais.nota[idx] ?? 0) * qtdRecebida(item))}
                          </p>
                        ) : (
                          custo && (
                            <p className="text-xs font-normal text-muted-foreground">
                              total {brl(custo.composicao.total)}
                            </p>
                          )
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          <div className="panel mt-4 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-display text-sm font-semibold">Itens recebidos fora da nota</p>
                <p className="text-xs text-muted-foreground">
                  O que chegou na caixa mas o fornecedor não colocou na nota. Entra no estoque e
                  divide o valor pago.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setExtras((l) => [
                    ...l,
                    {
                      seq: SEQ_EXTRA + (Date.now() % 100_000) + l.length,
                      produto_id: "",
                      quantidade: "",
                      valor_ref: "",
                    },
                  ])
                }
              >
                <PackagePlus className="size-4" /> Adicionar item recebido
              </Button>
            </div>
            {extras.length > 0 && (
              <div className="mt-3 space-y-3">
                {extras.map((e, k) => {
                  const muda = (c: Partial<Extra>) =>
                    setExtras((l) => l.map((x) => (x.seq === e.seq ? { ...x, ...c } : x)));
                  const g = grades[e.seq] ?? [];
                  return (
                    <div
                      key={e.seq}
                      className="grid items-end gap-3 rounded-md border border-border p-3 sm:grid-cols-[minmax(0,2fr)_7rem_8rem_auto_auto]"
                    >
                      <div className="min-w-0">
                        <Label>Produto</Label>
                        <Select value={e.produto_id} onValueChange={(v) => muda({ produto_id: v })}>
                          <SelectTrigger className="mt-1">
                            <SelectValue placeholder="Escolha o produto" />
                          </SelectTrigger>
                          <SelectContent>
                            {(produtos ?? []).map((p) => (
                              <SelectItem key={p.id} value={p.id}>
                                {p.codigo_interno} — {p.descricao}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {g.length > 0 && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {g.map((l) => `${l.tamanho}: ${l.quantidade}`).join(" · ")}
                          </p>
                        )}
                      </div>
                      <div>
                        <Label>Quantidade</Label>
                        <Input
                          className="mt-1"
                          inputMode="decimal"
                          value={e.quantidade}
                          onChange={(ev) => muda({ quantidade: ev.target.value })}
                        />
                      </div>
                      <div>
                        <Label>Preço de referência</Label>
                        <Input
                          className="mt-1"
                          inputMode="decimal"
                          placeholder="R$ por unidade"
                          value={e.valor_ref}
                          onChange={(ev) => muda({ valor_ref: ev.target.value })}
                        />
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!(numero(e.quantidade) > 0)}
                        onClick={() => setGradeSeq(e.seq)}
                      >
                        <Grid3x3 className="size-4" />{" "}
                        {g.length ? "Grade informada" : "Informar grade"}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Remover item"
                        onClick={() => setExtras((l) => l.filter((x) => x.seq !== e.seq))}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                      <p className="text-xs text-muted-foreground sm:col-span-5">
                        Custo real: {brl(custosReais.extras[k] ?? 0)} por unidade
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="panel mt-4 grid gap-4 p-4 sm:grid-cols-[14rem_minmax(0,1fr)]">
            <div>
              <Label htmlFor="valor-real">Valor real pago ao fornecedor</Label>
              <Input
                id="valor-real"
                className="mt-1"
                inputMode="decimal"
                placeholder={brl(lida.nota.total)}
                value={valorReal}
                onChange={(e) => setValorReal(e.target.value)}
              />
            </div>
            <div className="text-sm">
              <p className="text-xs text-muted-foreground">
                Deixe em branco se pagou o mesmo valor da nota. Se pagou mais, as contas a pagar
                ficam no valor real e esse valor é dividido no custo de tudo o que entrou. A nota
                fiscal continua registrada com o valor dela.
              </p>
              {valorRealNum != null && (
                <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1">
                  <span>
                    Valor da nota: <strong className="text-numeric">{brl(lida.nota.total)}</strong>
                  </span>
                  <span>
                    Fora da nota: <strong className="text-numeric">{brl(ajuste)}</strong>
                  </span>
                  <span>
                    Total a pagar: <strong className="text-numeric">{brl(valorRealNum)}</strong>
                  </span>
                </div>
              )}
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                abandonarEnvio();
                setLida(null);
              }}
            >
              {importar.isPending ? "Cancelar importação" : "Cancelar"}
            </Button>
            <Button disabled={importar.isPending || !!duplicada} onClick={() => importar.mutate()}>
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
                <TableHead className="text-right">Detalhes</TableHead>
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
                  <TableCell className="text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      aria-label={`Ver detalhes da nota ${c.nfe_numero ?? c.numero}`}
                      onClick={() => setNotaDetalhesId(c.id)}
                    >
                      <Eye className="size-4" /> Ver nota
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <DetalhesNotaEntrada compraId={notaDetalhesId} onClose={() => setNotaDetalhesId(null)} />
      {(() => {
        const daNota = lida?.itens.find((i) => i.seq === gradeSeq);
        const extra = extras.find((e) => e.seq === gradeSeq);
        const item = daNota
          ? { seq: daNota.seq, descricao: daNota.descricao, quantidade: qtdRecebida(daNota) }
          : extra
            ? {
                seq: extra.seq,
                descricao:
                  (produtos ?? []).find((p) => p.id === extra.produto_id)?.descricao ??
                  "Item recebido",
                quantidade: numero(extra.quantidade),
              }
            : undefined;
        return (
          <GradeEntradaDialog
            aberto={!!item}
            descricao={item?.descricao ?? ""}
            quantidade={item?.quantidade ?? 0}
            titulo="Grade por tamanho"
            texto="informe quantos pares de cada tamanho estão entrando."
            inicial={item ? (grades[item.seq] ?? []) : []}
            onFechar={() => setGradeSeq(null)}
            onSalvar={(g) => {
              if (item) setGrades((m) => ({ ...m, [item.seq]: g }));
              setGradeSeq(null);
            }}
          />
        );
      })()}
    </div>
  );
}
