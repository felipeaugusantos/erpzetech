import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useSessionData } from "@/hooks/useSessionData";
import { consultarCnpj } from "@/lib/cnpj.functions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type ClienteFrente = {
  id: string;
  nome: string;
  cpf: string | null;
  cnpj: string | null;
  telefone: string | null;
};
const dig = (v: string) => v.replace(/\D/g, "");

/** Busca e cadastro rápido de clientes (CPF/CNPJ) dentro da frente de caixa. */
export function FrenteClientes({
  open,
  onClose,
  onEscolher,
}: {
  open: boolean;
  onClose: () => void;
  onEscolher: (c: ClienteFrente | null) => void;
}) {
  const qc = useQueryClient();
  const { data: session } = useSessionData();
  const buscarCnpj = useServerFn(consultarCnpj);
  const [busca, setBusca] = useState("");
  const [novo, setNovo] = useState<null | {
    nome: string;
    doc: string;
    telefone: string;
    email: string;
    cep: string;
    endereco: string;
    numero: string;
    bairro: string;
    cidade: string;
    estado: string;
  }>(null);

  const { data: clientes = [] } = useQuery({
    queryKey: ["frente-clientes"],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clientes")
        .select("id, nome, cpf, cnpj, telefone")
        .order("nome")
        .limit(2000);
      if (error) throw error;
      return (data ?? []) as ClienteFrente[];
    },
  });

  const filtrados = useMemo(() => {
    const t = busca.trim().toLowerCase();
    const d = dig(busca);
    if (!t) return clientes.slice(0, 30);
    return clientes
      .filter(
        (c) =>
          c.nome.toLowerCase().includes(t) ||
          (d.length >= 3 &&
            (dig(c.cpf ?? "").includes(d) ||
              dig(c.cnpj ?? "").includes(d) ||
              dig(c.telefone ?? "").includes(d))),
      )
      .slice(0, 30);
  }, [busca, clientes]);

  const preencherCnpj = useMutation({
    mutationFn: async () => buscarCnpj({ data: { cnpj: dig(novo!.doc) } }),
    onSuccess: (r) => {
      const d = r as Record<string, string | null | undefined>;
      setNovo(
        (n) =>
          n && {
            ...n,
            nome: d["razao_social"] || n.nome,
            telefone: d["telefone"] || n.telefone,
            email: d["email"] || n.email,
            cep: d["cep"] || n.cep,
            endereco: d["endereco"] || n.endereco,
            numero: d["numero"] || n.numero,
            bairro: d["bairro"] || n.bairro,
            cidade: d["cidade"] || n.cidade,
            estado: d["estado"] || n.estado,
          },
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const salvar = useMutation({
    mutationFn: async () => {
      const n = novo!;
      const d = dig(n.doc);
      if (!n.nome.trim()) throw new Error("Informe o nome");
      if (d.length !== 11 && d.length !== 14)
        throw new Error("Informe um CPF (11 dígitos) ou CNPJ (14 dígitos)");
      const pj = d.length === 14;
      const { data, error } = await supabase
        .from("clientes")
        .insert({
          tenant_id: session?.profile?.tenant_id as string,
          empresa_id: session?.profile?.empresa_id ?? null,
          filial_id: session?.profile?.filial_id ?? null,
          tipo: pj ? "PJ" : "PF",
          nome: n.nome.trim(),
          cpf: pj ? null : d,
          cnpj: pj ? d : null,
          telefone: n.telefone || null,
          email: n.email || null,
          cep: n.cep || null,
          endereco: n.endereco || null,
          numero: n.numero || null,
          bairro: n.bairro || null,
          cidade: n.cidade || null,
          estado: n.estado || null,
        })
        .select("id, nome, cpf, cnpj, telefone")
        .single();
      if (error) throw error;
      return data as ClienteFrente;
    },
    onSuccess: (c) => {
      toast.success("Cliente cadastrado");
      setNovo(null);
      void qc.invalidateQueries({ queryKey: ["frente-clientes"] });
      onEscolher(c);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setNovo(null);
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{novo ? "Cadastrar cliente" : "Cliente da venda"}</DialogTitle>
        </DialogHeader>
        {!novo ? (
          <div className="space-y-3">
            <Input
              autoFocus
              placeholder="Nome, CPF, CNPJ ou telefone"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && filtrados[0]) onEscolher(filtrados[0]);
              }}
            />
            <div className="max-h-72 space-y-1 overflow-y-auto">
              {filtrados.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onEscolher(c)}
                  className="flex w-full justify-between rounded border px-3 py-2 text-left text-sm hover:bg-muted"
                >
                  <span className="font-medium">{c.nome}</span>
                  <span className="text-xs text-muted-foreground">
                    {c.cnpj ? `CNPJ ${c.cnpj}` : c.cpf ? `CPF ${c.cpf}` : "sem documento"}
                  </span>
                </button>
              ))}
              {filtrados.length === 0 && (
                <p className="text-sm text-muted-foreground">Nenhum cliente encontrado.</p>
              )}
            </div>
            <div className="flex justify-between gap-2">
              <Button variant="outline" onClick={() => onEscolher(null)}>
                Consumidor final
              </Button>
              <Button
                onClick={() =>
                  setNovo({
                    nome: busca && !dig(busca) ? busca : "",
                    doc: dig(busca).length >= 11 ? dig(busca) : "",
                    telefone: "",
                    email: "",
                    cep: "",
                    endereco: "",
                    numero: "",
                    bairro: "",
                    cidade: "",
                    estado: "",
                  })
                }
              >
                Cadastrar novo
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label>CPF ou CNPJ</Label>
              <div className="flex gap-2">
                <Input
                  autoFocus
                  value={novo.doc}
                  onChange={(e) => setNovo({ ...novo, doc: e.target.value })}
                />
                {dig(novo.doc).length === 14 && (
                  <Button
                    variant="outline"
                    disabled={preencherCnpj.isPending}
                    onClick={() => preencherCnpj.mutate()}
                  >
                    Buscar CNPJ
                  </Button>
                )}
              </div>
            </div>
            <div className="sm:col-span-2">
              <Label>Nome / razão social</Label>
              <Input
                value={novo.nome}
                onChange={(e) => setNovo({ ...novo, nome: e.target.value })}
              />
            </div>
            <div>
              <Label>Telefone</Label>
              <Input
                value={novo.telefone}
                onChange={(e) => setNovo({ ...novo, telefone: e.target.value })}
              />
            </div>
            <div>
              <Label>E-mail</Label>
              <Input
                value={novo.email}
                onChange={(e) => setNovo({ ...novo, email: e.target.value })}
              />
            </div>
            <div>
              <Label>CEP</Label>
              <Input value={novo.cep} onChange={(e) => setNovo({ ...novo, cep: e.target.value })} />
            </div>
            <div>
              <Label>Endereço</Label>
              <Input
                value={novo.endereco}
                onChange={(e) => setNovo({ ...novo, endereco: e.target.value })}
              />
            </div>
            <div>
              <Label>Número</Label>
              <Input
                value={novo.numero}
                onChange={(e) => setNovo({ ...novo, numero: e.target.value })}
              />
            </div>
            <div>
              <Label>Bairro</Label>
              <Input
                value={novo.bairro}
                onChange={(e) => setNovo({ ...novo, bairro: e.target.value })}
              />
            </div>
            <div>
              <Label>Cidade</Label>
              <Input
                value={novo.cidade}
                onChange={(e) => setNovo({ ...novo, cidade: e.target.value })}
              />
            </div>
            <div>
              <Label>UF</Label>
              <Input
                maxLength={2}
                value={novo.estado}
                onChange={(e) => setNovo({ ...novo, estado: e.target.value.toUpperCase() })}
              />
            </div>
            <div className="flex justify-between gap-2 sm:col-span-2">
              <Button variant="ghost" onClick={() => setNovo(null)}>
                Voltar
              </Button>
              <Button disabled={salvar.isPending} onClick={() => salvar.mutate()}>
                Salvar e usar na venda
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
