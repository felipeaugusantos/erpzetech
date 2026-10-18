import { useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileUp, Upload } from "lucide-react";
import { toast } from "sonner";

import { EmptyState, PageHeader } from "@/components/app/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import type { Json } from "@/integrations/supabase/types";
import { baixarArquivo } from "@/lib/cotacao";
import { dateTimeBR } from "@/lib/format";
import {
  CAMPOS,
  LIMITE_LINHAS,
  ROTULO_TIPO,
  csvErros,
  decodificar,
  errosDaLeitura,
  lerPlanilha,
  modeloCsv,
  paraEnvio,
  type ErroImportacao,
  type Leitura,
  type TipoImportacao,
} from "@/lib/importacao";

export const Route = createFileRoute("/_authenticated/importacao")({
  head: () => ({
    meta: [
      { title: "Importação por planilha — ERP Ze Tech" },
      {
        name: "description",
        content:
          "Importe produtos, clientes e saldos de estoque de uma planilha, com pré-visualização e relatório de erros.",
      },
    ],
  }),
  component: Importacao,
});

type Resposta = {
  ok: boolean;
  simulado: boolean;
  total: number;
  n_erros: number;
  erros: ErroImportacao[];
  criados?: number;
  atualizados?: number;
  categorias_novas?: number;
};

const PAPEIS: Record<TipoImportacao, string[]> = {
  produtos: ["administrador", "gestor"],
  clientes: ["administrador", "gestor"],
  saldos: ["administrador", "gestor", "estoquista"],
};

function Importacao() {
  const qc = useQueryClient();
  const { data: sessao } = useSessionData();
  const papeis = sessao?.roles ?? [];
  const tiposPermitidos = (Object.keys(PAPEIS) as TipoImportacao[]).filter((t) =>
    papeis.some((r) => PAPEIS[t].includes(r)),
  );

  const [tipo, setTipo] = useState<TipoImportacao>("produtos");
  const [atualizar, setAtualizar] = useState(false);
  const [arquivo, setArquivo] = useState<string | null>(null);
  const [leitura, setLeitura] = useState<Leitura | null>(null);
  const [simulacao, setSimulacao] = useState<Resposta | null>(null);
  const [resultado, setResultado] = useState<Resposta | null>(null);
  const entrada = useRef<HTMLInputElement>(null);

  const tipoAtual = tiposPermitidos.includes(tipo) ? tipo : (tiposPermitidos[0] ?? tipo);
  const usaAtualizar = tipoAtual !== "saldos";

  const historico = useQuery({
    queryKey: ["importacoes"],
    enabled: tiposPermitidos.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("importacoes")
        .select("id, tipo, arquivo, linhas, criados, atualizados, created_at")
        .order("created_at", { ascending: false })
        .limit(15);
      if (error) throw error;
      return data ?? [];
    },
  });

  async function chamar(simular: boolean, l: Leitura, atualizarLinhas: boolean): Promise<Resposta> {
    const linhas = paraEnvio(l) as Json;
    const nome = arquivo ?? undefined;
    const pedido =
      l.tipo === "produtos"
        ? supabase.rpc("importar_produtos", {
            p_linhas: linhas,
            p_atualizar: atualizarLinhas,
            p_simular: simular,
            ...(nome ? { p_arquivo: nome } : {}),
          })
        : l.tipo === "clientes"
          ? supabase.rpc("importar_clientes", {
              p_linhas: linhas,
              p_atualizar: atualizarLinhas,
              p_simular: simular,
              ...(nome ? { p_arquivo: nome } : {}),
            })
          : supabase.rpc("importar_saldos", {
              p_linhas: linhas,
              p_simular: simular,
              ...(nome ? { p_arquivo: nome } : {}),
            });
    const { data, error } = await pedido;
    if (error) throw error;
    return data as unknown as Resposta;
  }

  const simular = useMutation({
    mutationFn: ({ l, atualizarLinhas }: { l: Leitura; atualizarLinhas: boolean }) =>
      chamar(true, l, atualizarLinhas),
    onSuccess: setSimulacao,
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "Não foi possível conferir a planilha"),
  });

  const importar = useMutation({
    mutationFn: (l: Leitura) => chamar(false, l, atualizar),
    onSuccess: (r) => {
      setResultado(r);
      if (r.ok) {
        toast.success("Importação concluída");
        void qc.invalidateQueries({ queryKey: ["importacoes"] });
        void qc.invalidateQueries({ queryKey: ["produtos"] });
        void qc.invalidateQueries({ queryKey: ["clientes"] });
        void qc.invalidateQueries({ queryKey: ["estoque"] });
      } else setSimulacao(r);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "A importação não foi feita"),
  });

  function limpar() {
    setLeitura(null);
    setSimulacao(null);
    setResultado(null);
    setArquivo(null);
    if (entrada.current) entrada.current.value = "";
  }

  async function aoEscolher(f: File | undefined) {
    if (!f) return;
    setSimulacao(null);
    setResultado(null);
    const bytes = new Uint8Array(await f.arrayBuffer());
    const l = lerPlanilha(tipoAtual, decodificar(bytes));
    setArquivo(f.name);
    setLeitura(l);
    // sem erro na planilha: o banco confere o que já existe (código repetido, depósito, saldo reservado…)
    if (l.faltando.length === 0 && l.totalErros === 0 && !l.excedeLimite && l.linhas.length > 0) {
      simular.mutate({ l, atualizarLinhas: atualizar });
    }
  }

  if (sessao && tiposPermitidos.length === 0) {
    return (
      <div>
        <PageHeader title="Importação por planilha" />
        <EmptyState
          title="Acesso restrito"
          description="Somente administrador, gestor e estoquista (saldos) importam planilhas."
        />
      </div>
    );
  }

  const errosPlanilha = leitura ? errosDaLeitura(leitura) : [];
  const errosBanco = simulacao && !simulacao.ok ? simulacao.erros : [];
  const todosErros = [...errosPlanilha, ...errosBanco];
  const pronto =
    !!leitura &&
    leitura.faltando.length === 0 &&
    leitura.totalErros === 0 &&
    !leitura.excedeLimite &&
    leitura.linhas.length > 0 &&
    simulacao?.ok === true &&
    !resultado?.ok;

  return (
    <div>
      <PageHeader
        title="Importação por planilha"
        description={`Entra tudo ou nada: se uma linha tiver erro, nenhuma é importada e você corrige a planilha. Até ${LIMITE_LINHAS} linhas por vez. Aceita CSV (no Excel: Salvar como › CSV).`}
      />

      <div className="panel mb-4 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <Label>O que importar</Label>
          <Select
            value={tipoAtual}
            onValueChange={(v) => {
              setTipo(v as TipoImportacao);
              limpar();
            }}
          >
            <SelectTrigger className="mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {tiposPermitidos.map((t) => (
                <SelectItem key={t} value={t}>
                  {ROTULO_TIPO[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-end">
          <Button
            variant="outline"
            onClick={() => baixarArquivo(`modelo-${tipoAtual}.csv`, modeloCsv(tipoAtual))}
          >
            <Download className="mr-1 h-4 w-4" />
            Baixar modelo
          </Button>
        </div>
        <div className="flex items-end">
          <input
            ref={entrada}
            type="file"
            accept=".csv,.txt,text/csv,text/plain"
            className="hidden"
            onChange={(e) => void aoEscolher(e.target.files?.[0])}
          />
          <Button onClick={() => entrada.current?.click()}>
            <FileUp className="mr-1 h-4 w-4" />
            Escolher planilha
          </Button>
        </div>
        {usaAtualizar ? (
          <label className="flex items-end gap-2 pb-2 text-sm">
            <input
              type="checkbox"
              checked={atualizar}
              onChange={(e) => {
                // a simulação usa o valor novo da caixa, não o estado antigo da tela
                const novo = e.target.checked;
                setAtualizar(novo);
                setSimulacao(null);
                if (leitura && leitura.totalErros === 0 && leitura.faltando.length === 0)
                  simular.mutate({ l: leitura, atualizarLinhas: novo });
              }}
            />
            Atualizar os que já existem
          </label>
        ) : (
          <p className="pb-2 text-xs text-muted-foreground self-end">
            Cada linha ajusta o saldo do produto no depósito para a quantidade da planilha.
          </p>
        )}
      </div>

      <details className="panel mb-4 p-3 text-sm">
        <summary className="cursor-pointer font-medium">
          Colunas aceitas em {ROTULO_TIPO[tipoAtual]}
        </summary>
        <ul className="mt-2 grid gap-1 sm:grid-cols-2">
          {CAMPOS[tipoAtual].map((c) => (
            <li key={c.chave}>
              <b>{c.rotulo}</b>
              {c.obrigatorio ? " (obrigatório)" : ""}
              <span className="text-muted-foreground"> — ex.: {c.exemplo || "—"}</span>
            </li>
          ))}
        </ul>
      </details>

      {resultado?.ok ? (
        <div className="panel mb-4 border-success/40 bg-success/10 p-4 text-sm">
          <p className="font-medium">Importação concluída: {resultado.total} linha(s).</p>
          <p>
            {tipoAtual === "saldos"
              ? `${resultado.atualizados ?? 0} saldo(s) ajustado(s).`
              : `${resultado.criados ?? 0} novo(s) e ${resultado.atualizados ?? 0} atualizado(s)${
                  resultado.categorias_novas
                    ? `; ${resultado.categorias_novas} categoria(s) criada(s)`
                    : ""
                }.`}
          </p>
          <Button className="mt-2" variant="outline" size="sm" onClick={limpar}>
            Importar outra planilha
          </Button>
        </div>
      ) : null}

      {leitura && !resultado?.ok ? (
        <div className="space-y-3">
          <div className="panel p-4 text-sm">
            <p className="font-medium">
              {arquivo} — {leitura.linhas.length} linha(s)
            </p>
            {leitura.reconhecidas.length > 0 ? (
              <p className="text-muted-foreground">
                Colunas lidas: {leitura.reconhecidas.join(", ")}.
              </p>
            ) : null}
            {leitura.ignoradas.length > 0 ? (
              <p className="text-muted-foreground">
                Colunas ignoradas: {leitura.ignoradas.join(", ")}.
              </p>
            ) : null}
            {leitura.faltando.length > 0 ? (
              <p className="mt-1 text-destructive">
                Faltam colunas obrigatórias: {leitura.faltando.join(", ")}. Use o modelo para
                conferir o cabeçalho.
              </p>
            ) : null}
            {leitura.excedeLimite ? (
              <p className="mt-1 text-destructive">
                A planilha passa de {LIMITE_LINHAS} linhas. Divida em partes menores.
              </p>
            ) : null}
            {leitura.linhas.length === 0 && leitura.faltando.length === 0 ? (
              <p className="mt-1 text-destructive">A planilha não tem linhas de dados.</p>
            ) : null}
            {simular.isPending ? (
              <p className="mt-1 text-muted-foreground">Conferindo com o que já existe…</p>
            ) : null}
            {simulacao?.ok ? (
              <p className="mt-1 text-success">
                Tudo certo.{" "}
                {tipoAtual === "saldos"
                  ? `${simulacao.atualizados ?? 0} saldo(s) serão ajustados.`
                  : `${simulacao.criados ?? 0} novo(s) e ${simulacao.atualizados ?? 0} para atualizar${
                      simulacao.categorias_novas
                        ? `; ${simulacao.categorias_novas} categoria(s) nova(s)`
                        : ""
                    }.`}
              </p>
            ) : null}
          </div>

          {todosErros.length > 0 ? (
            <div className="panel overflow-x-auto">
              <div className="flex items-center justify-between p-3">
                <p className="text-sm font-medium text-destructive">
                  {todosErros.length} erro(s)
                  {errosBanco.length > 0 && simulacao
                    ? ` (o banco achou ${simulacao.n_erros})`
                    : ""}{" "}
                  — nada foi importado
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => baixarArquivo(`erros-${tipoAtual}.csv`, csvErros(todosErros))}
                >
                  <Download className="mr-1 h-4 w-4" />
                  Baixar erros
                </Button>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-24">Linha</TableHead>
                    <TableHead>O que corrigir</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {todosErros.slice(0, 100).map((e, i) => (
                    <TableRow key={`${e.linha}-${i}`}>
                      <TableCell>{e.linha}</TableCell>
                      <TableCell className="text-sm">{e.mensagem}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {todosErros.length > 100 ? (
                <p className="p-3 text-xs text-muted-foreground">
                  Mostrando os 100 primeiros; baixe o arquivo de erros para ver a lista inteira.
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="panel overflow-x-auto">
            <p className="p-3 text-sm font-medium">Primeiras linhas</p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">Linha</TableHead>
                  {CAMPOS[tipoAtual]
                    .filter((c) => leitura.reconhecidas.includes(c.rotulo))
                    .map((c) => (
                      <TableHead key={c.chave}>{c.rotulo}</TableHead>
                    ))}
                  <TableHead>Situação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {leitura.linhas.slice(0, 20).map((l) => (
                  <TableRow key={l.linha}>
                    <TableCell>{l.linha}</TableCell>
                    {CAMPOS[tipoAtual]
                      .filter((c) => leitura.reconhecidas.includes(c.rotulo))
                      .map((c) => (
                        <TableCell key={c.chave} className="max-w-48 truncate text-sm">
                          {l.valores[c.chave]}
                        </TableCell>
                      ))}
                    <TableCell>
                      {l.erros.length > 0 ? (
                        <Badge className="bg-destructive/15 text-destructive">Erro</Badge>
                      ) : (
                        <Badge className="bg-success/15 text-success">Ok</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={limpar}>
              Cancelar
            </Button>
            <Button
              disabled={!pronto || importar.isPending}
              onClick={() => importar.mutate(leitura)}
            >
              <Upload className="mr-1 h-4 w-4" />
              {importar.isPending ? "Importando…" : `Importar ${leitura.linhas.length} linha(s)`}
            </Button>
          </div>
        </div>
      ) : null}

      <h2 className="mb-2 mt-8 text-base font-semibold">Importações recentes</h2>
      {historico.data && historico.data.length > 0 ? (
        <div className="panel overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Quando</TableHead>
                <TableHead>O que</TableHead>
                <TableHead>Arquivo</TableHead>
                <TableHead className="text-right">Linhas</TableHead>
                <TableHead className="text-right">Novos</TableHead>
                <TableHead className="text-right">Atualizados</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {historico.data.map((h) => (
                <TableRow key={h.id}>
                  <TableCell className="whitespace-nowrap text-sm">
                    {dateTimeBR(h.created_at)}
                  </TableCell>
                  <TableCell className="text-sm">
                    {ROTULO_TIPO[h.tipo as TipoImportacao] ?? h.tipo}
                  </TableCell>
                  <TableCell className="text-sm">{h.arquivo ?? "—"}</TableCell>
                  <TableCell className="text-right text-sm">{h.linhas}</TableCell>
                  <TableCell className="text-right text-sm">{h.criados}</TableCell>
                  <TableCell className="text-right text-sm">{h.atualizados}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Nenhuma importação ainda.</p>
      )}
    </div>
  );
}
