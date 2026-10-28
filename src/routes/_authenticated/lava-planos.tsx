import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, ShoppingCart } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { useSessionData } from "@/hooks/useSessionData";
import { supabase } from "@/integrations/supabase/client";
import { useModulosCnae } from "@/lib/cnae";
import { brl, dateBR } from "@/lib/format";
import {
  TIPOS_VEICULO,
  diasParaVencer,
  formatarIdentificacao,
  lavagensRestantes,
  rotuloAssinatura,
  rotuloTipo,
  situacaoDaAssinatura,
} from "@/lib/lava-rapido";

export const Route = createFileRoute("/_authenticated/lava-planos")({
  head: () => ({
    meta: [
      { title: "Planos e fidelidade do lava rápido — ERP Ze Tech" },
      {
        name: "description",
        content: "Planos mensais de lavagem por veículo e programa de fidelidade com brinde.",
      },
    ],
  }),
  component: PlanosModulo,
});

const QUALQUER = "__qualquer";

function hojeISO() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

type FormPlano = {
  id?: string;
  nome: string;
  servico_id: string;
  lavagens: string;
  validade_dias: string;
  tipo: string;
  preco: string;
  ativo: boolean;
};

const vazio: FormPlano = {
  nome: "",
  servico_id: "",
  lavagens: "4",
  validade_dias: "30",
  tipo: "",
  preco: "",
  ativo: true,
};

function PlanosModulo() {
  const modulos = useModulosCnae();
  if (modulos.carregando) return <div className="panel h-40 animate-pulse" />;
  if (!modulos.lavarapido) return <ModuloBloqueado modulo="lavarapido" />;
  return <Planos />;
}

function Planos() {
  const qc = useQueryClient();
  const navegar = useNavigate();
  const { data: session } = useSessionData();
  const podeEditar = (session?.roles ?? []).some((r) => ["administrador", "gestor"].includes(r));
  const [aberto, setAberto] = useState(false);
  const [form, setForm] = useState<FormPlano>(vazio);
  const [vendendo, setVendendo] = useState(false);
  const [cancelando, setCancelando] = useState<string | null>(null);
  const [motivo, setMotivo] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["lava-planos"],
    queryFn: async () => {
      const [planos, servicos, assinaturas, usos, veiculos, clientes, fid] = await Promise.all([
        supabase.from("lr_planos").select("*").order("nome"),
        supabase.from("lr_servicos").select("id, nome, ativo").order("nome"),
        supabase
          .from("lr_assinaturas")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(300),
        supabase.from("lr_assinatura_usos").select("assinatura_id").eq("desfeito", false),
        supabase
          .from("lr_veiculos")
          .select("id, tipo, identificacao, ativo")
          .order("identificacao"),
        supabase.from("clientes").select("id, nome").order("nome").limit(2000),
        supabase.from("lr_fidelidade_config").select("*").maybeSingle(),
      ]);
      for (const r of [planos, servicos, assinaturas, usos, veiculos, clientes, fid])
        if (r.error) throw r.error;
      return {
        planos: planos.data ?? [],
        servicos: servicos.data ?? [],
        assinaturas: assinaturas.data ?? [],
        usos: usos.data ?? [],
        veiculos: veiculos.data ?? [],
        clientes: clientes.data ?? [],
        fidelidade: fid.data,
      };
    },
  });
  const planos = data?.planos ?? [];
  const servicos = data?.servicos ?? [];
  const nomeServico = (id: string) => servicos.find((s) => s.id === id)?.nome ?? "—";
  const veiculo = (id: string) => data?.veiculos.find((v) => v.id === id);
  const nomeCliente = (id: string) => data?.clientes.find((c) => c.id === id)?.nome ?? "—";
  const usadas = (id: string) => (data?.usos ?? []).filter((u) => u.assinatura_id === id).length;
  const hoje = hojeISO();

  const atualizar = () => void qc.invalidateQueries({ queryKey: ["lava-planos"] });

  const salvar = useMutation({
    mutationFn: async () => {
      if (!form.nome.trim()) throw new Error("Informe o nome do plano.");
      if (!form.servico_id) throw new Error("Escolha o serviço do plano.");
      const lav = Number(form.lavagens);
      if (!Number.isInteger(lav) || lav < 2 || lav > 60)
        throw new Error("O plano precisa ter de 2 a 60 lavagens.");
      const val = Number(form.validade_dias);
      if (!Number.isInteger(val) || val < 7 || val > 366)
        throw new Error("A validade precisa ficar entre 7 e 366 dias.");
      const preco = Number(form.preco.replace(",", "."));
      if (!Number.isFinite(preco) || preco <= 0) throw new Error("Informe o preço do plano.");
      const { error } = await supabase.rpc("lr_plano_salvar", {
        p_dados: {
          ...(form.id ? { id: form.id } : {}),
          nome: form.nome.trim(),
          servico_id: form.servico_id,
          lavagens: lav,
          validade_dias: val,
          tipo: form.tipo,
          preco,
          ativo: form.ativo,
        },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(form.id ? "Plano atualizado." : "Plano cadastrado.");
      setAberto(false);
      setForm(vazio);
      atualizar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cancelar = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("lr_assinatura_cancelar", {
        p_id: cancelando as string,
        p_motivo: motivo,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Assinatura cancelada.");
      setCancelando(null);
      setMotivo("");
      atualizar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-10">
      <section>
        <PageHeader
          title="Planos e fidelidade"
          description="O plano dá um número de lavagens de um serviço, por um período, para um veículo. É vendido no caixa; para renovar, venda de novo."
          actions={
            <>
              <Button variant="outline" onClick={() => setVendendo(true)}>
                <ShoppingCart className="size-4" /> Vender plano
              </Button>
              {podeEditar && (
                <Button
                  onClick={() => {
                    setForm(vazio);
                    setAberto(true);
                  }}
                >
                  <Plus className="size-4" /> Novo plano
                </Button>
              )}
            </>
          }
        />

        {isLoading ? (
          <div className="panel h-40 animate-pulse" />
        ) : planos.length === 0 ? (
          <EmptyState
            title="Nenhum plano cadastrado"
            description="Ex.: Mensal 4 lavagens completas de carro por R$ 120."
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
                  <TableHead>Veículo</TableHead>
                  <TableHead className="text-right">Preço</TableHead>
                  <TableHead className="text-right">Ação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {planos.map((p) => (
                  <TableRow key={p.id} className={p.ativo ? "" : "opacity-60"}>
                    <TableCell className="font-medium">
                      {p.nome}
                      {!p.ativo && (
                        <Badge variant="outline" className="ml-2">
                          Inativo
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>{nomeServico(p.servico_id)}</TableCell>
                    <TableCell className="text-right">{p.lavagens}</TableCell>
                    <TableCell className="text-right">{p.validade_dias} dias</TableCell>
                    <TableCell>{p.tipo ? rotuloTipo(p.tipo) : "Qualquer"}</TableCell>
                    <TableCell className="text-right">{brl(Number(p.preco))}</TableCell>
                    <TableCell className="text-right">
                      {podeEditar && (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Editar ${p.nome}`}
                          onClick={() => {
                            setForm({
                              id: p.id,
                              nome: p.nome,
                              servico_id: p.servico_id,
                              lavagens: String(p.lavagens),
                              validade_dias: String(p.validade_dias),
                              tipo: p.tipo ?? "",
                              preco: String(p.preco),
                              ativo: p.ativo,
                            });
                            setAberto(true);
                          }}
                        >
                          <Pencil className="size-4" />
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

      <section>
        <h2 className="mb-3 font-display text-lg font-semibold">Assinaturas</h2>
        {(data?.assinaturas.length ?? 0) === 0 ? (
          <EmptyState
            title="Nenhuma assinatura vendida"
            description="Elas aparecem quando um plano é vendido no caixa."
          />
        ) : (
          <div className="panel overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Veículo</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Plano</TableHead>
                  <TableHead className="text-right">Restam</TableHead>
                  <TableHead>Vence em</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead className="text-right">Ação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data?.assinaturas ?? []).map((a) => {
                  const v = veiculo(a.veiculo_id);
                  const sit = situacaoDaAssinatura({
                    situacao: a.situacao,
                    vence_em: a.vence_em,
                    lavagens: a.lavagens,
                    usadas: usadas(a.id),
                    hoje,
                  });
                  const dias = diasParaVencer(a.vence_em, hoje);
                  return (
                    <TableRow key={a.id} className={sit === "ativa" ? "" : "opacity-60"}>
                      <TableCell className="font-medium">
                        {v ? formatarIdentificacao(v.tipo, v.identificacao) : "—"}
                      </TableCell>
                      <TableCell>{nomeCliente(a.cliente_id)}</TableCell>
                      <TableCell>{planos.find((p) => p.id === a.plano_id)?.nome ?? "—"}</TableCell>
                      <TableCell className="text-right">
                        {lavagensRestantes(a.lavagens, usadas(a.id))} de {a.lavagens}
                      </TableCell>
                      <TableCell>
                        {dateBR(a.vence_em)}
                        {sit === "ativa" && dias <= 7 && (
                          <span className="ml-2 text-xs text-muted-foreground">
                            {dias === 0 ? "vence hoje" : `em ${dias} d`}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={sit === "ativa" ? "secondary" : "outline"}>
                          {rotuloAssinatura[sit]}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {podeEditar && a.situacao === "ativa" && (
                          <Button size="sm" variant="outline" onClick={() => setCancelando(a.id)}>
                            Cancelar
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      {!isLoading && (
        <Fidelidade
          podeEditar={podeEditar}
          config={data?.fidelidade ?? null}
          servicos={servicos.filter((s) => s.ativo)}
          onSalvo={atualizar}
        />
      )}

      <Dialog open={aberto} onOpenChange={(o) => !o && setAberto(false)}>
        <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{form.id ? "Editar plano" : "Novo plano"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div>
              <Label htmlFor="pl-nome">Nome</Label>
              <Input
                id="pl-nome"
                value={form.nome}
                placeholder="Ex.: Mensal 4 lavagens"
                onChange={(e) => setForm({ ...form, nome: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="pl-serv">Serviço incluído</Label>
              <Select
                value={form.servico_id}
                onValueChange={(v) => setForm({ ...form, servico_id: v })}
              >
                <SelectTrigger id="pl-serv">
                  <SelectValue placeholder="Escolha o serviço" />
                </SelectTrigger>
                <SelectContent>
                  {servicos
                    .filter((s) => s.ativo || s.id === form.servico_id)
                    .map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.nome}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="pl-lav">Lavagens</Label>
                <Input
                  id="pl-lav"
                  inputMode="numeric"
                  value={form.lavagens}
                  onChange={(e) => setForm({ ...form, lavagens: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="pl-val">Validade (dias)</Label>
                <Input
                  id="pl-val"
                  inputMode="numeric"
                  value={form.validade_dias}
                  onChange={(e) => setForm({ ...form, validade_dias: e.target.value })}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="pl-tipo">Vale para</Label>
                <Select
                  value={form.tipo || QUALQUER}
                  onValueChange={(v) => setForm({ ...form, tipo: v === QUALQUER ? "" : v })}
                >
                  <SelectTrigger id="pl-tipo">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={QUALQUER}>Qualquer veículo</SelectItem>
                    {TIPOS_VEICULO.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="pl-preco">Preço (R$)</Label>
                <Input
                  id="pl-preco"
                  inputMode="decimal"
                  value={form.preco}
                  onChange={(e) => setForm({ ...form, preco: e.target.value })}
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="pl-ativo"
                checked={form.ativo}
                onCheckedChange={(v) => setForm({ ...form, ativo: v })}
              />
              <Label htmlFor="pl-ativo">À venda</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAberto(false)}>
              Cancelar
            </Button>
            <Button onClick={() => salvar.mutate()} disabled={salvar.isPending}>
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {vendendo && (
        <VenderPlano
          planos={planos.filter((p) => p.ativo)}
          veiculos={(data?.veiculos ?? []).filter((v) => v.ativo)}
          onFechar={() => setVendendo(false)}
          onEscolher={(plano, veic) =>
            void navegar({ to: "/frente-caixa", search: { plano, veiculo: veic } })
          }
        />
      )}

      <Dialog open={!!cancelando} onOpenChange={(o) => !o && setCancelando(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Cancelar assinatura</DialogTitle>
          </DialogHeader>
          <Label htmlFor="as-motivo">Motivo</Label>
          <Textarea
            id="as-motivo"
            rows={2}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelando(null)}>
              Voltar
            </Button>
            <Button
              variant="destructive"
              disabled={cancelar.isPending}
              onClick={() => cancelar.mutate()}
            >
              Cancelar assinatura
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function VenderPlano({
  planos,
  veiculos,
  onFechar,
  onEscolher,
}: {
  planos: { id: string; nome: string; preco: number; tipo: string | null }[];
  veiculos: { id: string; tipo: string; identificacao: string }[];
  onFechar: () => void;
  onEscolher: (plano: string, veiculo: string) => void;
}) {
  const [planoId, setPlanoId] = useState("");
  const [veiculoId, setVeiculoId] = useState("");
  const plano = planos.find((p) => p.id === planoId);
  const compativeis = useMemo(
    () => veiculos.filter((v) => !plano?.tipo || plano.tipo === v.tipo),
    [veiculos, plano],
  );
  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Vender plano</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div>
            <Label htmlFor="vp-plano">Plano</Label>
            <Select
              value={planoId}
              onValueChange={(v) => {
                setPlanoId(v);
                setVeiculoId("");
              }}
            >
              <SelectTrigger id="vp-plano">
                <SelectValue placeholder="Escolha o plano" />
              </SelectTrigger>
              <SelectContent>
                {planos.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.nome} · {brl(Number(p.preco))}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="vp-veiculo">Veículo</Label>
            <Select value={veiculoId} onValueChange={setVeiculoId} disabled={!planoId}>
              <SelectTrigger id="vp-veiculo">
                <SelectValue placeholder="Escolha o veículo" />
              </SelectTrigger>
              <SelectContent>
                {compativeis.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {formatarIdentificacao(v.tipo, v.identificacao)} · {rotuloTipo(v.tipo)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className="text-xs text-muted-foreground">
            O pagamento é feito na frente de caixa, com a forma de pagamento que o cliente escolher.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>
            Cancelar
          </Button>
          <Button disabled={!planoId || !veiculoId} onClick={() => onEscolher(planoId, veiculoId)}>
            Ir para o caixa
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Fidelidade({
  podeEditar,
  config,
  servicos,
  onSalvo,
}: {
  podeEditar: boolean;
  config: { ativo: boolean; lavagens_para_brinde: number; servico_id: string | null } | null;
  servicos: { id: string; nome: string }[];
  onSalvo: () => void;
}) {
  const [ativo, setAtivo] = useState(config?.ativo ?? false);
  const [lavagens, setLavagens] = useState(String(config?.lavagens_para_brinde ?? 10));
  const [servicoId, setServicoId] = useState(config?.servico_id ?? "");

  const salvar = useMutation({
    mutationFn: async () => {
      const n = Number(lavagens);
      if (!Number.isInteger(n) || n < 2 || n > 50)
        throw new Error("O brinde sai entre a 2ª e a 50ª lavagem.");
      if (ativo && !servicoId) throw new Error("Escolha o serviço que será o brinde.");
      const { error } = await supabase.rpc("lr_fidelidade_salvar", {
        p_ativo: ativo,
        p_lavagens: n,
        p_servico_id: servicoId || (null as unknown as string),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Fidelidade salva.");
      onSalvo();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <section>
      <h2 className="mb-1 font-display text-lg font-semibold">Fidelidade</h2>
      <p className="mb-3 text-sm text-muted-foreground">
        Cada lavagem entregue vale um selo. Ao juntar o número escolhido, a próxima lavagem do
        serviço-brinde sai sem cobrança. Os selos contam a partir do momento em que o programa é
        ligado.
      </p>
      <div className="panel grid max-w-xl gap-3 p-4">
        <div className="flex items-center gap-2">
          <Switch id="fd-ativo" checked={ativo} disabled={!podeEditar} onCheckedChange={setAtivo} />
          <Label htmlFor="fd-ativo">Programa ligado</Label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="fd-lav">Lavagens para ganhar o brinde</Label>
            <Input
              id="fd-lav"
              inputMode="numeric"
              value={lavagens}
              disabled={!podeEditar}
              onChange={(e) => setLavagens(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="fd-serv">Serviço-brinde</Label>
            <Select value={servicoId} disabled={!podeEditar} onValueChange={setServicoId}>
              <SelectTrigger id="fd-serv">
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
        </div>
        {podeEditar && (
          <div>
            <Button onClick={() => salvar.mutate()} disabled={salvar.isPending}>
              Salvar fidelidade
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
