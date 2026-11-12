import { useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Pencil } from "lucide-react";
import { toast } from "sonner";

import { ModuloBloqueado } from "@/components/app/ModuloCnae";
import { EmptyState } from "@/components/app/PageHeader";
import { BotaoFavoritoBulario } from "@/components/app/FavoritosBulario";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useSessionData } from "@/hooks/useSessionData";
import { supabase } from "@/integrations/supabase/client";
import {
  FONTE_MAPA,
  SECOES_CLINICA,
  agruparExtras,
  dividirLista,
  registroInativo,
  type CampoNota,
  type FichaBulario,
  type NotaBulario,
} from "@/lib/bulario";
import { useModulosCnae } from "@/lib/cnae";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/clinica-bulario/$id")({
  head: () => ({
    meta: [
      { title: "Medicamento — Bulário veterinário — EZRA ERP" },
      {
        name: "description",
        content: "Ficha do produto veterinário registrado no MAPA, com as anotações da clínica.",
      },
    ],
  }),
  component: FichaModulo,
});

function FichaModulo() {
  const modulos = useModulosCnae();
  if (modulos.carregando) return <div className="panel h-40 animate-pulse" />;
  if (!modulos.clinica) return <ModuloBloqueado modulo="clinica" />;
  return <Ficha />;
}

type Secao = "sobre" | CampoNota;

function Bloco({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {titulo}
      </h3>
      <div className="text-sm leading-relaxed">{children}</div>
    </section>
  );
}

function Ficha() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const { data: sessao } = useSessionData();
  const podeCadastrar = (sessao?.roles ?? []).some((r) => ["administrador", "gestor"].includes(r));
  const [secao, setSecao] = useState<Secao>("sobre");
  const [editando, setEditando] = useState<CampoNota | null>(null);
  const [texto, setTexto] = useState("");

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["bulario-ficha", id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("bulario_ficha", { p_id: id });
      if (error) throw error;
      return data as unknown as FichaBulario;
    },
  });

  // produtos da própria empresa com nome parecido (RLS): evita cadastrar em duplicidade
  const nome = data?.medicamento.nome ?? "";
  const { data: parecidos = [] } = useQuery({
    queryKey: ["bulario-parecidos", id],
    enabled: !!nome && podeCadastrar,
    queryFn: async () => {
      const termo = nome.replace(/[%_,()]/g, " ").trim();
      const { data, error } = await supabase
        .from("produtos")
        .select("id, descricao")
        .ilike("descricao", `%${termo}%`)
        .limit(5);
      if (error) throw error;
      return data ?? [];
    },
  });

  const salvar = useMutation({
    mutationFn: async () => {
      if (!editando) return;
      const atual: Partial<NotaBulario> = data?.nota ?? {};
      const dados: Record<string, string | null> = {};
      for (const s of SECOES_CLINICA) dados[s.campo] = atual[s.campo] ?? null;
      dados[editando] = texto;
      const { error } = await supabase.rpc("bulario_nota_salvar", { p_id: id, p_dados: dados });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Anotação salva");
      setEditando(null);
      void qc.invalidateQueries({ queryKey: ["bulario-ficha", id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <div className="panel h-40 animate-pulse" />;
  if (isError || !data) {
    return (
      <EmptyState
        title="Medicamento não encontrado"
        {...(error instanceof Error ? { description: error.message } : {})}
        action={
          <Button asChild variant="outline">
            <Link to="/clinica-bulario">Voltar ao bulário</Link>
          </Button>
        }
      />
    );
  }

  const m = data.medicamento;
  const nota = data.nota;
  const ex = agruparExtras(m.extras);
  const principios = dividirLista(m.principio_ativo);
  const inativo = registroInativo(m.situacao);
  const secaoClinica = SECOES_CLINICA.find((s) => s.campo === secao);

  return (
    <div className="space-y-4">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link to="/clinica-bulario">
          <ArrowLeft className="mr-1 size-4" /> Bulário
        </Link>
      </Button>

      <header className="space-y-1">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h1 className="text-2xl font-semibold">{m.nome}</h1>
          <BotaoFavoritoBulario medicamentoId={id} />
        </div>
        {m.fabricante && (
          <p className="text-xs font-semibold uppercase text-muted-foreground">{m.fabricante}</p>
        )}
        <p className="text-sm text-muted-foreground">
          {m.classificacao && (
            <>
              Classificação: <span className="text-foreground">{m.classificacao}</span>
            </>
          )}
          {m.classificacao && m.especies && " · "}
          {m.especies && (
            <>
              Espécies: <span className="text-foreground">{m.especies}</span>
            </>
          )}
        </p>
        {inativo && (
          <Badge variant="destructive">Registro {m.situacao?.toLowerCase()} no MAPA</Badge>
        )}
      </header>

      <div className="grid gap-6 md:grid-cols-[18rem_1fr]">
        <nav aria-label="Seções do medicamento" className="panel h-fit overflow-hidden p-0">
          {(
            [
              { chave: "sobre" as Secao, titulo: "Sobre", cheia: true },
              ...SECOES_CLINICA.map((s) => ({
                chave: s.campo as Secao,
                titulo: s.titulo,
                cheia: !!nota?.[s.campo],
              })),
            ] as { chave: Secao; titulo: string; cheia: boolean }[]
          ).map((i) => (
            <button
              key={i.chave}
              type="button"
              onClick={() => setSecao(i.chave)}
              aria-current={secao === i.chave ? "page" : undefined}
              className={cn(
                "block w-full border-b px-4 py-3 text-left text-sm last:border-b-0",
                secao === i.chave ? "bg-accent font-medium" : "hover:bg-accent/50",
                !i.cheia && secao !== i.chave && "text-muted-foreground",
              )}
            >
              {i.titulo}
            </button>
          ))}
        </nav>

        <div className="space-y-5">
          {secao === "sobre" && (
            <>
              <h2 className="text-lg font-semibold">Sobre</h2>
              {principios.length > 0 && (
                <Bloco titulo="Princípio(s) ativo(s)">
                  <ul className="space-y-1">
                    {principios.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                </Bloco>
              )}
              {ex.composicao && (
                <Bloco titulo="Composição">
                  <p className="whitespace-pre-wrap">{ex.composicao}</p>
                </Bloco>
              )}
              {ex.armazenamento && (
                <Bloco titulo="Armazenamento">
                  <p className="whitespace-pre-wrap">{ex.armazenamento}</p>
                </Bloco>
              )}
              {ex.carencia && (
                <Bloco titulo="Tempo de carência">
                  <p className="whitespace-pre-wrap">{ex.carencia}</p>
                </Bloco>
              )}
              {(m.registro || m.situacao) && (
                <Bloco titulo="Registro no MAPA">
                  <p>
                    {m.registro && <>Nº {m.registro}</>}
                    {m.registro && m.situacao && " · "}
                    {m.situacao}
                  </p>
                </Bloco>
              )}
              {ex.responsavel && (
                <Bloco titulo="Responsável técnico">
                  <p className="whitespace-pre-wrap">{ex.responsavel}</p>
                </Bloco>
              )}
              {ex.outros.length > 0 && (
                <Bloco titulo="Outras informações do registro">
                  <dl className="space-y-1">
                    {ex.outros.map(([k, v]) => (
                      <div key={k} className="grid grid-cols-3 gap-2">
                        <dt className="text-muted-foreground">{k}</dt>
                        <dd className="col-span-2">{v}</dd>
                      </div>
                    ))}
                  </dl>
                </Bloco>
              )}

              {podeCadastrar && (
                <div className="space-y-2 border-t pt-4">
                  {parecidos.length > 0 && (
                    <p className="text-sm">
                      Já no seu cadastro: {parecidos.map((p) => p.descricao).join("; ")}.
                    </p>
                  )}
                  <Button asChild variant="outline">
                    <Link
                      to="/produtos"
                      search={{ novo: m.nome, ...(m.fabricante ? { fab: m.fabricante } : {}) }}
                    >
                      Cadastrar no estoque
                    </Link>
                  </Button>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Fonte: {FONTE_MAPA}. Consulta de referência: não substitui a bula nem o juízo do
                veterinário.
              </p>
            </>
          )}

          {secaoClinica && (
            <>
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-lg font-semibold">{secaoClinica.titulo}</h2>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setTexto(nota?.[secaoClinica.campo] ?? "");
                    setEditando(secaoClinica.campo);
                  }}
                >
                  <Pencil className="mr-2 size-4" />{" "}
                  {nota?.[secaoClinica.campo] ? "Editar" : "Escrever"}
                </Button>
              </div>
              {nota?.[secaoClinica.campo] ? (
                <p className="whitespace-pre-wrap text-sm leading-relaxed">
                  {nota[secaoClinica.campo]}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Ninguém da sua clínica escreveu esta seção ainda. {secaoClinica.dica}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Anotação da sua clínica, visível só para ela. Não vem do MAPA e não preenche receita
                nem estoque sozinha.
              </p>
            </>
          )}
        </div>
      </div>

      <Dialog open={!!editando} onOpenChange={(o) => !o && setEditando(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {SECOES_CLINICA.find((s) => s.campo === editando)?.titulo} — {m.nome}
            </DialogTitle>
          </DialogHeader>
          <Textarea
            rows={10}
            maxLength={6000}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder={SECOES_CLINICA.find((s) => s.campo === editando)?.dica}
            aria-label="Texto da seção"
          />
          <p className="text-xs text-muted-foreground">
            Escreva com as palavras da sua clínica ou conforme a bula do fabricante. Deixe em branco
            para apagar.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditando(null)}>
              Cancelar
            </Button>
            <Button disabled={salvar.isPending} onClick={() => salvar.mutate()}>
              {salvar.isPending ? "Salvando…" : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
