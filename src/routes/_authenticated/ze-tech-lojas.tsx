import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { brl } from "@/lib/format";
import { SITUACAO_SAAS, useSaasDados, useSaasOperador, type LojaSaas } from "@/lib/saas";
import { EmptyState, PageHeader } from "@/components/app/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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

export const Route = createFileRoute("/_authenticated/ze-tech-lojas")({
  head: () => ({
    meta: [
      { title: "Lojas da rede — Painel Ze Tech" },
      {
        name: "description",
        content:
          "Cadastre cada loja da rede do cliente com endereço, contato e plano, e controle a implantação das filiais extras.",
      },
      { property: "og:title", content: "Lojas da rede — Painel Ze Tech" },
      {
        property: "og:description",
        content:
          "Matriz e filiais de cada cliente, com endereço, contato, plano e situação de implantação.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: LojasZeTech,
});

const SITUACAO_LOJA: Record<string, string> = {
  implantacao: "Em implantação",
  ativa: "Ativa",
  inativa: "Inativa",
};

type Form = {
  cliente_id: string;
  nome: string;
  apelido: string;
  tipo: string;
  documento: string;
  responsavel: string;
  telefone: string;
  whatsapp: string;
  email: string;
  cep: string;
  endereco: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  uf: string;
  situacao: string;
  implantacao_paga: boolean;
  abertura: string;
  observacoes: string;
};

const vazio: Form = {
  cliente_id: "",
  nome: "",
  apelido: "",
  tipo: "filial",
  documento: "",
  responsavel: "",
  telefone: "",
  whatsapp: "",
  email: "",
  cep: "",
  endereco: "",
  numero: "",
  complemento: "",
  bairro: "",
  cidade: "",
  uf: "",
  situacao: "implantacao",
  implantacao_paga: false,
  abertura: "",
  observacoes: "",
};

function LojasZeTech() {
  const qc = useQueryClient();
  const { data: operador, isLoading: carregandoAcesso } = useSaasOperador();
  const { data: saas } = useSaasDados(operador === true);
  const [form, setForm] = useState<Form>(vazio);
  const [editando, setEditando] = useState<LojaSaas | null>(null);
  const [aberto, setAberto] = useState(false);
  const [filtroCliente, setFiltroCliente] = useState("todos");

  const clientes = saas?.clientes ?? [];
  const planos = saas?.planos ?? [];

  const { data: lojas = [], isLoading } = useQuery({
    queryKey: ["saas-lojas"],
    enabled: operador === true,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("saas_lojas")
        .select("*")
        .order("cliente_id")
        .order("tipo")
        .order("nome");
      if (error) throw error;
      return (data ?? []) as LojaSaas[];
    },
  });

  const visiveis = useMemo(
    () => (filtroCliente === "todos" ? lojas : lojas.filter((l) => l.cliente_id === filtroCliente)),
    [lojas, filtroCliente],
  );

  const totais = useMemo(() => {
    const ativas = lojas.filter((l) => l.situacao === "ativa").length;
    const implantando = lojas.filter((l) => l.situacao === "implantacao").length;
    const extras = lojas.filter((l) => l.tipo === "filial" && l.situacao !== "inativa").length;
    const aPagar = lojas.filter((l) => l.tipo === "filial" && !l.implantacao_paga).length;
    return { ativas, implantando, extras, aPagar };
  }, [lojas]);

  function nomeCliente(id: string) {
    return clientes.find((c) => c.id === id)?.nome ?? "—";
  }

  function planoDoCliente(id: string) {
    const cliente = clientes.find((c) => c.id === id);
    return planos.find((p) => p.id === cliente?.plano_id) ?? null;
  }

  function abrirNova() {
    setEditando(null);
    setForm({
      ...vazio,
      cliente_id: filtroCliente !== "todos" ? filtroCliente : (clientes[0]?.id ?? ""),
    });
    setAberto(true);
  }

  function abrirEdicao(l: LojaSaas) {
    setEditando(l);
    setForm({
      cliente_id: l.cliente_id,
      nome: l.nome,
      apelido: l.apelido ?? "",
      tipo: l.tipo,
      documento: l.documento ?? "",
      responsavel: l.responsavel ?? "",
      telefone: l.telefone ?? "",
      whatsapp: l.whatsapp ?? "",
      email: l.email ?? "",
      cep: l.cep ?? "",
      endereco: l.endereco ?? "",
      numero: l.numero ?? "",
      complemento: l.complemento ?? "",
      bairro: l.bairro ?? "",
      cidade: l.cidade ?? "",
      uf: l.uf ?? "",
      situacao: l.situacao,
      implantacao_paga: l.implantacao_paga,
      abertura: l.abertura ?? "",
      observacoes: l.observacoes ?? "",
    });
    setAberto(true);
  }

  const salvar = useMutation({
    mutationFn: async () => {
      if (!form.cliente_id) throw new Error("Escolha o cliente dono da loja.");
      if (!form.nome.trim()) throw new Error("Informe o nome da loja.");
      const payload = {
        cliente_id: form.cliente_id,
        nome: form.nome.trim(),
        apelido: form.apelido.trim() || null,
        tipo: form.tipo,
        documento: form.documento.trim() || null,
        responsavel: form.responsavel.trim() || null,
        telefone: form.telefone.trim() || null,
        whatsapp: form.whatsapp.trim() || null,
        email: form.email.trim() || null,
        cep: form.cep.trim() || null,
        endereco: form.endereco.trim() || null,
        numero: form.numero.trim() || null,
        complemento: form.complemento.trim() || null,
        bairro: form.bairro.trim() || null,
        cidade: form.cidade.trim() || null,
        uf: form.uf.trim().toUpperCase() || null,
        situacao: form.situacao,
        implantacao_paga: form.implantacao_paga,
        abertura: form.abertura || null,
        observacoes: form.observacoes.trim() || null,
      };
      const res = editando
        ? await supabase.from("saas_lojas").update(payload).eq("id", editando.id)
        : await supabase.from("saas_lojas").insert(payload);
      if (res.error) throw res.error;
      // mantém a contagem de filiais extras da cobrança em dia
      const { error: sincErro } = await supabase.rpc("saas_sincronizar_filiais", {
        p_cliente_id: form.cliente_id,
      });
      if (sincErro) throw sincErro;
    },
    onSuccess: () => {
      toast.success(editando ? "Loja atualizada." : "Loja cadastrada.");
      setAberto(false);
      void qc.invalidateQueries({ queryKey: ["saas-lojas"] });
      void qc.invalidateQueries({ queryKey: ["saas-dados"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cobrarImplantacao = useMutation({
    mutationFn: async (loja: LojaSaas) => {
      const plano = planoDoCliente(loja.cliente_id);
      const valor = Number(plano?.valor_implantacao ?? 1500);
      const venc = new Date();
      venc.setDate(venc.getDate() + 5);
      const { error } = await supabase.rpc("saas_registrar_cobranca", {
        p_cliente_id: loja.cliente_id,
        p_descricao: `Implantação da loja ${loja.nome}`,
        p_valor: valor,
        p_vencimento: venc.toISOString().slice(0, 10),
        p_tipo: "implantacao",
        p_forma: "pix",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Implantação lançada na cobrança do cliente.");
      void qc.invalidateQueries({ queryKey: ["saas-dados"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const ativar = useMutation({
    mutationFn: async (loja: LojaSaas) => {
      const { error } = await supabase
        .from("saas_lojas")
        .update({ situacao: loja.situacao === "ativa" ? "inativa" : "ativa" })
        .eq("id", loja.id);
      if (error) throw error;
      const { error: sincErro } = await supabase.rpc("saas_sincronizar_filiais", {
        p_cliente_id: loja.cliente_id,
      });
      if (sincErro) throw sincErro;
    },
    onSuccess: () => {
      toast.success("Situação da loja atualizada.");
      void qc.invalidateQueries({ queryKey: ["saas-lojas"] });
      void qc.invalidateQueries({ queryKey: ["saas-dados"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (carregandoAcesso) return <p className="text-sm text-muted-foreground">Carregando…</p>;

  if (!operador)
    return (
      <EmptyState
        title="Área exclusiva da Ze Tech"
        description="Só a equipe Ze Tech cadastra as lojas da rede dos clientes."
      />
    );

  return (
    <>
      <PageHeader
        title="Lojas da rede"
        description="Cadastre matriz e filiais de cada cliente com endereço, contato e plano. A implantação da filial extra é lançada aqui."
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to="/ze-tech">Painel de clientes</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/ze-tech-cobranca">Cobrança</Link>
            </Button>
            <Button onClick={abrirNova} disabled={clientes.length === 0}>
              <Plus className="size-4" /> Nova loja
            </Button>
          </>
        }
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { rotulo: "Lojas ativas", valor: String(totais.ativas) },
          { rotulo: "Em implantação", valor: String(totais.implantando) },
          { rotulo: "Filiais extras cobráveis", valor: String(totais.extras) },
          { rotulo: "Implantações em aberto", valor: String(totais.aPagar) },
        ].map((k) => (
          <div key={k.rotulo} className="panel p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{k.rotulo}</p>
            <p className="font-display text-2xl font-bold">{k.valor}</p>
          </div>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Label className="text-xs uppercase tracking-wide text-muted-foreground">Cliente</Label>
        <Select value={filtroCliente} onValueChange={setFiltroCliente}>
          <SelectTrigger className="w-72">
            <SelectValue placeholder="Todos os clientes" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os clientes</SelectItem>
            {clientes.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.nome}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="panel h-52 animate-pulse" />
      ) : visiveis.length === 0 ? (
        <EmptyState
          title="Nenhuma loja cadastrada."
          description="Cadastre a matriz de cada cliente e depois as filiais da rede."
          action={
            clientes.length > 0 ? (
              <Button onClick={abrirNova}>Cadastrar primeira loja</Button>
            ) : undefined
          }
        />
      ) : (
        <div className="panel overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-48">Loja</TableHead>
                <TableHead className="min-w-40">Cliente e plano</TableHead>
                <TableHead className="min-w-52">Endereço</TableHead>
                <TableHead className="min-w-40">Contato</TableHead>
                <TableHead className="w-36 text-center">Situação</TableHead>
                <TableHead className="w-40 text-center">Implantação</TableHead>
                <TableHead className="w-36" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {visiveis.map((l) => {
                const plano = planoDoCliente(l.cliente_id);
                const cliente = clientes.find((c) => c.id === l.cliente_id);
                return (
                  <TableRow key={l.id} className="align-top">
                    <TableCell>
                      <p className="font-medium">{l.nome}</p>
                      <p className="text-xs text-muted-foreground">
                        {l.tipo === "matriz" ? "Matriz" : "Filial"}
                        {l.apelido ? ` · ${l.apelido}` : ""}
                        {l.documento ? ` · ${l.documento}` : ""}
                      </p>
                    </TableCell>
                    <TableCell>
                      <p className="text-sm">{nomeCliente(l.cliente_id)}</p>
                      <p className="text-xs text-muted-foreground">
                        {plano ? `${plano.nome} · ${brl(plano.valor_mensal)}/mês` : "Sem plano"}
                        {cliente ? ` · ${SITUACAO_SAAS[cliente.situacao] ?? cliente.situacao}` : ""}
                      </p>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {[l.endereco, l.numero].filter(Boolean).join(", ") || "—"}
                      <br />
                      {[l.bairro, l.cidade, l.uf].filter(Boolean).join(" · ")}
                      {l.cep ? ` · CEP ${l.cep}` : ""}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {l.responsavel ?? "—"}
                      <br />
                      {[l.telefone, l.whatsapp].filter(Boolean).join(" · ") || "—"}
                      <br />
                      {l.email ?? ""}
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge
                        variant={
                          l.situacao === "ativa"
                            ? "default"
                            : l.situacao === "inativa"
                              ? "secondary"
                              : "outline"
                        }
                      >
                        {SITUACAO_LOJA[l.situacao] ?? l.situacao}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      {l.tipo === "matriz" ? (
                        <span className="text-xs text-muted-foreground">Não se aplica</span>
                      ) : l.implantacao_paga ? (
                        <Badge>Paga</Badge>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => cobrarImplantacao.mutate(l)}
                          disabled={cobrarImplantacao.isPending}
                        >
                          Cobrar {brl(Number(plano?.valor_implantacao ?? 1500))}
                        </Button>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap justify-end gap-2">
                        <Button variant="outline" size="sm" onClick={() => abrirEdicao(l)}>
                          Editar
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => ativar.mutate(l)}
                          disabled={ativar.isPending}
                        >
                          {l.situacao === "ativa" ? "Inativar" : "Ativar"}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editando ? `Editar ${editando.nome}` : "Nova loja da rede"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5 sm:col-span-2">
              <Label>Cliente dono da loja</Label>
              <Select
                value={form.cliente_id}
                onValueChange={(v) => setForm({ ...form, cliente_id: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Escolha o cliente" />
                </SelectTrigger>
                <SelectContent>
                  {clientes.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="l-nome">Nome da loja</Label>
              <Input
                id="l-nome"
                value={form.nome}
                onChange={(e) => setForm({ ...form, nome: e.target.value })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="l-apelido">Apelido interno</Label>
              <Input
                id="l-apelido"
                value={form.apelido}
                onChange={(e) => setForm({ ...form, apelido: e.target.value })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Tipo</Label>
              <Select value={form.tipo} onValueChange={(v) => setForm({ ...form, tipo: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="matriz">Matriz</SelectItem>
                  <SelectItem value="filial">Filial (extra)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="l-doc">CNPJ</Label>
              <Input
                id="l-doc"
                value={form.documento}
                onChange={(e) => setForm({ ...form, documento: e.target.value })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="l-resp">Responsável</Label>
              <Input
                id="l-resp"
                value={form.responsavel}
                onChange={(e) => setForm({ ...form, responsavel: e.target.value })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="l-tel">Telefone</Label>
              <Input
                id="l-tel"
                value={form.telefone}
                onChange={(e) => setForm({ ...form, telefone: e.target.value })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="l-zap">WhatsApp</Label>
              <Input
                id="l-zap"
                value={form.whatsapp}
                onChange={(e) => setForm({ ...form, whatsapp: e.target.value })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="l-mail">E-mail</Label>
              <Input
                id="l-mail"
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="l-cep">CEP</Label>
              <Input
                id="l-cep"
                value={form.cep}
                onChange={(e) => setForm({ ...form, cep: e.target.value })}
              />
            </div>
            <div className="grid gap-1.5 sm:col-span-2">
              <Label htmlFor="l-end">Endereço</Label>
              <Input
                id="l-end"
                value={form.endereco}
                onChange={(e) => setForm({ ...form, endereco: e.target.value })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="l-num">Número</Label>
              <Input
                id="l-num"
                value={form.numero}
                onChange={(e) => setForm({ ...form, numero: e.target.value })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="l-comp">Complemento</Label>
              <Input
                id="l-comp"
                value={form.complemento}
                onChange={(e) => setForm({ ...form, complemento: e.target.value })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="l-bairro">Bairro</Label>
              <Input
                id="l-bairro"
                value={form.bairro}
                onChange={(e) => setForm({ ...form, bairro: e.target.value })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="l-cidade">Cidade</Label>
              <Input
                id="l-cidade"
                value={form.cidade}
                onChange={(e) => setForm({ ...form, cidade: e.target.value })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="l-uf">UF</Label>
              <Input
                id="l-uf"
                maxLength={2}
                value={form.uf}
                onChange={(e) => setForm({ ...form, uf: e.target.value })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="l-abertura">Abertura</Label>
              <Input
                id="l-abertura"
                type="date"
                value={form.abertura}
                onChange={(e) => setForm({ ...form, abertura: e.target.value })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Situação</Label>
              <Select
                value={form.situacao}
                onValueChange={(v) => setForm({ ...form, situacao: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="implantacao">Em implantação</SelectItem>
                  <SelectItem value="ativa">Ativa</SelectItem>
                  <SelectItem value="inativa">Inativa</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2 sm:col-span-2">
              <Switch
                id="l-impl"
                checked={form.implantacao_paga}
                onCheckedChange={(v) => setForm({ ...form, implantacao_paga: v })}
              />
              <Label htmlFor="l-impl">Implantação já paga</Label>
            </div>
            <div className="grid gap-1.5 sm:col-span-2">
              <Label htmlFor="l-obs">Observações</Label>
              <Textarea
                id="l-obs"
                rows={3}
                value={form.observacoes}
                onChange={(e) => setForm({ ...form, observacoes: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => salvar.mutate()} disabled={salvar.isPending}>
              Salvar loja
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
