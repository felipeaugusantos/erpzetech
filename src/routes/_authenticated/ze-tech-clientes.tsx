import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Building2, Search, Users, Wallet } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { brl, dateBR } from "@/lib/format";
import {
  SITUACAO_SAAS,
  TIPO_FATURA_SAAS,
  diasEntre,
  useSaasDados,
  useSaasOperador,
  type LojaSaas,
} from "@/lib/saas";
import { EmptyState, PageHeader, StatCard } from "@/components/app/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/ze-tech-clientes")({
  head: () => ({
    meta: [
      { title: "Clientes da Ze Tech — histórico e filiais" },
      {
        name: "description",
        content:
          "Acompanhe cada loja da rede: plano, situação do contrato, filiais cadastradas e histórico completo de cobranças.",
      },
      { property: "og:title", content: "Clientes da Ze Tech — histórico e filiais" },
      {
        property: "og:description",
        content: "Situação de cada cliente assinante, filiais e todas as cobranças emitidas.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ClientesZeTech,
});

const SITUACAO_LOJA: Record<string, string> = {
  implantacao: "Em implantação",
  ativa: "Ativa",
  inativa: "Inativa",
};

function ClientesZeTech() {
  const { data: operador, isLoading: carregandoAcesso } = useSaasOperador();
  const { data, isLoading } = useSaasDados(operador === true);
  const [busca, setBusca] = useState("");
  const [situacao, setSituacao] = useState("todas");
  const [aberto, setAberto] = useState<string | null>(null);

  const { data: lojas = [] } = useQuery({
    queryKey: ["saas-lojas"],
    enabled: operador === true,
    queryFn: async () => {
      const { data, error } = await supabase.from("saas_lojas").select("*").order("nome");
      if (error) throw error;
      return (data ?? []) as unknown as LojaSaas[];
    },
  });

  const resumos = data?.resumos ?? [];

  const lista = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return resumos.filter((r) => {
      if (situacao !== "todas" && r.cliente.situacao !== situacao) return false;
      if (!t) return true;
      return [r.cliente.nome, r.cliente.documento, r.cliente.cidade, r.plano?.nome]
        .filter(Boolean)
        .some((x) => String(x).toLowerCase().includes(t));
    });
  }, [resumos, busca, situacao]);

  const detalhe = resumos.find((r) => r.cliente.id === aberto) ?? null;
  const lojasDoCliente = lojas.filter((l) => l.cliente_id === aberto);

  const totais = useMemo(
    () => ({
      clientes: resumos.length,
      ativos: resumos.filter((r) => r.cliente.situacao === "ativo").length,
      recorrente: resumos
        .filter((r) => r.cliente.situacao === "ativo")
        .reduce((s, r) => s + r.mensal, 0),
      atrasado: resumos.reduce((s, r) => s + r.atrasado, 0),
    }),
    [resumos],
  );

  if (carregandoAcesso) {
    return <div className="panel p-6 text-sm text-muted-foreground">Carregando…</div>;
  }
  if (operador !== true) {
    return (
      <EmptyState
        title="Área exclusiva da equipe Ze Tech."
        description="Entre com um acesso da equipe para acompanhar os clientes da rede."
      />
    );
  }

  return (
    <div>
      <PageHeader
        title="Clientes da Ze Tech"
        description="Cada loja da rede com plano, situação do contrato, filiais cadastradas e histórico de cobranças."
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Clientes" value={String(totais.clientes)} icon={Users} />
        <StatCard label="Ativos" value={String(totais.ativos)} tone="success" />
        <StatCard label="Receita mensal" value={brl(totais.recorrente)} icon={Wallet} />
        <StatCard label="Em atraso" value={brl(totais.atrasado)} tone="danger" />
      </div>

      <div className="panel mb-4 flex flex-wrap items-center gap-2 p-3">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Buscar por cliente, documento, cidade ou plano"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>
        <Select value={situacao} onValueChange={setSituacao}>
          <SelectTrigger className="w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas as situações</SelectItem>
            {Object.entries(SITUACAO_SAAS).map(([v, l]) => (
              <SelectItem key={v} value={v}>
                {l}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="panel p-6 text-sm text-muted-foreground">Carregando…</div>
      ) : lista.length === 0 ? (
        <EmptyState
          title="Nenhum cliente encontrado."
          description="Cadastre os clientes no painel da Ze Tech para acompanhá-los aqui."
        />
      ) : (
        <div className="panel overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cliente</TableHead>
                <TableHead>Plano</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead className="text-right">Lojas</TableHead>
                <TableHead className="text-right">Mensal</TableHead>
                <TableHead>Próximo vencimento</TableHead>
                <TableHead className="text-right">Em aberto</TableHead>
                <TableHead className="text-right">Atrasado</TableHead>
                <TableHead>Pagamento</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {lista.map((r) => {
                const minhasLojas = lojas.filter((l) => l.cliente_id === r.cliente.id);
                return (
                  <TableRow key={r.cliente.id}>
                    <TableCell>
                      <p className="font-medium">{r.cliente.nome}</p>
                      <p className="text-xs text-muted-foreground">
                        {[r.cliente.cidade, r.cliente.uf].filter(Boolean).join("/") || "—"}
                      </p>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{r.plano?.nome ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">
                        {SITUACAO_SAAS[r.cliente.situacao] ?? r.cliente.situacao}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right text-numeric">
                      {minhasLojas.length || 1}
                    </TableCell>
                    <TableCell className="text-right text-numeric">{brl(r.mensal)}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {r.proximoVencimento ? dateBR(r.proximoVencimento) : "—"}
                    </TableCell>
                    <TableCell className="text-right text-numeric">{brl(r.aberto)}</TableCell>
                    <TableCell className="text-right text-numeric">{brl(r.atrasado)}</TableCell>
                    <TableCell>
                      <Badge
                        className={
                          r.status === "pago"
                            ? "bg-success/15 text-success"
                            : r.status === "atrasado"
                              ? "bg-destructive/15 text-destructive"
                              : "bg-warning/15 text-warning-foreground"
                        }
                      >
                        {r.status === "pago" ? "Em dia" : r.status === "aberto" ? "A vencer" : "Atrasado"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => setAberto(r.cliente.id)}>
                        Abrir
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={!!aberto} onOpenChange={(o) => !o && setAberto(null)}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{detalhe?.cliente.nome ?? "Cliente"}</DialogTitle>
          </DialogHeader>

          {detalhe && (
            <div className="space-y-5 text-sm">
              <div className="grid gap-3 sm:grid-cols-4">
                <div className="rounded-md border border-border p-3">
                  <p className="text-xs text-muted-foreground">Plano</p>
                  <p className="font-semibold">{detalhe.plano?.nome ?? "—"}</p>
                  <p className="text-xs text-muted-foreground">{brl(detalhe.mensal)} por mês</p>
                </div>
                <div className="rounded-md border border-border p-3">
                  <p className="text-xs text-muted-foreground">Situação</p>
                  <p className="font-semibold">
                    {SITUACAO_SAAS[detalhe.cliente.situacao] ?? detalhe.cliente.situacao}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {detalhe.diasTeste !== null && detalhe.diasTeste >= 0
                      ? `Teste termina em ${detalhe.diasTeste} dias`
                      : `Contrato até ${dateBR(detalhe.fim)}`}
                  </p>
                </div>
                <div className="rounded-md border border-border p-3">
                  <p className="text-xs text-muted-foreground">Em aberto</p>
                  <p className="font-semibold">{brl(detalhe.aberto)}</p>
                  <p className="text-xs text-muted-foreground">
                    Atrasado {brl(detalhe.atrasado)}
                  </p>
                </div>
                <div className="rounded-md border border-border p-3">
                  <p className="text-xs text-muted-foreground">Já pago</p>
                  <p className="font-semibold">{brl(detalhe.pagoTotal)}</p>
                  <p className="text-xs text-muted-foreground">
                    {detalhe.faturas.length} cobranças
                  </p>
                </div>
              </div>

              <div>
                <p className="mb-2 flex items-center gap-2 font-display font-semibold">
                  <Building2 className="size-4" /> Lojas e filiais
                </p>
                {lojasDoCliente.length === 0 ? (
                  <p className="text-muted-foreground">
                    Nenhuma loja cadastrada para este cliente ainda.
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Loja</TableHead>
                        <TableHead>Tipo</TableHead>
                        <TableHead>Cidade</TableHead>
                        <TableHead>Responsável</TableHead>
                        <TableHead>Situação</TableHead>
                        <TableHead>Implantação</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {lojasDoCliente.map((l) => (
                        <TableRow key={l.id}>
                          <TableCell className="font-medium">{l.nome}</TableCell>
                          <TableCell className="text-muted-foreground">
                            {l.tipo === "matriz" ? "Matriz" : "Filial"}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {[l.cidade, l.uf].filter(Boolean).join("/") || "—"}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {l.responsavel ?? "—"}
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary">
                              {SITUACAO_LOJA[l.situacao] ?? l.situacao}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {l.implantacao_paga ? (
                              <Badge className="bg-success/15 text-success">Paga</Badge>
                            ) : (
                              <Badge variant="outline">Em aberto</Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>

              <div>
                <p className="mb-2 flex items-center gap-2 font-display font-semibold">
                  <Wallet className="size-4" /> Histórico de cobranças
                </p>
                {detalhe.faturas.length === 0 ? (
                  <p className="text-muted-foreground">Nenhuma cobrança emitida ainda.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Vencimento</TableHead>
                        <TableHead>Descrição</TableHead>
                        <TableHead>Tipo</TableHead>
                        <TableHead className="text-right">Valor</TableHead>
                        <TableHead className="text-right">Pago</TableHead>
                        <TableHead>Situação</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {[...detalhe.faturas]
                        .sort((a, b) => b.vencimento.localeCompare(a.vencimento))
                        .map((f) => {
                          const saldo = Number(f.valor) - Number(f.valor_pago);
                          const atrasada = saldo > 0 && diasEntre(f.vencimento) < 0;
                          return (
                            <TableRow key={f.id}>
                              <TableCell className="text-muted-foreground">
                                {dateBR(f.vencimento)}
                              </TableCell>
                              <TableCell>{f.descricao}</TableCell>
                              <TableCell className="text-muted-foreground">
                                {TIPO_FATURA_SAAS[f.tipo] ?? f.tipo}
                              </TableCell>
                              <TableCell className="text-right text-numeric">
                                {brl(Number(f.valor))}
                              </TableCell>
                              <TableCell className="text-right text-numeric">
                                {brl(Number(f.valor_pago))}
                              </TableCell>
                              <TableCell>
                                <Badge
                                  className={
                                    saldo <= 0
                                      ? "bg-success/15 text-success"
                                      : atrasada
                                        ? "bg-destructive/15 text-destructive"
                                        : "bg-warning/15 text-warning-foreground"
                                  }
                                >
                                  {saldo <= 0
                                    ? `Paga${f.pago_em ? ` em ${dateBR(f.pago_em)}` : ""}`
                                    : atrasada
                                      ? "Atrasada"
                                      : "A vencer"}
                                </Badge>
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

          <DialogFooter>
            <Button variant="outline" onClick={() => setAberto(null)}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
