import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FilePlus2, FlaskConical, Plus, Printer, Trash2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { CampoMedicamento } from "@/components/app/CampoMedicamento";
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
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import {
  CAMPOS_DOCUMENTO,
  MODELOS_INICIAIS,
  TIPOS_DOCUMENTO,
  dataPorExtenso,
  faltaParaEmitir,
  itemReceitaVazio,
  marcadoresPendentes,
  montarTextoDocumento,
  modelosReceitaDaResposta,
  numeroDoDocumento,
  type ItemExame,
  type ItemReceita,
  type ModeloReceita,
  type ModeloDocumento,
  type ResumoDocumento,
  type TipoDocumento,
} from "@/lib/documentos-clinica";
import { dateTimeBR } from "@/lib/format";
import { hojeISO } from "@/lib/financeiro";
import { ESPECIES, rotulo } from "@/lib/pet";

type Contexto = {
  veterinario: { id: string; nome: string; crmv: string; crmv_uf: string };
  clinica: string | null;
  modelos: (ModeloDocumento & { id: string })[];
};

type ItemReceitaForm = ItemReceita & { controlado: boolean };

const TITULO_PADRAO: Record<TipoDocumento, string> = {
  receita: "Receita",
  atestado: "Atestado",
  termo: "Termo de consentimento",
  solicitacao_exame: "Solicitação de exames",
};

/**
 * Receita, atestado, termo de consentimento e solicitação de exames do paciente. Só o veterinário emite e lê.
 * Documento emitido não se altera: errou, cancela (com motivo) e emite outro. Sem assinatura digital: imprime e assina.
 */
export function DocumentosClinicos({
  petId,
  atendimentoId,
  pet,
  tutor,
  pedidoSolicitacao = 0,
}: {
  petId: string;
  atendimentoId?: string;
  pet: { nome: string; especie: string; raca: string | null };
  tutor: string;
  /** Cada aumento abre a solicitação de exames (botão "Solicitar exames" fora do quadro). */
  pedidoSolicitacao?: number;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [novo, setNovo] = useState<TipoDocumento | null>(null);
  useEffect(() => {
    if (pedidoSolicitacao > 0) setNovo("solicitacao_exame");
  }, [pedidoSolicitacao]);
  const [cancelando, setCancelando] = useState<ResumoDocumento | null>(null);
  const [motivo, setMotivo] = useState("");

  const chave = ["clinica-documentos", petId, atendimentoId ?? null];
  const lista = useQuery({
    queryKey: chave,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("clinica_documentos_do_pet", {
        p_pet_id: petId,
        ...(atendimentoId ? { p_atendimento_id: atendimentoId } : {}),
      });
      if (error) throw error;
      return (data ?? []) as unknown as ResumoDocumento[];
    },
  });

  /** Fechar por qualquer caminho (Voltar, Esc, fora da janela) apaga o motivo: o próximo cancelamento começa em branco. */
  function fecharCancelamento() {
    setCancelando(null);
    setMotivo("");
  }

  const cancelar = useMutation({
    mutationFn: async () => {
      if (!cancelando) return;
      const { error } = await supabase.rpc("clinica_documento_cancelar", {
        p_id: cancelando.id,
        p_motivo: motivo,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Documento cancelado");
      fecharCancelamento();
      void qc.invalidateQueries({ queryKey: ["clinica-documentos"] });
    },
    onError: (e: Error) => toast.error("Não foi possível cancelar", { description: e.message }),
  });

  return (
    <div className="panel p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 font-display text-sm font-semibold">
          <FilePlus2 className="size-4" /> Documentos
        </p>
        <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => setNovo("solicitacao_exame")}>
          <FlaskConical className="size-4" /> Solicitar exames
        </Button>
        <Select value="" onValueChange={(v) => setNovo(v as TipoDocumento)}>
          <SelectTrigger className="w-56">
            <SelectValue placeholder="Emitir documento…" />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(TIPOS_DOCUMENTO) as TipoDocumento[]).map((t) => (
              <SelectItem key={t} value={t}>
                {TIPOS_DOCUMENTO[t].rotulo}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        </div>
      </div>

      {lista.isLoading ? (
        <div className="h-12 animate-pulse rounded-md bg-muted" />
      ) : lista.error ? (
        <p className="text-sm text-destructive">{(lista.error as Error).message}</p>
      ) : (lista.data ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum documento emitido.</p>
      ) : (
        <ul className="divide-y divide-border text-sm">
          {(lista.data ?? []).map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div>
                <span className="font-medium">{d.titulo}</span>{" "}
                <span className="text-xs text-muted-foreground">
                  nº {numeroDoDocumento(d)} · {TIPOS_DOCUMENTO[d.tipo].rotulo} ·{" "}
                  {dateTimeBR(d.emitido_em)} · {d.veterinario}
                </span>
                {d.situacao === "cancelado" && (
                  <Badge variant="destructive" className="ml-2">
                    Cancelado
                  </Badge>
                )}
              </div>
              <div className="flex gap-2">
                <Button asChild size="sm" variant="outline">
                  <Link to="/clinica-documento" search={{ id: d.id }}>
                    <Printer className="size-4" /> Abrir / imprimir
                  </Link>
                </Button>
                {d.pode_cancelar && (
                  <Button size="sm" variant="ghost" onClick={() => setCancelando(d)}>
                    Cancelar
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {novo && (
        <EmitirDocumento
          tipo={novo}
          petId={petId}
          {...(atendimentoId ? { atendimentoId } : {})}
          pet={pet}
          tutor={tutor}
          onFechar={() => setNovo(null)}
          onEmitido={(id) => {
            const tipoEmitido = novo;
            setNovo(null);
            void qc.invalidateQueries({ queryKey: ["clinica-documentos"] });
            // solicitação de exames vai direto para a impressão da relação
            if (tipoEmitido === "solicitacao_exame" && id)
              void navigate({ to: "/clinica-documento", search: { id } });
          }}
        />
      )}

      <Dialog open={Boolean(cancelando)} onOpenChange={(o) => !o && fecharCancelamento()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Cancelar o documento nº {cancelando ? numeroDoDocumento(cancelando) : ""}?
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            O documento continua no registro, marcado como cancelado. Para corrigir, emita outro.
          </p>
          <div>
            <Label htmlFor="doc-motivo">Motivo</Label>
            <Input id="doc-motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={fecharCancelamento}>
              Voltar
            </Button>
            <Button
              variant="destructive"
              disabled={motivo.trim().length < 5 || cancelar.isPending}
              onClick={() => cancelar.mutate()}
            >
              Cancelar documento
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EmitirDocumento({
  tipo,
  petId,
  atendimentoId,
  pet,
  tutor,
  onFechar,
  onEmitido,
}: {
  tipo: TipoDocumento;
  petId: string;
  atendimentoId?: string;
  pet: { nome: string; especie: string; raca: string | null };
  tutor: string;
  onFechar: () => void;
  onEmitido: (id?: string) => void;
}) {
  const qc = useQueryClient();
  const ctx = useQuery({
    queryKey: ["clinica-documento-contexto"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("clinica_documento_contexto");
      if (error) throw error;
      return data as unknown as Contexto;
    },
  });
  const modelosReceita = useQuery({
    queryKey: ["clinica-receita-modelos"],
    enabled: tipo === "receita",
    queryFn: async () => {
      const { data, error } = await supabase.rpc("clinica_receita_modelos");
      if (error) throw error;
      return modelosReceitaDaResposta(data);
    },
  });
  const [titulo, setTitulo] = useState(TITULO_PADRAO[tipo]);
  const [texto, setTexto] = useState("");
  const [receita, setReceita] = useState<ItemReceitaForm[]>([
    { ...itemReceitaVazio(), controlado: false },
  ]);
  const [exames, setExames] = useState<ItemExame[]>([{ exame: "" }]);
  const modelosExame = useQuery({
    queryKey: ["clinica-exame-modelos-lista"],
    enabled: tipo === "solicitacao_exame",
    queryFn: async () => {
      const { data, error } = await supabase.rpc("clinica_exame_modelos");
      if (error) throw error;
      return ((data ?? []) as unknown as { id: string; nome: string; ativo: boolean }[]).filter(
        (m) => m.ativo,
      );
    },
  });
  function adicionarExame(nome: string) {
    setExames((atual) => {
      if (atual.some((x) => x.exame.trim().toLowerCase() === nome.toLowerCase())) return atual;
      const vazios = atual.filter((x) => x.exame.trim());
      return vazios.length >= 30 ? atual : [...vazios, { exame: nome }];
    });
  }
  const [modeloEscolhido, setModeloEscolhido] = useState("");
  const [modeloReceitaId, setModeloReceitaId] = useState("");

  const modelos = useMemo<ModeloDocumento[]>(() => {
    const dela = (ctx.data?.modelos ?? []).filter((m) => m.tipo === tipo);
    const chaves = new Set(dela.map((m) => m.titulo));
    return [...dela, ...MODELOS_INICIAIS.filter((m) => m.tipo === tipo && !chaves.has(m.titulo))];
  }, [ctx.data, tipo]);

  const vars = {
    tutor,
    pet: pet.nome,
    especie: rotulo(ESPECIES, pet.especie).toLowerCase(),
    raca: pet.raca ?? "sem raça definida",
    data: dataPorExtenso(hojeISO()),
    veterinario: ctx.data?.veterinario.nome ?? "",
    crmv: ctx.data ? `${ctx.data.veterinario.crmv}-${ctx.data.veterinario.crmv_uf}` : "",
    clinica: ctx.data?.clinica ?? "",
  };
  const texto_final = montarTextoDocumento(texto, vars);
  const pendentes = marcadoresPendentes(texto_final);
  const textoLivre = tipo === "atestado" || tipo === "termo";

  const falta = faltaParaEmitir(tipo, {
    titulo,
    corpo: texto_final,
    receita,
    exames,
  });
  const controlado = tipo === "receita" && receita.some((i) => i.controlado);
  const bloqueado = falta.length > 0 || pendentes.length > 0 || controlado;

  const emitir = useMutation({
    mutationFn: async () => {
      const itens =
        tipo === "receita"
          ? receita
              .filter((i) => i.medicamento.trim() || i.posologia.trim())
              .map((i) => ({
                medicamento: i.medicamento,
                posologia: i.posologia,
                via: i.via ?? "",
                duracao: i.duracao ?? "",
                quantidade: i.quantidade ?? "",
                controlado: i.controlado,
              }))
          : tipo === "solicitacao_exame"
            ? exames.filter((e) => e.exame.trim())
            : [];
      const { data, error } = await supabase.rpc("clinica_documento_emitir", {
        p_dados: {
          tipo,
          pet_id: petId,
          ...(atendimentoId ? { atendimento_id: atendimentoId } : {}),
          titulo,
          corpo: texto_final,
          itens,
        },
      });
      if (error) throw error;
      return data as unknown as { id: string };
    },
    onSuccess: (data) => {
      toast.success("Documento emitido");
      onEmitido(data?.id);
    },
    onError: (e: Error) => toast.error("Não foi possível emitir", { description: e.message }),
  });

  const guardarModelo = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("clinica_documento_modelo_salvar", {
        p_tipo: tipo,
        p_titulo: titulo,
        p_corpo: texto,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Modelo guardado para a clínica");
      void qc.invalidateQueries({ queryKey: ["clinica-documento-contexto"] });
    },
    onError: (e: Error) => toast.error("Não foi possível guardar", { description: e.message }),
  });

  const guardarReceitaModelo = useMutation({
    mutationFn: async () => {
      const itens = receita
        .filter((i) => i.medicamento.trim() || i.posologia.trim())
        .map((i) => ({
          medicamento: i.medicamento,
          posologia: i.posologia,
          via: i.via ?? "",
          duracao: i.duracao ?? "",
          quantidade: i.quantidade ?? "",
        }));
      const { error } = await supabase.rpc("clinica_receita_modelo_salvar", {
        p_titulo: titulo,
        p_itens: itens,
        p_orientacoes: texto.trim() || (null as unknown as string),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Modelo de receita guardado");
      void qc.invalidateQueries({ queryKey: ["clinica-receita-modelos"] });
    },
    onError: (e: Error) => toast.error("Não foi possível guardar", { description: e.message }),
  });

  const excluirReceitaModelo = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("clinica_receita_modelo_excluir", { p_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Modelo excluído");
      setModeloReceitaId("");
      void qc.invalidateQueries({ queryKey: ["clinica-receita-modelos"] });
    },
    onError: (e: Error) => toast.error("Não foi possível excluir", { description: e.message }),
  });

  function escolherModeloReceita(id: string) {
    setModeloReceitaId(id);
    const m = (modelosReceita.data ?? []).find((x) => x.id === id);
    if (!m) return;
    setTitulo(m.titulo);
    setTexto(m.orientacoes ?? "");
    setReceita(
      m.itens.length > 0
        ? m.itens.map((i) => ({ ...i, controlado: false }))
        : [{ ...itemReceitaVazio(), controlado: false }],
    );
  }

  function escolherModelo(t: string) {
    setModeloEscolhido(t);
    const m = modelos.find((x) => x.titulo === t);
    if (m) {
      setTitulo(m.titulo);
      setTexto(m.corpo);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {TIPOS_DOCUMENTO[tipo].rotulo} — {pet.nome}
          </DialogTitle>
        </DialogHeader>

        {ctx.isLoading ? (
          <div className="h-32 animate-pulse rounded-md bg-muted" />
        ) : ctx.error ? (
          <p className="text-sm text-destructive">{(ctx.error as Error).message}</p>
        ) : (
          <div className="space-y-4">
            <div>
              <Label htmlFor="doc-titulo">Título</Label>
              <Input id="doc-titulo" value={titulo} onChange={(e) => setTitulo(e.target.value)} />
            </div>

            {tipo === "receita" && (
              <>
                {(modelosReceita.data ?? []).length > 0 && (
                  <div className="flex items-end gap-2">
                    <div className="grow">
                      <Label>Modelo de receita</Label>
                      <Select value={modeloReceitaId} onValueChange={escolherModeloReceita}>
                        <SelectTrigger>
                          <SelectValue placeholder="Usar um modelo guardado" />
                        </SelectTrigger>
                        <SelectContent>
                          {(modelosReceita.data ?? []).map((m: ModeloReceita) => (
                            <SelectItem key={m.id} value={m.id}>
                              {m.titulo}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {modeloReceitaId && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={excluirReceitaModelo.isPending}
                        onClick={() => excluirReceitaModelo.mutate(modeloReceitaId)}
                      >
                        <Trash2 className="size-4" /> Excluir modelo
                      </Button>
                    )}
                  </div>
                )}
                <div
                  role="note"
                  className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
                >
                  <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                  <span>
                    Medicamento de controle especial (tarja preta ou vermelha) exige receituário
                    próprio e assinatura qualificada: este sistema ainda não emite essa receita.
                  </span>
                </div>
                {receita.map((i, idx) => (
                  <div key={idx} className="space-y-2 rounded-md border border-border p-3">
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div>
                        <Label>Medicamento *</Label>
                        <CampoMedicamento
                          value={i.medicamento}
                          onChange={(v) =>
                            setReceita(
                              receita.map((x, k) => (k === idx ? { ...x, medicamento: v } : x)),
                            )
                          }
                        />
                      </div>
                      <div>
                        <Label>Posologia *</Label>
                        <Input
                          placeholder="Ex.: 1 comprimido a cada 12 horas"
                          value={i.posologia}
                          onChange={(e) =>
                            setReceita(
                              receita.map((x, k) =>
                                k === idx ? { ...x, posologia: e.target.value } : x,
                              ),
                            )
                          }
                        />
                      </div>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-3">
                      <div>
                        <Label>Via</Label>
                        <Input
                          placeholder="Oral, tópica…"
                          value={i.via ?? ""}
                          onChange={(e) =>
                            setReceita(
                              receita.map((x, k) =>
                                k === idx ? { ...x, via: e.target.value } : x,
                              ),
                            )
                          }
                        />
                      </div>
                      <div>
                        <Label>Duração</Label>
                        <Input
                          placeholder="Ex.: 7 dias"
                          value={i.duracao ?? ""}
                          onChange={(e) =>
                            setReceita(
                              receita.map((x, k) =>
                                k === idx ? { ...x, duracao: e.target.value } : x,
                              ),
                            )
                          }
                        />
                      </div>
                      <div>
                        <Label>Quantidade</Label>
                        <Input
                          placeholder="Ex.: 1 caixa"
                          value={i.quantidade ?? ""}
                          onChange={(e) =>
                            setReceita(
                              receita.map((x, k) =>
                                k === idx ? { ...x, quantidade: e.target.value } : x,
                              ),
                            )
                          }
                        />
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <label className="flex items-center gap-2 text-xs text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={i.controlado}
                          onChange={(e) =>
                            setReceita(
                              receita.map((x, k) =>
                                k === idx ? { ...x, controlado: e.target.checked } : x,
                              ),
                            )
                          }
                        />
                        É medicamento de controle especial
                      </label>
                      {receita.length > 1 && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setReceita(receita.filter((_, k) => k !== idx))}
                        >
                          <Trash2 className="size-4" /> Tirar
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setReceita([...receita, { ...itemReceitaVazio(), controlado: false }])
                  }
                >
                  <Plus className="size-4" /> Outro medicamento
                </Button>
                <div>
                  <Label htmlFor="doc-orient">Orientações ao tutor</Label>
                  <Textarea
                    id="doc-orient"
                    rows={3}
                    value={texto}
                    onChange={(e) => setTexto(e.target.value)}
                  />
                </div>
                <div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={
                      guardarReceitaModelo.isPending ||
                      titulo.trim().length < 3 ||
                      !receita.some((i) => i.medicamento.trim() && i.posologia.trim())
                    }
                    onClick={() => guardarReceitaModelo.mutate()}
                  >
                    Guardar como modelo da clínica
                  </Button>
                </div>
              </>
            )}

            {tipo === "solicitacao_exame" && (
              <>
                {(modelosExame.data ?? []).length > 0 && (
                  <div>
                    <Label>Exames da clínica (toque para incluir)</Label>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {(modelosExame.data ?? []).map((m) => {
                        const incluido = exames.some(
                          (x) => x.exame.trim().toLowerCase() === m.nome.toLowerCase(),
                        );
                        return (
                          <Button
                            key={m.id}
                            type="button"
                            size="sm"
                            variant={incluido ? "default" : "outline"}
                            className="h-7 rounded-full px-3 text-xs"
                            onClick={() => adicionarExame(m.nome)}
                          >
                            {incluido ? "✓ " : "+ "}
                            {m.nome}
                          </Button>
                        );
                      })}
                    </div>
                  </div>
                )}
                {exames.map((e, idx) => (
                  <div key={idx} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                    <div>
                      <Label>Exame *</Label>
                      <Input
                        placeholder="Ex.: Hemograma completo"
                        value={e.exame}
                        onChange={(ev) =>
                          setExames(
                            exames.map((x, k) =>
                              k === idx ? { ...x, exame: ev.target.value } : x,
                            ),
                          )
                        }
                      />
                    </div>
                    <div>
                      <Label>Observação</Label>
                      <Input
                        value={e.observacao ?? ""}
                        onChange={(ev) =>
                          setExames(
                            exames.map((x, k) =>
                              k === idx ? { ...x, observacao: ev.target.value } : x,
                            ),
                          )
                        }
                      />
                    </div>
                    {exames.length > 1 && (
                      <Button
                        className="self-end"
                        size="sm"
                        variant="ghost"
                        onClick={() => setExames(exames.filter((_, k) => k !== idx))}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    )}
                  </div>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setExames([...exames, { exame: "" }])}
                >
                  <Plus className="size-4" /> Outro exame
                </Button>
                <div>
                  <Label htmlFor="doc-ind">Indicação clínica</Label>
                  <Textarea
                    id="doc-ind"
                    rows={3}
                    value={texto}
                    onChange={(e) => setTexto(e.target.value)}
                  />
                </div>
              </>
            )}

            {textoLivre && (
              <>
                <div>
                  <Label>Modelo</Label>
                  <Select value={modeloEscolhido} onValueChange={escolherModelo}>
                    <SelectTrigger>
                      <SelectValue placeholder="Escolha um modelo para começar" />
                    </SelectTrigger>
                    <SelectContent>
                      {modelos.map((m) => (
                        <SelectItem key={m.titulo} value={m.titulo}>
                          {m.titulo}
                          {m.id ? " (da clínica)" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="doc-texto">Texto (modelo com marcadores)</Label>
                  <Textarea
                    id="doc-texto"
                    rows={8}
                    value={texto}
                    onChange={(e) => setTexto(e.target.value)}
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    Marcadores: {CAMPOS_DOCUMENTO.map((c) => `{${c}}`).join(", ")}. O texto abaixo é
                    o que sai no documento.
                  </p>
                </div>
                <div>
                  <Label>Como vai sair</Label>
                  <p className="whitespace-pre-wrap rounded-md border border-border bg-muted/40 p-3 text-sm">
                    {texto_final || "—"}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={
                      guardarModelo.isPending ||
                      texto.trim().length < 10 ||
                      titulo.trim().length < 3
                    }
                    onClick={() => guardarModelo.mutate()}
                  >
                    Guardar como modelo da clínica
                  </Button>
                </div>
              </>
            )}

            {pendentes.length > 0 && (
              <p className="text-sm text-destructive">
                Troque ou apague: {pendentes.join(", ")} (marcador sem valor).
              </p>
            )}
            {controlado && (
              <p className="text-sm text-destructive">
                Tire o medicamento de controle especial: este sistema não emite essa receita.
              </p>
            )}
            {falta.length > 0 && (
              <p className="text-sm text-muted-foreground">Falta: {falta.join(", ")}.</p>
            )}
            <p className="text-xs text-muted-foreground">
              Emitido por {ctx.data?.veterinario.nome} (CRMV {ctx.data?.veterinario.crmv}/
              {ctx.data?.veterinario.crmv_uf}). Depois de emitido, o documento não se altera: só se
              cancela.
            </p>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>
            Voltar
          </Button>
          <Button
            disabled={bloqueado || emitir.isPending || ctx.isLoading}
            onClick={() => emitir.mutate()}
          >
            Emitir documento
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
