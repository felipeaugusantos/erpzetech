import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, FileText, Plus, QrCode, Send, Wallet } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { brl, dateBR } from "@/lib/format";
import { gerarPixCopiaCola } from "@/lib/pix";
import {
  SITUACAO_SAAS,
  TIPO_FATURA_SAAS,
  diasEntre,
  useSaasDados,
  useSaasOperador,
} from "@/lib/saas";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/_authenticated/ze-tech-cobranca")({
  head: () => ({
    meta: [
      { title: "Cobrança das lojas — Ze Tech" },
      {
        name: "description",
        content:
          "Cadastro e envio das mensalidades das lojas assinantes com PIX copia e cola e boleto, ligado ao painel Ze Tech.",
      },
      { property: "og:title", content: "Cobrança das lojas — Ze Tech" },
      {
        property: "og:description",
        content: "Gere a cobrança de cada loja em PIX ou boleto e acompanhe o envio e o pagamento.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CobrancaZeTech,
});

type Config = {
  beneficiario: string;
  documento: string | null;
  chave_pix: string | null;
  cidade: string;
  banco: string | null;
  instrucoes: string | null;
  email_cobranca: string | null;
  whatsapp_cobranca: string | null;
};

type Fatura = {
  id: string;
  cliente_id: string;
  descricao: string;
  tipo: string;
  valor: number;
  valor_pago: number;
  vencimento: string;
  pago_em: string | null;
  forma_cobranca: string | null;
  pix_copia_cola: string | null;
  boleto_linha_digitavel: string | null;
  boleto_url: string | null;
  enviado_em: string | null;
  enviado_canal: string | null;
  observacao: string | null;
};

function copiar(texto: string, aviso: string) {
  void navigator.clipboard.writeText(texto).then(
    () => toast.success(aviso),
    () => toast.error("Não foi possível copiar. Selecione o texto e copie manualmente."),
  );
}

function CobrancaZeTech() {
  const qc = useQueryClient();
  const { data: operador, isLoading: carregandoAcesso } = useSaasOperador();
  const { data: base } = useSaasDados();

  const { data: extra } = useQuery({
    queryKey: ["saas-cobranca"],
    enabled: operador === true,
    queryFn: async () => {
      const [cfgRes, fatRes] = await Promise.all([
        supabase.from("saas_config").select("*").maybeSingle(),
        supabase.from("saas_faturas").select("*").order("vencimento", { ascending: false }),
      ]);
      if (cfgRes.error) throw cfgRes.error;
      if (fatRes.error) throw fatRes.error;
      return {
        config: (cfgRes.data ?? null) as Config | null,
        faturas: (fatRes.data ?? []) as unknown as Fatura[],
      };
    },
  });

  const clientes = base?.clientes ?? [];
  const planos = base?.planos ?? [];
  const faturas = extra?.faturas ?? [];
  const config = extra?.config ?? null;

  const nomeCliente = (id: string) => clientes.find((c) => c.id === id)?.nome ?? "Loja";
  const planoDoCliente = (clienteId: string) => {
    const c = clientes.find((x) => x.id === clienteId);
    return planos.find((p) => p.id === c?.plano_id) ?? null;
  };

  const resumo = useMemo(() => {
    const abertas = faturas.filter((f) => Number(f.valor_pago) < Number(f.valor));
    const atrasadas = abertas.filter((f) => diasEntre(f.vencimento) < 0);
    return {
      aberto: abertas.reduce((s, f) => s + (Number(f.valor) - Number(f.valor_pago)), 0),
      atrasado: atrasadas.reduce((s, f) => s + (Number(f.valor) - Number(f.valor_pago)), 0),
      aEnviar: abertas.filter((f) => !f.enviado_em).length,
      recebido: faturas.reduce((s, f) => s + Number(f.valor_pago), 0),
    };
  }, [faturas]);

  /* ---------- nova cobrança ---------- */
  const [aberto, setAberto] = useState(false);
  const hoje = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    cliente_id: "",
    tipo: "mensalidade",
    descricao: "",
    valor: "",
    vencimento: hoje,
    forma: "pix",
    linha_digitavel: "",
    boleto_url: "",
    observacao: "",
  });

  function escolherCliente(id: string) {
    const plano = planoDoCliente(id);
    const cliente = clientes.find((c) => c.id === id);
    const venc = new Date();
    venc.setMonth(venc.getMonth() + 1);
    venc.setDate(Math.min(cliente?.dia_vencimento ?? 10, 28));
    setForm({
      ...form,
      cliente_id: id,
      descricao: plano ? `Mensalidade do plano ${plano.nome}` : "Mensalidade do ERP Ze Tech",
      valor: plano
        ? String(
            Number(plano.valor_mensal) +
              Number(cliente?.filiais_extras ?? 0) * Number(plano.valor_filial_extra),
          )
        : form.valor,
      vencimento: venc.toISOString().slice(0, 10),
    });
  }

  const criar = useMutation({
    mutationFn: async () => {
      const valor = Number(form.valor.replace(",", "."));
      if (!form.cliente_id) throw new Error("Escolha a loja.");
      if (!form.descricao.trim()) throw new Error("Descreva a cobrança.");
      if (!Number.isFinite(valor) || valor <= 0) throw new Error("Informe o valor.");

      const pix =
        form.forma === "pix" && config?.chave_pix
          ? gerarPixCopiaCola({
              chave: config.chave_pix,
              beneficiario: config.beneficiario,
              cidade: config.cidade,
              valor,
              referencia: nomeCliente(form.cliente_id).replace(/\s/g, "").slice(0, 20),
            })
          : null;

      const { error } = await supabase.rpc("saas_registrar_cobranca", {
        p_cliente_id: form.cliente_id,
        p_descricao: form.descricao.trim(),
        p_valor: valor,
        p_vencimento: form.vencimento,
        p_tipo: form.tipo,
        p_forma: form.forma,
        ...(pix ? { p_pix: pix } : {}),
        ...(form.linha_digitavel.trim() ? { p_linha_digitavel: form.linha_digitavel.trim() } : {}),
        ...(form.boleto_url.trim() ? { p_boleto_url: form.boleto_url.trim() } : {}),
        ...(form.observacao.trim() ? { p_observacao: form.observacao.trim() } : {}),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Cobrança cadastrada.");
      setAberto(false);
      setForm({ ...form, valor: "", linha_digitavel: "", boleto_url: "", observacao: "" });
      void qc.invalidateQueries({ queryKey: ["saas-cobranca"] });
      void qc.invalidateQueries({ queryKey: ["saas-dados"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const marcarEnviada = useMutation({
    mutationFn: async ({ id, canal }: { id: string; canal: string }) => {
      const { error } = await supabase.rpc("saas_marcar_enviada", {
        p_fatura_id: id,
        p_canal: canal,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Cobrança marcada como enviada.");
      void qc.invalidateQueries({ queryKey: ["saas-cobranca"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  /** Mensagem pronta para WhatsApp / e-mail. */
  function mensagem(f: Fatura) {
    const linhas = [
      `Olá! Segue a cobrança do ERP Ze Tech — ${nomeCliente(f.cliente_id)}.`,
      `${f.descricao}`,
      `Valor: ${brl(f.valor)} · Vencimento: ${dateBR(f.vencimento)}`,
    ];
    if (f.pix_copia_cola) linhas.push("", "PIX copia e cola:", f.pix_copia_cola);
    if (f.boleto_linha_digitavel)
      linhas.push("", "Linha digitável do boleto:", f.boleto_linha_digitavel);
    if (f.boleto_url) linhas.push("", `Boleto em PDF: ${f.boleto_url}`);
    if (config?.instrucoes) linhas.push("", config.instrucoes);
    return linhas.join("\n");
  }

  function enviarWhatsapp(f: Fatura) {
    const cliente = clientes.find((c) => c.id === f.cliente_id);
    const fone = (cliente?.whatsapp ?? "").replace(/\D/g, "");
    if (!fone) {
      toast.error("Cadastre o WhatsApp desta loja no painel de clientes.");
      return;
    }
    window.open(`https://wa.me/55${fone}?text=${encodeURIComponent(mensagem(f))}`, "_blank");
    marcarEnviada.mutate({ id: f.id, canal: "whatsapp" });
  }

  function enviarEmail(f: Fatura) {
    const cliente = clientes.find((c) => c.id === f.cliente_id);
    if (!cliente?.email) {
      toast.error("Cadastre o e-mail desta loja no painel de clientes.");
      return;
    }
    window.location.href = `mailto:${cliente.email}?subject=${encodeURIComponent(
      `Cobrança ERP Ze Tech — ${f.descricao}`,
    )}&body=${encodeURIComponent(mensagem(f))}`;
    marcarEnviada.mutate({ id: f.id, canal: "email" });
  }

  /* ---------- dados de cobrança da Ze Tech ---------- */
  const [cfgAberto, setCfgAberto] = useState(false);
  const [cfg, setCfg] = useState<Config | null>(null);
  const salvarCfg = useMutation({
    mutationFn: async () => {
      if (!cfg) return;
      const { error } = await supabase
        .from("saas_config")
        .update({
          beneficiario: cfg.beneficiario,
          documento: cfg.documento,
          chave_pix: cfg.chave_pix,
          cidade: cfg.cidade,
          banco: cfg.banco,
          instrucoes: cfg.instrucoes,
          email_cobranca: cfg.email_cobranca,
          whatsapp_cobranca: cfg.whatsapp_cobranca,
        })
        .eq("id", true);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Dados de cobrança salvos.");
      setCfgAberto(false);
      void qc.invalidateQueries({ queryKey: ["saas-cobranca"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (carregandoAcesso) return <p className="text-sm text-muted-foreground">Carregando…</p>;
  if (!operador) {
    return (
      <EmptyState
        title="Área exclusiva da Ze Tech."
        description="Esta tela é do fabricante do sistema e não fica disponível para as lojas."
      />
    );
  }

  const porLoja = clientes.map((c) => {
    const minhas = faturas.filter((f) => f.cliente_id === c.id);
    const aberto = minhas
      .filter((f) => Number(f.valor_pago) < Number(f.valor))
      .reduce((s, f) => s + (Number(f.valor) - Number(f.valor_pago)), 0);
    return { cliente: c, cobrancas: minhas.length, aberto };
  });

  return (
    <>
      <PageHeader
        title="Cobrança das lojas"
        description="Cadastre a mensalidade de cada loja em PIX copia e cola ou boleto e envie por WhatsApp ou e-mail."
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to="/ze-tech">Painel de clientes</Link>
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setCfg(config);
                setCfgAberto(true);
              }}
            >
              Dados de cobrança
            </Button>
            <Button
              onClick={() => {
                setAberto(true);
                if (clientes[0]) escolherCliente(clientes[0].id);
              }}
            >
              <Plus className="size-4" /> Nova cobrança
            </Button>
          </>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Em aberto"
          value={brl(resumo.aberto)}
          hint="Cobranças não quitadas"
          icon={Wallet}
        />
        <StatCard
          label="Em atraso"
          value={brl(resumo.atrasado)}
          hint="Vencidas e não pagas"
          icon={FileText}
        />
        <StatCard
          label="A enviar"
          value={String(resumo.aEnviar)}
          hint="Cobranças sem envio"
          icon={Send}
        />
        <StatCard
          label="Já recebido"
          value={brl(resumo.recebido)}
          hint="Total pago pelas lojas"
          icon={QrCode}
        />
      </div>

      {!config?.chave_pix && (
        <p className="panel mb-5 p-4 text-sm text-muted-foreground">
          Cadastre a sua chave PIX em <strong>Dados de cobrança</strong> para o sistema gerar o PIX
          copia e cola de cada mensalidade.
        </p>
      )}

      <Tabs defaultValue="cobrancas">
        <TabsList>
          <TabsTrigger value="cobrancas">Cobranças</TabsTrigger>
          <TabsTrigger value="lojas">Por loja</TabsTrigger>
        </TabsList>

        <TabsContent value="cobrancas" className="mt-4">
          {faturas.length === 0 ? (
            <EmptyState
              title="Nenhuma cobrança cadastrada."
              description="Crie a cobrança da mensalidade de cada loja assinante."
              action={<Button onClick={() => setAberto(true)}>Nova cobrança</Button>}
            />
          ) : (
            <div className="panel overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-44">Loja</TableHead>
                    <TableHead className="min-w-48">Cobrança</TableHead>
                    <TableHead className="w-28">Vencimento</TableHead>
                    <TableHead className="w-28 text-right">Valor</TableHead>
                    <TableHead className="w-28 text-center">Situação</TableHead>
                    <TableHead className="w-28 text-center">Envio</TableHead>
                    <TableHead className="w-72 text-right">Cobrar</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {faturas.map((f) => {
                    const saldo = Number(f.valor) - Number(f.valor_pago);
                    const dias = diasEntre(f.vencimento);
                    const situacao =
                      saldo <= 0
                        ? { texto: "Paga", variante: "default" as const }
                        : dias < 0
                          ? {
                              texto: `${Math.abs(dias)}d em atraso`,
                              variante: "destructive" as const,
                            }
                          : { texto: "Em aberto", variante: "secondary" as const };
                    return (
                      <TableRow key={f.id} className="align-middle">
                        <TableCell>{nomeCliente(f.cliente_id)}</TableCell>
                        <TableCell>
                          <p>{f.descricao}</p>
                          <p className="text-xs text-muted-foreground">
                            {TIPO_FATURA_SAAS[f.tipo] ?? f.tipo}
                            {f.forma_cobranca
                              ? ` · ${f.forma_cobranca === "pix" ? "PIX" : "Boleto"}`
                              : ""}
                          </p>
                        </TableCell>
                        <TableCell>{dateBR(f.vencimento)}</TableCell>
                        <TableCell className="text-right">
                          {brl(f.valor)}
                          {saldo > 0 && Number(f.valor_pago) > 0 && (
                            <span className="block text-xs text-muted-foreground">
                              falta {brl(saldo)}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant={situacao.variante}>{situacao.texto}</Badge>
                        </TableCell>
                        <TableCell className="text-center text-xs">
                          {f.enviado_em ? (
                            <>
                              {dateBR(f.enviado_em.slice(0, 10))}
                              <span className="block text-muted-foreground">
                                {f.enviado_canal === "email" ? "e-mail" : "WhatsApp"}
                              </span>
                            </>
                          ) : (
                            <Badge variant="secondary">a enviar</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex flex-wrap justify-end gap-1">
                            {f.pix_copia_cola && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => copiar(f.pix_copia_cola!, "PIX copiado.")}
                              >
                                <Copy className="size-3.5" /> PIX
                              </Button>
                            )}
                            {f.boleto_linha_digitavel && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                  copiar(f.boleto_linha_digitavel!, "Linha digitável copiada.")
                                }
                              >
                                <Copy className="size-3.5" /> Boleto
                              </Button>
                            )}
                            <Button variant="outline" size="sm" onClick={() => enviarWhatsapp(f)}>
                              WhatsApp
                            </Button>
                            <Button variant="outline" size="sm" onClick={() => enviarEmail(f)}>
                              E-mail
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
        </TabsContent>

        <TabsContent value="lojas" className="mt-4">
          <div className="panel overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-44">Loja</TableHead>
                  <TableHead className="w-40">Plano</TableHead>
                  <TableHead className="w-32 text-center">Situação</TableHead>
                  <TableHead className="w-24 text-center">Dia venc.</TableHead>
                  <TableHead className="w-28 text-center">Cobranças</TableHead>
                  <TableHead className="w-32 text-right">Em aberto</TableHead>
                  <TableHead className="w-32 text-right" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {porLoja.map(({ cliente, cobrancas, aberto: emAberto }) => (
                  <TableRow key={cliente.id} className="align-middle">
                    <TableCell>
                      <p className="font-medium">{cliente.nome}</p>
                      <p className="text-xs text-muted-foreground">
                        {cliente.whatsapp ?? cliente.email ?? "sem contato cadastrado"}
                      </p>
                    </TableCell>
                    <TableCell>{planoDoCliente(cliente.id)?.nome ?? "—"}</TableCell>
                    <TableCell className="text-center">
                      <Badge variant={cliente.situacao === "ativo" ? "default" : "secondary"}>
                        {SITUACAO_SAAS[cliente.situacao] ?? cliente.situacao}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center">{cliente.dia_vencimento}</TableCell>
                    <TableCell className="text-center">{cobrancas}</TableCell>
                    <TableCell className="text-right">{brl(emAberto)}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          escolherCliente(cliente.id);
                          setAberto(true);
                        }}
                      >
                        Cobrar
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Nova cobrança</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="c-loja">Loja</Label>
              <Select value={form.cliente_id} onValueChange={escolherCliente}>
                <SelectTrigger id="c-loja">
                  <SelectValue placeholder="Escolha a loja" />
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
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="c-tipo">Tipo</Label>
                <Select value={form.tipo} onValueChange={(v) => setForm({ ...form, tipo: v })}>
                  <SelectTrigger id="c-tipo">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(TIPO_FATURA_SAAS).map(([v, l]) => (
                      <SelectItem key={v} value={v}>
                        {l}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="c-forma">Forma de cobrança</Label>
                <Select value={form.forma} onValueChange={(v) => setForm({ ...form, forma: v })}>
                  <SelectTrigger id="c-forma">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pix">PIX copia e cola</SelectItem>
                    <SelectItem value="boleto">Boleto</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="c-desc">Descrição</Label>
              <Input
                id="c-desc"
                value={form.descricao}
                onChange={(e) => setForm({ ...form, descricao: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="c-valor">Valor (R$)</Label>
                <Input
                  id="c-valor"
                  inputMode="decimal"
                  value={form.valor}
                  onChange={(e) => setForm({ ...form, valor: e.target.value })}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="c-venc">Vencimento</Label>
                <Input
                  id="c-venc"
                  type="date"
                  value={form.vencimento}
                  onChange={(e) => setForm({ ...form, vencimento: e.target.value })}
                />
              </div>
            </div>
            {form.forma === "boleto" && (
              <>
                <div className="grid gap-1.5">
                  <Label htmlFor="c-linha">Linha digitável do boleto</Label>
                  <Input
                    id="c-linha"
                    value={form.linha_digitavel}
                    onChange={(e) => setForm({ ...form, linha_digitavel: e.target.value })}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="c-url">Link do boleto em PDF</Label>
                  <Input
                    id="c-url"
                    value={form.boleto_url}
                    onChange={(e) => setForm({ ...form, boleto_url: e.target.value })}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  O boleto é emitido pelo seu banco; cole aqui a linha digitável e o link para
                  enviar à loja.
                </p>
              </>
            )}
            <div className="grid gap-1.5">
              <Label htmlFor="c-obs">Observação</Label>
              <Textarea
                id="c-obs"
                value={form.observacao}
                onChange={(e) => setForm({ ...form, observacao: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => criar.mutate()} disabled={criar.isPending}>
              Cadastrar cobrança
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={cfgAberto} onOpenChange={setCfgAberto}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Dados de cobrança da Ze Tech</DialogTitle>
          </DialogHeader>
          {cfg && (
            <div className="grid gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="g-benef">Nome do beneficiário</Label>
                <Input
                  id="g-benef"
                  value={cfg.beneficiario}
                  onChange={(e) => setCfg({ ...cfg, beneficiario: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="g-doc">CNPJ / CPF</Label>
                  <Input
                    id="g-doc"
                    value={cfg.documento ?? ""}
                    onChange={(e) => setCfg({ ...cfg, documento: e.target.value })}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="g-cidade">Cidade</Label>
                  <Input
                    id="g-cidade"
                    value={cfg.cidade}
                    onChange={(e) => setCfg({ ...cfg, cidade: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="g-pix">Chave PIX</Label>
                <Input
                  id="g-pix"
                  value={cfg.chave_pix ?? ""}
                  onChange={(e) => setCfg({ ...cfg, chave_pix: e.target.value })}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="g-banco">Banco do boleto</Label>
                <Input
                  id="g-banco"
                  value={cfg.banco ?? ""}
                  onChange={(e) => setCfg({ ...cfg, banco: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="g-email">E-mail de cobrança</Label>
                  <Input
                    id="g-email"
                    value={cfg.email_cobranca ?? ""}
                    onChange={(e) => setCfg({ ...cfg, email_cobranca: e.target.value })}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="g-zap">WhatsApp de cobrança</Label>
                  <Input
                    id="g-zap"
                    value={cfg.whatsapp_cobranca ?? ""}
                    onChange={(e) => setCfg({ ...cfg, whatsapp_cobranca: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="g-instr">Instruções enviadas à loja</Label>
                <Textarea
                  id="g-instr"
                  value={cfg.instrucoes ?? ""}
                  onChange={(e) => setCfg({ ...cfg, instrucoes: e.target.value })}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => salvarCfg.mutate()} disabled={salvarCfg.isPending}>
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
