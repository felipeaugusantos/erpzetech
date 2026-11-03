import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus } from "lucide-react";
import { toast } from "sonner";

import { useCamposPet } from "@/components/app/CamposPersonalizados";
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
import { useSessionData } from "@/hooks/useSessionData";
import { supabase } from "@/integrations/supabase/client";
import { useModulosCnae } from "@/lib/cnae";
import {
  ENTIDADES_CAMPO,
  TIPOS_CAMPO_PET,
  opcoesDoTexto,
  type EntidadeCampo,
  type TipoCampoPet,
} from "@/lib/pet-campos";
import { rotulo } from "@/lib/pet";

export const Route = createFileRoute("/_authenticated/pet-campos")({
  head: () => ({
    meta: [
      { title: "Campos personalizados do pet — EZRA ERP" },
      {
        name: "description",
        content: "Campos extras do cadastro do animal e do tutor, definidos pela sua clínica.",
      },
    ],
  }),
  component: CamposModulo,
});

type Form = {
  id?: string;
  entidade: EntidadeCampo;
  nome: string;
  tipo: TipoCampoPet;
  opcoes: string;
  obrigatorio: boolean;
  ordem: string;
  ativo: boolean;
};

const vazio: Form = {
  entidade: "pet",
  nome: "",
  tipo: "texto",
  opcoes: "",
  obrigatorio: false,
  ordem: "0",
  ativo: true,
};

function CamposModulo() {
  const modulos = useModulosCnae();
  if (modulos.carregando) return <div className="panel h-40 animate-pulse" />;
  if (!modulos.petshop) return <ModuloBloqueado modulo="petshop" />;
  return <Campos />;
}

function Campos() {
  const qc = useQueryClient();
  const { data: session } = useSessionData();
  const podeEditar = (session?.roles ?? []).some((r) => ["administrador", "gestor"].includes(r));
  const { data: campos = [], isLoading } = useCamposPet();
  const [aberto, setAberto] = useState(false);
  const [form, setForm] = useState<Form>(vazio);

  const salvar = useMutation({
    mutationFn: async () => {
      if (!form.nome.trim()) throw new Error("Informe o nome do campo.");
      const opcoes = opcoesDoTexto(form.opcoes);
      if (form.tipo === "lista" && opcoes.length < 2)
        throw new Error("A lista precisa de pelo menos 2 opções (uma por linha).");
      const ordem = Number(form.ordem || "0");
      if (!Number.isInteger(ordem) || ordem < 0 || ordem > 999)
        throw new Error("A ordem fica entre 0 e 999.");
      const { error } = await supabase.rpc("pet_campo_salvar", {
        p_dados: {
          ...(form.id ? { id: form.id } : { entidade: form.entidade }),
          nome: form.nome.trim(),
          tipo: form.tipo,
          opcoes: form.tipo === "lista" ? opcoes : [],
          obrigatorio: form.obrigatorio,
          ordem,
          ativo: form.ativo,
        },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(form.id ? "Campo atualizado." : "Campo criado.");
      setAberto(false);
      void qc.invalidateQueries({ queryKey: ["pet-campos"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div>
      <PageHeader
        title="Campos personalizados"
        description="Campos extras que aparecem no cadastro do animal e do tutor (por exemplo, pedigree, plano de saúde, veterinário de origem). Campo desativado some do cadastro, mas os valores já guardados ficam."
        actions={
          podeEditar ? (
            <Button
              onClick={() => {
                setForm(vazio);
                setAberto(true);
              }}
            >
              <Plus className="size-4" /> Novo campo
            </Button>
          ) : undefined
        }
      />

      {isLoading ? (
        <div className="panel h-40 animate-pulse" />
      ) : campos.length === 0 ? (
        <EmptyState
          title="Nenhum campo personalizado"
          description="Crie o primeiro campo para o cadastro do animal ou do tutor."
        />
      ) : (
        <div className="panel overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Campo</TableHead>
                <TableHead>Cadastro</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Ordem</TableHead>
                <TableHead className="text-right">Ação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {campos.map((c) => (
                <TableRow key={c.id} className={c.ativo ? "" : "opacity-60"}>
                  <TableCell className="font-medium">
                    {c.nome}
                    {c.obrigatorio && (
                      <Badge variant="secondary" className="ml-2">
                        Obrigatório
                      </Badge>
                    )}
                    {!c.ativo && (
                      <Badge variant="outline" className="ml-2">
                        Desativado
                      </Badge>
                    )}
                    {c.tipo === "lista" && (
                      <span className="block text-xs text-muted-foreground">
                        {c.opcoes.join(" · ")}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>{rotulo(ENTIDADES_CAMPO, c.entidade)}</TableCell>
                  <TableCell>{rotulo(TIPOS_CAMPO_PET, c.tipo)}</TableCell>
                  <TableCell>{c.ordem}</TableCell>
                  <TableCell className="text-right">
                    {podeEditar && (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Editar ${c.nome}`}
                        onClick={() => {
                          setForm({
                            id: c.id,
                            entidade: c.entidade,
                            nome: c.nome,
                            tipo: c.tipo,
                            opcoes: c.opcoes.join("\n"),
                            obrigatorio: c.obrigatorio,
                            ordem: String(c.ordem),
                            ativo: c.ativo,
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
            <DialogTitle>{form.id ? "Editar campo" : "Novo campo"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div>
              <Label htmlFor="pc-nome">Nome do campo</Label>
              <Input
                id="pc-nome"
                maxLength={60}
                value={form.nome}
                onChange={(e) => setForm({ ...form, nome: e.target.value })}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="pc-ent">Cadastro</Label>
                <Select
                  value={form.entidade}
                  disabled={Boolean(form.id)}
                  onValueChange={(v) => setForm({ ...form, entidade: v as EntidadeCampo })}
                >
                  <SelectTrigger id="pc-ent">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ENTIDADES_CAMPO.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="pc-tipo">Tipo</Label>
                <Select
                  value={form.tipo}
                  onValueChange={(v) => setForm({ ...form, tipo: v as TipoCampoPet })}
                >
                  <SelectTrigger id="pc-tipo">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TIPOS_CAMPO_PET.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {form.tipo === "lista" && (
              <div>
                <Label htmlFor="pc-opcoes">Opções (uma por linha)</Label>
                <Textarea
                  id="pc-opcoes"
                  rows={4}
                  value={form.opcoes}
                  onChange={(e) => setForm({ ...form, opcoes: e.target.value })}
                />
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="pc-ordem">Ordem na tela</Label>
                <Input
                  id="pc-ordem"
                  inputMode="numeric"
                  value={form.ordem}
                  onChange={(e) => setForm({ ...form, ordem: e.target.value })}
                />
              </div>
              <div className="flex flex-col justify-end gap-2">
                <div className="flex items-center gap-2">
                  <Switch
                    id="pc-obrig"
                    checked={form.obrigatorio}
                    onCheckedChange={(v) => setForm({ ...form, obrigatorio: v })}
                  />
                  <Label htmlFor="pc-obrig">Obrigatório</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    id="pc-ativo"
                    checked={form.ativo}
                    onCheckedChange={(v) => setForm({ ...form, ativo: v })}
                  />
                  <Label htmlFor="pc-ativo">Ativo</Label>
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAberto(false)}>
              Cancelar
            </Button>
            <Button onClick={() => salvar.mutate()} disabled={salvar.isPending}>
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
