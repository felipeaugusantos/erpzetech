import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type Perfil = {
  id: string;
  nome: string;
  email: string | null;
  tenant_id: string | null;
  empresa_id: string | null;
  filial_id: string | null;
};

export function useSessionData() {
  return useQuery({
    queryKey: ["session-data"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data: userData } = await supabase.auth.getUser();
      const user = userData.user;
      if (!user) return null;

      const [{ data: profile }, { data: roles }, { data: empresa }, { data: filiais }] =
        await Promise.all([
          supabase
            .from("profiles")
            .select("id, nome, email, tenant_id, empresa_id, filial_id")
            .eq("id", user.id)
            .maybeSingle(),
          supabase.from("user_roles").select("role").eq("user_id", user.id),
          supabase
            .from("empresas")
            .select("id, razao_social, nome_fantasia, ramo_atividade")
            .limit(1)
            .maybeSingle(),
          supabase.from("filiais").select("id, nome, codigo").order("nome"),
        ]);

      return {
        user,
        profile: (profile ?? null) as Perfil | null,
        roles: (roles ?? []).map((r) => r.role as string),
        empresa: empresa ?? null,
        filiais: filiais ?? [],
      };
    },
  });
}
