import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, RotateCw, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { ModuloBloqueado } from "@/components/app/ModuloCnae";
import { EmptyState, PageHeader } from "@/components/app/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { dateTimeBR } from "@/lib/format";
import { formatarQuantidade } from "@/lib/lava-rapido";

export const Route = createFileRoute("/_authenticated/lava-insumos")({
  head: () => ({
    meta: [
      { title: "Insumos do lava rápido — ERP Ze Tech" },
      {
        name: "description",
        content: "Insumos gastos em cada serviço, com baixa automática no estoque na entrega.",
      },
    ],
  }),
  component: InsumosModulo,
});

function InsumosModulo() {
  const modulos = useModulosCnae();
  if (modulos.carregando) return <div className="panel h-40 animate-pulse" />;
  if (!modulos.lavarapido) return <ModuloBloqueado modulo="lavarapido" />;
  return <Insumos />;
}

function Insumos() {
  const qc = useQueryClient();
  const { data: session } = useSessionData();
  const roles = session?.roles ?? [];
  const podeEditar = roles.some((r) => ["administrador", "gestor"].includes(r));
  const podeRefazer = roles.some((r) => ["administrador", "gestor", "estoquista"].includes(r));
  const [novo, setNovo] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["lava-insumos"],
    queryFn: async () => {
      const [config, depositos, servicos, receita, produtos, baixas] = await Promise.all([
        supabase.from("lr_insumo_config").select("*").maybeSingle(),
        supabase.from("depositos").select("id, nome").order("nome"),
        supabase.from("lr_servicos").select("id, nome, ativo").order("nome"),
        supabase.from("lr_servico_insumos").select("*"),
        supabase
          .from("produtos")
          .select("id, descricao, unidade")
          .eq("controla_estoque", true)
          .eq("ativo", true)
          .order("descricao")
          .limit(2000),
        supabase
          .from("lr_insumo_baixas")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(100),
      ]);
      for (const r of [config, depositos, servicos, receita, produtos, baixas])
        if (r.error) throw r.error;
      return {
        config: config.data,
        depositos: depositos.data ?? [],
        servicos: servicos.data ?? [],
        receita: receita.data ?? [],
        produtos: produtos.data ?? [],
        baixas: baixas.data ?? [],
      };
    },
  });
  const produto = (id: string) => data?.produtos.find((p) => p.id === id);
  const nomeProduto = (id: string) => produto(id)?.descricao ?? "Produto";
  const atualizar = () => void qc.invalidateQueries({ queryKey: ["lava-insumos"] });

  const remover = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("lr_servico_insumo_remover", { p_id: id });
      if (error) throw error;
    },
    onSuccess: atualizar,
    onError: (e: Error) => toast.error(e.message),
  });

  const refazer = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("lr_insumo_baixa_refazer", { p_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Baixa feita.");
      atualizar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const falhas = (data?.baixas ?? []).filter((b) => b.situacao === "falhou");

  return (
    <div className="space-y-10">
      <section>
        <PageHeader
          title="Insumos"
          description="Cada serviço pode ter uma receita de insumos. Ao entregar a ordem, o sistema dá baixa no estoque. Se faltar saldo, a entrega e a cobrança seguem normais e a baixa fica aqui para refazer."
          actions={
            podeEditar ? (
              <Button onClick={() => setNovo(true)}>
                <Plus className="size-4" /> Insumo em um serviço
              </Button>
            ) : undefined
          }
        />

        {!isLoading && (
          <Deposito
            key={data?.config?.deposito_id ?? "sem"}
            podeEditar={podeEditar}
            config={data?.config ?? null}
            depositos={data?.depositos ?? []}
            onSalvo={atualizar}
          />
        )}
      </section>

      <section>
        <h2 className="mb-3 font-display text-lg font-semibold">Receita por serviço</h2>
        {isLoading ? (
          <div className="panel h-32 animate-pulse" />
        ) : (data?.receita.length ?? 0) === 0 ? (
          <EmptyState
            title="Nenhum insumo cadastrado"
            description="Ex.: Lavagem completa gasta 0,05 L de shampoo e 1 pano."
          />
        ) : (
          <div className="panel overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Serviço</TableHead>
                  <TableHead>Insumo</TableHead>
                  <TableHead className="text-right">Por lavagem</TableHead>
                  <TableHead className="text-right">Ação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data?.servicos ?? []).flatMap((s) =>
                  (data?.receita ?? [])
                    .filter((r) => r.servico_id === s.id)
                    .map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium">{s.nome}</TableCell>
                        <TableCell>{nomeProduto(r.produto_id)}</TableCell>
                        <TableCell className="text-right">
                          {formatarQuantidade(Number(r.quantidade))}{" "}
                          {produto(r.produto_id)?.unidade}
                        </TableCell>
                        <TableCell className="text-right">
                          {podeEditar && (
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`Remover ${nomeProduto(r.produto_id)} de ${s.nome}`}
                              onClick={() => remover.mutate(r.id)}
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    )),
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 font-display text-lg font-semibold">
          Baixas que falharam{" "}
          {falhas.length > 0 && <Badge variant="destructive">{falhas.length}</Badge>}
        </h2>
        {falhas.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma baixa pendente.</p>
        ) : (
          <div className="panel overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Insumo</TableHead>
                  <TableHead className="text-right">Quantidade</TableHead>
                  <TableHead>Motivo</TableHead>
                  <TableHead>Quando</TableHead>
                  <TableHead className="text-right">Ação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {falhas.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell className="font-medium">{nomeProduto(b.produto_id)}</TableCell>
                    <TableCell className="text-right">
                      {formatarQuantidade(Number(b.quantidade))}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{b.erro}</TableCell>
                    <TableCell>{dateTimeBR(b.created_at)}</TableCell>
                    <TableCell className="text-right">
                      {podeRefazer && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={refazer.isPending}
                          onClick={() => refazer.mutate(b.id)}
                        >
                          <RotateCw className="size-4" /> Tentar de novo
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      {novo && data && (
        <NovoInsumo
          servicos={data.servicos.filter((s) => s.ativo)}
          produtos={data.produtos}
          onFechar={() => setNovo(false)}
          onSalvo={() => {
            setNovo(false);
            atualizar();
          }}
        />
      )}
    </div>
  );
}

function Deposito({
  podeEditar,
  config,
  depositos,
  onSalvo,
}: {
  podeEditar: boolean;
  config: { deposito_id: string; ativo: boolean } | null;
  depositos: { id: string; nome: string }[];
  onSalvo: () => void;
}) {
  const [depositoId, setDepositoId] = useState(config?.deposito_id ?? "");
  const [ativo, setAtivo] = useState(config?.ativo ?? true);
  const salvar = useMutation({
    mutationFn: async () => {
      if (!depositoId) throw new Error("Escolha o depósito dos insumos.");
      const { error } = await supabase.rpc("lr_insumo_config_salvar", {
        p_deposito_id: depositoId,
        p_ativo: ativo,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Depósito dos insumos salvo.");
      onSalvo();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <div className="panel grid max-w-xl gap-3 p-4">
      <div>
        <Label htmlFor="in-dep">Depósito dos insumos</Label>
        <Select value={depositoId} disabled={!podeEditar} onValueChange={setDepositoId}>
          <SelectTrigger id="in-dep">
            <SelectValue placeholder="Escolha o depósito" />
          </SelectTrigger>
          <SelectContent>
            {depositos.map((d) => (
              <SelectItem key={d.id} value={d.id}>
                {d.nome}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center gap-2">
        <Switch id="in-ativo" checked={ativo} disabled={!podeEditar} onCheckedChange={setAtivo} />
        <Label htmlFor="in-ativo">Dar baixa nos insumos ao entregar</Label>
      </div>
      {podeEditar && (
        <div>
          <Button onClick={() => salvar.mutate()} disabled={salvar.isPending}>
            Salvar
          </Button>
        </div>
      )}
    </div>
  );
}

function NovoInsumo({
  servicos,
  produtos,
  onFechar,
  onSalvo,
}: {
  servicos: { id: string; nome: string }[];
  produtos: { id: string; descricao: string; unidade: string }[];
  onFechar: () => void;
  onSalvo: () => void;
}) {
  const [servicoId, setServicoId] = useState("");
  const [produtoId, setProdutoId] = useState("");
  const [quantidade, setQuantidade] = useState("");
  const salvar = useMutation({
    mutationFn: async () => {
      if (!servicoId) throw new Error("Escolha o serviço.");
      if (!produtoId) throw new Error("Escolha o insumo.");
      const q = Number(quantidade.replace(",", "."));
      if (!Number.isFinite(q) || q <= 0) throw new Error("Informe uma quantidade maior que zero.");
      const { error } = await supabase.rpc("lr_servico_insumo_salvar", {
        p_servico_id: servicoId,
        p_produto_id: produtoId,
        p_quantidade: q,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Insumo salvo.");
      onSalvo();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const un = produtos.find((p) => p.id === produtoId)?.unidade;
  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Insumo em um serviço</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div>
            <Label htmlFor="ni-serv">Serviço</Label>
            <Select value={servicoId} onValueChange={setServicoId}>
              <SelectTrigger id="ni-serv">
                <SelectValue placeholder="Escolha o serviço" />
              </SelectTrigger>
              <SelectContent>
                {servicos.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="ni-prod">Insumo</Label>
            <Select value={produtoId} onValueChange={setProdutoId}>
              <SelectTrigger id="ni-prod">
                <SelectValue placeholder="Escolha o produto do estoque" />
              </SelectTrigger>
              <SelectContent>
                {produtos.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.descricao}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="ni-qtd">Quantidade por lavagem{un ? ` (${un})` : ""}</Label>
            <Input
              id="ni-qtd"
              inputMode="decimal"
              value={quantidade}
              placeholder="Ex.: 0,05"
              onChange={(e) => setQuantidade(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>
            Cancelar
          </Button>
          <Button onClick={() => salvar.mutate()} disabled={salvar.isPending}>
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
