import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { EmptyState } from "@/components/app/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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

/**
 * Acesso do contador (só o administrador vê). O contador usa uma conta própria, criada em "Novo usuário" sem
 * nenhum perfil operacional; aqui o administrador a liga a UMA empresa e pode revogar quando quiser.
 * O XML vale só para a empresa escolhida. A parte tributária (ajustes de tributos aproximados e regras fiscais)
 * é da conta inteira, então só pode ser liberada quando a conta tem uma única empresa.
 */
export function ContadorAcessos() {
  const qc = useQueryClient();
  const [pessoa, setPessoa] = useState("");
  const [empresa, setEmpresa] = useState("");
  const [edita, setEdita] = useState(false);

  const dados = useQuery({
    queryKey: ["contador-acessos"],
    queryFn: async () => {
      const [acessos, perfis, papeis, empresas] = await Promise.all([
        supabase.rpc("contador_acessos_listar"),
        supabase.from("profiles").select("id, nome, email").order("nome"),
        supabase.from("user_roles").select("user_id, role"),
        supabase
          .from("empresas")
          .select("id, razao_social, nome_fantasia, ativo")
          .eq("ativo", true),
      ]);
      const erro = acessos.error ?? perfis.error ?? papeis.error ?? empresas.error;
      if (erro) throw erro;
      return {
        acessos: acessos.data ?? [],
        perfis: perfis.data ?? [],
        papeis: papeis.data ?? [],
        empresas: empresas.data ?? [],
      };
    },
  });

  const empresas = dados.data?.empresas ?? [];
  const umaEmpresa = empresas.length === 1;
  const ativos = new Set(
    (dados.data?.acessos ?? []).filter((a) => !a.revogado_em).map((a) => a.user_id),
  );
  // só contas sem nenhum perfil operacional (ou que já foram contador): a conta de um funcionário não vira contador
  const candidatas = (dados.data?.perfis ?? []).filter((p) => {
    const meus = (dados.data?.papeis ?? []).filter((r) => r.user_id === p.id);
    return !ativos.has(p.id) && meus.every((r) => r.role === "contador");
  });

  const refrescar = () => qc.invalidateQueries({ queryKey: ["contador-acessos"] });

  const conceder = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("contador_conceder", {
        p_user: pessoa,
        p_empresa: empresa,
        p_edita_tributos: edita && umaEmpresa,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Acesso do contador liberado");
      setPessoa("");
      setEmpresa("");
      setEdita(false);
      void refrescar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const revogar = useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await supabase.rpc("contador_revogar", { p_user: userId });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Acesso do contador revogado");
      void refrescar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <div className="panel space-y-4 p-4">
        <div className="flex items-start gap-2 text-sm text-muted-foreground">
          <ShieldCheck className="mt-0.5 size-4 shrink-0" />
          <p>
            O contador entra com uma conta própria e vê somente os XMLs das notas autorizadas da
            empresa que você escolher. Ele não vê vendas, clientes, financeiro nem outros cadastros.
            A permissão tributária vale para a conta inteira (todas as empresas dela), por isso só
            pode ser liberada quando a conta tem uma empresa.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Conta do contador</Label>
            <Select value={pessoa} onValueChange={setPessoa}>
              <SelectTrigger aria-label="Conta do contador">
                <SelectValue placeholder="Escolha uma conta sem perfil operacional" />
              </SelectTrigger>
              <SelectContent>
                {candidatas.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.nome || p.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {candidatas.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Crie a conta em "Novo usuário", sem marcar nenhum perfil, e volte aqui.
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>Empresa autorizada (XMLs)</Label>
            <Select value={empresa} onValueChange={setEmpresa}>
              <SelectTrigger aria-label="Empresa autorizada">
                <SelectValue placeholder="Escolha a empresa" />
              </SelectTrigger>
              <SelectContent>
                {empresas.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.nome_fantasia || e.razao_social}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex items-start gap-2">
          <Checkbox
            id="edita-tributos"
            checked={edita && umaEmpresa}
            disabled={!umaEmpresa}
            onCheckedChange={(v) => setEdita(v === true)}
          />
          <div>
            <Label htmlFor="edita-tributos">Permitir alterar a parte tributária da conta</Label>
            <p className="text-xs text-muted-foreground">
              {umaEmpresa
                ? "Ajustes de tributos aproximados e regras fiscais da conta, com motivo e validade registrados."
                : "Indisponível: esta conta tem mais de uma empresa e os ajustes e regras valem para todas. O contador teria só os XMLs."}
            </p>
          </div>
        </div>
        <div className="flex justify-end">
          <Button
            disabled={!pessoa || !empresa || conceder.isPending}
            onClick={() => conceder.mutate()}
          >
            Liberar acesso
          </Button>
        </div>
      </div>

      {(dados.data?.acessos.length ?? 0) === 0 ? (
        <EmptyState
          title="Nenhum contador com acesso"
          description="Os acessos liberados aparecem aqui."
        />
      ) : (
        <div className="panel overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Contador</TableHead>
                <TableHead>Empresa (XMLs)</TableHead>
                <TableHead>Parte tributária</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead className="w-28" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(dados.data?.acessos ?? []).map((a) => (
                <TableRow key={a.id}>
                  <TableCell>{a.nome || a.email}</TableCell>
                  <TableCell>{a.empresa_nome}</TableCell>
                  <TableCell>
                    {a.pode_editar_tributos ? "Pode alterar (conta inteira)" : "Não"}
                  </TableCell>
                  <TableCell>
                    {a.revogado_em ? (
                      <Badge variant="secondary">Revogado</Badge>
                    ) : (
                      <Badge>Ativo</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {!a.revogado_em && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={revogar.isPending}
                        onClick={() => revogar.mutate(a.user_id)}
                      >
                        Revogar
                      </Button>
                    )}
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
