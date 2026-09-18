import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Plus } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useSessionData } from "@/hooks/useSessionData";
import { PageHeader, EmptyState } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ramos } from "@/lib/ramo";

export const Route = createFileRoute("/_authenticated/configuracoes")({
  head: () => ({
    meta: [
      { title: "Configurações — ERP Ze Tech" },
      { name: "description", content: "Dados da empresa, filiais e preferências do usuário." },
      { property: "og:title", content: "Configurações — ERP Ze Tech" },
      { property: "og:description", content: "Configure empresa e filiais do sistema." },
    ],
  }),
  component: Configuracoes,
});

function Configuracoes() {
  const qc = useQueryClient();
  const { data: session } = useSessionData();
  const [empresa, setEmpresa] = useState({
    razao_social: "",
    nome_fantasia: "",
    cnpj: "",
    inscricao_estadual: "",
    telefone: "",
    email: "",
    cep: "",
    endereco: "",
    numero: "",
    bairro: "",
    cidade: "",
    estado: "",
    ramo_atividade: "construcao",
  });
  const [perfil, setPerfil] = useState({ nome: "", telefone: "" });
  const [openFilial, setOpenFilial] = useState(false);
  const [filial, setFilial] = useState({ nome: "", codigo: "", telefone: "", cidade: "", estado: "" });

  const { data } = useQuery({
    queryKey: ["configuracoes"],
    queryFn: async () => {
      const [emp, fil, prof] = await Promise.all([
        supabase.from("empresas").select("*").limit(1).maybeSingle(),
        supabase.from("filiais").select("*").order("nome"),
        supabase.from("profiles").select("*").eq("id", (await supabase.auth.getUser()).data.user!.id).maybeSingle(),
      ]);
      return { empresa: emp.data, filiais: fil.data ?? [], perfil: prof.data };
    },
  });

  useEffect(() => {
    if (data?.empresa) {
      setEmpresa({
        razao_social: data.empresa.razao_social ?? "",
        nome_fantasia: data.empresa.nome_fantasia ?? "",
        cnpj: data.empresa.cnpj ?? "",
        inscricao_estadual: data.empresa.inscricao_estadual ?? "",
        telefone: data.empresa.telefone ?? "",
        email: data.empresa.email ?? "",
        cep: data.empresa.cep ?? "",
        endereco: data.empresa.endereco ?? "",
        numero: data.empresa.numero ?? "",
        bairro: data.empresa.bairro ?? "",
        cidade: data.empresa.cidade ?? "",
        estado: data.empresa.estado ?? "",
        ramo_atividade: data.empresa.ramo_atividade ?? "construcao",
      });
    }
    if (data?.perfil) {
      setPerfil({ nome: data.perfil.nome ?? "", telefone: data.perfil.telefone ?? "" });
    }
  }, [data]);

  const salvarEmpresa = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("empresas")
        .update(empresa)
        .eq("id", data!.empresa!.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Dados da empresa salvos");
      qc.invalidateQueries({ queryKey: ["configuracoes"] });
      qc.invalidateQueries({ queryKey: ["session-data"] });
    },
    onError: (e: Error) => toast.error("Erro ao salvar", { description: e.message }),
  });

  const salvarPerfil = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("profiles")
        .update(perfil)
        .eq("id", session!.user.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Perfil atualizado");
      qc.invalidateQueries({ queryKey: ["session-data"] });
    },
    onError: (e: Error) => toast.error("Erro ao salvar", { description: e.message }),
  });

  const criarFilial = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("filiais").insert({
        tenant_id: session?.profile?.tenant_id as string,
        empresa_id: data!.empresa!.id,
        nome: filial.nome,
        codigo: filial.codigo || null,
        telefone: filial.telefone || null,
        cidade: filial.cidade || null,
        estado: filial.estado || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Filial criada");
      setOpenFilial(false);
      setFilial({ nome: "", codigo: "", telefone: "", cidade: "", estado: "" });
      qc.invalidateQueries({ queryKey: ["configuracoes"] });
      qc.invalidateQueries({ queryKey: ["session-data"] });
    },
    onError: (e: Error) => toast.error("Erro ao salvar", { description: e.message }),
  });

  return (
    <>
      <PageHeader
        title="Configurações"
        description="Dados da empresa, filiais e seu perfil de usuário."
      />

      <Tabs defaultValue="empresa">
        <TabsList>
          <TabsTrigger value="empresa">Empresa</TabsTrigger>
          <TabsTrigger value="filiais">Filiais</TabsTrigger>
          <TabsTrigger value="perfil">Meu perfil</TabsTrigger>
        </TabsList>

        <TabsContent value="empresa" className="mt-4">
          <div className="panel max-w-3xl p-5">
            <div className="mb-4 flex items-center gap-2">
              <span className="grid size-9 place-items-center rounded-md bg-secondary">
                <Building2 className="size-4" />
              </span>
              <div>
                <p className="font-display text-sm font-semibold">Dados cadastrais</p>
                <p className="text-xs text-muted-foreground">
                  Usados em orçamentos, pedidos e documentos.
                </p>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="e-rs">Razão social</Label>
                <Input
                  id="e-rs"
                  value={empresa.razao_social}
                  onChange={(e) => setEmpresa({ ...empresa, razao_social: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="e-nf">Nome fantasia</Label>
                <Input
                  id="e-nf"
                  value={empresa.nome_fantasia}
                  onChange={(e) => setEmpresa({ ...empresa, nome_fantasia: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="e-ramo">Ramo de atividade</Label>
                <Select
                  value={empresa.ramo_atividade}
                  onValueChange={(v) => setEmpresa({ ...empresa, ramo_atividade: v })}
                >
                  <SelectTrigger id="e-ramo" aria-label="Ramo de atividade">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ramos.map((r) => (
                      <SelectItem key={r.value} value={r.value}>
                        {r.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="mt-1 text-xs text-muted-foreground">
                  No ramo de roupas e calçados o cadastro de produto libera a grade de tamanhos.
                </p>
              </div>
              <div>
                <Label htmlFor="e-cnpj">CNPJ</Label>
                <Input
                  id="e-cnpj"
                  value={empresa.cnpj}
                  onChange={(e) => setEmpresa({ ...empresa, cnpj: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="e-ie">Inscrição estadual</Label>
                <Input
                  id="e-ie"
                  value={empresa.inscricao_estadual}
                  onChange={(e) => setEmpresa({ ...empresa, inscricao_estadual: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="e-tel">Telefone</Label>
                <Input
                  id="e-tel"
                  value={empresa.telefone}
                  onChange={(e) => setEmpresa({ ...empresa, telefone: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="e-mail">E-mail</Label>
                <Input
                  id="e-mail"
                  value={empresa.email}
                  onChange={(e) => setEmpresa({ ...empresa, email: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="e-cep">CEP</Label>
                <Input
                  id="e-cep"
                  value={empresa.cep}
                  onChange={(e) => setEmpresa({ ...empresa, cep: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="e-end">Endereço</Label>
                <Input
                  id="e-end"
                  value={empresa.endereco}
                  onChange={(e) => setEmpresa({ ...empresa, endereco: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="e-num">Número</Label>
                <Input
                  id="e-num"
                  value={empresa.numero}
                  onChange={(e) => setEmpresa({ ...empresa, numero: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="e-bai">Bairro</Label>
                <Input
                  id="e-bai"
                  value={empresa.bairro}
                  onChange={(e) => setEmpresa({ ...empresa, bairro: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="e-cid">Cidade</Label>
                <Input
                  id="e-cid"
                  value={empresa.cidade}
                  onChange={(e) => setEmpresa({ ...empresa, cidade: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="e-uf">Estado</Label>
                <Input
                  id="e-uf"
                  maxLength={2}
                  value={empresa.estado}
                  onChange={(e) => setEmpresa({ ...empresa, estado: e.target.value.toUpperCase() })}
                />
              </div>
            </div>
            <div className="mt-4">
              <Button onClick={() => salvarEmpresa.mutate()} disabled={salvarEmpresa.isPending}>
                Salvar empresa
              </Button>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="filiais" className="mt-4">
          <div className="mb-3 flex justify-end">
            <Button onClick={() => setOpenFilial(true)}>
              <Plus className="mr-2 size-4" /> Nova filial
            </Button>
          </div>
          {(data?.filiais.length ?? 0) === 0 ? (
            <EmptyState title="Nenhuma filial encontrada." description="Cadastre a primeira filial." />
          ) : (
            <div className="panel overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Filial</TableHead>
                    <TableHead>Código</TableHead>
                    <TableHead>Telefone</TableHead>
                    <TableHead>Cidade</TableHead>
                    <TableHead>Situação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(data?.filiais ?? []).map((f) => (
                    <TableRow key={f.id}>
                      <TableCell className="font-medium">{f.nome}</TableCell>
                      <TableCell className="text-numeric">{f.codigo ?? "—"}</TableCell>
                      <TableCell>{f.telefone ?? "—"}</TableCell>
                      <TableCell>{f.cidade ? `${f.cidade}/${f.estado ?? ""}` : "—"}</TableCell>
                      <TableCell>
                        {f.ativo ? <Badge variant="secondary">Ativa</Badge> : <Badge variant="outline">Inativa</Badge>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="perfil" className="mt-4">
          <div className="panel max-w-lg p-5">
            <div className="grid gap-3">
              <div>
                <Label htmlFor="u-nome">Nome</Label>
                <Input
                  id="u-nome"
                  value={perfil.nome}
                  onChange={(e) => setPerfil({ ...perfil, nome: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="u-tel">Telefone</Label>
                <Input
                  id="u-tel"
                  value={perfil.telefone}
                  onChange={(e) => setPerfil({ ...perfil, telefone: e.target.value })}
                />
              </div>
              <div>
                <Label>E-mail</Label>
                <Input value={session?.user.email ?? ""} readOnly />
              </div>
              <div>
                <Label>Perfis de acesso</Label>
                <div className="mt-1 flex flex-wrap gap-1">
                  {(session?.roles ?? []).map((r) => (
                    <Badge key={r} variant="secondary" className="capitalize">
                      {r}
                    </Badge>
                  ))}
                </div>
              </div>
              <Button
                className="mt-2 w-fit"
                onClick={() => salvarPerfil.mutate()}
                disabled={salvarPerfil.isPending}
              >
                Salvar perfil
              </Button>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={openFilial} onOpenChange={setOpenFilial}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova filial</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label htmlFor="f-nome">Nome</Label>
              <Input
                id="f-nome"
                value={filial.nome}
                onChange={(e) => setFilial({ ...filial, nome: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="f-cod">Código</Label>
              <Input
                id="f-cod"
                value={filial.codigo}
                onChange={(e) => setFilial({ ...filial, codigo: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="f-tel">Telefone</Label>
              <Input
                id="f-tel"
                value={filial.telefone}
                onChange={(e) => setFilial({ ...filial, telefone: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="f-cid">Cidade</Label>
              <Input
                id="f-cid"
                value={filial.cidade}
                onChange={(e) => setFilial({ ...filial, cidade: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="f-uf">Estado</Label>
              <Input
                id="f-uf"
                maxLength={2}
                value={filial.estado}
                onChange={(e) => setFilial({ ...filial, estado: e.target.value.toUpperCase() })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => criarFilial.mutate()} disabled={!filial.nome.trim() || criarFilial.isPending}>
              Salvar filial
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
