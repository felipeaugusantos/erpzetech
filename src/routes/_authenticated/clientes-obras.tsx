import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, HardHat, UserRound } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useSessionData } from "@/hooks/useSessionData";
import { brl, dateBR } from "@/lib/format";
import { EmptyState, PageHeader, StatCard } from "@/components/app/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

export const Route = createFileRoute("/_authenticated/clientes-obras")({
  head: () => ({
    meta: [
      { title: "Clientes e obras — ERP Ze Tech" },
      {
        name: "description",
        content:
          "Cadastro completo de clientes PF e PJ com endereço, crédito, profissional que indicou e as obras de cada cliente.",
      },
      { property: "og:title", content: "Clientes e obras — ERP Ze Tech" },
      {
        property: "og:description",
        content: "Cadastre clientes e obras completos antes de gerar pedidos e notas.",
      },
    ],
  }),
  component: ClientesObras,
});

const SITUACOES_OBRA = [
  "planejamento",
  "em_andamento",
  "pausada",
  "concluida",
  "cancelada",
] as const;

function ClientesObras() {
  const qc = useQueryClient();
  const { data: session } = useSessionData();
  const tenantId = session?.profile?.tenant_id ?? null;
  const empresaId = session?.profile?.empresa_id ?? session?.empresa?.id ?? null;
  const filialId = session?.profile?.filial_id ?? null;

  const [busca, setBusca] = useState("");
  const [selecionado, setSelecionado] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["clientes-obras"],
    queryFn: async () => {
      const [cliRes, obrasRes, profRes] = await Promise.all([
        supabase.from("clientes").select("*").eq("ativo", true).order("nome"),
        supabase.from("obras").select("*").order("created_at", { ascending: false }),
        supabase.from("profissionais").select("id, nome, percentual_premio").order("nome"),
      ]);
      return {
        clientes: cliRes.data ?? [],
        obras: obrasRes.data ?? [],
        profissionais: profRes.data ?? [],
      };
    },
  });

  const clientes = data?.clientes ?? [];
  const obras = data?.obras ?? [];
  const profissionais = data?.profissionais ?? [];

  const visiveis = useMemo(() => {
    const t = busca.trim().toLowerCase();
    if (!t) return clientes;
    return clientes.filter((c) =>
      [c.nome, c.nome_fantasia, c.cpf, c.cnpj, c.telefone, c.whatsapp, c.cidade]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(t)),
    );
  }, [clientes, busca]);

  const cliente = clientes.find((c) => c.id === (selecionado ?? visiveis[0]?.id)) ?? null;
  const obrasDoCliente = obras.filter((o) => o.cliente_id === cliente?.id);

  /* ---------- cliente ---------- */
  const clienteVazio = {
    tipo: "PF",
    nome: "",
    nome_fantasia: "",
    cpf: "",
    cnpj: "",
    inscricao_estadual: "",
    telefone: "",
    whatsapp: "",
    email: "",
    cep: "",
    endereco: "",
    numero: "",
    complemento: "",
    bairro: "",
    cidade: "",
    estado: "",
    limite_credito: "0",
    prazo_padrao_dias: "0",
    profissional_id: "",
    observacoes: "",
  };
  const [clienteAberto, setClienteAberto] = useState(false);
  const [clienteEditando, setClienteEditando] = useState<string | null>(null);
  const [formCliente, setFormCliente] = useState(clienteVazio);

  function novoCliente() {
    setClienteEditando(null);
    setFormCliente(clienteVazio);
    setClienteAberto(true);
  }

  function editarCliente(c: (typeof clientes)[number]) {
    setClienteEditando(c.id);
    setFormCliente({
      tipo: c.tipo,
      nome: c.nome,
      nome_fantasia: c.nome_fantasia ?? "",
      cpf: c.cpf ?? "",
      cnpj: c.cnpj ?? "",
      inscricao_estadual: c.inscricao_estadual ?? "",
      telefone: c.telefone ?? "",
      whatsapp: c.whatsapp ?? "",
      email: c.email ?? "",
      cep: c.cep ?? "",
      endereco: c.endereco ?? "",
      numero: c.numero ?? "",
      complemento: c.complemento ?? "",
      bairro: c.bairro ?? "",
      cidade: c.cidade ?? "",
      estado: c.estado ?? "",
      limite_credito: String(c.limite_credito),
      prazo_padrao_dias: String(c.prazo_padrao_dias),
      profissional_id: c.profissional_id ?? "",
      observacoes: c.observacoes ?? "",
    });
    setClienteAberto(true);
  }

  const salvarCliente = useMutation({
    mutationFn: async () => {
      if (formCliente.nome.trim().length < 2) throw new Error("Informe o nome do cliente");
      const valores = {
        tipo: formCliente.tipo as "PF" | "PJ",
        nome: formCliente.nome.trim(),
        nome_fantasia: formCliente.nome_fantasia.trim() || null,
        cpf: formCliente.cpf.trim() || null,
        cnpj: formCliente.cnpj.trim() || null,
        inscricao_estadual: formCliente.inscricao_estadual.trim() || null,
        telefone: formCliente.telefone.trim() || null,
        whatsapp: formCliente.whatsapp.trim() || null,
        email: formCliente.email.trim() || null,
        cep: formCliente.cep.trim() || null,
        endereco: formCliente.endereco.trim() || null,
        numero: formCliente.numero.trim() || null,
        complemento: formCliente.complemento.trim() || null,
        bairro: formCliente.bairro.trim() || null,
        cidade: formCliente.cidade.trim() || null,
        estado: formCliente.estado.trim() || null,
        limite_credito: Number(formCliente.limite_credito.replace(",", ".")) || 0,
        prazo_padrao_dias: Number(formCliente.prazo_padrao_dias) || 0,
        profissional_id: formCliente.profissional_id || null,
        observacoes: formCliente.observacoes.trim() || null,
      };
      if (clienteEditando) {
        const { error } = await supabase.from("clientes").update(valores).eq("id", clienteEditando);
        if (error) throw error;
        return clienteEditando;
      }
      if (!tenantId) throw new Error("Empresa não identificada");
      const { data: novo, error } = await supabase
        .from("clientes")
        .insert({ tenant_id: tenantId, empresa_id: empresaId, filial_id: filialId, ...valores })
        .select("id")
        .single();
      if (error) throw error;
      return novo.id;
    },
    onSuccess: (id) => {
      toast.success("Cliente salvo");
      setClienteAberto(false);
      setSelecionado(id);
      qc.invalidateQueries({ queryKey: ["clientes-obras"] });
      qc.invalidateQueries({ queryKey: ["clientes"] });
    },
    onError: (e: Error) => toast.error("Erro", { description: e.message }),
  });

  /* ---------- obra ---------- */
  const obraVazia = {
    nome: "",
    responsavel: "",
    telefone: "",
    cep: "",
    endereco: "",
    numero: "",
    bairro: "",
    cidade: "",
    estado: "",
    data_inicio: "",
    previsao_termino: "",
    situacao: "em_andamento",
    observacoes: "",
  };
  const [obraAberta, setObraAberta] = useState(false);
  const [obraEditando, setObraEditando] = useState<string | null>(null);
  const [formObra, setFormObra] = useState(obraVazia);

  function novaObra() {
    if (!cliente) return;
    setObraEditando(null);
    setFormObra({
      ...obraVazia,
      cep: cliente.cep ?? "",
      endereco: cliente.endereco ?? "",
      numero: cliente.numero ?? "",
      bairro: cliente.bairro ?? "",
      cidade: cliente.cidade ?? "",
      estado: cliente.estado ?? "",
      telefone: cliente.whatsapp ?? cliente.telefone ?? "",
    });
    setObraAberta(true);
  }

  function editarObra(o: (typeof obras)[number]) {
    setObraEditando(o.id);
    setFormObra({
      nome: o.nome,
      responsavel: o.responsavel ?? "",
      telefone: o.telefone ?? "",
      cep: o.cep ?? "",
      endereco: o.endereco ?? "",
      numero: o.numero ?? "",
      bairro: o.bairro ?? "",
      cidade: o.cidade ?? "",
      estado: o.estado ?? "",
      data_inicio: o.data_inicio ?? "",
      previsao_termino: o.previsao_termino ?? "",
      situacao: o.situacao,
      observacoes: o.observacoes ?? "",
    });
    setObraAberta(true);
  }

  const salvarObra = useMutation({
    mutationFn: async () => {
      if (!cliente) throw new Error("Selecione o cliente");
      if (formObra.nome.trim().length < 2) throw new Error("Informe o nome da obra");
      const valores = {
        nome: formObra.nome.trim(),
        responsavel: formObra.responsavel.trim() || null,
        telefone: formObra.telefone.trim() || null,
        cep: formObra.cep.trim() || null,
        endereco: formObra.endereco.trim() || null,
        numero: formObra.numero.trim() || null,
        bairro: formObra.bairro.trim() || null,
        cidade: formObra.cidade.trim() || null,
        estado: formObra.estado.trim() || null,
        data_inicio: formObra.data_inicio || null,
        previsao_termino: formObra.previsao_termino || null,
        situacao: formObra.situacao as (typeof SITUACOES_OBRA)[number],
        observacoes: formObra.observacoes.trim() || null,
      };
      if (obraEditando) {
        const { error } = await supabase.from("obras").update(valores).eq("id", obraEditando);
        if (error) throw error;
      } else {
        if (!tenantId) throw new Error("Empresa não identificada");
        const { error } = await supabase
          .from("obras")
          .insert({ tenant_id: tenantId, cliente_id: cliente.id, ...valores });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Obra salva");
      setObraAberta(false);
      qc.invalidateQueries({ queryKey: ["clientes-obras"] });
      qc.invalidateQueries({ queryKey: ["obras"] });
    },
    onError: (e: Error) => toast.error("Erro", { description: e.message }),
  });

  const semEndereco = clientes.filter((c) => !c.endereco || !c.cidade).length;

  return (
    <>
      <PageHeader
        title="Clientes e obras"
        description="Cadastro completo do cliente e das obras dele, tudo na mesma tela, antes de gerar pedidos e notas."
        actions={<Button onClick={novoCliente}>Novo cliente</Button>}
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Clientes"
          value={String(clientes.length)}
          hint={`${clientes.filter((c) => c.tipo === "PJ").length} PJ · ${clientes.filter((c) => c.tipo === "PF").length} PF`}
          icon={UserRound}
          tone="accent"
        />
        <StatCard
          label="Obras cadastradas"
          value={String(obras.length)}
          hint={`${obras.filter((o) => o.situacao === "em_andamento").length} em andamento`}
          icon={HardHat}
        />
        <StatCard
          label="Cadastros incompletos"
          value={String(semEndereco)}
          hint="Sem endereço ou cidade — a nota exige"
          icon={Building2}
          tone={semEndereco > 0 ? "warning" : "success"}
        />
      </div>

      {isLoading ? (
        <div className="panel h-64 animate-pulse" />
      ) : clientes.length === 0 ? (
        <EmptyState
          title="Nenhum cliente cadastrado."
          description="Cadastre o cliente com endereço e documento para poder emitir nota."
          action={<Button onClick={novoCliente}>Novo cliente</Button>}
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[20rem_1fr]">
          <div className="panel p-3">
            <Input
              placeholder="Buscar cliente, documento ou cidade"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
            <ul className="mt-3 max-h-[32rem] space-y-1 overflow-y-auto">
              {visiveis.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => setSelecionado(c.id)}
                    className={`w-full rounded-md px-3 py-2 text-left text-sm transition-colors ${
                      cliente?.id === c.id ? "bg-secondary font-semibold" : "hover:bg-secondary/60"
                    }`}
                  >
                    <span className="block truncate">{c.nome}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {c.cnpj || c.cpf || "sem documento"} ·{" "}
                      {obras.filter((o) => o.cliente_id === c.id).length} obra(s)
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {cliente && (
            <div className="space-y-4">
              <div className="panel p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="font-display text-lg font-bold">{cliente.nome}</h2>
                    <p className="text-sm text-muted-foreground">
                      {cliente.tipo === "PJ" ? "Pessoa jurídica" : "Pessoa física"} ·{" "}
                      {cliente.cnpj || cliente.cpf || "sem documento"}
                    </p>
                  </div>
                  <Button variant="outline" onClick={() => editarCliente(cliente)}>
                    Editar cliente
                  </Button>
                </div>
                <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {[
                    [
                      "Contato",
                      [cliente.whatsapp, cliente.telefone, cliente.email]
                        .filter(Boolean)
                        .join(" · ") || "—",
                    ],
                    [
                      "Endereço",
                      [cliente.endereco, cliente.numero, cliente.bairro]
                        .filter(Boolean)
                        .join(", ") || "—",
                    ],
                    ["Cidade", [cliente.cidade, cliente.estado].filter(Boolean).join(" / ") || "—"],
                    ["Limite de crédito", brl(Number(cliente.limite_credito))],
                    ["Saldo utilizado", brl(Number(cliente.saldo_utilizado))],
                    [
                      "Indicado por",
                      profissionais.find((p) => p.id === cliente.profissional_id)?.nome ?? "—",
                    ],
                  ].map(([label, valor]) => (
                    <div key={label}>
                      <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                        {label}
                      </dt>
                      <dd className="text-sm">{valor}</dd>
                    </div>
                  ))}
                </dl>
              </div>

              <div className="panel p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-display text-sm font-semibold">
                    Obras deste cliente ({obrasDoCliente.length})
                  </p>
                  <Button size="sm" onClick={novaObra}>
                    Nova obra
                  </Button>
                </div>
                {obrasDoCliente.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    Nenhuma obra cadastrada para este cliente.
                  </p>
                ) : (
                  <ul className="mt-3 divide-y divide-border">
                    {obrasDoCliente.map((o) => (
                      <li key={o.id} className="flex flex-wrap items-center gap-3 py-3">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold">{o.nome}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {[o.endereco, o.numero, o.bairro, o.cidade]
                              .filter(Boolean)
                              .join(", ") || "sem endereço"}
                            {o.responsavel ? ` · resp. ${o.responsavel}` : ""}
                            {o.previsao_termino ? ` · previsão ${dateBR(o.previsao_termino)}` : ""}
                          </p>
                        </div>
                        <Badge variant="outline" className="capitalize">
                          {o.situacao.replace(/_/g, " ")}
                        </Badge>
                        <Button size="sm" variant="outline" onClick={() => editarObra(o)}>
                          Editar
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* cliente */}
      <Dialog open={clienteAberto} onOpenChange={setClienteAberto}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{clienteEditando ? "Editar cliente" : "Novo cliente"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <Label>Tipo</Label>
              <Select
                value={formCliente.tipo}
                onValueChange={(v) => setFormCliente({ ...formCliente, tipo: v })}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PF">Pessoa física</SelectItem>
                  <SelectItem value="PJ">Pessoa jurídica</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-2">
              <Label>Nome / Razão social</Label>
              <Input
                className="mt-1"
                value={formCliente.nome}
                onChange={(e) => setFormCliente({ ...formCliente, nome: e.target.value })}
              />
            </div>
            {(
              [
                ["nome_fantasia", "Nome fantasia"],
                ["cpf", "CPF"],
                ["cnpj", "CNPJ"],
                ["inscricao_estadual", "Inscrição estadual"],
                ["whatsapp", "WhatsApp"],
                ["telefone", "Telefone"],
                ["email", "E-mail"],
                ["cep", "CEP"],
                ["endereco", "Endereço"],
                ["numero", "Número"],
                ["complemento", "Complemento"],
                ["bairro", "Bairro"],
                ["cidade", "Cidade"],
                ["estado", "Estado (UF)"],
                ["limite_credito", "Limite de crédito (R$)"],
                ["prazo_padrao_dias", "Prazo padrão (dias)"],
              ] as const
            ).map(([campo, label]) => (
              <div key={campo}>
                <Label>{label}</Label>
                <Input
                  className="mt-1"
                  value={formCliente[campo]}
                  onChange={(e) => setFormCliente({ ...formCliente, [campo]: e.target.value })}
                />
              </div>
            ))}
            <div>
              <Label>Indicado por (profissional)</Label>
              <Select
                value={formCliente.profissional_id || "nenhum"}
                onValueChange={(v) =>
                  setFormCliente({ ...formCliente, profissional_id: v === "nenhum" ? "" : v })
                }
              >
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="nenhum">Ninguém</SelectItem>
                  {profissionais.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.nome} ({p.percentual_premio}%)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-3">
              <Label>Observações</Label>
              <Textarea
                className="mt-1"
                rows={2}
                value={formCliente.observacoes}
                onChange={(e) => setFormCliente({ ...formCliente, observacoes: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setClienteAberto(false)}>
              Cancelar
            </Button>
            <Button onClick={() => salvarCliente.mutate()} disabled={salvarCliente.isPending}>
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* obra */}
      <Dialog open={obraAberta} onOpenChange={setObraAberta}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{obraEditando ? "Editar obra" : "Nova obra"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label>Nome da obra</Label>
              <Input
                className="mt-1"
                value={formObra.nome}
                onChange={(e) => setFormObra({ ...formObra, nome: e.target.value })}
              />
            </div>
            {(
              [
                ["responsavel", "Responsável na obra"],
                ["telefone", "Telefone"],
                ["cep", "CEP"],
                ["endereco", "Endereço"],
                ["numero", "Número"],
                ["bairro", "Bairro"],
                ["cidade", "Cidade"],
                ["estado", "Estado (UF)"],
              ] as const
            ).map(([campo, label]) => (
              <div key={campo}>
                <Label>{label}</Label>
                <Input
                  className="mt-1"
                  value={formObra[campo]}
                  onChange={(e) => setFormObra({ ...formObra, [campo]: e.target.value })}
                />
              </div>
            ))}
            <div>
              <Label>Início</Label>
              <Input
                type="date"
                className="mt-1"
                value={formObra.data_inicio}
                onChange={(e) => setFormObra({ ...formObra, data_inicio: e.target.value })}
              />
            </div>
            <div>
              <Label>Previsão de término</Label>
              <Input
                type="date"
                className="mt-1"
                value={formObra.previsao_termino}
                onChange={(e) => setFormObra({ ...formObra, previsao_termino: e.target.value })}
              />
            </div>
            <div>
              <Label>Situação</Label>
              <Select
                value={formObra.situacao}
                onValueChange={(v) => setFormObra({ ...formObra, situacao: v })}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SITUACOES_OBRA.map((s) => (
                    <SelectItem key={s} value={s} className="capitalize">
                      {s.replace(/_/g, " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-2">
              <Label>Observações</Label>
              <Textarea
                className="mt-1"
                rows={2}
                value={formObra.observacoes}
                onChange={(e) => setFormObra({ ...formObra, observacoes: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setObraAberta(false)}>
              Cancelar
            </Button>
            <Button onClick={() => salvarObra.mutate()} disabled={salvarObra.isPending}>
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
