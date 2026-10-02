import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, CreditCard, XCircle, Ban } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useSessionData } from "@/hooks/useSessionData";
import { PageHeader, StatCard, EmptyState } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CREDENCIADORAS } from "./tef";

export const Route = createFileRoute("/_authenticated/tef-painel")({
  head: () => ({
    meta: [
      { title: "Painel da maquininha (TEF) — ERP Ze Tech" },
      {
        name: "description",
        content:
          "Transações de cartão aprovadas, negadas e canceladas, ligadas ao caixa e à nota fiscal.",
      },
      { property: "og:title", content: "Painel da maquininha (TEF) — ERP Ze Tech" },
      { property: "og:description", content: "Acompanhe as transações de cartão da loja." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TefPainel,
});

type Tx = {
  id: string;
  created_at: string;
  credenciadora: string | null;
  forma: string | null;
  valor: number;
  parcelas: number;
  status: string;
  nsu: string | null;
  autorizacao: string | null;
  bandeira: string | null;
  motivo: string | null;
  caixa_id: string | null;
  pedido_id: string | null;
  filial_id: string | null;
  operador_id: string | null;
};

const brl = (n: number) =>
  Number(n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const hoje = () => new Date().toISOString().slice(0, 10);
const nomeCred = (v: string | null) => CREDENCIADORAS.find((c) => c.v === v)?.l ?? v ?? "—";
const nomeForma = (f: string | null) =>
  f === "cartao_credito" ? "Crédito" : f === "cartao_debito" ? "Débito" : (f ?? "—");

const GUIAS: Record<string, { programa: string; passos: string[] }> = {
  stone: {
    programa: "Stone Connect / TEF Stone (via SiTef ou PayGo)",
    passos: [
      "Peça à Stone o TEF para o seu código de cliente (Stone Code).",
      "Baixe o instalador enviado pela Stone no computador do caixa e instale como administrador.",
      "Ligue a maquininha (Pinpad) no USB e aguarde o Windows reconhecer.",
      "Abra o programa, informe o Stone Code e o número do terminal e faça a ativação.",
    ],
  },
  cielo: {
    programa: "Cielo LIO / SiTef Cielo",
    passos: [
      "Solicite à Cielo a habilitação de TEF para o seu número de estabelecimento.",
      "Instale o SiTef (Software Express) com os dados enviados pela Cielo.",
      "Conecte o Pinpad no USB e selecione a porta no configurador do SiTef.",
      "Informe empresa, terminal e IP do servidor e faça a carga de tabelas.",
    ],
  },
  rede: {
    programa: "SiTef ou PayGo com adquirente Rede",
    passos: [
      "Solicite à Rede a habilitação de TEF para seu número de estabelecimento.",
      "Contrate o integrador (SiTef ou PayGo) e instale o programa enviado.",
      "Conecte o Pinpad e configure a porta.",
      "Informe o número do estabelecimento e do terminal e faça a carga inicial.",
    ],
  },
  getnet: {
    programa: "SiTef ou PayGo com adquirente Getnet",
    passos: [
      "Peça à Getnet o TEF para seu código de estabelecimento.",
      "Instale o programa do integrador indicado pela Getnet.",
      "Conecte o Pinpad e selecione a porta.",
      "Informe estabelecimento e terminal e faça a carga de tabelas.",
    ],
  },
  pagseguro: {
    programa: "PagBank Conecta (maquininha pela internet)",
    passos: [
      "No app PagBank, ative a maquininha Smart na conta da loja.",
      "Gere o token de integração no painel PagBank (Vendas › Integrações).",
      "Deixe a maquininha ligada no Wi-Fi da loja.",
      "Aqui no sistema escolha 'Maquininha ligada pela internet' e informe o número de série no campo do terminal.",
    ],
  },
  mercadopago: {
    programa: "Mercado Pago Point (pela internet)",
    passos: [
      "No app Mercado Pago, vincule a maquininha Point à loja.",
      "Crie as credenciais de produção em Suas integrações.",
      "Ative o 'modo PDV' da maquininha.",
      "Aqui escolha 'Maquininha ligada pela internet' e informe o ID do dispositivo no campo do terminal.",
    ],
  },
  sipag: {
    programa: "SiTef com adquirente Sipag/Sicredi",
    passos: [
      "Peça à sua cooperativa a habilitação de TEF.",
      "Instale o SiTef enviado pela cooperativa.",
      "Conecte o Pinpad e selecione a porta.",
      "Informe estabelecimento e terminal e faça a carga inicial.",
    ],
  },
  outra: {
    programa: "Programa de ponte do fornecedor",
    passos: [
      "Peça ao fornecedor o instalador do programa de ponte e os dados do contrato.",
      "Instale no computador do caixa.",
      "Conecte a maquininha e configure a porta.",
      "Informe os dados do contrato e deixe o programa aberto.",
    ],
  },
};

function TefPainel() {
  const qc = useQueryClient();
  const { data: session } = useSessionData();
  const filiais = session?.filiais ?? [];
  const [de, setDe] = useState(hoje().slice(0, 8) + "01");
  const [ate, setAte] = useState(hoje());
  const [status, setStatus] = useState("");
  const [aba, setAba] = useState<"painel" | "guia">("painel");
  const [cred, setCred] = useState("stone");
  const [neg, setNeg] = useState({
    valor: "",
    forma: "cartao_credito",
    parcelas: "1",
    bandeira: "",
    motivo: "Saldo insuficiente",
    credenciadora: "stone",
  });

  const [loja, setLoja] = useState("");
  const { data: txsAll = [] } = useQuery({
    queryKey: ["tef-transacoes", de, ate],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tef_transacoes" as never)
        .select("*")
        .gte("created_at", de)
        .lte("created_at", ate + "T23:59:59")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as Tx[];
    },
  });
  const txs = loja ? txsAll.filter((t) => t.filial_id === loja) : txsAll;

  const pedidoIds = useMemo(
    () => [...new Set(txs.map((t) => t.pedido_id).filter(Boolean))] as string[],
    [txs],
  );
  const caixaIds = useMemo(
    () => [...new Set(txs.map((t) => t.caixa_id).filter(Boolean))] as string[],
    [txs],
  );
  const { data: vinc } = useQuery({
    queryKey: ["tef-vinculos", pedidoIds, caixaIds],
    enabled: pedidoIds.length + caixaIds.length > 0,
    queryFn: async () => {
      const [p, n, c] = await Promise.all([
        pedidoIds.length
          ? supabase.from("pedidos").select("id, numero").in("id", pedidoIds)
          : { data: [] },
        pedidoIds.length
          ? supabase
              .from("nfe")
              .select("id, numero, pedido_id, situacao")
              .in("pedido_id", pedidoIds)
          : { data: [] },
        caixaIds.length
          ? supabase.from("caixas").select("id, numero").in("id", caixaIds)
          : { data: [] },
      ]);
      return {
        pedidos: Object.fromEntries(
          (p.data ?? []).map((x: { id: string; numero: number | null }) => [x.id, x.numero]),
        ),
        notas: Object.fromEntries(
          (n.data ?? []).map(
            (x: { pedido_id: string | null; numero: number | null; situacao: string }) => [
              x.pedido_id,
              x,
            ],
          ),
        ),
        caixas: Object.fromEntries(
          (c.data ?? []).map((x: { id: string; numero: number | null }) => [x.id, x.numero]),
        ),
      } as {
        pedidos: Record<string, number>;
        notas: Record<string, { numero: number | null; situacao: string }>;
        caixas: Record<string, number>;
      };
    },
  });

  const operIds = useMemo(
    () => [...new Set(txsAll.map((t) => t.operador_id).filter(Boolean))] as string[],
    [txsAll],
  );
  const { data: operadores = {} } = useQuery({
    queryKey: ["tef-operadores", operIds],
    enabled: operIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("id, nome").in("id", operIds);
      return Object.fromEntries((data ?? []).map((p) => [p.id, p.nome])) as Record<string, string>;
    },
  });
  const { data: cfg } = useQuery({
    queryKey: ["tef-config", loja],
    enabled: !!loja,
    queryFn: async () => {
      const { data } = await supabase
        .from("tef_config" as never)
        .select("*")
        .eq("filial_id", loja)
        .maybeSingle();
      return data as unknown as {
        credenciadora: string | null;
        contrato: string | null;
        codigo_estabelecimento: string | null;
        terminal_id: string | null;
        modo: string | null;
        ativo: boolean;
      } | null;
    },
  });
  const nomeLoja = (id: string | null) => filiais.find((f) => f.id === id)?.nome ?? "—";
  const lista = status ? txs.filter((t) => t.status === status) : txs;
  const soma = (s: string) => txs.filter((t) => t.status === s);
  const aprov = soma("aprovada"),
    negadas = soma("negada"),
    canc = soma("cancelada");
  const taxa = txs.length ? Math.round((aprov.length / txs.length) * 100) : 0;

  const registrar = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc(
        "tef_registrar_negada" as never,
        {
          p_filial_id: session?.profile?.filial_id ?? filiais[0]?.id ?? null,
          p_credenciadora: neg.credenciadora,
          p_forma: neg.forma,
          p_valor: Number(neg.valor.replace(",", ".")) || 0,
          p_parcelas: Number(neg.parcelas) || 1,
          p_bandeira: neg.bandeira,
          p_motivo: neg.motivo,
        } as never,
      );
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Transação negada registrada");
      setNeg({ ...neg, valor: "" });
      void qc.invalidateQueries({ queryKey: ["tef-transacoes"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const sel = "h-9 w-full rounded-md border bg-background px-2 text-sm";
  const guia = GUIAS[cred] ?? GUIAS["outra"]!;

  return (
    <div>
      <PageHeader
        title="Painel da maquininha (TEF)"
        description="Transações de cartão aprovadas, negadas e canceladas, com o caixa, a venda e a nota de cada uma."
        actions={
          <>
            <Button
              variant={aba === "painel" ? "default" : "outline"}
              onClick={() => setAba("painel")}
            >
              Transações
            </Button>
            <Button variant={aba === "guia" ? "default" : "outline"} onClick={() => setAba("guia")}>
              Instalar a ponte
            </Button>
          </>
        }
      />

      {aba === "painel" ? (
        <>
          <div className="panel mb-4 grid gap-3 p-4 md:grid-cols-4">
            <div>
              <Label>Loja</Label>
              <select className={sel} value={loja} onChange={(e) => setLoja(e.target.value)}>
                <option value="">Todas as lojas</option>
                {filiais.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.nome}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label>De</Label>
              <Input type="date" value={de} onChange={(e) => setDe(e.target.value)} />
            </div>
            <div>
              <Label>Até</Label>
              <Input type="date" value={ate} onChange={(e) => setAte(e.target.value)} />
            </div>
            <div>
              <Label>Situação</Label>
              <select className={sel} value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">Todas</option>
                <option value="aprovada">Aprovadas</option>
                <option value="negada">Negadas</option>
                <option value="cancelada">Canceladas</option>
              </select>
            </div>
          </div>
          {loja && (
            <div className="panel mb-4 p-4 text-sm">
              <p className="font-display font-semibold">Maquininha da {nomeLoja(loja)}</p>
              {cfg ? (
                <p className="mt-1 text-muted-foreground">
                  {nomeCred(cfg.credenciadora)} · Contrato {cfg.contrato || "—"} · Estabelecimento{" "}
                  {cfg.codigo_estabelecimento || "—"} · Terminal {cfg.terminal_id || "—"} ·{" "}
                  {cfg.ativo ? "ativa" : "inativa"}
                </p>
              ) : (
                <p className="mt-1 text-muted-foreground">
                  Esta loja ainda não tem maquininha cadastrada.{" "}
                  <Link to="/tef" className="text-primary underline">
                    Cadastrar
                  </Link>
                </p>
              )}
            </div>
          )}
          <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Aprovadas"
              value={brl(aprov.reduce((s, t) => s + Number(t.valor), 0))}
              hint={`${aprov.length} transações`}
              icon={CheckCircle2}
              tone="success"
            />
            <StatCard
              label="Negadas"
              value={String(negadas.length)}
              hint={brl(negadas.reduce((s, t) => s + Number(t.valor), 0))}
              icon={XCircle}
              tone="danger"
            />
            <StatCard
              label="Canceladas / estornos"
              value={String(canc.length)}
              hint={brl(canc.reduce((s, t) => s + Number(t.valor), 0))}
              icon={Ban}
              tone="warning"
            />
            <StatCard
              label="Taxa de aprovação"
              value={`${taxa}%`}
              hint={`${txs.length} tentativas`}
              icon={CreditCard}
            />
          </div>

          {lista.length === 0 ? (
            <EmptyState
              title="Nenhuma transação no período"
              description="As vendas com cartão da frente de caixa aparecem aqui."
            />
          ) : (
            <div className="panel mb-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    {[
                      "Data",
                      "Situação",
                      "Loja",
                      "Operador",
                      "Credenciadora",
                      "Forma",
                      "Valor",
                      "Código (NSU)",
                      "Autorização",
                      "Bandeira",
                      "Caixa",
                      "Venda",
                      "Nota",
                      "Motivo",
                    ].map((h) => (
                      <th key={h} className="px-3 py-2">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {lista.map((t) => {
                    const nota = t.pedido_id ? vinc?.notas[t.pedido_id] : undefined;
                    return (
                      <tr key={t.id} className="border-t">
                        <td className="px-3 py-2 whitespace-nowrap">
                          {new Date(t.created_at).toLocaleString("pt-BR")}
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={
                              t.status === "aprovada"
                                ? "text-success"
                                : t.status === "negada"
                                  ? "text-destructive"
                                  : "text-warning-foreground"
                            }
                          >
                            {t.status}
                          </span>
                        </td>
                        <td className="px-3 py-2">{nomeLoja(t.filial_id)}</td>
                        <td className="px-3 py-2">
                          {t.operador_id ? (operadores[t.operador_id] ?? "…") : "—"}
                        </td>
                        <td className="px-3 py-2">{nomeCred(t.credenciadora)}</td>
                        <td className="px-3 py-2">
                          {nomeForma(t.forma)}
                          {t.parcelas > 1 ? ` ${t.parcelas}x` : ""}
                        </td>
                        <td className="px-3 py-2 text-numeric">{brl(t.valor)}</td>
                        <td className="px-3 py-2">{t.nsu ?? "—"}</td>
                        <td className="px-3 py-2">{t.autorizacao ?? "—"}</td>
                        <td className="px-3 py-2">{t.bandeira ?? "—"}</td>
                        <td className="px-3 py-2">
                          {t.caixa_id ? `nº ${vinc?.caixas[t.caixa_id] ?? "…"}` : "—"}
                        </td>
                        <td className="px-3 py-2">
                          {t.pedido_id ? (
                            <Link
                              to="/pedidos/$id"
                              params={{ id: t.pedido_id }}
                              className="text-primary underline"
                            >
                              nº {vinc?.pedidos[t.pedido_id] ?? "…"}
                            </Link>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {nota ? (
                            <Link to="/nfe" className="text-primary underline">
                              {nota.numero ? `nº ${nota.numero}` : nota.situacao}
                            </Link>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{t.motivo ?? ""}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="panel grid gap-3 p-4 md:grid-cols-6">
            <p className="font-display font-semibold md:col-span-6">
              Registrar transação negada na maquininha
            </p>
            <div>
              <Label>Credenciadora</Label>
              <select
                className={sel}
                value={neg.credenciadora}
                onChange={(e) => setNeg({ ...neg, credenciadora: e.target.value })}
              >
                {CREDENCIADORAS.map((c) => (
                  <option key={c.v} value={c.v}>
                    {c.l}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label>Forma</Label>
              <select
                className={sel}
                value={neg.forma}
                onChange={(e) => setNeg({ ...neg, forma: e.target.value })}
              >
                <option value="cartao_credito">Crédito</option>
                <option value="cartao_debito">Débito</option>
              </select>
            </div>
            <div>
              <Label>Valor</Label>
              <Input
                value={neg.valor}
                onChange={(e) => setNeg({ ...neg, valor: e.target.value })}
                placeholder="0,00"
              />
            </div>
            <div>
              <Label>Parcelas</Label>
              <Input
                value={neg.parcelas}
                onChange={(e) => setNeg({ ...neg, parcelas: e.target.value })}
              />
            </div>
            <div>
              <Label>Bandeira</Label>
              <Input
                value={neg.bandeira}
                onChange={(e) => setNeg({ ...neg, bandeira: e.target.value })}
                placeholder="Visa"
              />
            </div>
            <div>
              <Label>Motivo</Label>
              <Input
                value={neg.motivo}
                onChange={(e) => setNeg({ ...neg, motivo: e.target.value })}
              />
            </div>
            <div className="md:col-span-6">
              <Button
                onClick={() => registrar.mutate()}
                disabled={registrar.isPending || !neg.valor}
              >
                Registrar negada
              </Button>
            </div>
          </div>
        </>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="panel p-4">
            <Label>Credenciadora da loja</Label>
            <select className={sel} value={cred} onChange={(e) => setCred(e.target.value)}>
              {CREDENCIADORAS.map((c) => (
                <option key={c.v} value={c.v}>
                  {c.l}
                </option>
              ))}
            </select>
            <p className="mt-3 text-sm">
              <b>Programa:</b> {guia.programa}
            </p>
            <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm">
              {guia.passos.map((p) => (
                <li key={p}>{p}</li>
              ))}
              <li>
                No ERP, abra{" "}
                <Link to="/tef" className="text-primary underline">
                  Maquininha (TEF)
                </Link>
                , escolha a loja e a credenciadora, preencha contrato, estabelecimento e terminal e
                salve.
              </li>
              <li>
                Com o programa aberto, clique em "Testar programa de ponte" — deve aparecer
                "maquininha conectada".
              </li>
              <li>
                Na frente de caixa, faça uma venda em crédito, passe o cartão e digite o NSU e a
                autorização do comprovante.
              </li>
              <li>
                Volte a este painel: a transação aparece como aprovada, com o caixa, a venda e a
                nota.
              </li>
            </ol>
          </div>
          <div className="panel p-4 text-sm">
            <p className="font-display font-semibold">
              Dados de exemplo para testar (sem valor real)
            </p>
            <ul className="mt-2 space-y-1">
              <li>
                <b>Contrato:</b> 000123456
              </li>
              <li>
                <b>Código do estabelecimento:</b> 1234567890
              </li>
              <li>
                <b>Terminal:</b> PDV00001
              </li>
              <li>
                <b>Endereço da ponte:</b> http://localhost:60906
              </li>
              <li>
                <b>Venda de teste:</b> R$ 10,00 no crédito à vista
              </li>
              <li>
                <b>NSU:</b> 000987654 · <b>Autorização:</b> A1B2C3 · <b>Bandeira:</b> Visa
              </li>
              <li>
                <b>Negada de teste:</b> R$ 10,00, motivo "Saldo insuficiente"
              </li>
            </ul>
            <p className="mt-3 text-muted-foreground">
              Use o ambiente de homologação da credenciadora para passar cartões de teste. Depois do
              teste, cancele a venda com F7 na frente de caixa — ela fica como cancelada aqui.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
