import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Syringe } from "lucide-react";
import { toast } from "sonner";

import { ModuloBloqueado } from "@/components/app/ModuloCnae";
import { EmptyState, PageHeader } from "@/components/app/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { podeSalvarCatalogo, precisaControleDose, type ProdutoVacina } from "@/lib/vacina-produto";
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
import { useSessionData } from "@/hooks/useSessionData";
import { supabase } from "@/integrations/supabase/client";
import { useModulosCnae } from "@/lib/cnae";
import {
  ESPECIES_VACINA,
  SUGESTOES_CATALOGO,
  TIPOS_VACINA,
  resumoDoProtocolo,
  type ItemCatalogo,
} from "@/lib/vacinas";
import { rotulo } from "@/lib/pet";

export const Route = createFileRoute("/_authenticated/clinica-catalogo")({
  head: () => ({
    meta: [
      { title: "Catálogo de vacinas — EZRA ERP" },
      {
        name: "description",
        content: "Vacinas e vermífugos da clínica, com série de doses e intervalo de reforço.",
      },
      { property: "og:title", content: "Catálogo de vacinas — ERP Ze Tech" },
      {
        property: "og:description",
        content: "Vacinas e vermífugos da clínica com produto, lote e protocolo conferidos.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CatalogoModulo,
});

type Form = {
  id?: string;
  nome: string;
  tipo: string;
  especie: string;
  doses_serie: string;
  intervalo_serie_dias: string;
  reforco_dias: string;
  idade_minima_dias: string;
  produto_id: string;
  ativo: boolean;
  confirmar_controle_lote: boolean;
};

const vazio: Form = {
  nome: "",
  tipo: "vacina",
  especie: "todas",
  doses_serie: "1",
  intervalo_serie_dias: "",
  reforco_dias: "365",
  idade_minima_dias: "",
  produto_id: "",
  ativo: true,
  confirmar_controle_lote: false,
};

function CatalogoModulo() {
  const modulos = useModulosCnae();
  if (modulos.carregando) return <div className="panel h-40 animate-pulse" />;
  if (!modulos.clinica) return <ModuloBloqueado modulo="clinica" />;
  return <Catalogo />;
}

function Catalogo() {
  const qc = useQueryClient();
  const { data: sessao } = useSessionData();
  // a gestão cadastra (escolhe o produto do estoque); o veterinário consulta o catálogo
  const pode = (sessao?.roles ?? []).some((r) =>
    ["administrador", "gestor", "veterinario"].includes(r),
  );
  const [aberto, setAberto] = useState(false);
  const [form, setForm] = useState<Form>(vazio);
  const [criarDose, setCriarDose] = useState(true);
  const [novaDoseId, setNovaDoseId] = useState("");

  const { data: itens = [], isLoading } = useQuery({
    queryKey: ["clinica-catalogo"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("clinica_vacinas_catalogo");
      if (error) throw error;
      return (data ?? []) as unknown as ItemCatalogo[];
    },
  });

  const consultaProdutos = useQuery({
    queryKey: ["clinica-catalogo-produtos"],
    enabled: aberto && pode,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("clinica_vacina_produtos");
      if (error) throw error;
      return (data ?? []) as unknown as ProdutoVacina[];
    },
  });
  const produtos = consultaProdutos.data ?? [];
  const produto = produtos.find((p) => p.id === form.produto_id);

  const salvar = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("clinica_vacina_catalogo_salvar", {
        p_dados: {
          ...(form.id ? { id: form.id } : {}),
          nome: form.nome.trim(),
          tipo: form.tipo,
          especie: form.especie,
          doses_serie: form.doses_serie,
          intervalo_serie_dias: form.intervalo_serie_dias,
          reforco_dias: form.reforco_dias,
          idade_minima_dias: form.idade_minima_dias,
          produto_id: criarDose ? "" : form.produto_id,
          criar_produto_dose: criarDose,
          novo_produto_id: criarDose ? novaDoseId : "",
          ativo: form.ativo,
          confirmar_controle_lote: form.confirmar_controle_lote,
        },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Catálogo atualizado");
      setAberto(false);
      setForm(vazio);
      void qc.invalidateQueries({ queryKey: ["clinica-catalogo"] });
      void qc.invalidateQueries({ queryKey: ["clinica-catalogo-produtos"] });
      void qc.invalidateQueries({ queryKey: ["produtos"] });
    },
    onError: (e: Error) => toast.error("Não foi possível salvar", { description: e.message }),
  });

  const serie = Number(form.doses_serie) > 1;

  return (
    <div>
      <PageHeader
        title="Catálogo de vacinas e vermífugos"
        description="Cada item guarda a série de doses e o intervalo de reforço. A dose baixa o lote do produto escolhido; quem cobra é o serviço de vacina da agenda."
        actions={
          pode ? (
            <Button
              onClick={() => {
                setForm(vazio);
                setCriarDose(true);
                setNovaDoseId(crypto.randomUUID());
                setAberto(true);
              }}
            >
              <Plus className="size-4" /> Novo item
            </Button>
          ) : undefined
        }
      />

      {isLoading ? (
        <div className="panel h-40 animate-pulse" />
      ) : itens.length === 0 ? (
        <EmptyState
          title="Catálogo vazio"
          description="Cadastre as vacinas e vermífugos da clínica. Em Novo item há sugestões de protocolo para conferir com o veterinário responsável."
        />
      ) : (
        <div className="panel overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead>Para</TableHead>
                <TableHead>Protocolo</TableHead>
                <TableHead>Produto (lote)</TableHead>
                <TableHead className="text-right">Ação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {itens.map((i) => (
                <TableRow key={i.id} className={i.ativo ? "" : "opacity-60"}>
                  <TableCell className="font-medium">
                    <Syringe className="mr-1 inline size-4 text-muted-foreground" />
                    {i.nome}
                    <span className="block text-xs text-muted-foreground">
                      {rotulo(TIPOS_VACINA, i.tipo)}
                      {i.idade_minima_dias !== null
                        ? ` · a partir de ${i.idade_minima_dias} dias`
                        : ""}
                    </span>
                    {!i.ativo && <Badge variant="outline">Inativo</Badge>}
                  </TableCell>
                  <TableCell>{rotulo(ESPECIES_VACINA, i.especie)}</TableCell>
                  <TableCell>{resumoDoProtocolo(i)}</TableCell>
                  <TableCell>{i.produto}</TableCell>
                  <TableCell className="text-right">
                    {pode && (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Editar ${i.nome}`}
                        onClick={() => {
                          setCriarDose(false);
                          setNovaDoseId(crypto.randomUUID());
                          setForm({
                            id: i.id,
                            nome: i.nome,
                            tipo: i.tipo,
                            especie: i.especie,
                            doses_serie: String(i.doses_serie),
                            intervalo_serie_dias: i.intervalo_serie_dias?.toString() ?? "",
                            reforco_dias: String(i.reforco_dias),
                            idade_minima_dias: i.idade_minima_dias?.toString() ?? "",
                            produto_id: i.produto_id,
                            ativo: i.ativo,
                            confirmar_controle_lote: false,
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

      <Dialog open={aberto} onOpenChange={(o) => !o && setAberto(false)}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{form.id ? "Editar item" : "Novo item do catálogo"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            {!form.id && (
              <div>
                <Label>Começar de uma sugestão</Label>
                <div className="mt-1 flex flex-wrap gap-2">
                  {SUGESTOES_CATALOGO.map((s) => (
                    <Button
                      key={s.nome}
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setForm({
                          ...form,
                          nome: s.nome,
                          tipo: s.tipo,
                          especie: s.especie,
                          doses_serie: String(s.doses_serie),
                          intervalo_serie_dias: s.intervalo_serie_dias?.toString() ?? "",
                          reforco_dias: String(s.reforco_dias),
                          idade_minima_dias: s.idade_minima_dias?.toString() ?? "",
                        })
                      }
                    >
                      {s.nome}
                    </Button>
                  ))}
                </div>
                <p className="mt-1 text-xs text-amber-800">
                  Sugestão para começar — o veterinário responsável confere o protocolo e a bula do
                  produto antes de usar.
                </p>
              </div>
            )}
            <div>
              <Label htmlFor="v-nome">Nome</Label>
              <Input
                id="v-nome"
                value={form.nome}
                onChange={(e) => setForm({ ...form, nome: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="v-tipo">Tipo</Label>
                <Select value={form.tipo} onValueChange={(v) => setForm({ ...form, tipo: v })}>
                  <SelectTrigger id="v-tipo">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TIPOS_VACINA.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="v-esp">Para</Label>
                <Select
                  value={form.especie}
                  onValueChange={(v) => setForm({ ...form, especie: v })}
                >
                  <SelectTrigger id="v-esp">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ESPECIES_VACINA.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label htmlFor="v-doses">Doses na série</Label>
                <Input
                  id="v-doses"
                  inputMode="numeric"
                  value={form.doses_serie}
                  onChange={(e) => setForm({ ...form, doses_serie: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="v-inter">Dias entre doses</Label>
                <Input
                  id="v-inter"
                  inputMode="numeric"
                  disabled={!serie}
                  value={serie ? form.intervalo_serie_dias : ""}
                  onChange={(e) => setForm({ ...form, intervalo_serie_dias: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="v-ref">Reforço (dias)</Label>
                <Input
                  id="v-ref"
                  inputMode="numeric"
                  value={form.reforco_dias}
                  onChange={(e) => setForm({ ...form, reforco_dias: e.target.value })}
                />
              </div>
            </div>
            <div>
              <Label htmlFor="v-idade">Idade mínima (dias) — opcional, só avisa</Label>
              <Input
                id="v-idade"
                inputMode="numeric"
                value={form.idade_minima_dias}
                onChange={(e) => setForm({ ...form, idade_minima_dias: e.target.value })}
              />
            </div>
            <div>
              <div className="mb-2 flex items-center gap-2">
                <Checkbox
                  id="v-criar-dose"
                  checked={criarDose}
                  onCheckedChange={(checked) => {
                    setCriarDose(checked === true);
                    setForm({ ...form, confirmar_controle_lote: false });
                  }}
                />
                <Label htmlFor="v-criar-dose">Cadastrar a dose junto com esta vacina</Label>
              </div>
              {criarDose ? (
                <p className="text-sm text-muted-foreground">
                  Dose: {form.nome.trim() || "Informe o nome acima"}. Controle de estoque e lote
                  habilitado, sem saldo inicial.
                </p>
              ) : (
                <>
                  <Label htmlFor="v-prod">Dose já cadastrada (controle por lote)</Label>
                  <Select
                    value={form.produto_id || "__nenhum"}
                    onValueChange={(v) =>
                      setForm({
                        ...form,
                        produto_id: v === "__nenhum" ? "" : v,
                        confirmar_controle_lote: false,
                      })
                    }
                  >
                    <SelectTrigger id="v-prod">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__nenhum">Escolha o produto</SelectItem>
                      {produtos.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.descricao}
                          {precisaControleDose(p) ? " · configurar lote" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="mt-1 text-xs text-muted-foreground">
                    O produto nunca vai para a venda: a cobrança é do serviço de vacina.
                  </p>
                  {consultaProdutos.isLoading && (
                    <p role="status" className="mt-2 text-sm text-muted-foreground">
                      Carregando produtos…
                    </p>
                  )}
                  {consultaProdutos.error && (
                    <p role="alert" className="mt-2 text-sm text-destructive">
                      Não foi possível carregar os produtos.
                    </p>
                  )}
                  {!consultaProdutos.isLoading &&
                    !consultaProdutos.error &&
                    produtos.length === 0 && (
                      <p className="mt-2 text-sm text-warning">
                        Nenhum produto ativo cadastrado para vincular à dose.
                      </p>
                    )}
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => void consultaProdutos.refetch()}
                      disabled={consultaProdutos.isFetching}
                    >
                      Atualizar produtos
                    </Button>
                  </div>
                  {precisaControleDose(produto) && (
                    <div className="mt-3 rounded-md border border-warning bg-warning/10 p-3">
                      <div className="flex items-start gap-2">
                        <Checkbox
                          id="v-confirmar-lote"
                          checked={form.confirmar_controle_lote}
                          onCheckedChange={(checked) =>
                            setForm({ ...form, confirmar_controle_lote: checked === true })
                          }
                        />
                        <Label htmlFor="v-confirmar-lote" className="leading-relaxed">
                          Ativar controle de estoque e lote para este produto ao salvar.
                        </Label>
                      </div>
                    </div>
                  )}
                  {!form.produto_id && (
                    <p className="mt-2 text-sm text-warning">
                      Selecione o produto da dose para salvar a vacina.
                    </p>
                  )}
                </>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="v-ativo"
                checked={form.ativo}
                onCheckedChange={(v) => setForm({ ...form, ativo: v })}
              />
              <Label htmlFor="v-ativo">Ativo</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAberto(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => salvar.mutate()}
              disabled={
                salvar.isPending ||
                !podeSalvarCatalogo(form.nome, produto, form.confirmar_controle_lote, criarDose)
              }
            >
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
