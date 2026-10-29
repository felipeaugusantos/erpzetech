import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Gift, Search } from "lucide-react";

import { ModuloBloqueado } from "@/components/app/ModuloCnae";
import { EmptyState, PageHeader } from "@/components/app/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useModulosCnae } from "@/lib/cnae";
import { brl, dateBR } from "@/lib/format";
import { formatarIdentificacao } from "@/lib/lava-rapido";

export const Route = createFileRoute("/_authenticated/lava-clientes")({
  head: () => ({
    meta: [
      { title: "Clientes e fidelidade do lava rápido — EZRA ERP" },
      {
        name: "description",
        content: "Saldo de pontos, histórico de lavagens e planos de cada cliente do lava rápido.",
      },
    ],
  }),
  component: Modulo,
});

function Modulo() {
  const modulos = useModulosCnae();
  if (modulos.carregando) return <div className="panel h-40 animate-pulse" />;
  if (!modulos.lavarapido) return <ModuloBloqueado modulo="lavarapido" />;
  return <ClientesLava />;
}

type Fidelidade = {
  ativo: boolean;
  selos: number;
  necessarias: number;
  disponiveis: number;
  faltam: number;
  brindes_usados?: number;
};

function ClientesLava() {
  const [busca, setBusca] = useState("");
  const [clienteId, setClienteId] = useState<string | null>(null);

  const { data: clientes = [], isLoading } = useQuery({
    queryKey: ["lava-clientes"],
    queryFn: async () => {
      const [cl, ve, os, as] = await Promise.all([
        supabase.from("clientes").select("id, nome, telefone").order("nome").limit(3000),
        supabase.from("lr_veiculos").select("cliente_id"),
        supabase.from("lr_ordens").select("cliente_id"),
        supabase.from("lr_assinaturas").select("cliente_id"),
      ]);
      if (cl.error) throw cl.error;
      const usam = new Set<string>();
      for (const r of [...(ve.data ?? []), ...(os.data ?? []), ...(as.data ?? [])])
        usam.add(r.cliente_id);
      return (cl.data ?? []).filter((c) => usam.has(c.id));
    },
  });

  const filtrados = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return t
      ? clientes.filter((c) => `${c.nome} ${c.telefone ?? ""}`.toLowerCase().includes(t))
      : clientes;
  }, [clientes, busca]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Clientes e fidelidade"
        description="Saldo de pontos, lavagens e planos de cada cliente, direto no sistema."
      />
      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <div className="panel space-y-3 p-4">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="Buscar cliente ou telefone"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
          </div>
          {isLoading ? (
            <div className="h-32 animate-pulse rounded bg-muted" />
          ) : filtrados.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhum cliente do lava rápido encontrado.
            </p>
          ) : (
            <ul className="max-h-[60vh] space-y-1 overflow-auto">
              {filtrados.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => setClienteId(c.id)}
                    className={`w-full rounded px-3 py-2 text-left text-sm hover:bg-muted ${
                      clienteId === c.id ? "bg-muted font-semibold" : ""
                    }`}
                  >
                    {c.nome}
                    {c.telefone && (
                      <span className="block text-xs text-muted-foreground">{c.telefone}</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {clienteId ? (
          <Detalhe clienteId={clienteId} />
        ) : (
          <EmptyState
            title="Escolha um cliente"
            description="Veja o saldo de pontos, as lavagens e os planos."
          />
        )}
      </div>
    </div>
  );
}

function Detalhe({ clienteId }: { clienteId: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["lava-cliente", clienteId],
    queryFn: async () => {
      const [fid, ordens, assin, veic] = await Promise.all([
        supabase.rpc("lr_fidelidade_cliente", { p_cliente_id: clienteId }),
        supabase
          .from("lr_ordens")
          .select(
            "id, situacao, entrada_em, entregue_em, veiculo_id, lr_ordem_itens(preco_aplicado, cobertura, lr_servicos(nome))",
          )
          .eq("cliente_id", clienteId)
          .order("entrada_em", { ascending: false })
          .limit(200),
        supabase
          .from("lr_assinaturas")
          .select(
            "id, comprado_em, vence_em, lavagens, valor, situacao, veiculo_id, lr_planos(nome), lr_assinatura_usos(desfeito)",
          )
          .eq("cliente_id", clienteId)
          .order("comprado_em", { ascending: false }),
        supabase
          .from("lr_veiculos")
          .select("id, tipo, identificacao, modelo")
          .eq("cliente_id", clienteId),
      ]);
      if (fid.error) throw fid.error;
      if (ordens.error) throw ordens.error;
      if (assin.error) throw assin.error;
      const veiculos = new Map((veic.data ?? []).map((v) => [v.id, v]));
      return {
        fid: fid.data as unknown as Fidelidade,
        ordens: ordens.data ?? [],
        assin: assin.data ?? [],
        veiculos,
      };
    },
  });

  if (isLoading) return <div className="panel h-60 animate-pulse" />;
  if (error || !data)
    return (
      <div className="panel p-4 text-sm text-destructive">
        {(error as Error)?.message ?? "Erro"}
      </div>
    );

  const { fid, ordens, assin, veiculos } = data;
  const nomeVeic = (id: string) => {
    const v = veiculos.get(id);
    return v ? `${formatarIdentificacao(v.tipo, v.identificacao)} ${v.modelo ?? ""}` : "—";
  };
  const hoje = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-6">
      <div className="panel p-4">
        <h2 className="mb-3 flex items-center gap-2 font-semibold">
          <Gift className="size-4" /> Fidelidade
        </h2>
        {!fid.ativo ? (
          <p className="text-sm text-muted-foreground">
            O programa de fidelidade está desligado. Ligue em Planos e fidelidade.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-4">
            <Indicador rotulo="Pontos (lavagens)" valor={fid.selos} />
            <Indicador
              rotulo="Saldo atual"
              valor={`${fid.selos % fid.necessarias} / ${fid.necessarias}`}
            />
            <Indicador rotulo="Faltam p/ brinde" valor={fid.faltam} />
            <Indicador rotulo="Brindes disponíveis" valor={fid.disponiveis} destaque />
          </div>
        )}
      </div>

      <div className="panel p-4">
        <h2 className="mb-3 font-semibold">Planos</h2>
        {assin.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum plano comprado.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Plano</TableHead>
                <TableHead>Veículo</TableHead>
                <TableHead>Compra</TableHead>
                <TableHead>Vence</TableHead>
                <TableHead>Lavagens</TableHead>
                <TableHead>Valor</TableHead>
                <TableHead>Situação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {assin.map((a) => {
                const usadas = (a.lr_assinatura_usos ?? []).filter((u) => !u.desfeito).length;
                const sit =
                  a.situacao !== "ativa"
                    ? a.situacao
                    : a.vence_em < hoje
                      ? "vencida"
                      : usadas >= a.lavagens
                        ? "esgotada"
                        : "ativa";
                return (
                  <TableRow key={a.id}>
                    <TableCell>{a.lr_planos?.nome ?? "—"}</TableCell>
                    <TableCell>{nomeVeic(a.veiculo_id)}</TableCell>
                    <TableCell>{dateBR(a.comprado_em)}</TableCell>
                    <TableCell>{dateBR(a.vence_em)}</TableCell>
                    <TableCell>
                      {usadas} de {a.lavagens}
                    </TableCell>
                    <TableCell>{brl(a.valor)}</TableCell>
                    <TableCell>
                      <Badge variant={sit === "ativa" ? "default" : "secondary"}>{sit}</Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>

      <div className="panel p-4">
        <h2 className="mb-3 font-semibold">Histórico de lavagens e compras</h2>
        {ordens.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma lavagem registrada.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Data</TableHead>
                <TableHead>Veículo</TableHead>
                <TableHead>Serviços</TableHead>
                <TableHead>Valor</TableHead>
                <TableHead>Situação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ordens.map((o) => {
                const itens = o.lr_ordem_itens ?? [];
                const total = itens.reduce((s, i) => s + Number(i.preco_aplicado ?? 0), 0);
                return (
                  <TableRow key={o.id}>
                    <TableCell>{dateBR(o.entregue_em ?? o.entrada_em)}</TableCell>
                    <TableCell>{nomeVeic(o.veiculo_id)}</TableCell>
                    <TableCell>
                      {itens.map((i, k) => (
                        <span key={k} className="mr-2">
                          {i.lr_servicos?.nome}
                          {i.cobertura === "fidelidade" && (
                            <Badge variant="outline" className="ml-1">
                              brinde
                            </Badge>
                          )}
                          {i.cobertura === "plano" && (
                            <Badge variant="outline" className="ml-1">
                              plano
                            </Badge>
                          )}
                        </span>
                      ))}
                    </TableCell>
                    <TableCell>{brl(total)}</TableCell>
                    <TableCell>{o.situacao}</TableCell>
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

function Indicador({
  rotulo,
  valor,
  destaque,
}: {
  rotulo: string;
  valor: string | number;
  destaque?: boolean;
}) {
  return (
    <div className={`rounded border p-3 ${destaque ? "border-primary bg-primary/5" : ""}`}>
      <div className="text-xs text-muted-foreground">{rotulo}</div>
      <div className="text-2xl font-bold">{valor}</div>
    </div>
  );
}
