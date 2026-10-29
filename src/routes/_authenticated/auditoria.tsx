import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ShieldCheck } from "lucide-react";

import { EmptyState, PageHeader } from "@/components/app/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import {
  ENTIDADES,
  OPERACOES,
  alteracoes,
  fimDoDia,
  inicioDoDia,
  rotuloEntidade,
  rotuloOperacao,
  type Json,
} from "@/lib/auditoria";
import { dateTimeBR } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/auditoria")({
  head: () => ({
    meta: [
      { title: "Auditoria — EZRA ERP" },
      {
        name: "description",
        content:
          "Quem alterou o quê: contas, notas fiscais, empresa, configuração fiscal, preços e perfis de acesso.",
      },
    ],
  }),
  component: Auditoria,
});

const TODOS = "todos";
/** Registros sem usuário: o que o servidor ou o próprio banco alterou. */
const SISTEMA = "sistema";
const POR_PAGINA = 50;

const COR_OPERACAO: Record<string, string> = {
  insert: "bg-success/15 text-success",
  update: "bg-info/15 text-info",
  delete: "bg-destructive/15 text-destructive",
};

type Registro = {
  id: string;
  usuario_id: string | null;
  entidade: string;
  entidade_id: string | null;
  operacao: string;
  valor_anterior: Json | null;
  valor_novo: Json | null;
  created_at: string;
};

const comoObjeto = (v: Json | null): Record<string, Json> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, Json>) : null;

function Auditoria() {
  const { data: sessao } = useSessionData();
  const podeVer = (sessao?.roles ?? []).some((r) => r === "administrador" || r === "gestor");

  const [entidade, setEntidade] = useState(TODOS);
  const [operacao, setOperacao] = useState(TODOS);
  const [usuario, setUsuario] = useState(TODOS);
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");
  const [limite, setLimite] = useState(POR_PAGINA);

  const { data: usuarios = [] } = useQuery({
    queryKey: ["auditoria-usuarios"],
    enabled: podeVer,
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("id, nome").order("nome");
      if (error) throw error;
      return data;
    },
  });

  const {
    data: registros = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ["auditoria", entidade, operacao, usuario, de, ate, limite],
    enabled: podeVer,
    queryFn: async () => {
      let q = supabase
        .from("auditoria")
        .select(
          "id, usuario_id, entidade, entidade_id, operacao, valor_anterior, valor_novo, created_at",
        )
        .order("created_at", { ascending: false })
        .range(0, limite - 1);
      if (entidade !== TODOS) q = q.eq("entidade", entidade);
      if (operacao !== TODOS) q = q.eq("operacao", operacao);
      if (usuario === SISTEMA) q = q.is("usuario_id", null);
      else if (usuario !== TODOS) q = q.eq("usuario_id", usuario);
      if (de) q = q.gte("created_at", inicioDoDia(de));
      if (ate) q = q.lte("created_at", fimDoDia(ate));
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Registro[];
    },
  });

  const nomeUsuario = (id: string | null) =>
    id ? (usuarios.find((u) => u.id === id)?.nome ?? "Usuário removido") : "Sistema";

  function filtrar(proximo: () => void) {
    proximo();
    setLimite(POR_PAGINA);
  }

  if (sessao && !podeVer) {
    return (
      <div>
        <PageHeader title="Auditoria" />
        <EmptyState
          title="Acesso restrito"
          description="Somente administrador e gestor consultam a auditoria."
        />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Auditoria"
        description="Quem alterou o quê, quando, e como era antes. Cobre contas a receber e a pagar, comissões, notas fiscais, empresa e filiais, configuração fiscal, perfis de acesso, preços, descontos e saldo de estoque."
      />

      <div className="panel mb-4 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
        <div>
          <Label>O que mudou</Label>
          <Select value={entidade} onValueChange={(v) => filtrar(() => setEntidade(v))}>
            <SelectTrigger className="mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS}>Tudo</SelectItem>
              {Object.entries(ENTIDADES).map(([valor, rotulo]) => (
                <SelectItem key={valor} value={valor}>
                  {rotulo}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Tipo</Label>
          <Select value={operacao} onValueChange={(v) => filtrar(() => setOperacao(v))}>
            <SelectTrigger className="mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS}>Todos</SelectItem>
              {Object.entries(OPERACOES).map(([valor, rotulo]) => (
                <SelectItem key={valor} value={valor}>
                  {rotulo}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Quem</Label>
          <Select value={usuario} onValueChange={(v) => filtrar(() => setUsuario(v))}>
            <SelectTrigger className="mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS}>Todos</SelectItem>
              <SelectItem value={SISTEMA}>Sistema</SelectItem>
              {usuarios.map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  {u.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="aud-de">De</Label>
          <Input
            id="aud-de"
            type="date"
            className="mt-1"
            value={de}
            onChange={(e) => filtrar(() => setDe(e.target.value))}
          />
        </div>
        <div>
          <Label htmlFor="aud-ate">Até</Label>
          <Input
            id="aud-ate"
            type="date"
            className="mt-1"
            value={ate}
            onChange={(e) => filtrar(() => setAte(e.target.value))}
          />
        </div>
      </div>

      {error ? (
        <EmptyState
          title="Não foi possível carregar a auditoria"
          description={error instanceof Error ? error.message : "Tente de novo em instantes."}
        />
      ) : isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : registros.length === 0 ? (
        <EmptyState
          title="Nenhum registro encontrado"
          description="Mude os filtros ou o período. Os registros começam quando as alterações passam a ser auditadas."
        />
      ) : (
        <>
          <div className="panel overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="whitespace-nowrap">Quando</TableHead>
                  <TableHead>Quem</TableHead>
                  <TableHead>O que</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Alterações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {registros.map((r) => {
                  const linhas = alteracoes(comoObjeto(r.valor_anterior), comoObjeto(r.valor_novo));
                  return (
                    <TableRow key={r.id} className="align-top">
                      <TableCell className="whitespace-nowrap text-sm">
                        {dateTimeBR(r.created_at)}
                      </TableCell>
                      <TableCell className="text-sm">{nomeUsuario(r.usuario_id)}</TableCell>
                      <TableCell className="text-sm">
                        {rotuloEntidade(r.entidade)}
                        {r.entidade_id && (
                          <span className="block font-mono text-xs text-muted-foreground">
                            {r.entidade_id.slice(0, 8)}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className={COR_OPERACAO[r.operacao] ?? ""}>
                          {rotuloOperacao(r.operacao)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">
                        {linhas.length === 0 ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <ul className="space-y-1">
                            {linhas.map((l) => (
                              <li key={l.campo} className="flex flex-wrap items-center gap-1.5">
                                <span className="font-medium">{l.rotulo}:</span>
                                {r.operacao !== "insert" && (
                                  <span className="text-muted-foreground line-through decoration-muted-foreground/40">
                                    {l.antes}
                                  </span>
                                )}
                                {r.operacao === "update" && (
                                  <ArrowRight className="size-3 text-muted-foreground" />
                                )}
                                {r.operacao !== "delete" && <span>{l.depois}</span>}
                              </li>
                            ))}
                          </ul>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          {registros.length >= limite && (
            <div className="mt-4 flex justify-center">
              <Button variant="outline" onClick={() => setLimite((l) => l + POR_PAGINA)}>
                <ShieldCheck className="size-4" /> Ver mais registros
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
