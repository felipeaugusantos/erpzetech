import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CircleDollarSign, Hammer, PackageCheck, Search, Wrench } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useModulosCnae } from "@/lib/cnae";
import { ModuloBloqueado } from "@/components/app/ModuloCnae";
import { brl, dateBR, num } from "@/lib/format";
import { EmptyState, PageHeader, StatCard } from "@/components/app/PageHeader";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/locacao-estoque")({
  head: () => ({
    meta: [
      { title: "Estoque de equipamentos — ERP Ze Tech" },
      {
        name: "description",
        content:
          "Quantidade em estoque, custo, valor de aluguel e o que está em locação agora, equipamento por equipamento.",
      },
      { property: "og:title", content: "Estoque de equipamentos — ERP Ze Tech" },
      {
        property: "og:description",
        content: "Acompanhe disponível, locado, custo e receita de aluguel de cada equipamento.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: LocacaoEstoqueModulo,
});

const EM_LOCACAO = ["reservada", "em_andamento"];

function LocacaoEstoque() {
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState("todos");
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
    queryKey: ["locacao-estoque-contratos"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("locacoes")
        .select(
          "id, numero, equipamento_id, situacao, inicio, previsao_devolucao, devolvido_em, dias, valor_total, clientes(nome), obras(nome)",
        )
        .order("inicio", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  /** Para cada equipamento: unidades locadas agora, contrato aberto e receita acumulada. */
  const linhas = useMemo(() => {
    return equipamentos.map((e) => {
      const meus = contratos.filter((c) => c.equipamento_id === e.id);
      const abertos = meus.filter((c) => EM_LOCACAO.includes(String(c.situacao)));
      const quantidade = Number(e.quantidade ?? 1);
      const locados = Math.min(abertos.length, quantidade);
      const disponivel = Math.max(quantidade - locados, 0);
      const receita = meus
        .filter((c) => c.situacao !== "cancelada")
        .reduce((s, c) => s + Number(c.valor_total ?? 0), 0);
      const custo = Number(e.valor_aquisicao ?? 0) + Number(e.custo_manutencao ?? 0);
      const atual = abertos[0] ?? null;
      const atrasado =
        !!atual && !atual.devolvido_em && String(atual.previsao_devolucao ?? "") < hoje;
      return { e, quantidade, locados, disponivel, receita, custo, atual, atrasado };
    });
  }, [equipamentos, contratos, hoje]);

  const lista = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return linhas.filter((l) => {
      if (filtro === "locados" && l.locados === 0) return false;
      if (filtro === "disponiveis" && l.disponivel === 0) return false;
      if (filtro === "atrasados" && !l.atrasado) return false;
      if (filtro === "manutencao" && l.e.situacao !== "manutencao") return false;
      if (!t) return true;
      return [l.e.nome, l.e.codigo, l.e.categoria, l.e.marca, l.e.modelo, l.atual?.clientes?.nome]
        .filter(Boolean)
        .some((x) => String(x).toLowerCase().includes(t));
    });
  }, [linhas, busca, filtro]);

  const totais = useMemo(
    () =>
      lista.reduce(
        (a, l) => ({
          unidades: a.unidades + l.quantidade,
          locados: a.locados + l.locados,
          disponivel: a.disponivel + l.disponivel,
          custo: a.custo + l.custo,
          receita: a.receita + l.receita,
          atrasados: a.atrasados + (l.atrasado ? 1 : 0),
        }),
        { unidades: 0, locados: 0, disponivel: 0, custo: 0, receita: 0, atrasados: 0 },
      ),
    [lista],
  );

  return (
    <div>
      <PageHeader
        title="Estoque de equipamentos"
        description="Quantidade, custo, valor de aluguel e o que está em locação agora, equipamento por equipamento."
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Unidades em estoque"
          value={num(totais.unidades, 0)}
          hint={`${num(totais.disponivel, 0)} disponíveis`}
          icon={Hammer}
        />
        <StatCard
          label="Em locação agora"
          value={num(totais.locados, 0)}
          hint={
            totais.atrasados > 0 ? `${num(totais.atrasados, 0)} com devolução atrasada` : "Em dia"
          }
          tone={totais.atrasados > 0 ? "warning" : "accent"}
          icon={PackageCheck}
        />
        <StatCard label="Custo do patrimônio" value={brl(totais.custo)} icon={Wrench} />
        <StatCard
          label="Receita de aluguel"
          value={brl(totais.receita)}
          hint="Contratos não cancelados"
          tone="success"
          icon={CircleDollarSign}
        />
      </div>

      <div className="panel mb-4 flex flex-wrap items-end gap-3 p-3">
        <div className="relative min-w-56 flex-1">
          <Label>Buscar</Label>
          <Search className="pointer-events-none absolute bottom-2.5 left-3 size-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Equipamento, código, categoria ou cliente"
            value={busca}
            onChange={(ev) => setBusca(ev.target.value)}
          />
        </div>
        <div className="min-w-44">
          <Label>Mostrar</Label>
          <Select value={filtro} onValueChange={setFiltro}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos</SelectItem>
              <SelectItem value="locados">Em locação</SelectItem>
              <SelectItem value="disponiveis">Disponíveis</SelectItem>
              <SelectItem value="atrasados">Devolução atrasada</SelectItem>
              <SelectItem value="manutencao">Em manutenção</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading ? (
        <div className="panel p-6 text-sm text-muted-foreground">Carregando…</div>
      ) : lista.length === 0 ? (
        <EmptyState
          title="Nenhum equipamento para mostrar."
          description="Cadastre os equipamentos em Locação de equipamentos › Equipamentos ou troque o filtro."
        />
      ) : (
        <div className="panel overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Equipamento</TableHead>
                <TableHead className="text-right">Estoque</TableHead>
                <TableHead className="text-right">Locados</TableHead>
                <TableHead className="text-right">Disponível</TableHead>
                <TableHead className="text-right">Custo</TableHead>
                <TableHead className="text-right">Diária</TableHead>
                <TableHead className="text-right">Semana</TableHead>
                <TableHead className="text-right">Mês</TableHead>
                <TableHead className="text-right">Receita</TableHead>
                <TableHead>Em locação com</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lista.map((l) => (
                <TableRow key={l.e.id}>
                  <TableCell>
                    <p className="font-medium">{l.e.nome}</p>
                    <p className="text-xs text-muted-foreground">
                      {[l.e.codigo, l.e.categoria, l.e.marca].filter(Boolean).join(" · ") || "—"}
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
                  <TableCell className="text-right text-numeric">{brl(l.custo)}</TableCell>
                  <TableCell className="text-right text-numeric">
                    {brl(Number(l.e.valor_diaria ?? 0))}
                  </TableCell>
                  <TableCell className="text-right text-numeric">
                    {brl(Number(l.e.valor_semanal ?? 0))}
                  </TableCell>
                  <TableCell className="text-right text-numeric">
                    {brl(Number(l.e.valor_mensal ?? 0))}
                  </TableCell>
                  <TableCell className="text-right text-numeric font-semibold">
                    {brl(l.receita)}
                  </TableCell>
                  <TableCell>
                    {l.atual ? (
                      <div>
                        <p className="text-sm">{l.atual.clientes?.nome ?? "—"}</p>
                        <p
                          className={`text-xs ${l.atrasado ? "font-medium text-destructive" : "text-muted-foreground"}`}
                        >
                          Nº {l.atual.numero} · devolver{" "}
                          {dateBR(String(l.atual.previsao_devolucao))}
                          {l.atrasado ? " (atrasado)" : ""}
                        </p>
                      </div>
                    ) : (
                      <span className="text-sm text-muted-foreground">—</span>
                    )}
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

/** O módulo só abre quando o CNAE da empresa permite locação. */
function LocacaoEstoqueModulo() {
  const modulos = useModulosCnae();
  if (modulos.carregando) return <div className="panel h-40 animate-pulse" />;
  if (!modulos.locacao) return <ModuloBloqueado modulo="locacao" />;
  return <LocacaoEstoque />;
}
