import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/lib/auth-sem-contador";
import { MARCADOR_SEM_PETSHOP, moduloLiberadoEmpresa } from "./cnae-regras";
import {
  AVISO_PETSHOP_EXPLICITO,
  definirContratoClinica,
  mensagemErroContrato,
  montarLinhasContrato,
  type EmpresaContrato,
} from "./contrato-clinica";

// Contrato da clínica: só a equipe Ze Tech lê e grava. A gravação usa o serviço (a tabela de liberações não aceita escrita do app).

async function exigirOperador(supabase: {
  rpc: (n: "eh_saas_operador") => PromiseLike<{ data: unknown; error: { message: string } | null }>;
}) {
  const { data, error } = await supabase.rpc("eh_saas_operador");
  if (error) throw new Error(error.message);
  if (data !== true) throw new Error("Área exclusiva da equipe Ze Tech.");
}

const CAMPOS_EMPRESA =
  "id, razao_social, nome_fantasia, ramo_atividade, cnpj, cnae, cnae_secundarios, modulos_sem_cnpj";

export const listarContratosClinica = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await exigirOperador(context.supabase);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [empresas, liberacoes] = await Promise.all([
      supabaseAdmin.from("empresas").select(CAMPOS_EMPRESA).limit(5000),
      supabaseAdmin.from("empresa_modulos_liberados").select("empresa_id, modulo").limit(20000),
    ]);
    if (empresas.error || liberacoes.error)
      throw new Error("Não foi possível consultar as empresas.");
    return {
      linhas: montarLinhasContrato(
        (empresas.data ?? []) as unknown as EmpresaContrato[],
        liberacoes.data ?? [],
      ),
    };
  });

export const definirContratoClinicaFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { empresaId: string; semPetshop: boolean }) =>
    definirContratoClinica.parse(input),
  )
  .handler(async ({ data, context }) => {
    await exigirOperador(context.supabase);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [empresa, liberacoes] = await Promise.all([
      supabaseAdmin.from("empresas").select(CAMPOS_EMPRESA).eq("id", data.empresaId).maybeSingle(),
      supabaseAdmin
        .from("empresa_modulos_liberados")
        .select("empresa_id, modulo")
        .eq("empresa_id", data.empresaId),
    ]);
    if (empresa.error || liberacoes.error) throw new Error("Não foi possível consultar a empresa.");
    if (!empresa.data) throw new Error("Empresa não encontrada.");
    const modulos = (liberacoes.data ?? []).map((l) => l.modulo);
    const comLiberacoes = {
      ...(empresa.data as unknown as EmpresaContrato),
      modulos_liberados: modulos,
    };
    if (!moduloLiberadoEmpresa(comLiberacoes, "clinica"))
      throw new Error("Esta empresa não tem o módulo de clínica.");
    if (data.semPetshop) {
      if (modulos.includes("petshop")) throw new Error(AVISO_PETSHOP_EXPLICITO);
      const { error } = await supabaseAdmin
        .from("empresa_modulos_liberados")
        .upsert(
          { empresa_id: data.empresaId, modulo: MARCADOR_SEM_PETSHOP },
          { onConflict: "empresa_id,modulo", ignoreDuplicates: true },
        );
      if (error) throw new Error(mensagemErroContrato(error.code, error.message));
    } else {
      const { error } = await supabaseAdmin
        .from("empresa_modulos_liberados")
        .delete()
        .eq("empresa_id", data.empresaId)
        .eq("modulo", MARCADOR_SEM_PETSHOP);
      if (error) throw new Error(mensagemErroContrato(error.code, error.message));
    }
    return { ok: true as const };
  });
