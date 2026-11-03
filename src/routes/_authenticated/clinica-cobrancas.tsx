import { Link, createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { ModuloBloqueado } from "@/components/app/ModuloCnae";
import { EmptyState, PageHeader } from "@/components/app/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useModulosCnae } from "@/lib/cnae";
import { brl, dateTimeBR } from "@/lib/format";
import { rotuloSituacaoInternacao } from "@/lib/internacao";

export const Route = createFileRoute("/_authenticated/clinica-cobrancas")({
  head: () => ({
    meta: [
      { title: "Internações a cobrar — EZRA ERP" },
      {
        name: "description",
        content: "Internações com alta ou óbito que ainda não foram cobradas na frente de caixa.",
      },
    ],
  }),
  component: CobrancasModulo,
});

type AInternacao = {
  id: string;
  situacao: "alta" | "obito";
  encerrado_em: string;
  pet: string;
  tutor: string;
  itens: number;
  total: number;
};

function CobrancasModulo() {
  const modulos = useModulosCnae();
  if (modulos.carregando) return <div className="panel h-40 animate-pulse" />;
  if (!modulos.clinica) return <ModuloBloqueado modulo="clinica" />;
  return <Cobrancas />;
}

function Cobrancas() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["clinica-internacoes-a-cobrar"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("clinica_internacoes_a_cobrar");
      if (error) throw error;
      return (data ?? []) as unknown as AInternacao[];
    },
  });
  const lista = data ?? [];

  return (
    <div>
      <PageHeader
        title="Internações a cobrar"
        description="Internações encerradas (alta ou óbito) com produtos e serviços ainda sem cobrança. O caixa abre com os itens; a recepção só escolhe a forma de pagamento. Aqui aparecem só os itens e o total, nunca o conteúdo clínico."
      />
      {isLoading ? (
        <div className="panel h-40 animate-pulse" />
      ) : error ? (
        <EmptyState title="Não foi possível abrir a lista" description={(error as Error).message} />
      ) : lista.length === 0 ? (
        <EmptyState
          title="Nada a cobrar"
          description="Quando o veterinário der a alta, a internação com itens aparece aqui."
        />
      ) : (
        <div className="panel overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Animal</TableHead>
                <TableHead>Tutor</TableHead>
                <TableHead>Encerrada</TableHead>
                <TableHead className="text-right">Itens</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {lista.map((i) => (
                <TableRow key={i.id}>
                  <TableCell className="font-medium">{i.pet}</TableCell>
                  <TableCell>{i.tutor}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="mr-2">
                      {rotuloSituacaoInternacao(i.situacao)}
                    </Badge>
                    {dateTimeBR(i.encerrado_em)}
                  </TableCell>
                  <TableCell className="text-right text-numeric">{i.itens}</TableCell>
                  <TableCell className="text-right text-numeric font-semibold">
                    {brl(Number(i.total))}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button asChild size="sm">
                      <Link to="/frente-caixa" search={{ internacao: i.id }}>
                        Cobrar no caixa
                      </Link>
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
