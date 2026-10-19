import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, FlaskConical, Pencil, Plus } from "lucide-react";
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
import { supabase } from "@/integrations/supabase/client";
import { useModulosCnae } from "@/lib/cnae";
import {
  ESPECIES_FAIXA,
  FORMAS_CAMPO,
  TIPOS_EXAME,
  agruparCampos,
  erroDaFaixa,
  erroDoCampo,
  numeroOuNulo,
  opcoesDoTexto,
  rotuloFaixa,
  type CampoExame,
  type FormCampo,
  type FormaCampo,
  type ModeloExame,
} from "@/lib/exames";
import { rotulo } from "@/lib/pet";

export const Route = createFileRoute("/_authenticated/clinica-exames-modelos")({
  head: () => ({
    meta: [
      { title: "Modelos de exame — ERP Ze Tech" },
      {
        name: "description",
        content:
          "Hemograma, bioquímica, urina e outros exames da clínica: campos, unidades e faixas de referência.",
      },
    ],
  }),
  component: ModelosModulo,
});

type FormModelo = { id?: string; nome: string; tipo: string; material: string; ativo: boolean };
type FaixaForm = Record<string, { minimo: string; maximo: string }>;
type FormCampoTela = FormCampo & { id?: string; ativo: boolean; faixas: FaixaForm };

const modeloVazio: FormModelo = { nome: "", tipo: "outro", material: "", ativo: true };

const faixasVazias = (): FaixaForm =>
  Object.fromEntries(ESPECIES_FAIXA.map((e) => [e.value, { minimo: "", maximo: "" }]));

const campoVazio: FormCampoTela = {
  nome: "",
  grupo: "",
  unidade: "",
  forma: "numero",
  casas: "2",
  opcoes: "",
  total_campo_id: "",
  pct_campo_id: "",
  ativo: true,
  faixas: faixasVazias(),
};

const texto = (n: number | null) => (n === null ? "" : String(n).replace(".", ","));

function ModelosModulo() {
  const modulos = useModulosCnae();
  if (modulos.carregando) return <div className="panel h-40 animate-pulse" />;
  if (!modulos.clinica) return <ModuloBloqueado modulo="clinica" />;
  return <Modelos />;
}

function Modelos() {
  const qc = useQueryClient();
  const [modeloId, setModeloId] = useState("");
  const [modeloAberto, setModeloAberto] = useState(false);
  const [formModelo, setFormModelo] = useState<FormModelo>(modeloVazio);
  const [campoAberto, setCampoAberto] = useState(false);
  const [formCampo, setFormCampo] = useState<FormCampoTela>(campoVazio);

  const { data: modelos = [], isLoading } = useQuery({
    queryKey: ["clinica-exame-modelos"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("clinica_exame_modelos");
      if (error) throw error;
      return (data ?? []) as unknown as ModeloExame[];
    },
  });

  const modelo = modelos.find((m) => m.id === modeloId) ?? modelos[0];
  const atualizar = () => qc.invalidateQueries({ queryKey: ["clinica-exame-modelos"] });

  const iniciais = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("clinica_exame_modelos_iniciais");
      if (error) throw error;
      return data as number;
    },
    onSuccess: (n) => {
      toast.success(n > 0 ? `${n} modelo(s) criado(s)` : "Os modelos iniciais já existem");
      void atualizar();
    },
    onError: (e: Error) => toast.error("Não foi possível criar", { description: e.message }),
  });

  const salvarModelo = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("clinica_exame_modelo_salvar", {
        p_dados: {
          ...(formModelo.id ? { id: formModelo.id } : {}),
          nome: formModelo.nome.trim(),
          tipo: formModelo.tipo,
          material: formModelo.material.trim(),
          ativo: formModelo.ativo,
        },
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (id) => {
      toast.success("Modelo salvo");
      setModeloAberto(false);
      setModeloId(id);
      void atualizar();
    },
    onError: (e: Error) => toast.error("Não foi possível salvar", { description: e.message }),
  });

  const mover = useMutation({
    mutationFn: async (v: { id: string; delta: number }) => {
      const { error } = await supabase.rpc("clinica_exame_campo_mover", {
        p_campo_id: v.id,
        p_delta: v.delta,
      });
      if (error) throw error;
    },
    onSuccess: () => void atualizar(),
    onError: (e: Error) => toast.error("Não foi possível mover", { description: e.message }),
  });

  const salvarCampo = useMutation({
    mutationFn: async () => {
      if (!modelo) return;
      const f = formCampo;
      const calculavel = f.forma === "numero" || f.forma === "calculado";
      const { data, error } = await supabase.rpc("clinica_exame_campo_salvar", {
        p_dados: {
          ...(f.id ? { id: f.id } : { modelo_id: modelo.id }),
          nome: f.nome.trim(),
          grupo: f.grupo.trim(),
          unidade: f.unidade.trim(),
          forma: f.forma,
          casas: calculavel ? f.casas.trim() : "",
          opcoes: f.forma === "escolha" ? opcoesDoTexto(f.opcoes) : null,
          total_campo_id: f.forma === "calculado" ? f.total_campo_id : "",
          pct_campo_id: f.forma === "calculado" ? f.pct_campo_id : "",
          ativo: f.ativo,
        },
      });
      if (error) throw error;
      const id = data as string;
      if (calculavel) {
        const antes = modelo.campos.find((c) => c.id === id)?.referencias ?? [];
        for (const e of ESPECIES_FAIXA) {
          const novo = f.faixas[e.value] ?? { minimo: "", maximo: "" };
          const velho = antes.find((r) => r.especie === e.value);
          if (
            texto(velho?.minimo ?? null) === novo.minimo.trim() &&
            texto(velho?.maximo ?? null) === novo.maximo.trim()
          )
            continue;
          const { error: erroFaixa } = await supabase.rpc("clinica_exame_referencia_salvar", {
            p_campo_id: id,
            p_especie: e.value,
            // o banco recebe número ou vazio (tira a faixa)
            p_minimo: numeroOuNulo(novo.minimo) as number,
            p_maximo: numeroOuNulo(novo.maximo) as number,
          });
          if (erroFaixa) throw erroFaixa;
        }
      }
    },
    onSuccess: () => {
      toast.success("Campo salvo");
      setCampoAberto(false);
      void atualizar();
    },
    onError: (e: Error) => toast.error("Não foi possível salvar", { description: e.message }),
  });

  function abrirCampo(c?: CampoExame) {
    if (!c) {
      setFormCampo({ ...campoVazio, faixas: faixasVazias() });
    } else {
      const faixas = faixasVazias();
      for (const r of c.referencias) {
        faixas[r.especie] = { minimo: texto(r.minimo), maximo: texto(r.maximo) };
      }
      setFormCampo({
        id: c.id,
        nome: c.nome,
        grupo: c.grupo ?? "",
        unidade: c.unidade ?? "",
        forma: c.forma,
        casas: c.casas === null ? "2" : String(c.casas),
        opcoes: (c.opcoes ?? []).join("\n"),
        total_campo_id: c.total_campo_id ?? "",
        pct_campo_id: c.pct_campo_id ?? "",
        ativo: c.ativo,
        faixas,
      });
    }
    setCampoAberto(true);
  }

  const erroCampo = erroDoCampo(formCampo);
  const erroFaixas =
    formCampo.forma === "numero" || formCampo.forma === "calculado"
      ? (ESPECIES_FAIXA.map((e) => {
          const f = formCampo.faixas[e.value];
          const msg = f ? erroDaFaixa(f.minimo, f.maximo) : null;
          return msg ? `${e.label}: ${msg}` : null;
        }).find(Boolean) ?? null)
      : null;
  const numericos = (modelo?.campos ?? []).filter(
    (c) => c.forma === "numero" && c.ativo && c.id !== formCampo.id,
  );
  const grupos = modelo ? agruparCampos(modelo.campos) : [];
  const posicoes = modelo ? [...modelo.campos].sort((a, b) => a.ordem - b.ordem) : [];

  return (
    <div>
      <PageHeader
        title="Modelos de exame"
        description="Campos, unidades e faixas de referência do hemograma, da bioquímica, da urina e de outros exames. O resultado é preenchido pelo veterinário; aqui fica só o modelo."
        actions={
          <Button
            onClick={() => {
              setFormModelo(modeloVazio);
              setModeloAberto(true);
            }}
          >
            <Plus className="size-4" /> Novo modelo
          </Button>
        }
      />

      {isLoading ? (
        <div className="panel h-40 animate-pulse" />
      ) : modelos.length === 0 ? (
        <EmptyState
          title="Nenhum modelo de exame"
          description="Comece pelos modelos iniciais (hemograma, bioquímica e urina) e ajuste unidade e campos ao laboratório da clínica."
          action={
            <Button onClick={() => iniciais.mutate()} disabled={iniciais.isPending}>
              <FlaskConical className="size-4" /> Criar modelos iniciais
            </Button>
          }
        />
      ) : (
        <>
          <div className="panel mb-4 flex flex-wrap items-end gap-3 p-4">
            <div className="min-w-56">
              <Label htmlFor="m-sel">Modelo</Label>
              <Select value={modelo?.id ?? ""} onValueChange={setModeloId}>
                <SelectTrigger id="m-sel">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {modelos.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.nome}
                      {m.ativo ? "" : " (inativo)"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {modelo && (
              <>
                <div className="text-sm text-muted-foreground">
                  {rotulo(TIPOS_EXAME, modelo.tipo)}
                  {modelo.material ? ` · ${modelo.material}` : ""}
                  {!modelo.ativo && (
                    <Badge variant="outline" className="ml-2">
                      Inativo
                    </Badge>
                  )}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setFormModelo({
                      id: modelo.id,
                      nome: modelo.nome,
                      tipo: modelo.tipo,
                      material: modelo.material ?? "",
                      ativo: modelo.ativo,
                    });
                    setModeloAberto(true);
                  }}
                >
                  <Pencil className="size-4" /> Editar modelo
                </Button>
                <Button size="sm" onClick={() => abrirCampo()}>
                  <Plus className="size-4" /> Novo campo
                </Button>
              </>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => iniciais.mutate()}
              disabled={iniciais.isPending}
            >
              Recriar modelos iniciais que faltam
            </Button>
          </div>
          <p className="mb-3 text-xs text-amber-800">
            A faixa de referência é do veterinário responsável e do laboratório da clínica: o
            sistema não traz valores prontos. Campo não se apaga — sai de uso ficando inativo.
          </p>

          {modelo && modelo.campos.length === 0 ? (
            <EmptyState
              title="Modelo sem campos"
              description="Inclua os campos que o veterinário vai preencher."
            />
          ) : (
            modelo &&
            grupos.map((g) => (
              <div key={g.grupo || "__sem_grupo"} className="panel mb-4 overflow-x-auto">
                <div className="border-b px-4 py-2 text-sm font-medium">{g.grupo || "Geral"}</div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Campo</TableHead>
                      <TableHead>Unidade</TableHead>
                      <TableHead>Valor</TableHead>
                      {ESPECIES_FAIXA.map((e) => (
                        <TableHead key={e.value}>{e.label}</TableHead>
                      ))}
                      <TableHead className="text-right">Ação</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {g.campos.map((c) => {
                      const pos = posicoes.findIndex((p) => p.id === c.id);
                      return (
                        <TableRow key={c.id} className={c.ativo ? "" : "opacity-60"}>
                          <TableCell className="font-medium">
                            {c.nome}
                            {!c.ativo && (
                              <Badge variant="outline" className="ml-2">
                                Inativo
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell>{c.unidade || "—"}</TableCell>
                          <TableCell>
                            {rotulo(FORMAS_CAMPO, c.forma)}
                            {c.forma === "escolha" && c.opcoes ? (
                              <span className="block text-xs text-muted-foreground">
                                {c.opcoes.join(" · ")}
                              </span>
                            ) : null}
                          </TableCell>
                          {ESPECIES_FAIXA.map((e) => (
                            <TableCell key={e.value}>
                              {c.forma === "numero" || c.forma === "calculado"
                                ? rotuloFaixa(c.referencias.find((r) => r.especie === e.value))
                                : "—"}
                            </TableCell>
                          ))}
                          <TableCell className="text-right whitespace-nowrap">
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`Subir ${c.nome}`}
                              disabled={pos <= 0 || mover.isPending}
                              onClick={() => mover.mutate({ id: c.id, delta: -1 })}
                            >
                              <ArrowUp className="size-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`Descer ${c.nome}`}
                              disabled={pos === posicoes.length - 1 || mover.isPending}
                              onClick={() => mover.mutate({ id: c.id, delta: 1 })}
                            >
                              <ArrowDown className="size-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`Editar ${c.nome}`}
                              onClick={() => abrirCampo(c)}
                            >
                              <Pencil className="size-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            ))
          )}
        </>
      )}

      <Dialog open={modeloAberto} onOpenChange={(o) => !o && setModeloAberto(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{formModelo.id ? "Editar modelo" : "Novo modelo de exame"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div>
              <Label htmlFor="mo-nome">Nome</Label>
              <Input
                id="mo-nome"
                value={formModelo.nome}
                onChange={(e) => setFormModelo({ ...formModelo, nome: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="mo-tipo">Tipo</Label>
              <Select
                value={formModelo.tipo}
                onValueChange={(v) => setFormModelo({ ...formModelo, tipo: v })}
              >
                <SelectTrigger id="mo-tipo">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIPOS_EXAME.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="mo-mat">Material (opcional)</Label>
              <Input
                id="mo-mat"
                placeholder="Sangue total em EDTA, soro, urina…"
                value={formModelo.material}
                onChange={(e) => setFormModelo({ ...formModelo, material: e.target.value })}
              />
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="mo-ativo"
                checked={formModelo.ativo}
                onCheckedChange={(v) => setFormModelo({ ...formModelo, ativo: v })}
              />
              <Label htmlFor="mo-ativo">Ativo</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModeloAberto(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => salvarModelo.mutate()}
              disabled={salvarModelo.isPending || !formModelo.nome.trim()}
            >
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={campoAberto} onOpenChange={(o) => !o && setCampoAberto(false)}>
        <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{formCampo.id ? "Editar campo" : "Novo campo"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="ca-nome">Nome</Label>
                <Input
                  id="ca-nome"
                  value={formCampo.nome}
                  onChange={(e) => setFormCampo({ ...formCampo, nome: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="ca-grupo">Grupo</Label>
                <Input
                  id="ca-grupo"
                  placeholder="Eritrograma, Químico…"
                  value={formCampo.grupo}
                  onChange={(e) => setFormCampo({ ...formCampo, grupo: e.target.value })}
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <Label htmlFor="ca-forma">Valor</Label>
                <Select
                  value={formCampo.forma}
                  onValueChange={(v) => setFormCampo({ ...formCampo, forma: v as FormaCampo })}
                >
                  <SelectTrigger id="ca-forma">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FORMAS_CAMPO.map((f) => (
                      <SelectItem key={f.value} value={f.value}>
                        {f.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="ca-casas">Casas decimais</Label>
                <Input
                  id="ca-casas"
                  inputMode="numeric"
                  disabled={formCampo.forma !== "numero" && formCampo.forma !== "calculado"}
                  value={
                    formCampo.forma === "numero" || formCampo.forma === "calculado"
                      ? formCampo.casas
                      : ""
                  }
                  onChange={(e) => setFormCampo({ ...formCampo, casas: e.target.value })}
                />
              </div>
            </div>
            {(formCampo.forma === "numero" || formCampo.forma === "calculado") && (
              <div>
                <Label htmlFor="ca-un">Unidade</Label>
                <Input
                  id="ca-un"
                  placeholder="g/dL, mg/dL, U/L, %…"
                  value={formCampo.unidade}
                  onChange={(e) => setFormCampo({ ...formCampo, unidade: e.target.value })}
                />
              </div>
            )}
            {formCampo.forma === "escolha" && (
              <div>
                <Label htmlFor="ca-op">Opções (uma por linha)</Label>
                <Textarea
                  id="ca-op"
                  rows={4}
                  value={formCampo.opcoes}
                  onChange={(e) => setFormCampo({ ...formCampo, opcoes: e.target.value })}
                />
              </div>
            )}
            {formCampo.forma === "calculado" && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="ca-total">Campo do total</Label>
                  <Select
                    value={formCampo.total_campo_id || "__nenhum"}
                    onValueChange={(v) =>
                      setFormCampo({ ...formCampo, total_campo_id: v === "__nenhum" ? "" : v })
                    }
                  >
                    <SelectTrigger id="ca-total">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__nenhum">Escolha</SelectItem>
                      {numericos.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.nome}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="ca-pct">Campo do percentual</Label>
                  <Select
                    value={formCampo.pct_campo_id || "__nenhum"}
                    onValueChange={(v) =>
                      setFormCampo({ ...formCampo, pct_campo_id: v === "__nenhum" ? "" : v })
                    }
                  >
                    <SelectTrigger id="ca-pct">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__nenhum">Escolha</SelectItem>
                      {numericos.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.nome}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <p className="col-span-2 text-xs text-muted-foreground">
                  O valor é calculado na hora do exame: total × percentual ÷ 100.
                </p>
              </div>
            )}
            {(formCampo.forma === "numero" || formCampo.forma === "calculado") && (
              <div>
                <Label>Faixa de referência (em branco = sem faixa)</Label>
                <div className="mt-1 grid gap-2">
                  {ESPECIES_FAIXA.map((e) => (
                    <div key={e.value} className="grid grid-cols-[5rem_1fr_1fr] items-center gap-2">
                      <span className="text-sm">{e.label}</span>
                      <Input
                        aria-label={`Mínimo — ${e.label}`}
                        placeholder="Mínimo"
                        inputMode="decimal"
                        value={formCampo.faixas[e.value]?.minimo ?? ""}
                        onChange={(ev) =>
                          setFormCampo({
                            ...formCampo,
                            faixas: {
                              ...formCampo.faixas,
                              [e.value]: {
                                minimo: ev.target.value,
                                maximo: formCampo.faixas[e.value]?.maximo ?? "",
                              },
                            },
                          })
                        }
                      />
                      <Input
                        aria-label={`Máximo — ${e.label}`}
                        placeholder="Máximo"
                        inputMode="decimal"
                        value={formCampo.faixas[e.value]?.maximo ?? ""}
                        onChange={(ev) =>
                          setFormCampo({
                            ...formCampo,
                            faixas: {
                              ...formCampo.faixas,
                              [e.value]: {
                                minimo: formCampo.faixas[e.value]?.minimo ?? "",
                                maximo: ev.target.value,
                              },
                            },
                          })
                        }
                      />
                    </div>
                  ))}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  A faixa é do veterinário responsável e do laboratório; confira antes de usar.
                </p>
              </div>
            )}
            <div className="flex items-center gap-2">
              <Switch
                id="ca-ativo"
                checked={formCampo.ativo}
                onCheckedChange={(v) => setFormCampo({ ...formCampo, ativo: v })}
              />
              <Label htmlFor="ca-ativo">Ativo</Label>
            </div>
            {(erroCampo || erroFaixas) && formCampo.nome.trim() !== "" && (
              <p className="text-sm text-destructive">{erroCampo ?? erroFaixas}</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCampoAberto(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => salvarCampo.mutate()}
              disabled={salvarCampo.isPending || !!erroCampo || !!erroFaixas}
            >
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
