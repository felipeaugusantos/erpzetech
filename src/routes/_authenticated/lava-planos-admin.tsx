import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";

import { ModuloBloqueado } from "@/components/app/ModuloCnae";
import { EmptyState, PageHeader } from "@/components/app/PageHeader";
import { Fidelidade, PlanoDialog } from "@/components/app/PlanosLava";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useSessionData } from "@/hooks/useSessionData";
import { supabase } from "@/integrations/supabase/client";
import { useModulosCnae } from "@/lib/cnae";
import { brl } from "@/lib/format";
import { isoBrasilia } from "@/lib/fuso";
import {
  dadosDoPlano,
  formDoPlano,
  planoVazio,
  type FormPlano,
  type PlanoLava,
} from "@/lib/lava-planos-form";
import { rotuloTipo, situacaoDaAssinatura } from "@/lib/lava-rapido";

export const Route = createFileRoute("/_authenticated/lava-planos-admin")({
  head: () => ({
    meta: [
      { title: "Administração de planos e brindes do lava rápido — EZRA ERP" },
      {
        name: "description",
        content:
          "Crie e edite os planos mensais e o brinde do programa de fidelidade do lava rápido, sem depender de cliente ou veículo.",
      },
    ],
  }),
  component: AdminModulo,
});

function AdminModulo() {
  const modulos = useModulosCnae();
  if (modulos.carregando) return <div className="panel h-40 animate-pulse" />;
  if (!modulos.lavarapido) return <ModuloBloqueado modulo="lavarapido" />;
  return <Admin />;
}

type Filtro = "todos" | "venda" | "inativos";

function Admin() {
  const qc = useQueryClient();
  const { data: session } = useSessionData();
  const podeEditar = (session?.roles ?? []).some((r) => ["administrador", "gestor"].includes(r));
  const [aberto, setAberto] = useState(false);
  const [form, setForm] = useState<FormPlano>(planoVazio);
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todos");

  const { data, isLoading, error } = useQuery({
    queryKey: ["lava-planos-admin"],
    queryFn: async () => {
      const [planos, servicos, ativas, usos, fid] = await Promise.all([
        supabase.from("lr_planos").select("*").order("nome"),
        supabase.from("lr_servicos").select("id, nome, ativo").order("nome"),
        supabase
          .from("lr_assinaturas")
          .select("id, plano_id, situacao, vence_em, lavagens")
          .eq("situacao", "ativa"),
        supabase.from("lr_assinatura_usos").select("assinatura_id").eq("desfeito", false),
        supabase.from("lr_fidelidade_config").select("*").maybeSingle(),
      ]);
      for (const r of [planos, servicos, ativas, usos, fid]) if (r.error) throw r.error;
      // vale só a assinatura que ainda está dentro da validade e com lavagens (a situação gravada só muda no cancelamento)
      const usadas = new Map<string, number>();
      for (const u of usos.data ?? [])
        usadas.set(u.assinatura_id, (usadas.get(u.assinatura_id) ?? 0) + 1);
      const hoje = isoBrasilia();
      const contagem = new Map<string, number>();
      for (const a of ativas.data ?? []) {
        if (
          situacaoDaAssinatura({
            situacao: a.situacao,
            vence_em: a.vence_em,
            lavagens: a.lavagens,
            usadas: usadas.get(a.id) ?? 0,
            hoje,
          }) === "ativa"
        )
          contagem.set(a.plano_id, (contagem.get(a.plano_id) ?? 0) + 1);
      }
      return {
        planos: (planos.data ?? []) as unknown as PlanoLava[],
        servicos: servicos.data ?? [],
        contagem,
        fidelidade: fid.data,
      };
    },
  });
  const planos = useMemo(() => data?.planos ?? [], [data]);
  const servicos = data?.servicos ?? [];
  const nomeServico = (id: string) => servicos.find((s) => s.id === id)?.nome ?? "—";

  const atualizar = () => void qc.invalidateQueries({ queryKey: ["lava-planos-admin"] });

  // liga ou desliga a venda do plano sem abrir o formulário
  const aVenda = useMutation({
    mutationFn: async (p: { plano: PlanoLava; ativo: boolean }) => {
      const { error } = await supabase.rpc("lr_plano_salvar", {
        p_dados: dadosDoPlano({ ...formDoPlano(p.plano), ativo: p.ativo }),
      });
      if (error) throw error;
    },
    onSuccess: (_r, v) => {
      toast.success(v.ativo ? "Plano à venda." : "Plano tirado de venda.");
      atualizar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const filtrados = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return planos.filter(
      (p) =>
        (filtro === "todos" || (filtro === "venda" ? p.ativo : !p.ativo)) &&
        (!t || p.nome.toLowerCase().includes(t)),
    );
  }, [planos, busca, filtro]);

  return (
    <div className="space-y-10">
      <section>
        <PageHeader
          title="Planos e brindes"
          description="Administração dos planos mensais e do brinde da fidelidade. Aqui você só cria e edita as regras: a venda do plano e a lista de assinaturas ficam em Planos e fidelidade, e o saldo de cada cliente em Clientes e fidelidade."
          actions={
            podeEditar && (
              <Button
                onClick={() => {
                  setForm(planoVazio);
                  setAberto(true);
                }}
              >
                <Plus className="size-4" /> Novo plano
              </Button>
            )
          }
        />

        <div className="mb-4 flex flex-wrap items-end gap-3">
          <div className="w-64">
            <Input
              placeholder="Buscar plano"
              aria-label="Buscar plano"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
          </div>
          <div className="w-44">
            <Select value={filtro} onValueChange={(v) => setFiltro(v as Filtro)}>
              <SelectTrigger aria-label="Filtrar planos">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos os planos</SelectItem>
                <SelectItem value="venda">À venda</SelectItem>
                <SelectItem value="inativos">Fora de venda</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {error ? (
          <p className="text-sm text-destructive">{(error as Error).message}</p>
        ) : isLoading ? (
          <div className="panel h-40 animate-pulse" />
        ) : filtrados.length === 0 ? (
          <EmptyState
            title={planos.length === 0 ? "Nenhum plano cadastrado" : "Nenhum plano encontrado"}
            description="Ex.: Mensal, 4 lavagens completas de carro por R$ 120."
          />
        ) : (
          <div className="panel overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Plano</TableHead>
                  <TableHead>Serviço</TableHead>
                  <TableHead className="text-right">Lavagens</TableHead>
                  <TableHead className="text-right">Validade</TableHead>
                  <TableHead>Vale para</TableHead>
                  <TableHead className="text-right">Preço</TableHead>
                  <TableHead className="text-right">Assinaturas ativas</TableHead>
                  <TableHead>À venda</TableHead>
                  <TableHead className="text-right">Ação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtrados.map((p) => (
                  <TableRow key={p.id} className={p.ativo ? "" : "opacity-60"}>
                    <TableCell className="font-medium">{p.nome}</TableCell>
                    <TableCell>{nomeServico(p.servico_id)}</TableCell>
                    <TableCell className="text-right">{p.lavagens}</TableCell>
                    <TableCell className="text-right">{p.validade_dias} dias</TableCell>
                    <TableCell>{p.tipo ? rotuloTipo(p.tipo) : "Qualquer veículo"}</TableCell>
                    <TableCell className="text-right">{brl(Number(p.preco))}</TableCell>
                    <TableCell className="text-right">{data?.contagem.get(p.id) ?? 0}</TableCell>
                    <TableCell>
                      <Switch
                        checked={p.ativo}
                        disabled={!podeEditar || aVenda.isPending}
                        aria-label={`${p.nome} à venda`}
                        onCheckedChange={(v) => aVenda.mutate({ plano: p, ativo: v })}
                      />
                      {!p.ativo && (
                        <Badge variant="outline" className="ml-2">
                          Fora de venda
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="space-x-1 text-right">
                      {podeEditar && (
                        <>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Duplicar ${p.nome}`}
                            onClick={() => {
                              const { id: _id, ...resto } = formDoPlano(p);
                              void _id;
                              setForm({ ...resto, nome: `${p.nome} (cópia)`, ativo: false });
                              setAberto(true);
                            }}
                          >
                            <Copy className="size-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Editar ${p.nome}`}
                            onClick={() => {
                              setForm(formDoPlano(p));
                              setAberto(true);
                            }}
                          >
                            <Pencil className="size-4" />
                          </Button>
                        </>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          Tirar um plano de venda não afeta as assinaturas já vendidas: elas seguem valendo até o
          fim.
        </p>
      </section>

      {!isLoading && !error && (
        <Fidelidade
          podeEditar={podeEditar}
          config={data?.fidelidade ?? null}
          servicos={servicos.filter((s) => s.ativo)}
          onSalvo={atualizar}
        />
      )}

      <PlanoDialog
        aberto={aberto}
        form={form}
        setForm={setForm}
        servicos={servicos}
        onFechar={() => setAberto(false)}
        onSalvo={() => {
          setAberto(false);
          setForm(planoVazio);
          atualizar();
        }}
      />
    </div>
  );
}
