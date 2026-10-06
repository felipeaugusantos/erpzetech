import { useState } from "react";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { ZeLogo } from "@/components/app/ZeLogo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/boas-vindas")({
  ssr: false,
  head: () => ({
    meta: [{ title: "Boas-vindas — ERP Ze Tech" }, { name: "robots", content: "noindex" }],
  }),
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    const { data: perfil } = await supabase
      .from("profiles")
      .select("tenant_id")
      .eq("id", data.user.id)
      .maybeSingle();
    if (perfil?.tenant_id) throw redirect({ to: "/dashboard" });
  },
  component: BoasVindas,
});

function BoasVindas() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [nome, setNome] = useState("");

  const criar = useMutation({
    mutationFn: async () => {
      if (nome.trim().length < 2) throw new Error("Informe o nome da empresa");
      const { error } = await supabase.rpc(
        "onboarding_criar_espaco" as never,
        {
          p_nome: nome.trim(),
        } as never,
      );
      if (error) throw error;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["session-data"] });
      toast.success("Espaço criado", { description: "Agora complete os dados da empresa." });
      navigate({ to: "/empresa" });
    },
    onError: (e: Error) =>
      toast.error("Não foi possível criar o espaço", { description: e.message }),
  });

  async function sair() {
    await supabase.auth.signOut();
    qc.clear();
    navigate({ to: "/auth" });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="items-center text-center">
          <ZeLogo />
          <CardTitle>Bem-vindo ao ERP Ze Tech</CardTitle>
          <CardDescription>
            Sua conta ainda não está vinculada a uma empresa. Crie o seu espaço para começar. Se
            você foi convidado por uma empresa, peça ao administrador para vincular o seu acesso.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              criar.mutate();
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="nome-empresa">Nome da empresa</Label>
              <Input
                id="nome-empresa"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                maxLength={120}
                placeholder="Ex.: Casa de Materiais Silva"
                autoFocus
              />
            </div>
            <Button type="submit" className="w-full" disabled={criar.isPending}>
              {criar.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
              Criar meu espaço
            </Button>
            <Button type="button" variant="ghost" className="w-full" onClick={sair}>
              Sair
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
