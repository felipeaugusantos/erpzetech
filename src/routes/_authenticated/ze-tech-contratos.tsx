import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { definirContratoClinicaFn, listarContratosClinica } from "@/lib/contrato-clinica.functions";
import {
  AVISO_PETSHOP_EXPLICITO,
  ROTULO_CONTRATO,
  type LinhaContrato,
} from "@/lib/contrato-clinica";
import { useSaasOperador } from "@/lib/saas";
import { EmptyState, PageHeader } from "@/components/app/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/ze-tech-contratos")({
  head: () => ({
    meta: [
      { title: "Contrato da clínica — ERP Ze Tech" },
      {
        name: "description",
        content: "Marque, por empresa, se a clínica foi contratada com ou sem pet shop.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ContratosClinica,
});

function ContratosClinica() {
  const qc = useQueryClient();
  const { data: operador, isLoading: acessoCarregando } = useSaasOperador();
  const listar = useServerFn(listarContratosClinica);
  const definir = useServerFn(definirContratoClinicaFn);
  const [busca, setBusca] = useState("");
  const [alvo, setAlvo] = useState<{ linha: LinhaContrato; semPetshop: boolean } | null>(null);

  const contratos = useQuery({
    queryKey: ["ze-tech-contratos"],
    queryFn: () => listar(),
    enabled: operador === true,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });

  const salvar = useMutation({
    mutationFn: (p: { empresaId: string; semPetshop: boolean }) => definir({ data: p }),
    onSuccess: () => {
      toast.success("Contrato salvo", {
        description: "A empresa vê a mudança no próximo carregamento do sistema.",
      });
      setAlvo(null);
      void qc.invalidateQueries({ queryKey: ["ze-tech-contratos"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const linhas = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    const todas = contratos.data?.linhas ?? [];
    return termo ? todas.filter((l) => l.nome.toLowerCase().includes(termo)) : todas;
  }, [contratos.data, busca]);

  if (acessoCarregando) return <p className="text-sm text-muted-foreground">Carregando…</p>;
  if (!operador)
    return (
      <EmptyState
        title="Área exclusiva da equipe Ze Tech"
        description="Esta conta não tem acesso ao painel do fabricante."
      />
    );

  return (
    <>
      <PageHeader
        title="Contrato da clínica"
        actions={
          <>
            <Button asChild variant="outline">
              <Link to="/ze-tech">Painel de clientes</Link>
            </Button>
            <Button
              variant="outline"
              size="icon"
              aria-label="Atualizar lista"
              title="Atualizar lista"
              onClick={() => void contratos.refetch()}
              disabled={contratos.isFetching}
            >
              <RefreshCw className="size-4" />
            </Button>
          </>
        }
      />
      <p className="mb-4 max-w-3xl text-sm text-muted-foreground">
        Por padrão a clínica inclui o pet shop. Marcando “só clínica”, a área Pet shop da empresa
        mostra apenas Pets e tutores e Contatos, e as telas de serviços do pet shop ficam
        bloqueadas. Nenhum dado é apagado e a mudança pode ser desfeita.
      </p>
      <div className="mb-4 max-w-sm">
        <Input
          placeholder="Buscar empresa"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          aria-label="Buscar empresa"
        />
      </div>
      {contratos.isPending ? (
        <p className="text-sm text-muted-foreground">Carregando empresas…</p>
      ) : contratos.isError ? (
        <div role="alert" className="text-destructive">
          {contratos.error.message}
        </div>
      ) : linhas.length === 0 ? (
        <EmptyState
          title="Nenhuma empresa de clínica"
          description="Só aparecem empresas com o módulo de clínica."
        />
      ) : (
        <div className="overflow-x-auto rounded-md border bg-card">
          <Table className="min-w-[560px]">
            <TableHeader>
              <TableRow>
                <TableHead>Empresa</TableHead>
                <TableHead>Contrato</TableHead>
                <TableHead className="w-56">
                  <span className="sr-only">Ação</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {linhas.map((l) => {
                const semPet = l.contrato === "clinica_sem_petshop";
                return (
                  <TableRow key={l.id}>
                    <TableCell className="font-medium">{l.nome}</TableCell>
                    <TableCell>
                      <Badge variant={semPet ? "default" : "secondary"}>
                        {ROTULO_CONTRATO[l.contrato]}
                      </Badge>
                      {l.petshopExplicito && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          Pet shop liberado de forma explícita.
                        </p>
                      )}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!semPet && l.petshopExplicito}
                        title={!semPet && l.petshopExplicito ? AVISO_PETSHOP_EXPLICITO : undefined}
                        onClick={() => setAlvo({ linha: l, semPetshop: !semPet })}
                      >
                        {semPet ? "Voltar a incluir o pet shop" : "Marcar só clínica"}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <AlertDialog
        open={alvo !== null}
        onOpenChange={(o) => !o && !salvar.isPending && setAlvo(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {alvo?.semPetshop ? "Marcar só clínica?" : "Voltar a incluir o pet shop?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {alvo?.semPetshop
                ? `${alvo.linha.nome} passa a ver, na área Pet shop, só Pets e tutores e Contatos. Agenda, Ordens de serviço, Serviços e preços, Profissionais, Campos e Pacotes ficam bloqueados. Nenhum dado é apagado.`
                : `${alvo?.linha.nome} volta a ver a área Pet shop completa.`}{" "}
              Confirme que isso está de acordo com o contrato do cliente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={salvar.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={salvar.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (alvo) salvar.mutate({ empresaId: alvo.linha.id, semPetshop: alvo.semPetshop });
              }}
            >
              {salvar.isPending ? "Salvando…" : "Confirmar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
