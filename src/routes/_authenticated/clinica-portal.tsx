import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { ModuloBloqueado } from "@/components/app/ModuloCnae";
import { EmptyState, PageHeader } from "@/components/app/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useSessionData } from "@/hooks/useSessionData";
import { supabase } from "@/integrations/supabase/client";
import { useModulosCnae } from "@/lib/cnae";
import { dateTimeBR } from "@/lib/format";
import { linkDoConvite, mensagemConvite } from "@/lib/portal-tutor";

export const Route = createFileRoute("/_authenticated/clinica-portal")({
  head: () => ({
    meta: [
      { title: "Portal do tutor — EZRA ERP" },
      {
        name: "description",
        content: "Convites e acessos dos tutores e o que o veterinário libera para eles verem.",
      },
    ],
  }),
  component: PortalModulo,
});

function PortalModulo() {
  const modulos = useModulosCnae();
  if (modulos.carregando) return <div className="panel h-40 animate-pulse" />;
  if (!modulos.clinica) return <ModuloBloqueado modulo="clinica" />;
  return <PortalClinica />;
}

function PortalClinica() {
  const { data: sessao } = useSessionData();
  const roles = sessao?.roles ?? [];
  const gerenciaAcessos = roles.some((r) =>
    ["administrador", "gestor", "vendedor", "caixa"].includes(r),
  );
  const souVet = roles.includes("veterinario");

  return (
    <div className="space-y-8">
      <PageHeader
        title="Portal do tutor"
        description="O tutor entra com conta própria, vinculada ao cadastro dele por um convite da recepção, e vê só o que o veterinário liberar e as próximas vacinas. Nada é enviado pelo sistema: a recepção entrega o código."
      />
      {gerenciaAcessos && (
        <AcessosTutores
          clinica={sessao?.empresa?.nome_fantasia || sessao?.empresa?.razao_social || "a clínica"}
        />
      )}
      {souVet && <Liberacoes />}
      {!gerenciaAcessos && !souVet && (
        <EmptyState
          title="Sem acesso a esta tela"
          description="Convites e acessos são da recepção e da gestão; liberar exames e receitas é do veterinário."
        />
      )}
    </div>
  );
}

// ============ recepção e gestão: convites e acessos ============

type Tutor = { id: string; nome: string; telefone: string | null };
type Convite = {
  id: string;
  cliente_id: string;
  cliente: string;
  created_at: string;
  expira_em: string;
  estado: "pendente" | "usado" | "vencido" | "revogado";
};
type Vinculo = {
  id: string;
  cliente_id: string;
  cliente: string;
  created_at: string;
  email: string | null;
  ativo: boolean;
  revogado_em: string | null;
  ultima_consulta: string | null;
};
type Acessos = { convites: Convite[]; vinculos: Vinculo[] };
type ConviteNovo = { codigo: string; expira_em: string; tutor: string };

const ROTULO_CONVITE = {
  pendente: "Pendente",
  usado: "Usado",
  vencido: "Vencido",
  revogado: "Revogado",
} as const;

function AcessosTutores({ clinica }: { clinica: string }) {
  const qc = useQueryClient();
  const [busca, setBusca] = useState("");
  const [tutor, setTutor] = useState<Tutor | null>(null);
  const [novo, setNovo] = useState<ConviteNovo | null>(null);
  const [revogando, setRevogando] = useState<Vinculo | null>(null);

  const termo = busca.trim();
  const tutores = useQuery({
    queryKey: ["clinica-portal-tutores", termo],
    enabled: termo.length >= 2 && !tutor,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clientes")
        .select("id, nome, telefone")
        .ilike("nome", `%${termo.replace(/[%_,()]/g, " ")}%`)
        .order("nome")
        .limit(20);
      if (error) throw error;
      return (data ?? []) as Tutor[];
    },
  });

  const acessos = useQuery({
    queryKey: ["clinica-portal-acessos", tutor?.id ?? "todos"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("clinica_portal_acessos", {
        p_cliente_id: tutor?.id ?? undefined,
      });
      if (error) throw error;
      return data as unknown as Acessos;
    },
  });

  const recarregar = () => void qc.invalidateQueries({ queryKey: ["clinica-portal-acessos"] });

  const criar = useMutation({
    mutationFn: async (t: Tutor) => {
      const { data, error } = await supabase.rpc("clinica_portal_convite_criar", {
        p_cliente_id: t.id,
      });
      if (error) throw error;
      const r = data as unknown as { codigo: string; expira_em: string };
      return { codigo: r.codigo, expira_em: r.expira_em, tutor: t.nome } satisfies ConviteNovo;
    },
    onSuccess: (r) => {
      setNovo(r);
      recarregar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const revogarConvite = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("clinica_portal_convite_revogar", { p_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Convite revogado");
      recarregar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <section aria-labelledby="pc-acessos" className="space-y-4">
      <h2 id="pc-acessos" className="text-base font-semibold">
        Acessos dos tutores
      </h2>

      <div className="panel space-y-3 p-4">
        {tutor ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm">
              Tutor: <strong>{tutor.nome}</strong>
            </p>
            <div className="flex gap-2">
              <Button disabled={criar.isPending} onClick={() => criar.mutate(tutor)}>
                {criar.isPending ? "Gerando…" : "Gerar convite"}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setTutor(null);
                  setBusca("");
                }}
              >
                Trocar tutor
              </Button>
            </div>
          </div>
        ) : (
          <div>
            <Label htmlFor="pc-busca">Buscar tutor pelo nome</Label>
            <Input
              id="pc-busca"
              placeholder="Digite ao menos 2 letras"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
            {termo.length >= 2 && (
              <ul className="mt-2 divide-y divide-border text-sm" aria-label="Tutores encontrados">
                {(tutores.data ?? []).map((t) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      className="w-full py-2 text-left hover:bg-muted"
                      onClick={() => setTutor(t)}
                    >
                      {t.nome}
                      {t.telefone ? (
                        <span className="text-xs text-muted-foreground"> · {t.telefone}</span>
                      ) : null}
                    </button>
                  </li>
                ))}
                {tutores.data?.length === 0 && (
                  <li className="py-2 text-muted-foreground">Nenhum tutor encontrado.</li>
                )}
              </ul>
            )}
          </div>
        )}
      </div>

      {acessos.isLoading ? (
        <div className="panel h-20 animate-pulse" />
      ) : acessos.isError ? (
        <p className="text-sm text-destructive" role="alert">
          Não foi possível carregar os acessos: {(acessos.error as Error).message}
        </p>
      ) : (
        <>
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Acessos ativos e revogados</h3>
            {(acessos.data?.vinculos ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum tutor vinculado ainda.</p>
            ) : (
              <ul className="space-y-2">
                {acessos.data!.vinculos.map((v) => (
                  <li
                    key={v.id}
                    className="panel flex flex-wrap items-start justify-between gap-2 p-3 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="break-words font-medium">
                        {v.cliente}{" "}
                        {v.ativo ? (
                          <Badge variant="secondary">Ativo</Badge>
                        ) : (
                          <Badge variant="outline">Revogado</Badge>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Conta {v.email ?? "—"} · vinculada em {dateTimeBR(v.created_at)} ·{" "}
                        {v.ultima_consulta
                          ? `última consulta em ${dateTimeBR(v.ultima_consulta)}`
                          : "ainda não consultou nada"}
                        {v.revogado_em ? ` · revogado em ${dateTimeBR(v.revogado_em)}` : ""}
                      </p>
                    </div>
                    {v.ativo && (
                      <Button size="sm" variant="outline" onClick={() => setRevogando(v)}>
                        Revogar acesso
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Convites</h3>
            {(acessos.data?.convites ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum convite gerado.</p>
            ) : (
              <ul className="space-y-2">
                {acessos.data!.convites.map((c) => (
                  <li
                    key={c.id}
                    className="panel flex flex-wrap items-center justify-between gap-2 p-3 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="break-words">
                        {c.cliente}{" "}
                        <Badge variant={c.estado === "pendente" ? "secondary" : "outline"}>
                          {ROTULO_CONVITE[c.estado]}
                        </Badge>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Gerado em {dateTimeBR(c.created_at)} · vale até {dateTimeBR(c.expira_em)}
                      </p>
                    </div>
                    {c.estado === "pendente" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={revogarConvite.isPending}
                        onClick={() => revogarConvite.mutate(c.id)}
                      >
                        Revogar
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}

      {novo && <ConviteDialog convite={novo} clinica={clinica} aoFechar={() => setNovo(null)} />}
      {revogando && (
        <RevogarDialog
          vinculo={revogando}
          aoFechar={() => setRevogando(null)}
          aoSalvar={() => {
            setRevogando(null);
            recarregar();
          }}
        />
      )}
    </section>
  );
}

async function copiar(texto: string, aviso: string) {
  try {
    await navigator.clipboard.writeText(texto);
    toast.success(aviso);
  } catch {
    toast.error("Não foi possível copiar. Selecione o texto e copie manualmente.");
  }
}

function ConviteDialog({
  convite,
  clinica,
  aoFechar,
}: {
  convite: ConviteNovo;
  clinica: string;
  aoFechar: () => void;
}) {
  const link = linkDoConvite(window.location.origin, convite.codigo);
  const mensagem = mensagemConvite({
    clinica,
    tutor: convite.tutor,
    codigo: convite.codigo,
    link,
    expiraEm: convite.expira_em,
  });
  return (
    <Dialog open onOpenChange={(o) => !o && aoFechar()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Convite de {convite.tutor}</DialogTitle>
          <DialogDescription>
            Este código aparece só agora e não fica guardado: se perder, gere outro. O sistema não
            envia nada: entregue ao tutor pessoalmente ou por um canal que a clínica escolher.
          </DialogDescription>
        </DialogHeader>
        <p
          className="break-all rounded-md bg-muted p-3 text-center font-mono text-xl tracking-wider"
          aria-label="Código do convite"
        >
          {convite.codigo}
        </p>
        <p className="text-xs text-muted-foreground">
          Vale até {dateTimeBR(convite.expira_em)} e só pode ser usado uma vez.
        </p>
        <Textarea readOnly rows={6} value={mensagem} aria-label="Mensagem pronta para o tutor" />
        <DialogFooter className="flex-wrap gap-2">
          <Button variant="outline" onClick={() => void copiar(convite.codigo, "Código copiado")}>
            Copiar código
          </Button>
          <Button onClick={() => void copiar(mensagem, "Mensagem copiada")}>Copiar mensagem</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RevogarDialog({
  vinculo,
  aoFechar,
  aoSalvar,
}: {
  vinculo: Vinculo;
  aoFechar: () => void;
  aoSalvar: () => void;
}) {
  const [motivo, setMotivo] = useState("");
  const salvar = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("clinica_portal_vinculo_revogar", {
        p_id: vinculo.id,
        p_motivo: motivo.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Acesso revogado");
      aoSalvar();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && aoFechar()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Revogar acesso de {vinculo.cliente}</DialogTitle>
          <DialogDescription>
            A conta deixa de ver os animais deste cadastro na próxima consulta. Para devolver o
            acesso, gere um novo convite.
          </DialogDescription>
        </DialogHeader>
        <div>
          <Label htmlFor="pc-motivo">Motivo (obrigatório)</Label>
          <Textarea
            id="pc-motivo"
            rows={2}
            maxLength={300}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={aoFechar}>
            Cancelar
          </Button>
          <Button
            variant="destructive"
            disabled={motivo.trim().length < 3 || salvar.isPending}
            onClick={() => salvar.mutate()}
          >
            {salvar.isPending ? "Revogando…" : "Revogar acesso"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============ veterinário: o que o tutor pode ver ============

type Paciente = { id: string; nome: string; especie: string; raca: string | null; tutor: string };
type ItemExame = {
  id: string;
  nome: string;
  data_coleta: string;
  liberado: boolean;
  liberado_em: string | null;
  ultima_consulta: string | null;
};
type ItemReceita = {
  id: string;
  titulo: string;
  numero: number;
  ano: number;
  emitido_em: string;
  situacao: "emitido" | "cancelado";
  liberado: boolean;
  liberado_em: string | null;
  ultima_consulta: string | null;
};
type ItensDoPet = { tutor_com_acesso: boolean; exames: ItemExame[]; receitas: ItemReceita[] };

function Liberacoes() {
  const qc = useQueryClient();
  const [busca, setBusca] = useState("");
  const [pet, setPet] = useState<Paciente | null>(null);
  const termo = busca.trim();

  const pacientes = useQuery({
    queryKey: ["clinica-portal-pacientes", termo],
    enabled: termo.length >= 2 && !pet,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("clinica_pacientes", { p_busca: termo });
      if (error) throw error;
      return (data ?? []) as unknown as Paciente[];
    },
  });

  const itens = useQuery({
    queryKey: ["clinica-portal-itens", pet?.id],
    enabled: !!pet,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("clinica_portal_itens_do_pet", {
        p_pet_id: pet!.id,
      });
      if (error) throw error;
      return data as unknown as ItensDoPet;
    },
  });

  const alterar = useMutation({
    mutationFn: async (p: { tipo: "exame" | "documento"; id: string; liberar: boolean }) => {
      const { error } = p.liberar
        ? await supabase.rpc("clinica_portal_liberar", { p_tipo: p.tipo, p_ref_id: p.id })
        : await supabase.rpc("clinica_portal_retirar", { p_tipo: p.tipo, p_ref_id: p.id });
      if (error) throw error;
    },
    onSuccess: (_r, p) => {
      toast.success(p.liberar ? "Liberado ao tutor" : "Retirado do portal");
      void qc.invalidateQueries({ queryKey: ["clinica-portal-itens", pet?.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const d = itens.data;

  return (
    <section aria-labelledby="pc-liberar" className="space-y-4">
      <h2 id="pc-liberar" className="text-base font-semibold">
        Liberar ao tutor
      </h2>
      <p className="text-sm text-muted-foreground">
        Libere só o que o tutor deve ver. Exames precisam estar fechados e só receitas emitidas
        podem ser liberadas. As próximas vacinas aparecem sem liberação.
      </p>

      <div className="panel space-y-3 p-4">
        {pet ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm">
              Animal: <strong>{pet.nome}</strong> · tutor(a) {pet.tutor}
            </p>
            <Button
              variant="outline"
              onClick={() => {
                setPet(null);
                setBusca("");
              }}
            >
              Trocar animal
            </Button>
          </div>
        ) : (
          <div>
            <Label htmlFor="pc-pet">Buscar animal ou tutor</Label>
            <Input
              id="pc-pet"
              placeholder="Digite ao menos 2 letras"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
            {termo.length >= 2 && (
              <ul className="mt-2 divide-y divide-border text-sm" aria-label="Animais encontrados">
                {(pacientes.data ?? []).map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      className="w-full py-2 text-left hover:bg-muted"
                      onClick={() => setPet(p)}
                    >
                      {p.nome}{" "}
                      <span className="text-xs text-muted-foreground">· tutor(a) {p.tutor}</span>
                    </button>
                  </li>
                ))}
                {pacientes.data?.length === 0 && (
                  <li className="py-2 text-muted-foreground">Nenhum animal encontrado.</li>
                )}
              </ul>
            )}
          </div>
        )}
      </div>

      {pet &&
        (itens.isLoading ? (
          <div className="panel h-20 animate-pulse" />
        ) : itens.isError || !d ? (
          <p className="text-sm text-destructive" role="alert">
            Não foi possível carregar os itens: {(itens.error as Error | null)?.message}
          </p>
        ) : (
          <>
            {!d.tutor_com_acesso && (
              <p className="panel p-3 text-sm" role="status">
                O tutor deste animal ainda não tem acesso ao portal. Peça à recepção para gerar um
                convite; o que você liberar ficará esperando por ele.
              </p>
            )}
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">Exames fechados</h3>
              {d.exames.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum exame fechado.</p>
              ) : (
                <ul className="space-y-2">
                  {d.exames.map((e) => (
                    <LinhaLiberacao
                      key={e.id}
                      titulo={e.nome}
                      detalhe={`Coleta em ${new Date(`${e.data_coleta}T00:00:00`).toLocaleDateString("pt-BR")}`}
                      liberado={e.liberado}
                      liberadoEm={e.liberado_em}
                      consulta={e.ultima_consulta}
                      ocupado={alterar.isPending}
                      aoAlterar={(liberar) => alterar.mutate({ tipo: "exame", id: e.id, liberar })}
                    />
                  ))}
                </ul>
              )}
            </div>
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">Receitas</h3>
              {d.receitas.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhuma receita.</p>
              ) : (
                <ul className="space-y-2">
                  {d.receitas.map((r) => (
                    <LinhaLiberacao
                      key={r.id}
                      titulo={r.titulo}
                      detalhe={`Nº ${r.numero}/${r.ano} · emitida em ${dateTimeBR(r.emitido_em)}`}
                      cancelada={r.situacao === "cancelado"}
                      liberado={r.liberado}
                      liberadoEm={r.liberado_em}
                      consulta={r.ultima_consulta}
                      ocupado={alterar.isPending}
                      aoAlterar={(liberar) =>
                        alterar.mutate({ tipo: "documento", id: r.id, liberar })
                      }
                    />
                  ))}
                </ul>
              )}
            </div>
          </>
        ))}
    </section>
  );
}

function LinhaLiberacao(p: {
  titulo: string;
  detalhe: string;
  liberado: boolean;
  liberadoEm: string | null;
  consulta: string | null;
  cancelada?: boolean;
  ocupado: boolean;
  aoAlterar: (liberar: boolean) => void;
}) {
  return (
    <li className="panel flex flex-wrap items-start justify-between gap-2 p-3 text-sm">
      <div className="min-w-0">
        <p className="break-words font-medium">
          {p.titulo} {p.cancelada && <Badge variant="destructive">Cancelada</Badge>}
        </p>
        <p className="text-xs text-muted-foreground">{p.detalhe}</p>
        <p className="text-xs text-muted-foreground">
          {p.liberado ? `Liberado em ${dateTimeBR(p.liberadoEm)}` : "Não liberado"}
          {p.liberado &&
            (p.consulta
              ? ` · visto pelo tutor em ${dateTimeBR(p.consulta)}`
              : " · ainda não visto pelo tutor")}
        </p>
      </div>
      {p.liberado ? (
        <Button size="sm" variant="outline" disabled={p.ocupado} onClick={() => p.aoAlterar(false)}>
          Retirar do portal
        </Button>
      ) : (
        !p.cancelada && (
          <Button size="sm" disabled={p.ocupado} onClick={() => p.aoAlterar(true)}>
            Liberar ao tutor
          </Button>
        )
      )}
    </li>
  );
}
