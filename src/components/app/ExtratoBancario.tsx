import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileUp, Upload } from "lucide-react";
import { toast } from "sonner";

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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { brl, dateBR } from "@/lib/format";
import { contaPareceOutra, decodificarOfx, lerOfx, type LeituraOfx } from "@/lib/ofx";

type ContaBanco = {
  id: string;
  apelido: string;
  conta: string | null;
  conta_digito: string | null;
};

type LinhaPrevia = {
  fitid: string;
  data: string;
  valor: number;
  descricao: string;
  situacao: "conciliada" | "pendente" | "repetida";
};

type Previa = {
  total: number;
  conciliadas: number;
  pendentes: number;
  repetidas: number;
  linhas: LinhaPrevia[];
};

const ROTULO: Record<string, string> = {
  conciliada: "Concilia sozinha",
  pendente: "Pendente",
  repetida: "Já importada",
};

function invalidar(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: ["banco-extrato"] });
  void qc.invalidateQueries({ queryKey: ["banco-extrato-pendentes"] });
  void qc.invalidateQueries({ queryKey: ["contas-bancarias"] });
}

/** Lê um extrato OFX do banco, mostra o que concilia sozinho e importa. */
export function ImportarExtratoDialog({
  aberto,
  contas,
  contaInicial,
  onFechar,
}: {
  aberto: boolean;
  contas: ContaBanco[];
  contaInicial: string;
  onFechar: () => void;
}) {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [contaId, setContaId] = useState(contaInicial);
  const [arquivo, setArquivo] = useState<string | null>(null);
  const [leitura, setLeitura] = useState<LeituraOfx | null>(null);
  const [previa, setPrevia] = useState<Previa | null>(null);

  const conta = contas.find((c) => c.id === contaId);
  const outraConta = leitura && conta ? contaPareceOutra(leitura.conta, conta) : false;

  function limpar() {
    setArquivo(null);
    setLeitura(null);
    setPrevia(null);
    if (input.current) input.current.value = "";
  }

  function fechar() {
    limpar();
    onFechar();
  }

  const chamar = (simular: boolean) => {
    if (!contaId) throw new Error("Escolha a conta do extrato.");
    if (!leitura || leitura.transacoes.length === 0) throw new Error("Escolha um arquivo OFX.");
    return supabase.rpc("banco_extrato_importar", {
      p_conta_id: contaId,
      p_linhas: leitura.transacoes as unknown as Json,
      p_simular: simular,
      ...(arquivo ? { p_arquivo: arquivo } : {}),
    });
  };

  const simular = useMutation({
    mutationFn: async () => {
      const { data, error } = await chamar(true);
      if (error) throw error;
      return data as unknown as Previa;
    },
    onSuccess: setPrevia,
    onError: (e: Error) => toast.error(e.message),
  });

  const importar = useMutation({
    mutationFn: async () => {
      const { data, error } = await chamar(false);
      if (error) throw error;
      return data as unknown as Previa;
    },
    onSuccess: (r) => {
      toast.success(
        `Extrato importado: ${r.conciliadas} conciliada(s), ${r.pendentes} pendente(s)` +
          (r.repetidas ? `, ${r.repetidas} já importada(s)` : ""),
      );
      invalidar(qc);
      fechar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  async function escolher(f: File | undefined) {
    limpar();
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) {
      toast.error("Arquivo grande demais (limite de 5 MB).");
      return;
    }
    const lido = lerOfx(decodificarOfx(new Uint8Array(await f.arrayBuffer())));
    setArquivo(f.name);
    setLeitura(lido);
  }

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && fechar()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Importar extrato do banco (OFX)</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="ofx-conta">Conta do extrato</Label>
            <select
              id="ofx-conta"
              className="h-9 rounded-md border bg-background px-3 text-sm"
              value={contaId}
              onChange={(e) => {
                setContaId(e.target.value);
                setPrevia(null);
              }}
            >
              <option value="">Escolha…</option>
              {contas.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.apelido}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ofx-arquivo">Arquivo OFX (baixe no internet banking)</Label>
            <Input
              id="ofx-arquivo"
              ref={input}
              type="file"
              accept=".ofx,.OFX,text/plain"
              onChange={(e) => void escolher(e.target.files?.[0])}
            />
          </div>

          {leitura && (
            <div className="rounded border p-3 text-sm">
              <p>
                <FileUp className="mr-1 inline size-4" />
                <strong>{arquivo}</strong>: {leitura.transacoes.length} lançamento(s) lido(s)
                {leitura.erros.length > 0 && `, ${leitura.erros.length} com problema`}.
              </p>
              {outraConta && (
                <p className="mt-1 text-destructive">
                  Atenção: o número da conta no arquivo ({leitura.conta.conta}) não parece ser o da
                  conta escolhida. Confira antes de importar.
                </p>
              )}
              {leitura.erros.length > 0 && (
                <ul className="mt-1 list-disc pl-5 text-xs text-destructive">
                  {leitura.erros.slice(0, 5).map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                  {leitura.erros.length > 5 && <li>… e mais {leitura.erros.length - 5}</li>}
                </ul>
              )}
            </div>
          )}

          {previa && (
            <div className="grid gap-2">
              <div className="flex flex-wrap gap-2 text-sm">
                <Badge variant="secondary">{previa.conciliadas} concilia(m) sozinha(s)</Badge>
                <Badge variant="outline">{previa.pendentes} pendente(s)</Badge>
                {previa.repetidas > 0 && (
                  <Badge variant="outline">{previa.repetidas} já importada(s)</Badge>
                )}
              </div>
              <div className="max-h-64 overflow-y-auto rounded border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Data</TableHead>
                      <TableHead>Descrição</TableHead>
                      <TableHead className="text-right">Valor</TableHead>
                      <TableHead>Situação</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {previa.linhas.map((l) => (
                      <TableRow key={l.fitid}>
                        <TableCell>{dateBR(l.data)}</TableCell>
                        <TableCell>{l.descricao}</TableCell>
                        <TableCell className="text-right">{brl(l.valor)}</TableCell>
                        <TableCell>{ROTULO[l.situacao]}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {previa.total > previa.linhas.length && (
                <p className="text-xs text-muted-foreground">
                  Mostrando {previa.linhas.length} de {previa.total} lançamentos.
                </p>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={fechar}>
            Cancelar
          </Button>
          {!previa ? (
            <Button
              onClick={() => simular.mutate()}
              disabled={
                !leitura || leitura.transacoes.length === 0 || !contaId || simular.isPending
              }
            >
              Conferir antes de importar
            </Button>
          ) : (
            <Button onClick={() => importar.mutate()} disabled={importar.isPending}>
              <Upload className="mr-1 size-4" /> Importar
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type LinhaPendente = {
  id: string;
  conta_id: string;
  data: string;
  valor: number;
  descricao: string;
  situacao: string;
};

/** Linhas do banco que o sistema não conhecia: lançar no sistema ou ignorar. */
export function PendenciasExtratoDialog({
  aberto,
  contas,
  onFechar,
}: {
  aberto: boolean;
  contas: ContaBanco[];
  onFechar: () => void;
}) {
  const qc = useQueryClient();
  const { data: linhas = [], isLoading } = useQuery({
    queryKey: ["banco-extrato-pendentes"],
    enabled: aberto,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("banco_extrato_linhas")
        .select("id, conta_id, data, valor, descricao, situacao")
        .in("situacao", ["pendente", "ignorada"])
        .order("data", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as LinhaPendente[];
    },
  });

  const lancar = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("banco_extrato_lancar", { p_linha_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Lançamento criado e conciliado.");
      invalidar(qc);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const ignorar = useMutation({
    mutationFn: async (p: { id: string; ignorar: boolean }) => {
      const { error } = await supabase.rpc("banco_extrato_ignorar", {
        p_linha_id: p.id,
        p_ignorar: p.ignorar,
      });
      if (error) throw error;
    },
    onSuccess: () => invalidar(qc),
    onError: (e: Error) => toast.error(e.message),
  });

  const nome = (id: string) => contas.find((c) => c.id === id)?.apelido ?? "—";

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Pendências do extrato do banco</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Linhas do banco que não batem com nenhum lançamento do sistema. Lance para registrar e
          conciliar, ou ignore o que não é da empresa.
        </p>
        {isLoading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Carregando…</p>
        ) : linhas.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Nada pendente. 🎉</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Data</TableHead>
                <TableHead>Conta</TableHead>
                <TableHead>Descrição</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead className="text-right">Ação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {linhas.map((l) => (
                <TableRow key={l.id} className={l.situacao === "ignorada" ? "opacity-60" : ""}>
                  <TableCell>{dateBR(l.data)}</TableCell>
                  <TableCell>{nome(l.conta_id)}</TableCell>
                  <TableCell>{l.descricao}</TableCell>
                  <TableCell
                    className={`text-right ${Number(l.valor) < 0 ? "text-destructive" : ""}`}
                  >
                    {brl(Number(l.valor))}
                  </TableCell>
                  <TableCell className="space-x-2 text-right">
                    {l.situacao === "pendente" ? (
                      <>
                        <Button
                          size="sm"
                          disabled={lancar.isPending}
                          onClick={() => lancar.mutate(l.id)}
                        >
                          Lançar
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={ignorar.isPending}
                          onClick={() => ignorar.mutate({ id: l.id, ignorar: true })}
                        >
                          Ignorar
                        </Button>
                      </>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={ignorar.isPending}
                        onClick={() => ignorar.mutate({ id: l.id, ignorar: false })}
                      >
                        Desfazer
                      </Button>
                    )}
                  </TableCell>
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
