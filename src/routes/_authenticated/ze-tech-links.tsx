import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Pencil, Plus, Users } from "lucide-react";
import { toast } from "sonner";

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
import { supabase } from "@/integrations/supabase/client";
import { dateTimeBR } from "@/lib/format";
import { erroDoLink, linkFinal, normalizarSlug } from "@/lib/link-acesso";
import { useSaasOperador } from "@/lib/saas";

export const Route = createFileRoute("/_authenticated/ze-tech-links")({
  head: () => ({
    meta: [
      { title: "Links de acesso — Ze Tech" },
      {
        name: "description",
        content:
          "Crie links de acesso personalizados por empresa e veja qual link cada usuário usou para entrar.",
      },
    ],
  }),
  component: LinksZeTech,
});

type Linha = {
  tenant_id: string;
  cliente: string;
  link_id: string | null;
  slug: string;
  rotulo: string | null;
  ativo: boolean;
  origem: "personalizado" | "principal" | "assinante";
  criado_em: string;
  usuarios: number;
  acessos: number;
  ultimo_acesso: string | null;
};

type UsuarioDoLink = {
  user_id: string;
  nome: string;
  usuario: string | null;
  email: string | null;
  ativo: boolean;
  ultimo_acesso: string | null;
  links: {
    slug: string;
    origem: string;
    rotulo: string | null;
    acessos: number;
    ultimo_em: string;
  }[];
};

const ORIGEM: Record<Linha["origem"], string> = {
  personalizado: "Personalizado",
  principal: "Principal da empresa",
  assinante: "Cadastro do assinante",
};

const urlDoLink = (slug: string) =>
  `${typeof window !== "undefined" ? window.location.origin : ""}/${slug}`;

function copiar(texto: string) {
  void navigator.clipboard.writeText(texto).then(
    () => toast.success("Link copiado."),
    () => toast.error("Não foi possível copiar."),
  );
}

function LinksZeTech() {
  const qc = useQueryClient();
  const { data: operador, isLoading: carregandoAcesso } = useSaasOperador();
  const [busca, setBusca] = useState("");
  const [novo, setNovo] = useState(false);
  const [editando, setEditando] = useState<Linha | null>(null);
  const [verUsuarios, setVerUsuarios] = useState<{ tenant: string; cliente: string } | null>(null);

  const { data: linhas = [], isLoading } = useQuery({
    queryKey: ["saas-links"],
    enabled: operador === true,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("saas_links_listar");
      if (error) throw error;
      return (data ?? []) as unknown as Linha[];
    },
  });

  const { data: empresas = [] } = useQuery({
    queryKey: ["saas-links-empresas"],
    enabled: operador === true,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("saas_clientes")
        .select("nome, tenant_id")
        .not("tenant_id", "is", null)
        .order("nome");
      if (error) throw error;
      return (data ?? []) as { nome: string; tenant_id: string }[];
    },
  });

  const filtradas = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return t
      ? linhas.filter((l) => `${l.cliente} ${l.slug} ${l.rotulo ?? ""}`.toLowerCase().includes(t))
      : linhas;
  }, [linhas, busca]);

  if (carregandoAcesso) {
    return <div className="panel p-6 text-sm text-muted-foreground">Carregando…</div>;
  }
  if (operador !== true) {
    return (
      <EmptyState
        title="Área exclusiva da equipe Ze Tech."
        description="Entre com um acesso da equipe para administrar os links de acesso."
      />
    );
  }

  const atualizar = () => void qc.invalidateQueries({ queryKey: ["saas-links"] });

  return (
    <div>
      <PageHeader
        title="Links de acesso"
        description="Cada link abre a tela de login da empresa com a marca dela. O texto do link é livre e não depende do nome da empresa; uma empresa pode ter vários. Veja quantos usuários entraram por cada link e, em Usuários, qual link cada um usou."
        actions={
          <Button onClick={() => setNovo(true)}>
            <Plus className="size-4" /> Novo link
          </Button>
        }
      />

      <div className="mb-4 max-w-sm">
        <Input
          placeholder="Buscar por empresa ou link"
          aria-label="Buscar"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />
      </div>

      {isLoading ? (
        <div className="panel h-40 animate-pulse" />
      ) : filtradas.length === 0 ? (
        <EmptyState
          title="Nenhum link encontrado"
          description="Crie o primeiro link de uma empresa em Novo link."
        />
      ) : (
        <div className="panel overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Empresa</TableHead>
                <TableHead>Link</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead className="text-right">Usuários</TableHead>
                <TableHead className="text-right">Entradas</TableHead>
                <TableHead>Último acesso</TableHead>
                <TableHead className="text-right">Ação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtradas.map((l) => (
                <TableRow key={`${l.tenant_id}-${l.slug}`} className={l.ativo ? "" : "opacity-60"}>
                  <TableCell className="font-medium">{l.cliente}</TableCell>
                  <TableCell>
                    <div className="font-mono text-xs">/{l.slug}</div>
                    {l.rotulo && <div className="text-xs text-muted-foreground">{l.rotulo}</div>}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{ORIGEM[l.origem]}</Badge>
                    {!l.ativo && (
                      <Badge variant="secondary" className="ml-1">
                        Desativado
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">{l.usuarios}</TableCell>
                  <TableCell className="text-right">{l.acessos}</TableCell>
                  <TableCell>{l.ultimo_acesso ? dateTimeBR(l.ultimo_acesso) : "—"}</TableCell>
                  <TableCell className="space-x-1 text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Copiar o link ${l.slug}`}
                      onClick={() => copiar(urlDoLink(l.slug))}
                    >
                      <Copy className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Ver usuários de ${l.cliente}`}
                      onClick={() => setVerUsuarios({ tenant: l.tenant_id, cliente: l.cliente })}
                    >
                      <Users className="size-4" />
                    </Button>
                    {l.link_id && (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Editar o link ${l.slug}`}
                        onClick={() => setEditando(l)}
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

      {novo && (
        <NovoLink
          empresas={empresas}
          onFechar={() => setNovo(false)}
          onCriado={() => {
            setNovo(false);
            atualizar();
          }}
        />
      )}
      {editando && (
        <EditarLink
          linha={editando}
          onFechar={() => setEditando(null)}
          onSalvo={() => {
            setEditando(null);
            atualizar();
          }}
        />
      )}
      {verUsuarios && (
        <UsuariosDaEmpresa
          tenant={verUsuarios.tenant}
          cliente={verUsuarios.cliente}
          onFechar={() => setVerUsuarios(null)}
        />
      )}
    </div>
  );
}

function NovoLink({
  empresas,
  onFechar,
  onCriado,
}: {
  empresas: { nome: string; tenant_id: string }[];
  onFechar: () => void;
  onCriado: () => void;
}) {
  const [tenant, setTenant] = useState("");
  const [slug, setSlug] = useState("");
  const [rotulo, setRotulo] = useState("");

  const criar = useMutation({
    mutationFn: async () => {
      if (!tenant) throw new Error("Escolha a empresa.");
      const link = linkFinal(slug);
      if (!link) throw new Error("Informe o link.");
      const erro = erroDoLink(link);
      if (erro) throw new Error(erro);
      const { error } = await supabase.rpc("saas_link_criar", {
        p_tenant: tenant,
        p_slug: link,
        p_rotulo: rotulo.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Link criado.");
      onCriado();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Novo link de acesso</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div>
            <Label htmlFor="nl-empresa">Empresa</Label>
            <Select value={tenant} onValueChange={setTenant}>
              <SelectTrigger id="nl-empresa">
                <SelectValue placeholder="Escolha a empresa" />
              </SelectTrigger>
              <SelectContent>
                {empresas.map((e) => (
                  <SelectItem key={e.tenant_id} value={e.tenant_id}>
                    {e.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="nl-slug">Link</Label>
            <div className="flex items-center gap-1 text-sm">
              <span className="text-muted-foreground">
                {typeof window !== "undefined" ? window.location.host : ""}/
              </span>
              <Input
                id="nl-slug"
                value={slug}
                placeholder="qualquer-texto"
                onChange={(e) => setSlug(normalizarSlug(e.target.value))}
              />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              De 3 a 50 letras minúsculas, números e hífen. Não precisa ter relação com o nome da
              empresa. Depois de criado, o texto não muda: para trocar, crie outro e desative este.
            </p>
          </div>
          <div>
            <Label htmlFor="nl-rotulo">Nome do link (opcional)</Label>
            <Input
              id="nl-rotulo"
              value={rotulo}
              maxLength={80}
              placeholder="Ex.: Equipe do caixa, Filial Centro"
              onChange={(e) => setRotulo(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>
            Cancelar
          </Button>
          <Button onClick={() => criar.mutate()} disabled={criar.isPending}>
            Criar link
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditarLink({
  linha,
  onFechar,
  onSalvo,
}: {
  linha: Linha;
  onFechar: () => void;
  onSalvo: () => void;
}) {
  const [rotulo, setRotulo] = useState(linha.rotulo ?? "");
  const [ativo, setAtivo] = useState(linha.ativo);

  const salvar = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("saas_link_atualizar", {
        p_id: linha.link_id as string,
        p_rotulo: rotulo.trim(),
        p_ativo: ativo,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Link atualizado.");
      onSalvo();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Link /{linha.slug}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div>
            <Label htmlFor="el-rotulo">Nome do link</Label>
            <Input
              id="el-rotulo"
              value={rotulo}
              maxLength={80}
              onChange={(e) => setRotulo(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <Switch id="el-ativo" checked={ativo} onCheckedChange={setAtivo} />
            <Label htmlFor="el-ativo">Ativo</Label>
          </div>
          {!ativo && (
            <p className="text-xs text-muted-foreground">
              Link desativado deixa de abrir a tela de login e de aceitar entrada. O histórico de
              uso continua.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>
            Cancelar
          </Button>
          <Button onClick={() => salvar.mutate()} disabled={salvar.isPending}>
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UsuariosDaEmpresa({
  tenant,
  cliente,
  onFechar,
}: {
  tenant: string;
  cliente: string;
  onFechar: () => void;
}) {
  const { data = [], isLoading } = useQuery({
    queryKey: ["saas-link-usuarios", tenant],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("saas_link_usuarios", { p_tenant: tenant });
      if (error) throw error;
      return (data ?? []) as unknown as UsuarioDoLink[];
    },
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Usuários de {cliente}</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          Código da empresa (também abre o login): <span className="font-mono">{tenant}</span>
        </p>
        {isLoading ? (
          <div className="h-24 animate-pulse rounded bg-muted" />
        ) : data.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum usuário nesta empresa.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Usuário</TableHead>
                <TableHead>Links usados</TableHead>
                <TableHead>Último acesso</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((u) => (
                <TableRow key={u.user_id} className={u.ativo ? "" : "opacity-60"}>
                  <TableCell>
                    <div className="font-medium">{u.nome}</div>
                    <div className="text-xs text-muted-foreground">
                      {u.usuario ?? u.email ?? "—"}
                      {!u.ativo ? " · inativo" : ""}
                    </div>
                  </TableCell>
                  <TableCell>
                    {u.links.length === 0 ? (
                      <span className="text-xs text-muted-foreground">
                        Nenhum (entrou pelo login geral)
                      </span>
                    ) : (
                      <ul className="space-y-0.5 text-xs">
                        {u.links.map((l) => (
                          <li key={l.slug}>
                            <span className="font-mono">
                              /{l.slug.length > 40 ? "código da empresa" : l.slug}
                            </span>
                            {l.rotulo ? ` · ${l.rotulo}` : ""} · {l.acessos}{" "}
                            {l.acessos === 1 ? "entrada" : "entradas"}
                          </li>
                        ))}
                      </ul>
                    )}
                  </TableCell>
                  <TableCell>{u.ultimo_acesso ? dateTimeBR(u.ultimo_acesso) : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
