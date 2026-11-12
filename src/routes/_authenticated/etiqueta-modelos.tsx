import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { ArrowDown, ArrowUp, Copy, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { EmptyState, PageHeader } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import { useSessionData } from "@/hooks/useSessionData";
import { TIPOS_CAMPO_ETIQUETA, htmlEtiquetas, type DadosEtiqueta } from "@/lib/etiqueta";
import {
  LIMITE_MODELOS_ETIQUETA,
  entradaDoEstado,
  estadoDoModelo,
  estadoNovoModelo,
  modeloDaLinha,
  moverCampoEditor,
  validarModeloProprio,
  type ConfigModeloEtiqueta,
  type EstadoEditorModelo,
} from "@/lib/etiqueta-modelo";
import {
  useExcluirModeloEtiqueta,
  useModelosEtiqueta,
  useSalvarModeloEtiqueta,
} from "@/lib/etiqueta-modelo-dados";

export const Route = createFileRoute("/_authenticated/etiqueta-modelos")({
  head: () => ({
    meta: [
      { title: "Modelos de etiqueta — EZRA ERP" },
      {
        name: "description",
        content:
          "Crie modelos de etiqueta com o tamanho do seu rolo ou da sua folha e escolha os campos.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ModelosDeEtiqueta,
});

const EXEMPLO: DadosEtiqueta = {
  descricao: "Ração Premium Cães Adultos 15 kg",
  codigo: "4006381333931",
  preco: 189.9,
  unidade: "SC",
  validade: "31/12/2027",
  lote: "L2407",
};

const TAMANHOS = [
  { id: "p", nome: "Pequena" },
  { id: "m", nome: "Média" },
  { id: "g", nome: "Grande" },
] as const;

function descreverConfig(c: ConfigModeloEtiqueta) {
  const campos = c.campos
    .map((x) => TIPOS_CAMPO_ETIQUETA.find((t) => t.id === x.campo)?.nome ?? x.campo)
    .join(", ");
  const medida = `${c.larguraMm.toLocaleString("pt-BR")} × ${c.alturaMm.toLocaleString("pt-BR")} mm`;
  return c.tipo === "folha"
    ? `Folha A4, ${c.colunas} × ${c.linhas} (${medida}) · ${campos}`
    : `Térmica ${medida} · ${campos}`;
}

function ModelosDeEtiqueta() {
  const { data: sessao, isLoading: sessaoCarregando } = useSessionData();
  const gestao = (sessao?.roles ?? []).some((r) => r === "administrador" || r === "gestor");
  const consulta = useModelosEtiqueta();
  const excluir = useExcluirModeloEtiqueta();
  const [editando, setEditando] = useState<EstadoEditorModelo | null>(null);
  const [apagar, setApagar] = useState<{ id: string; nome: string } | null>(null);

  if (sessaoCarregando) return <p className="text-sm text-muted-foreground">Carregando…</p>;
  if (!gestao)
    return (
      <EmptyState
        title="Só a administração cria modelos de etiqueta"
        description="Peça ao administrador ou ao gestor da empresa."
      />
    );
  const lista = consulta.data ?? [];

  return (
    <>
      <PageHeader
        title="Modelos de etiqueta"
        description="Defina o tamanho do rolo ou da folha e os campos que saem na etiqueta. Os modelos aparecem na hora de imprimir."
        actions={
          <Button
            disabled={lista.length >= LIMITE_MODELOS_ETIQUETA}
            onClick={() => setEditando(estadoNovoModelo())}
          >
            <Plus className="mr-2 size-4" /> Novo modelo
          </Button>
        }
      />

      {consulta.isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : lista.length === 0 ? (
        <EmptyState
          title="Nenhum modelo próprio ainda"
          description="Sem modelo próprio, a impressão usa os modelos prontos (térmicas de 40×25 a 100×50 mm e folhas A4)."
        />
      ) : (
        <ul className="space-y-2">
          {lista.map((m) => (
            <li key={m.id} className="panel flex items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{m.nome}</p>
                <p className="truncate text-sm text-muted-foreground">
                  {descreverConfig(m.config)}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Editar ${m.nome}`}
                onClick={() => setEditando(estadoDoModelo(m.id, m.nome, m.config))}
              >
                <Pencil className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Duplicar ${m.nome}`}
                disabled={lista.length >= LIMITE_MODELOS_ETIQUETA}
                onClick={() => {
                  const e = estadoDoModelo(m.id, m.nome, m.config);
                  setEditando({ ...e, id: null, nome: `${m.nome} (cópia)`.slice(0, 60) });
                }}
              >
                <Copy className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Excluir ${m.nome}`}
                onClick={() => setApagar({ id: m.id, nome: m.nome })}
              >
                <Trash2 className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {editando && <Editor inicial={editando} onClose={() => setEditando(null)} />}

      <AlertDialog open={!!apagar} onOpenChange={(o) => !o && setApagar(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir o modelo “{apagar?.nome}”?</AlertDialogTitle>
            <AlertDialogDescription>
              As etiquetas já impressas não mudam. Quem usava este modelo volta para o modelo padrão
              na próxima impressão.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction
              disabled={excluir.isPending}
              onClick={() =>
                apagar &&
                excluir.mutate(apagar.id, {
                  onSuccess: () => {
                    toast.success("Modelo excluído");
                    setApagar(null);
                  },
                  onError: (e) => toast.error(e.message),
                })
              }
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function Editor({ inicial, onClose }: { inicial: EstadoEditorModelo; onClose: () => void }) {
  const [e, setE] = useState(inicial);
  const salvar = useSalvarModeloEtiqueta();
  const set = <K extends keyof EstadoEditorModelo>(k: K, v: EstadoEditorModelo[K]) =>
    setE((a) => ({ ...a, [k]: v }));
  const folha = e.tipo === "folha";
  const r = useMemo(() => validarModeloProprio(entradaDoEstado(e)), [e]);

  // pré-visualização com dados de exemplo; sem nome válido ainda dá para ver o desenho
  const previa = useMemo(() => {
    const v = validarModeloProprio({
      ...entradaDoEstado(e),
      nome: e.nome.trim().length >= 2 ? e.nome : "Prévia",
    });
    if (!v.ok) return null;
    const modelo = modeloDaLinha({ id: "previa", nome: v.nome, config: v.config });
    return modelo ? { modelo, html: htmlEtiquetas(modelo, [EXEMPLO]) } : null;
  }, [e]);

  const escala = previa
    ? previa.modelo.tipo === "folha"
      ? 0.5
      : Math.min(3, 340 / (previa.modelo.larguraMm * 3.78))
    : 1;
  const largPx = previa
    ? (previa.modelo.tipo === "folha" ? 210 : previa.modelo.larguraMm) * 3.78
    : 0;
  const altPx = previa ? (previa.modelo.tipo === "folha" ? 297 : previa.modelo.alturaMm) * 3.78 : 0;

  function gravar() {
    if (!r.ok) {
      toast.error(r.erro);
      return;
    }
    salvar.mutate(
      { id: e.id, nome: r.nome, config: r.config },
      {
        onSuccess: () => {
          toast.success("Modelo salvo");
          onClose();
        },
        onError: (er) => toast.error(er.message),
      },
    );
  }

  const campoNumero = (k: keyof EstadoEditorModelo, rotulo: string) => (
    <div>
      <Label htmlFor={`em-${k}`}>{rotulo}</Label>
      <Input
        id={`em-${k}`}
        inputMode="decimal"
        value={e[k] as string}
        onChange={(ev) => set(k, ev.target.value as never)}
      />
    </div>
  );

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{e.id ? "Editar modelo" : "Novo modelo de etiqueta"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-4">
            <div>
              <Label htmlFor="em-nome">Nome do modelo</Label>
              <Input
                id="em-nome"
                maxLength={60}
                value={e.nome}
                onChange={(ev) => set("nome", ev.target.value)}
                placeholder="Ex.: Gôndola 60 × 30"
              />
            </div>
            <div>
              <Label>Tipo</Label>
              <Select value={e.tipo} onValueChange={(v) => set("tipo", v as "termica" | "folha")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="termica">Térmica (rolo: Zebra, Argox…)</SelectItem>
                  <SelectItem value="folha">Folha A4 (laser ou jato)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {campoNumero("larguraMm", "Largura de cada etiqueta (mm)")}
              {campoNumero("alturaMm", "Altura de cada etiqueta (mm)")}
            </div>
            {folha && (
              <div className="grid grid-cols-2 gap-3">
                {campoNumero("colunas", "Colunas")}
                {campoNumero("linhas", "Linhas")}
                {campoNumero("margemSuperiorMm", "Margem de cima (mm)")}
                {campoNumero("margemEsquerdaMm", "Margem da esquerda (mm)")}
                {campoNumero("espacoHMm", "Espaço entre colunas (mm)")}
                {campoNumero("espacoVMm", "Espaço entre linhas (mm)")}
              </div>
            )}
            <div>
              <Label>Campos, de cima para baixo</Label>
              <ul className="mt-1 space-y-2">
                {e.campos.map((c, i) => (
                  <li key={c.campo} className="flex items-center gap-2 rounded-md border p-2">
                    <Switch
                      aria-label={`Mostrar ${TIPOS_CAMPO_ETIQUETA.find((t) => t.id === c.campo)?.nome}`}
                      checked={c.ativo}
                      onCheckedChange={(v) =>
                        setE((a) => ({
                          ...a,
                          campos: a.campos.map((x, j) => (j === i ? { ...x, ativo: v } : x)),
                        }))
                      }
                    />
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {TIPOS_CAMPO_ETIQUETA.find((t) => t.id === c.campo)?.nome}
                    </span>
                    {c.campo !== "codigo" && (
                      <Select
                        value={c.tamanho}
                        onValueChange={(v) =>
                          setE((a) => ({
                            ...a,
                            campos: a.campos.map((x, j) =>
                              j === i ? { ...x, tamanho: v as "p" | "m" | "g" } : x,
                            ),
                          }))
                        }
                      >
                        <SelectTrigger className="w-28" aria-label="Tamanho da letra">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {TAMANHOS.map((t) => (
                            <SelectItem key={t.id} value={t.id}>
                              {t.nome}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Subir"
                      disabled={i === 0}
                      onClick={() => setE((a) => moverCampoEditor(a, i, -1))}
                    >
                      <ArrowUp className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Descer"
                      disabled={i === e.campos.length - 1}
                      onClick={() => setE((a) => moverCampoEditor(a, i, 1))}
                    >
                      <ArrowDown className="size-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
            {!r.ok && <p className="text-sm text-destructive">{r.erro}</p>}
          </div>

          <div>
            <Label>Prévia (dados de exemplo)</Label>
            <div className="mt-1 overflow-auto rounded-md border bg-muted/40 p-3">
              {previa ? (
                <div style={{ width: largPx * escala, height: altPx * escala }}>
                  <iframe
                    title="Prévia da etiqueta"
                    sandbox=""
                    srcDoc={previa.html}
                    style={{
                      width: largPx,
                      height: altPx,
                      transform: `scale(${escala})`,
                      transformOrigin: "top left",
                      border: 0,
                      background: "white",
                    }}
                  />
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Ajuste as medidas e os campos para ver a prévia.
                </p>
              )}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              A prévia mostra como sai pelo driver do sistema. Nas impressoras que recebem comando
              direto (ZPL ou TSPL) as letras são desenhadas pela impressora e podem ficar um pouco
              diferentes: faça um teste com uma etiqueta.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={gravar} disabled={salvar.isPending}>
            Salvar modelo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
