import { useMemo } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Check,
  CircleDollarSign,
  ExternalLink,
  Receipt,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { brl, dateBR } from "@/lib/format";
import { EmptyState, PageHeader, StatCard } from "@/components/app/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  lerResumoAssinatura,
  saldoDaFatura,
  situacaoDaFatura,
  totaisDasFaturas,
  totalMensal,
} from "@/lib/assinatura-tela";
import { comNomeDeExibicao, nomeDoPlano } from "@/lib/planos-nomes";
import { SITUACAO_SAAS, TIPO_FATURA_SAAS } from "@/lib/saas";

export const Route = createFileRoute("/_authenticated/planos")({
  head: () => ({
    meta: [
      { title: "Plano e assinatura — EZRA ERP" },
      {
        name: "description",
        content:
          "Plano contratado, mensalidade, filiais extras, implantação, o que já foi pago e o que falta.",
      },
      { property: "og:title", content: "Plano e assinatura — EZRA ERP" },
      {
        property: "og:description",
        content: "Acompanhe a assinatura do EZRA ERP, pagamentos e valores em aberto.",
      },
    ],
  }),
  component: Planos,
});

function copiar(texto: string) {
  void navigator.clipboard.writeText(texto).then(
    () => toast.success("Copiado."),
    () => toast.error("Não foi possível copiar."),
  );
}

function Planos() {
  // Só administrador e gestor leem a assinatura (a função do banco recusa os demais). A fonte é a assinatura real
  // (saas_clientes / saas_faturas), a mesma da cobrança da equipe e do gateway; a empresa não grava nada aqui.
  const { data, isLoading, isError } = useQuery({
    queryKey: ["assinatura-resumo"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("assinatura_resumo");
      if (error) throw error;
      return lerResumoAssinatura(data);
    },
    retry: false,
  });

  const { data: planosDoSistema } = useQuery({
    queryKey: ["assinatura-planos"],
    queryFn: async () => {
      const { data } = await supabase
        .from("saas_planos")
        .select("id,codigo,nome,resumo,valor_mensal,dias_teste,recursos,ordem,ativo")
        .eq("ativo", true)
        .order("ordem");
      return (data ?? []).map((p) => comNomeDeExibicao({ ...p, recursos: p.recursos ?? [] }));
    },
    staleTime: 10 * 60_000,
  });

  const { data: contatos } = useQuery({
    queryKey: ["contatos"],
    queryFn: async () => {
      const { data } = await supabase
        .from("contatos")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(30);
      return data ?? [];
    },
  });

  const hoje = new Date().toISOString().slice(0, 10);
  const assinatura = data ?? null;
  const faturas = useMemo(() => assinatura?.faturas ?? [], [assinatura]);
  const resumo = useMemo(() => totaisDasFaturas(faturas, hoje), [faturas, hoje]);
  const plano = assinatura?.plano ?? null;

  return (
    <>
      <PageHeader
        title="Plano e assinatura"
        description="Plano contratado, mensalidade, filiais extras, o que já foi pago e o que falta."
        actions={
          assinatura ? (
            <Button asChild variant="outline">
              <Link to="/chamados">Pedir mudança de plano</Link>
            </Button>
          ) : null
        }
      />

      {isLoading ? (
        <div className="panel h-52 animate-pulse" />
      ) : isError ? (
        <EmptyState
          title="A assinatura é vista só por administrador e gestor."
          description="Peça a quem administra a empresa para conferir o plano e os pagamentos."
        />
      ) : !assinatura ? (
        <EmptyState
          title="Nenhuma assinatura cadastrada."
          description="Assim que o plano for contratado, os valores e pagamentos aparecem aqui."
        />
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Plano atual"
              value={plano ? nomeDoPlano(plano.codigo) || plano.nome : "—"}
              hint={
                plano
                  ? `${brl(plano.valorMensal)}/mês · ${plano.resumo ?? ""}`
                  : "Plano não definido"
              }
              icon={CircleDollarSign}
              tone="accent"
            />
            <StatCard
              label="Total mensal"
              value={brl(totalMensal(assinatura))}
              hint={`${assinatura.cliente.filiaisExtras} filial(is) extra × ${brl(plano?.valorFilialExtra ?? 0)}`}
              icon={Wallet}
            />
            <StatCard
              label="Já pago"
              value={brl(resumo.pago)}
              hint="Soma de tudo que foi quitado"
              icon={Check}
              tone="success"
            />
            <StatCard
              label="Falta pagar"
              value={brl(resumo.aberto)}
              hint={resumo.vencido > 0 ? `${brl(resumo.vencido)} em atraso` : "Nada em atraso"}
              icon={resumo.vencido > 0 ? AlertTriangle : Receipt}
              tone={resumo.vencido > 0 ? "danger" : "default"}
            />
          </div>

          <div className="panel p-5">
            <div className="flex flex-wrap items-center gap-3">
              <Badge variant={assinatura.cliente.situacao === "ativo" ? "default" : "secondary"}>
                {SITUACAO_SAAS[assinatura.cliente.situacao] ?? assinatura.cliente.situacao}
              </Badge>
              {assinatura.cliente.testeAte && (
                <span className="text-sm text-muted-foreground">
                  Teste grátis até {dateBR(assinatura.cliente.testeAte)}
                </span>
              )}
              <span className="text-sm text-muted-foreground">
                Vencimento todo dia {assinatura.cliente.diaVencimento}
              </span>
              <span className="text-sm text-muted-foreground">
                {assinatura.taxaInicial.rotulo} {brl(assinatura.taxaInicial.valor)} —{" "}
                {assinatura.cliente.implantacaoPaga ? "paga" : "em aberto"}
              </span>
              {assinatura.cliente.cobrancaAutomatica && (
                <span className="text-sm text-muted-foreground">
                  Cobrança automática: Pix, boleto ou cartão na página de cada fatura
                </span>
              )}
            </div>
            {plano && plano.recursos.length > 0 && (
              <ul className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {comNomeDeExibicao({
                  codigo: plano.codigo,
                  nome: plano.nome,
                  recursos: plano.recursos,
                }).recursos.map((i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <Check className="mt-0.5 size-4 shrink-0 text-brand" />
                    {i}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {(planosDoSistema ?? []).length > 0 && (
            <div className="grid gap-4 lg:grid-cols-3">
              {(planosDoSistema ?? []).map((p) => {
                const atual = p.codigo === plano?.codigo;
                return (
                  <div
                    key={p.id}
                    className={atual ? "panel border-2 border-brand p-5" : "panel p-5"}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="font-display text-lg font-bold">{p.nome}</h3>
                      {atual && <Badge>Seu plano</Badge>}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{p.resumo}</p>
                    <p className="mt-3 font-display text-2xl font-bold">
                      {brl(Number(p.valor_mensal))}
                      <span className="ml-1 text-xs font-medium text-muted-foreground">/mês</span>
                    </p>
                    {Number(p.dias_teste) > 0 && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {p.dias_teste} dias de teste grátis
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div className="panel overflow-x-auto">
            <div className="border-b border-border px-4 py-3">
              <p className="font-display text-sm font-semibold">Pagamentos da assinatura</p>
              <p className="text-xs text-muted-foreground">
                As cobranças são lançadas pela EZRA. O pagamento é confirmado pela própria EZRA ou,
                na cobrança automática, pelo banco; aqui você só acompanha e paga.
              </p>
            </div>
            {faturas.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                Nenhuma cobrança lançada.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cobrança</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Vencimento</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead className="text-right">Pago</TableHead>
                    <TableHead className="text-right">Falta</TableHead>
                    <TableHead>Situação</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {faturas.map((f) => {
                    const falta = saldoDaFatura(f);
                    const situacao = situacaoDaFatura(f, hoje);
                    return (
                      <TableRow key={f.id}>
                        <TableCell className="max-w-[18rem] truncate">{f.descricao}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {TIPO_FATURA_SAAS[f.tipo] ?? f.tipo}
                        </TableCell>
                        <TableCell className="text-sm">{dateBR(f.vencimento)}</TableCell>
                        <TableCell className="text-right text-numeric">{brl(f.valor)}</TableCell>
                        <TableCell className="text-right text-numeric">
                          {brl(f.valorPago)}
                        </TableCell>
                        <TableCell className="text-right text-numeric">{brl(falta)}</TableCell>
                        <TableCell>
                          {situacao === "paga" ? (
                            <span className="inline-flex items-center gap-1 text-sm text-success">
                              <Check className="size-3.5" /> Pago {dateBR(f.pagoEm)}
                            </span>
                          ) : situacao === "atrasada" ? (
                            <Badge variant="destructive">Em atraso</Badge>
                          ) : (
                            <Badge variant="outline">Em aberto</Badge>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right">
                          {falta > 0 &&
                            (f.url ? (
                              <Button asChild size="sm">
                                <a href={f.url} target="_blank" rel="noopener noreferrer">
                                  Pagar <ExternalLink className="ml-1 size-3.5" />
                                </a>
                              </Button>
                            ) : (
                              <span className="inline-flex gap-1">
                                {f.boletoUrl && (
                                  <Button asChild size="sm" variant="outline">
                                    <a href={f.boletoUrl} target="_blank" rel="noopener noreferrer">
                                      Boleto
                                    </a>
                                  </Button>
                                )}
                                {f.pixCopiaCola && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => copiar(f.pixCopiaCola!)}
                                  >
                                    Copiar Pix
                                  </Button>
                                )}
                                {!f.boletoUrl && !f.pixCopiaCola && (
                                  <span className="text-xs text-muted-foreground">
                                    A EZRA envia o link
                                  </span>
                                )}
                              </span>
                            ))}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </div>
        </div>
      )}

      <div className="panel mt-6 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="font-display text-sm font-semibold">Interessados nos planos</p>
            <p className="text-xs text-muted-foreground">
              Contatos enviados pela página pública de contato.
            </p>
          </div>
        </div>
        {(contatos ?? []).length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Nenhum contato recebido ainda.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-border">
            {(contatos ?? []).map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{c.nome}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {[c.email, c.whatsapp].filter(Boolean).join(" · ") || "—"}
                    {c.plano_interesse ? ` · plano ${nomeDoPlano(c.plano_interesse)}` : ""} ·{" "}
                    {dateBR(c.created_at)}
                  </p>
                  {c.mensagem && <p className="mt-1 text-xs">{c.mensagem}</p>}
                </div>
                <div className="flex gap-2">
                  {c.whatsapp && (
                    <Button asChild size="sm" variant="outline">
                      <a
                        href={`https://wa.me/${c.whatsapp.replace(/\D/g, "")}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        WhatsApp
                      </a>
                    </Button>
                  )}
                  {c.email && (
                    <Button asChild size="sm" variant="outline">
                      <a href={`mailto:${c.email}?subject=Planos EZRA ERP`}>E-mail</a>
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
