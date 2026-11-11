import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Download } from "lucide-react";
import { toast } from "sonner";

import { contadorNotas, contadorXml } from "@/lib/contador.functions";
import { brl } from "@/lib/format";
import { EmptyState, PageHeader } from "@/components/app/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

export const Route = createFileRoute("/_authenticated/contador")({
  head: () => ({
    meta: [
      { title: "XMLs das notas — EZRA ERP" },
      {
        name: "description",
        content:
          "Área do contador: baixe os XMLs das notas autorizadas da empresa que liberou o seu acesso.",
      },
    ],
  }),
  component: ContadorXmls,
});

const mesAtual = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

function ContadorXmls() {
  const [mes, setMes] = useState(mesAtual());
  const listar = useServerFn(contadorNotas);
  const pegarXml = useServerFn(contadorXml);
  const mesValido = /^\d{4}-(0[1-9]|1[0-2])$/.test(mes);

  const notas = useQuery({
    queryKey: ["contador-notas", mes],
    enabled: mesValido,
    queryFn: () =>
      listar({ data: { mes } }) as Promise<{
        empresa: { nome: string | null; cnpj: string | null };
        notas: {
          id: string;
          numero: number | null;
          serie: number | null;
          situacao: string;
          chave: string | null;
          valor_total: number | string | null;
          emitida_em: string | null;
          created_at: string;
        }[];
      }>,
  });

  const baixar = useMutation({
    mutationFn: (nfeId: string) =>
      pegarXml({ data: { nfeId } }) as Promise<{
        xml: string;
        nome: string;
      }>,
    onSuccess: ({ xml, nome }) => {
      const url = URL.createObjectURL(new Blob([xml], { type: "application/xml" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = nome;
      a.click();
      URL.revokeObjectURL(url);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const lista = notas.data?.notas ?? [];
  return (
    <div>
      <PageHeader
        title="XMLs das notas"
        description={
          notas.data?.empresa?.nome
            ? `${notas.data.empresa.nome}${notas.data.empresa.cnpj ? ` · ${notas.data.empresa.cnpj}` : ""}`
            : "Notas autorizadas e canceladas da empresa que liberou o seu acesso."
        }
      />
      <div className="mb-4 flex max-w-xs flex-col gap-1.5">
        <Label htmlFor="mes">Mês</Label>
        <Input id="mes" type="month" value={mes} onChange={(e) => setMes(e.target.value)} />
      </div>
      {notas.isError ? (
        <EmptyState
          title="Não foi possível abrir as notas"
          description="Seu acesso pode ter sido encerrado. Fale com a empresa que o liberou."
        />
      ) : notas.isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : lista.length === 0 ? (
        <EmptyState title="Nenhuma nota neste mês" description="Escolha outro mês." />
      ) : (
        <div className="panel overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nota</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead className="hidden sm:table-cell">Chave</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead className="w-28" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {lista.map((n) => (
                <TableRow key={n.id}>
                  <TableCell>
                    {n.numero ?? "—"}
                    {n.serie != null ? ` / ${n.serie}` : ""}
                  </TableCell>
                  <TableCell>
                    <Badge variant={n.situacao === "autorizada" ? "default" : "secondary"}>
                      {n.situacao === "autorizada" ? "Autorizada" : "Cancelada"}
                    </Badge>
                  </TableCell>
                  <TableCell className="hidden max-w-[16rem] truncate font-mono text-xs sm:table-cell">
                    {n.chave ?? "—"}
                  </TableCell>
                  <TableCell className="text-right">{brl(Number(n.valor_total ?? 0))}</TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={baixar.isPending}
                      onClick={() => baixar.mutate(n.id)}
                    >
                      <Download className="mr-2 size-4" /> XML
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
