/* eslint-disable @typescript-eslint/no-explicit-any -- tabelas novas ainda fora dos tipos gerados do cliente Supabase */
import { useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { dateBR } from "@/lib/format";
import { ajusteVigente, type AjusteTributos } from "@/lib/tributos-aprox";
import { EmptyState, PageHeader } from "@/components/app/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useSessionData } from "@/hooks/useSessionData";

export const Route = createFileRoute("/_authenticated/tributos-aprox")({
  head: () => ({
    meta: [
      { title: "Tributos aproximados — EZRA ERP" },
      {
        name: "description",
        content:
          "Alíquotas da IBPT por NCM usadas no valor aproximado dos tributos da nota, com os ajustes de cada conta.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: TributosAproximados,
});

type Base = {
  ncm: string;
  aliq_nacional_federal: number;
  aliq_importado_federal: number;
  aliq_estadual: number;
  aliq_municipal: number;
  vigencia_fim: string | null;
  versao: string | null;
  fonte: string | null;
};
type Ajuste = AjusteTributos & { id: string; motivo: string; criado_em: string };

const hojeIso = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
const pct = (v: number) => `${Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}%`;

function TributosAproximados() {
  const { data: sessao, isLoading } = useSessionData();
  const pode = (sessao?.roles ?? []).some(
    (r) => r === "administrador" || r === "gestor" || r === "financeiro" || r === "contador",
  );
  // importar a tabela da IBPT (CSV ou API) não é do contador: o botão nem aparece para ele
  // (a trava real segue no banco e nas funções de servidor, que o recusam).
  const contador = (sessao?.roles ?? []).includes("contador");
  if (isLoading) return <p className="text-sm text-muted-foreground">Carregando…</p>;
  if (!pode) {
    return (
      <EmptyState
        title="Só administrador, gestor ou financeiro mexe nos tributos aproximados"
        description="Peça a quem administra a empresa."
      />
    );
  }
  return <Painel contador={contador} />;
}

function Painel({ contador }: { contador: boolean }) {
  const qc = useQueryClient();
  const [busca, setBusca] = useState("");
  const [editando, setEditando] = useState<Base | null>(null);
  const termo = busca.replace(/\D/g, "");

  const { data: bases = [], isFetching } = useQuery({
    queryKey: ["tributos-aprox-lista", termo],
    queryFn: async () => {
      let q = (supabase as any)
        .from("tributos_aprox_ncm")
        .select(
          "ncm, aliq_nacional_federal, aliq_importado_federal, aliq_estadual, aliq_municipal, vigencia_fim, versao, fonte",
        )
        .order("ncm")
        .limit(50);
      if (termo) q = q.like("ncm", `${termo}%`);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Base[];
    },
  });

  const { data: ajustes = [] } = useQuery({
    queryKey: ["tributos-aprox-ajustes"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("tributos_aprox_ajuste")
        .select(
          "id, ncm, aliq_nacional_federal, aliq_importado_federal, aliq_estadual, aliq_municipal, valido_ate, motivo, criado_em, removido_em",
        )
        .is("removido_em", null)
        .order("ncm");
      if (error) throw error;
      return (data ?? []) as Ajuste[];
    },
  });
  const ajusteDoNcm = new Map(ajustes.map((a) => [a.ncm, a]));
  const hoje = hojeIso();

  const remover = useMutation({
    mutationFn: async (ncm: string) => {
      const { error } = await (supabase as any).rpc("tributos_aprox_ajuste_remover", {
        p_ncm: ncm,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      toast.success("Ajuste removido. A nota volta a usar a tabela da IBPT.");
      await qc.invalidateQueries({ queryKey: ["tributos-aprox-ajustes"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div>
      <PageHeader
        title="Tributos aproximados"
        description="Alíquotas por NCM do valor aproximado dos tributos informado na nota (Lei 12.741/2012). Não são os impostos devidos, que seguem as regras fiscais da empresa."
        actions={
          contador ? undefined : (
            <Button asChild variant="outline" size="sm">
              <Link to="/nfe">Importar tabela da IBPT</Link>
            </Button>
          )
        }
      />
      <p className="mb-4 max-w-3xl text-sm text-muted-foreground">
        A tabela da IBPT fica como veio. O ajuste do contador é guardado à parte, com validade e
        motivo, vale só para esta conta e não é apagado quando você importa uma tabela nova da IBPT.
        Ajuste vencido deixa de valer e a nota volta a usar a IBPT. O texto da nota informa quando
        uma alíquota foi ajustada.
      </p>

      <div className="mb-4 max-w-sm">
        <Label htmlFor="busca-ncm">NCM (início do código)</Label>
        <div className="relative mt-1">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input
            id="busca-ncm"
            className="pl-8"
            inputMode="numeric"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>
      </div>

      {bases.length === 0 && !isFetching ? (
        <EmptyState
          title="Nenhuma alíquota da IBPT nesta conta"
          description="Importe a tabela da IBPT em Notas fiscais para poder consultar e ajustar por NCM."
        />
      ) : (
        <div className="hidden overflow-x-auto rounded-md border sm:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>NCM</TableHead>
                <TableHead>IBPT (nacional / importado / estadual / municipal)</TableHead>
                <TableHead>Versão e vigência</TableHead>
                <TableHead>Ajuste da conta</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bases.map((b) => {
                const aj = ajusteDoNcm.get(b.ncm);
                const vale = ajusteVigente(aj, hoje);
                return (
                  <TableRow key={b.ncm}>
                    <TableCell className="font-mono">{b.ncm}</TableCell>
                    <TableCell className="text-sm">
                      {pct(b.aliq_nacional_federal)} / {pct(b.aliq_importado_federal)} /{" "}
                      {pct(b.aliq_estadual)} / {pct(b.aliq_municipal)}
                    </TableCell>
                    <TableCell className="text-sm">
                      {b.versao ?? "—"}
                      {b.vigencia_fim ? ` até ${dateBR(b.vigencia_fim)}` : ""}
                    </TableCell>
                    <TableCell className="text-sm">
                      {!aj ? (
                        <span className="text-muted-foreground">Sem ajuste</span>
                      ) : (
                        <div className="space-y-1">
                          <Badge variant={vale ? "default" : "secondary"}>
                            {vale ? `Ajustado até ${dateBR(aj.valido_ate)}` : "Ajuste vencido"}
                          </Badge>
                          <div>
                            {pct(aj.aliq_nacional_federal)} / {pct(aj.aliq_importado_federal)} /{" "}
                            {pct(aj.aliq_estadual)} / {pct(aj.aliq_municipal)}
                          </div>
                          <div className="text-xs text-muted-foreground">{aj.motivo}</div>
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="space-x-2 text-right">
                      <Button size="sm" variant="outline" onClick={() => setEditando(b)}>
                        {aj ? "Alterar ajuste" : "Ajustar"}
                      </Button>
                      {aj ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={remover.isPending}
                          onClick={() => remover.mutate(b.ncm)}
                        >
                          Remover
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {bases.length > 0 ? (
        <div className="space-y-3 sm:hidden">
          {bases.map((b) => {
            const aj = ajusteDoNcm.get(b.ncm);
            const vale = ajusteVigente(aj, hoje);
            return (
              <div key={b.ncm} className="space-y-2 rounded-md border p-3 text-sm">
                <div className="font-mono text-base">{b.ncm}</div>
                <div>
                  <div className="text-xs text-muted-foreground">
                    IBPT: nacional / importado / estadual / municipal
                  </div>
                  {pct(b.aliq_nacional_federal)} / {pct(b.aliq_importado_federal)} /{" "}
                  {pct(b.aliq_estadual)} / {pct(b.aliq_municipal)}
                  <div className="text-xs text-muted-foreground">
                    Versão {b.versao ?? "—"}
                    {b.vigencia_fim ? ` até ${dateBR(b.vigencia_fim)}` : ""}
                  </div>
                </div>
                {aj ? (
                  <div className="space-y-1">
                    <Badge variant={vale ? "default" : "secondary"}>
                      {vale ? `Ajustado até ${dateBR(aj.valido_ate)}` : "Ajuste vencido"}
                    </Badge>
                    <div>
                      {pct(aj.aliq_nacional_federal)} / {pct(aj.aliq_importado_federal)} /{" "}
                      {pct(aj.aliq_estadual)} / {pct(aj.aliq_municipal)}
                    </div>
                    <div className="text-xs text-muted-foreground">{aj.motivo}</div>
                  </div>
                ) : (
                  <div className="text-muted-foreground">Sem ajuste</div>
                )}
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setEditando(b)}>
                    {aj ? "Alterar ajuste" : "Ajustar"}
                  </Button>
                  {aj ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={remover.isPending}
                      onClick={() => remover.mutate(b.ncm)}
                    >
                      Remover
                    </Button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
      <p className="mt-2 text-xs text-muted-foreground">Mostra até 50 NCM por busca.</p>

      {editando ? (
        <AjusteDialog
          base={editando}
          atual={ajusteDoNcm.get(editando.ncm) ?? null}
          onFechar={() => setEditando(null)}
          onSalvo={async () => {
            setEditando(null);
            await qc.invalidateQueries({ queryKey: ["tributos-aprox-ajustes"] });
          }}
        />
      ) : null}
    </div>
  );
}

function AjusteDialog({
  base,
  atual,
  onFechar,
  onSalvo,
}: {
  base: Base;
  atual: Ajuste | null;
  onFechar: () => void;
  onSalvo: () => Promise<void>;
}) {
  const ini = atual ?? base;
  const [v, setV] = useState({
    nac: String(ini.aliq_nacional_federal),
    imp: String(ini.aliq_importado_federal),
    est: String(ini.aliq_estadual),
    mun: String(ini.aliq_municipal),
    ate: atual?.valido_ate ?? "",
    motivo: atual?.motivo ?? "",
  });
  const n = (s: string) => Number(s.replace(",", "."));
  const salvar = useMutation({
    mutationFn: async () => {
      const valores = [v.nac, v.imp, v.est, v.mun].map(n);
      if (valores.some((x) => !Number.isFinite(x) || x < 0 || x > 100)) {
        throw new Error("Cada alíquota deve ficar entre 0 e 100.");
      }
      if (!v.ate) throw new Error("Informe até quando o ajuste vale.");
      if (v.motivo.trim().length < 5)
        throw new Error("Informe o motivo (por exemplo, a orientação do contador).");
      const { error } = await (supabase as any).rpc("tributos_aprox_ajustar", {
        p_ncm: base.ncm,
        p_nacional_federal: valores[0],
        p_importado_federal: valores[1],
        p_estadual: valores[2],
        p_municipal: valores[3],
        p_valido_ate: v.ate,
        p_motivo: v.motivo.trim(),
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      toast.success("Ajuste salvo.");
      await onSalvo();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const campos: Array<[string, keyof typeof v, string]> = [
    ["Federal nacional (%)", "nac", "ajuste-nac"],
    ["Federal importado (%)", "imp", "ajuste-imp"],
    ["Estadual (%)", "est", "ajuste-est"],
    ["Municipal (%)", "mun", "ajuste-mun"],
  ];
  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Ajustar NCM {base.ncm}</DialogTitle>
          <DialogDescription>
            IBPT: {pct(base.aliq_nacional_federal)} / {pct(base.aliq_importado_federal)} /{" "}
            {pct(base.aliq_estadual)} / {pct(base.aliq_municipal)}
            {base.versao ? ` (versão ${base.versao})` : ""}. O ajuste vale só para esta conta e não
            altera a tabela da IBPT.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {campos.map(([rotulo, chave, id]) => (
            <div key={id}>
              <Label htmlFor={id}>{rotulo}</Label>
              <Input
                id={id}
                inputMode="decimal"
                value={v[chave]}
                onChange={(e) => setV({ ...v, [chave]: e.target.value })}
              />
            </div>
          ))}
          <div className="sm:col-span-2">
            <Label htmlFor="ajuste-ate">Vale até</Label>
            <Input
              id="ajuste-ate"
              type="date"
              min={hojeIso()}
              value={v.ate}
              onChange={(e) => setV({ ...v, ate: e.target.value })}
            />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="ajuste-motivo">Motivo</Label>
            <Textarea
              id="ajuste-motivo"
              rows={3}
              value={v.motivo}
              onChange={(e) => setV({ ...v, motivo: e.target.value })}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>
            Cancelar
          </Button>
          <Button onClick={() => salvar.mutate()} disabled={salvar.isPending}>
            {salvar.isPending ? "Salvando…" : "Salvar ajuste"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
