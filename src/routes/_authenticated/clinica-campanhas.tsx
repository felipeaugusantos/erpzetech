import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Send } from "lucide-react";

import { ModuloBloqueado } from "@/components/app/ModuloCnae";
import { PageHeader } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useModulosCnae } from "@/lib/cnae";
import { dateTimeBR } from "@/lib/format";
import { telefoneWhatsApp } from "@/lib/contato-pet";
import {
  MAX_CAMPANHA,
  MAX_TEXTO_CAMPANHA,
  PAUSA_CAMPANHA_MS,
  textoCampanha,
  validarCampanha,
} from "@/lib/campanha-whatsapp";
import { campanhaEnviar } from "@/lib/campanha-whatsapp.functions";

export const Route = createFileRoute("/_authenticated/clinica-campanhas")({
  head: () => ({
    meta: [
      { title: "Campanhas de WhatsApp — ERP Ze Tech" },
      {
        name: "description",
        content: "Envie campanhas da clínica pelo WhatsApp para até 10 tutores por vez.",
      },
      { property: "og:title", content: "Campanhas de WhatsApp — ERP Ze Tech" },
      {
        property: "og:description",
        content: "Mensagens personalizadas para tutores, em lotes de até 10.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CampanhasProtegida,
});

function CampanhasProtegida() {
  const m = useModulosCnae();
  if (m.carregando) return <div className="panel h-40 animate-pulse" />;
  if (!m.clinica) return <ModuloBloqueado modulo="clinica" />;
  return <Campanhas />;
}

type Tutor = { id: string; nome: string; numero: string; pets: string[] };
const ROTULO: Record<string, string> = {
  enviando: "Enviando",
  enviada: "Enviada",
  falhou: "Falhou",
  incerto: "Incerto (confira o celular)",
};
const MODELO_INICIAL =
  "Olá, {tutor}! Aqui é da {clinica}. Estamos com a campanha de vacinação e lembramos do {pet}. Quer agendar um horário?";
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

function Campanhas() {
  const qc = useQueryClient();
  const enviar = useServerFn(campanhaEnviar);
  const [busca, setBusca] = useState("");
  const [sel, setSel] = useState<string[]>([]);
  const [modelo, setModelo] = useState(MODELO_INICIAL);
  const [titulo, setTitulo] = useState("");
  const [modeloId, setModeloId] = useState("");
  const aprovador = useQuery({
    queryKey: ["campanha-aprovador"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return false;
      const [a, g] = await Promise.all([
        supabase.rpc("has_role", { _user_id: u.user.id, _role: "administrador" }),
        supabase.rpc("has_role", { _user_id: u.user.id, _role: "gestor" }),
      ]);
      return Boolean(a.data || g.data);
    },
  });
  const modelos = useQuery({
    queryKey: ["campanha-modelos"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clinica_wa_campanha_modelos")
        .select("id,titulo,texto")
        .eq("ativo", true)
        .order("titulo");
      if (error) throw error;
      return data ?? [];
    },
  });
  const escolhido = (modelos.data ?? []).find((m) => m.id === modeloId);
  async function aprovarModelo() {
    const e = validarCampanha(modelo, 1);
    if (e) {
      toast.error(e);
      return;
    }
    if (!titulo.trim()) {
      toast.error("Dê um título à mensagem.");
      return;
    }
    const { data: u } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from("clinica_wa_campanha_modelos")
      .insert({ titulo: titulo.trim(), texto: modelo.trim(), aprovado_por: u.user?.id ?? "" })
      .select("id")
      .single();
    if (error) {
      toast.error("Não foi possível aprovar a mensagem.");
      return;
    }
    toast.success("Mensagem aprovada.");
    setTitulo("");
    await qc.invalidateQueries({ queryKey: ["campanha-modelos"] });
    setModeloId(data.id);
  }
  async function desativarModelo() {
    if (!modeloId) return;
    const { error } = await supabase
      .from("clinica_wa_campanha_modelos")
      .update({ ativo: false })
      .eq("id", modeloId);
    if (error) {
      toast.error("Não foi possível desativar.");
      return;
    }
    setModeloId("");
    void qc.invalidateQueries({ queryKey: ["campanha-modelos"] });
  }
  const [progresso, setProgresso] = useState<{ feito: number; total: number } | null>(null);

  const tutores = useQuery({
    queryKey: ["campanha-tutores"],
    queryFn: async (): Promise<Tutor[]> => {
      const { data, error } = await supabase
        .from("clientes")
        .select("id,nome,whatsapp,telefone,pets(nome,ativo,obito)")
        .eq("ativo", true)
        .eq("aceita_mensagens", true)
        .is("deleted_at", null)
        .order("nome")
        .limit(2000);
      if (error) throw error;
      return (data ?? []).flatMap((c) => {
        const numero = telefoneWhatsApp(c.whatsapp || c.telefone);
        const pets = (c.pets ?? []).filter((p) => p.ativo && !p.obito).map((p) => p.nome);
        return numero && pets.length ? [{ id: c.id, nome: c.nome, numero, pets }] : [];
      });
    },
  });
  const historico = useQuery({
    queryKey: ["campanha-historico"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clinica_wa_campanha_envios")
        .select("id,tutor,numero,situacao,erro,created_at,texto")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data ?? [];
    },
  });

  const lista = useMemo(() => {
    const b = busca.trim().toLowerCase();
    return (tutores.data ?? []).filter(
      (t) =>
        !b || t.nome.toLowerCase().includes(b) || t.pets.some((p) => p.toLowerCase().includes(b)),
    );
  }, [tutores.data, busca]);
  const escolhidos = (tutores.data ?? []).filter((t) => sel.includes(t.id));
  const previa = escolhidos[0]
    ? textoCampanha(
        escolhido?.texto ?? "",
        { tutor: escolhidos[0].nome, pets: escolhidos[0].pets },
        "sua clínica",
      )
    : "";
  const erro = escolhido
    ? validarCampanha(escolhido.texto, sel.length)
    : "Escolha uma mensagem aprovada.";

  function alternar(id: string) {
    setSel((s) =>
      s.includes(id)
        ? s.filter((x) => x !== id)
        : s.length >= MAX_CAMPANHA
          ? (toast.error(`Máximo de ${MAX_CAMPANHA} tutores por envio.`), s)
          : [...s, id],
    );
  }

  async function disparar() {
    if (erro) {
      toast.error(erro);
      return;
    }
    if (!window.confirm(`Enviar a mensagem de verdade para ${sel.length} tutor(es)?`)) return;
    const campanhaId = crypto.randomUUID();
    const alvo = [...sel];
    const contagem = { enviada: 0, falhou: 0, incerto: 0 } as Record<
      "enviada" | "falhou" | "incerto",
      number
    >;
    setProgresso({ feito: 0, total: alvo.length });
    for (let i = 0; i < alvo.length; i++) {
      if (i > 0) await espera(PAUSA_CAMPANHA_MS + Math.floor(Math.random() * 2000));
      try {
        const r = await enviar({ data: { campanhaId, clienteId: alvo[i]!, modeloId } });
        if (r.situacao in contagem) contagem[r.situacao as "enviada"] += 1;
      } catch (e) {
        contagem.falhou += 1;
        toast.error(e instanceof Error ? e.message : "Falha no envio");
      }
      setProgresso({ feito: i + 1, total: alvo.length });
      void qc.invalidateQueries({ queryKey: ["campanha-historico"] });
    }
    setProgresso(null);
    setSel([]);
    toast.success(
      `Campanha concluída: ${contagem.enviada ?? 0} enviada(s), ${contagem.falhou + contagem.incerto} com problema.`,
    );
  }

  const inserir = (tag: string) => setModelo((m) => `${m}${m.endsWith(" ") ? "" : " "}${tag}`);
  const enviando = progresso !== null;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Campanhas de WhatsApp"
        description={`Selecione até ${MAX_CAMPANHA} tutores por envio e escolha uma mensagem aprovada. Só aparecem tutores que aceitam mensagens e têm WhatsApp.`}
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="panel space-y-3 p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-semibold">1. Destinatários</h2>
            <span className="text-sm font-medium text-primary">
              {sel.length} de {MAX_CAMPANHA} selecionados
            </span>
          </div>
          <Input
            placeholder="Buscar tutor ou pet"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
          <div className="max-h-[420px] divide-y overflow-y-auto rounded-md border">
            {tutores.isLoading && <p className="p-3 text-sm text-muted-foreground">Carregando…</p>}
            {!tutores.isLoading && lista.length === 0 && (
              <p className="p-3 text-sm text-muted-foreground">Nenhum tutor encontrado.</p>
            )}
            {lista.map((t) => (
              <label
                key={t.id}
                className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-muted/50"
              >
                <Checkbox
                  checked={sel.includes(t.id)}
                  onCheckedChange={() => alternar(t.id)}
                  disabled={enviando}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{t.nome}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {t.pets.join(", ")} · +{t.numero}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </section>
        <section className="panel space-y-3 p-4">
          <h2 className="font-semibold">2. Mensagem</h2>
          <Label htmlFor="modelo-aprovado">Mensagem aprovada</Label>
          <select
            id="modelo-aprovado"
            className="h-10 w-full rounded-md border bg-background px-3 text-sm"
            value={modeloId}
            onChange={(e) => setModeloId(e.target.value)}
            disabled={enviando}
          >
            <option value="">Selecione…</option>
            {(modelos.data ?? []).map((m) => (
              <option key={m.id} value={m.id}>
                {m.titulo}
              </option>
            ))}
          </select>
          {(modelos.data ?? []).length === 0 && (
            <p className="text-xs text-muted-foreground">
              Nenhuma mensagem aprovada. Administrador ou gestor aprova as mensagens abaixo.
            </p>
          )}
          {aprovador.data && modeloId && (
            <Button type="button" size="sm" variant="outline" onClick={desativarModelo}>
              Desativar esta mensagem
            </Button>
          )}
          {aprovador.data && (
            <details className="rounded-md border p-3">
              <summary className="cursor-pointer text-sm font-medium">
                Aprovar nova mensagem
              </summary>
              <div className="mt-3 space-y-3">
                <Input
                  placeholder="Título (ex.: Campanha de vacinação)"
                  maxLength={80}
                  value={titulo}
                  onChange={(e) => setTitulo(e.target.value)}
                />
                <div className="flex flex-wrap gap-2">
                  {["{tutor}", "{pet}", "{clinica}"].map((t) => (
                    <Button
                      key={t}
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => inserir(t)}
                      disabled={enviando}
                    >
                      {t}
                    </Button>
                  ))}
                </div>
                <Label htmlFor="texto-campanha" className="sr-only">
                  Mensagem
                </Label>
                <Textarea
                  id="texto-campanha"
                  rows={6}
                  maxLength={MAX_TEXTO_CAMPANHA}
                  value={modelo}
                  onChange={(e) => setModelo(e.target.value)}
                  disabled={enviando}
                />
                <p className="text-xs text-muted-foreground">
                  {modelo.length}/{MAX_TEXTO_CAMPANHA} caracteres
                </p>
                <Button type="button" size="sm" onClick={aprovarModelo}>
                  Aprovar mensagem
                </Button>
              </div>
            </details>
          )}
          {previa && (
            <div className="rounded-md border bg-muted/40 p-3 text-sm">
              <p className="mb-1 text-xs font-semibold text-muted-foreground">
                Prévia para {escolhidos[0]!.nome}
              </p>
              <p className="whitespace-pre-wrap">{previa}</p>
            </div>
          )}
          <h2 className="font-semibold">3. Envio</h2>
          {progresso && (
            <p className="text-sm font-medium text-primary">
              Enviando {progresso.feito} de {progresso.total}… mantenha a tela aberta.
            </p>
          )}
          <Button onClick={disparar} disabled={enviando || !!erro} className="w-full">
            <Send className="size-4" /> Enviar para {sel.length} tutor(es)
          </Button>
        </section>
      </div>
      <section className="panel p-4">
        <h2 className="mb-2 font-semibold">Últimos envios</h2>
        <div className="divide-y text-sm">
          {(historico.data ?? []).length === 0 && (
            <p className="py-2 text-muted-foreground">Nenhuma campanha enviada ainda.</p>
          )}
          {(historico.data ?? []).map((h) => (
            <div
              key={h.id}
              className="grid gap-1 py-2 sm:grid-cols-[1fr_auto_auto] sm:items-center sm:gap-4"
            >
              <span className="min-w-0 truncate" title={h.texto}>
                <b>{h.tutor}</b> · +{h.numero}
              </span>
              <span
                className={
                  h.situacao === "enviada"
                    ? "text-primary"
                    : h.situacao === "enviando"
                      ? ""
                      : "text-destructive"
                }
                title={h.erro ?? ""}
              >
                {ROTULO[h.situacao] ?? h.situacao}
              </span>
              <span className="text-xs text-muted-foreground">{dateTimeBR(h.created_at)}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
