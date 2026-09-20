import { useMemo } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Boxes,
  CircleDollarSign,
  FileText,
  PackageCheck,
  Receipt,
  ThumbsUp,
  Truck,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useModulosCnae } from "@/lib/cnae";
import { ModuloBloqueado } from "@/components/app/ModuloCnae";
import { brl, dateBR, num } from "@/lib/format";
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

export const Route = createFileRoute("/_authenticated/painel-locacao")({
  head: () => ({
    meta: [
      { title: "Painel de locação — ERP Ze Tech" },
      {
        name: "description",
        content:
          "Estoque de equipamentos, o que está locado agora e as pendências de aprovação, entrega, devolução, cobrança e nota de serviço.",
      },
      { property: "og:title", content: "Painel de locação — ERP Ze Tech" },
      {
        property: "og:description",
        content: "Equipamentos locados, disponíveis e pendências da locação em uma só tela.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PainelLocacaoModulo,
});

const ABERTAS = ["reservada", "em_andamento"];

function PainelLocacao() {
  const hoje = new Date().toISOString().slice(0, 10);

  const { data: equipamentos = [], isLoading } = useQuery({
    queryKey: ["locacao-equipamentos"],
    queryFn: async () => {
      const { data, error } = await supabase.from("locacao_equipamentos").select("*").order("nome");
      if (error) throw error;
      return data;
    },
  });

  const { data: contratos = [] } = useQuery({
    queryKey: ["painel-locacao-contratos"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("locacoes")
        .select(
          "id, numero, situacao, aprovada, inicio, previsao_devolucao, devolvido_em, dias, valor_total, valor_faturado, nfe_id, equipamento_id, clientes(nome), obras(nome), locacao_equipamentos(nome, codigo)",
        )
        .order("numero", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  /** Estoque: unidades, quantas estão locadas agora e quantas sobram. */
  const estoque = useMemo(() => {
    const abertos = contratos.filter((c) => ABERTAS.includes(String(c.situacao)));
    return equipamentos.map((e) => {
      const meus = abertos.filter((c) => c.equipamento_id === e.id);
      const quantidade = Number(e.quantidade ?? 1);
      const locados = Math.min(meus.length, quantidade);
      return {
        e,
        quantidade,
        locados,
        disponivel: Math.max(quantidade - locados, 0),
        contratos: meus,
      };
    });
  }, [equipamentos, contratos]);

  const locados = useMemo(
    () =>
      contratos
        .filter((c) => ABERTAS.includes(String(c.situacao)))
        .map((c) => ({
          ...c,
          atrasado: !c.devolvido_em && String(c.previsao_devolucao ?? "") < hoje,
        })),
    [contratos, hoje],
  );

  /** Pendências: cada contrato aparece no passo que falta resolver. */
  const pendencias = useMemo(() => {
    const lista: {
      id: string;
      numero: number;
      cliente: string;
      equipamento: string;
      passo: string;
      detalhe: string;
      urgente: boolean;
      valor: number;
    }[] = [];
    for (const c of contratos) {
      if (c.situacao === "cancelada") continue;
      const cliente = c.clientes?.nome ?? "—";
      const equipamento = c.locacao_equipamentos?.nome ?? "—";
      const valor = Number(c.valor_total ?? 0);
      const base = { id: c.id, numero: c.numero, cliente, equipamento, valor };
      if (!c.aprovada && c.situacao === "reservada") {
        lista.push({ ...base, passo: "Aprovar", detalhe: "Solicitação aguardando aprovação", urgente: false });
        continue;
      }
      if (c.aprovada && c.situacao === "reservada") {
        lista.push({
          ...base,
          passo: "Entregar",
          detalhe: `Retirada prevista em ${dateBR(c.inicio)}`,
          urgente: String(c.inicio ?? "") < hoje,
        });
        continue;
      }
      if (c.situacao === "em_andamento") {
        const atrasado = String(c.previsao_devolucao ?? "") < hoje;
        lista.push({
          ...base,
          passo: "Devolver",
          detalhe: `${atrasado ? "Devolução atrasada desde" : "Devolver em"} ${dateBR(c.previsao_devolucao)}`,
          urgente: atrasado,
        });
        continue;
      }
      if (Number(c.valor_faturado ?? 0) <= 0 && valor > 0) {
        lista.push({ ...base, passo: "Cobrar", detalhe: "Contrato devolvido e ainda sem cobrança", urgente: true });
        continue;
      }
      if (!c.nfe_id && valor > 0) {
        lista.push({ ...base, passo: "Nota de serviço", detalhe: "Locação cobrada e sem NFS-e", urgente: false });
      }
    }
    return lista;
  }, [contratos, hoje]);

  const totais = useMemo(() => {
    const unidades = estoque.reduce((s, l) => s + l.quantidade, 0);
    const emLocacao = estoque.reduce((s, l) => s + l.locados, 0);
    return {
      unidades,
      emLocacao,
      disponivel: estoque.reduce((s, l) => s + l.disponivel, 0),
      atrasados: locados.filter((c) => c.atrasado).length,
      receita: contratos
        .filter((c) => c.situacao !== "cancelada")
        .reduce((s, c) => s + Number(c.valor_total ?? 0), 0),
      aberto: locados.reduce((s, c) => s + Number(c.valor_total ?? 0), 0),
    };
  }, [estoque, locados, contratos]);

  const icone: Record<string, typeof ThumbsUp> = {
    Aprovar: ThumbsUp,
    Entregar: Truck,
    Devolver: PackageCheck,
    Cobrar: Receipt,
    "Nota de serviço": FileText,
  };

  return (
    <div>
      <PageHeader
        title="Painel de locação"
        description="Estoque de equipamentos, o que está locado agora e o que falta resolver em cada contrato."
        actions={
          <Button asChild>
            <Link to="/locacao-balcao">
              <Receipt className="size-4" /> Balcão de locação
            </Link>
          </Button>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Unidades em estoque"
          value={num(totais.unidades, 0)}
          hint={`${num(totais.disponivel, 0)} disponíveis agora`}
          icon={Boxes}
        />
        <StatCard
          label="Locados agora"
          value={num(totais.emLocacao, 0)}
          hint={totais.atrasados > 0 ? `${num(totais.atrasados, 0)} com devolução atrasada` : "Em dia"}
          tone={totais.atrasados > 0 ? "warning" : "accent"}
          icon={PackageCheck}
        />
        <StatCard
          label="Pendentes"
          value={num(pendencias.length, 0)}
          hint={`${num(pendencias.filter((p) => p.urgente).length, 0)} urgentes`}
          tone={pendencias.some((p) => p.urgente) ? "warning" : "default"}
          icon={AlertTriangle}
        />
        <StatCard
          label="Valor em locação"
          value={brl(totais.aberto)}
          hint={`${brl(totais.receita)} em contratos no total`}
          tone="success"
          icon={CircleDollarSign}
        />
      </div>

      <div className="panel mb-5 overflow-x-auto">
        <div className="border-b p-3 text-sm font-semibold">Pendências da locação</div>
        {pendencias.length === 0 ? (
          <EmptyState
            title="Nenhuma pendência."
            description="Todos os contratos estão aprovados, entregues, devolvidos, cobrados e com nota."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nº</TableHead>
                <TableHead>Falta</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Equipamento</TableHead>
                <TableHead>Detalhe</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {pendencias.map((p) => {
                const Icone = icone[p.passo] ?? AlertTriangle;
                return (
                  <TableRow key={`${p.id}-${p.passo}`}>
                    <TableCell className="text-numeric font-semibold">{p.numero}</TableCell>
                    <TableCell>
                      <Badge
                        variant="secondary"
                        className={p.urgente ? "bg-destructive/15 text-destructive" : undefined}
                      >
                        <Icone className="mr-1 size-3" />
                        {p.passo}
                      </Badge>
                    </TableCell>
                    <TableCell>{p.cliente}</TableCell>
                    <TableCell className="text-muted-foreground">{p.equipamento}</TableCell>
                    <TableCell
                      className={p.urgente ? "text-sm font-medium text-destructive" : "text-sm text-muted-foreground"}
                    >
                      {p.detalhe}
                    </TableCell>
                    <TableCell className="text-right text-numeric">{brl(p.valor)}</TableCell>
                    <TableCell className="text-right">
                      <Button asChild variant="ghost" size="sm">
                        <Link to="/locacoes">Abrir</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>

      <div className="panel overflow-x-auto">
        <div className="border-b p-3 text-sm font-semibold">Estoque e equipamentos locados</div>
        {isLoading ? (
          <div className="p-6 text-sm text-muted-foreground">Carregando…</div>
        ) : estoque.length === 0 ? (
          <EmptyState
            title="Nenhum equipamento cadastrado."
            description="Cadastre em Locação de equipamentos › Equipamentos."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Equipamento</TableHead>
                <TableHead className="text-right">Estoque</TableHead>
                <TableHead className="text-right">Locados</TableHead>
                <TableHead className="text-right">Disponível</TableHead>
                <TableHead className="text-right">Diária</TableHead>
                <TableHead>Com quem está</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {estoque.map((l) => {
                const atrasado = l.contratos.some(
                  (c) => !c.devolvido_em && String(c.previsao_devolucao ?? "") < hoje,
                );
                return (
                  <TableRow key={l.e.id}>
                    <TableCell>
                      <p className="font-medium">{l.e.nome}</p>
                      <p className="text-xs text-muted-foreground">
                        {[l.e.codigo, l.e.marca, l.e.modelo].filter(Boolean).join(" · ") || "—"}
                      </p>
                    </TableCell>
                    <TableCell className="text-right text-numeric">{num(l.quantidade, 0)}</TableCell>
                    <TableCell className="text-right text-numeric">{num(l.locados, 0)}</TableCell>
                    <TableCell className="text-right text-numeric">
                      {l.e.situacao === "manutencao" ? (
                        <Badge variant="secondary">Manutenção</Badge>
                      ) : l.disponivel === 0 ? (
                        <Badge className="bg-primary/15 text-primary">Sem unidade livre</Badge>
                      ) : (
                        num(l.disponivel, 0)
                      )}
                    </TableCell>
                    <TableCell className="text-right text-numeric">
                      {brl(Number(l.e.valor_diaria ?? 0))}
                    </TableCell>
                    <TableCell>
                      {l.contratos.length === 0 ? (
                        <span className="text-sm text-muted-foreground">—</span>
                      ) : (
                        <div className="space-y-0.5">
                          {l.contratos.slice(0, 3).map((c) => (
                            <p
                              key={c.id}
                              className={`text-xs ${atrasado ? "text-destructive" : "text-muted-foreground"}`}
                            >
                              Nº {c.numero} · {c.clientes?.nome ?? "—"} · devolver{" "}
                              {dateBR(c.previsao_devolucao)}
                            </p>
                          ))}
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}

/** O módulo só abre quando o CNAE da empresa permite locação. */
function PainelLocacaoModulo() {
  const modulos = useModulosCnae();
  if (modulos.carregando) return <div className="panel h-40 animate-pulse" />;
  if (!modulos.locacao) return <ModuloBloqueado modulo="locacao" />;
  return <PainelLocacao />;
}
