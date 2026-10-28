import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Save, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { useSessionData } from "@/hooks/useSessionData";
import { supabase } from "@/integrations/supabase/client";
import { moduloLiberadoEmpresa, ROTULO_MODULO, semCnpj, type ModuloCnae } from "@/lib/cnae";
import { PageHeader } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/modulos-sem-cnpj")({
  head: () => ({
    meta: [
      { title: "Módulos sem CNPJ — ERP Ze Tech" },
      {
        name: "description",
        content: "Atividades e opções de menu liberadas para negócios sem CNPJ no ERP Ze Tech.",
      },
      { property: "og:title", content: "Módulos sem CNPJ — ERP Ze Tech" },
      {
        property: "og:description",
        content: "Seleção de módulos e consulta das opções de menu do negócio.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ModulosSemCnpj,
});

const MENU: Record<ModuloCnae, { grupo: string; itens: string[]; relatorios?: string[] }> = {
  assistencia: {
    grupo: "Assistência técnica",
    itens: ["Ordens de serviço", "Técnicos"],
    relatorios: ["Assistência por loja", "Relatório em PDF"],
  },
  locacao: {
    grupo: "Locação de equipamentos",
    itens: ["Balcão de locação", "Locações", "Equipamentos", "Estoque de equipamentos"],
    relatorios: ["Painel de locação", "Relatório em PDF"],
  },
  restaurante: {
    grupo: "Restaurante",
    itens: ["PDV do restaurante", "Delivery", "Cozinha", "Cardápio e mesas"],
  },
  petshop: {
    grupo: "Pet shop",
    itens: [
      "Agenda",
      "Pets e tutores",
      "Serviços e preços",
      "Profissionais",
      "Contatos",
      "Pacotes",
      "Comissões",
    ],
    relatorios: ["Serviços por profissional"],
  },
  clinica: { grupo: "Clínica", itens: [] },
  lavarapido: {
    grupo: "Lava rápido",
    itens: [
      "Pátio",
      "Veículos",
      "Serviços e preços",
      "Planos e fidelidade",
      "Lavadores e comissões",
      "Avisos ao cliente",
    ],
  },
};
const MODULOS = Object.keys(ROTULO_MODULO) as ModuloCnae[];

function ModulosSemCnpj() {
  const { data: session, isLoading } = useSessionData();
  const qc = useQueryClient();
  const empresa = session?.empresa;
  const [selecionados, setSelecionados] = useState<string[]>([]);
  useEffect(() => {
    setSelecionados(empresa?.modulos_sem_cnpj ?? []);
  }, [empresa?.id, empresa?.modulos_sem_cnpj]);
  const admin = session?.roles.includes("administrador") ?? false;
  const permiteSelecao = Boolean(empresa) && semCnpj(empresa);
  const rascunho = { ...empresa, modulos_sem_cnpj: selecionados };
  const liberados = MODULOS.filter((m) => moduloLiberadoEmpresa(rascunho, m));
  const alterado = MODULOS.some(
    (m) => selecionados.includes(m) !== Boolean(empresa?.modulos_sem_cnpj?.includes(m)),
  );
  const salvar = useMutation({
    mutationFn: async () => {
      if (!admin || !empresa || !permiteSelecao)
        throw new Error("Somente o administrador de um negócio sem CNPJ pode salvar esta seleção.");
      const { data, error } = await supabase
        .from("empresas")
        .update({ modulos_sem_cnpj: selecionados })
        .eq("id", empresa.id)
        .select("id")
        .single();
      if (error) throw error;
      if (!data) throw new Error("Não foi possível salvar os módulos da empresa.");
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["session-data"] }),
        qc.invalidateQueries({ queryKey: ["empresa-cadastro"] }),
        qc.invalidateQueries({ queryKey: ["configuracoes"] }),
      ]);
      toast.success("Módulos salvos");
    },
    onError: (e: Error) => toast.error("Não foi possível salvar", { description: e.message }),
  });
  const roles = session?.roles ?? [];
  const veterinario = roles.includes("veterinario");
  const gestao = roles.some((r) => ["administrador", "gestor"].includes(r));
  const recepcao = roles.some((r) => r === "vendedor" || r === "caixa");
  const clinicaMenu = [
    ...(veterinario ? ["Prontuário", "Exames", "Trabalho sem internet"] : []),
    ...(veterinario || gestao ? ["Catálogo de vacinas", "Modelos de exame"] : []),
    ...(gestao || recepcao ? ["Reforços de vacina"] : []),
  ];

  return (
    <>
      <PageHeader
        title="Módulos sem CNPJ"
        description={empresa?.nome_fantasia || empresa?.razao_social || "Atividades do negócio"}
      />
      {isLoading ? (
        <p className="text-muted-foreground">Carregando módulos…</p>
      ) : !empresa ? (
        <Button asChild variant="outline">
          <Link to="/empresa">Cadastrar empresa</Link>
        </Button>
      ) : (
        <>
          {!permiteSelecao && (
            <div className="mb-5 border-l-4 border-primary bg-secondary p-4 text-sm">
              Esta empresa tem CNPJ. Os módulos seguem o ramo de atividade e os CNAEs cadastrados.
              <Button asChild variant="link">
                <Link to="/empresa">Cadastro da empresa</Link>
              </Button>
            </div>
          )}
          {!admin && permiteSelecao && (
            <p className="mb-4 text-sm text-muted-foreground">
              Somente o administrador pode alterar a seleção.
            </p>
          )}
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <section aria-label="Seleção de módulos">
              <h2 className="mb-3 font-display text-base font-semibold">Atividades</h2>
              <div className="divide-y divide-border border-y border-border">
                {MODULOS.map((m) => {
                  const ativo = moduloLiberadoEmpresa(rascunho, m);
                  const pelaAtividade = moduloLiberadoEmpresa(
                    { ...empresa, modulos_sem_cnpj: [] },
                    m,
                  );
                  return (
                    <div key={m} className="py-4">
                      <div className="flex items-start gap-3">
                        <Checkbox
                          id={`selecionar-${m}`}
                          className="mt-0.5"
                          checked={selecionados.includes(m)}
                          disabled={!admin || !permiteSelecao || salvar.isPending}
                          onCheckedChange={(v) =>
                            setSelecionados((atual) =>
                              v === true
                                ? [...new Set([...atual, m])]
                                : atual.filter((item) => item !== m),
                            )
                          }
                        />
                        <div className="min-w-0 flex-1">
                          <Label htmlFor={`selecionar-${m}`} className="text-sm font-medium">
                            {ROTULO_MODULO[m]}
                          </Label>
                          {pelaAtividade && (
                            <p className="mt-1 text-xs text-muted-foreground">
                              Já liberado pelo ramo ou CNAE cadastrado.
                            </p>
                          )}
                          {!pelaAtividade &&
                            m === "petshop" &&
                            ativo &&
                            !selecionados.includes(m) && (
                              <p className="mt-1 text-xs text-muted-foreground">
                                Incluído pela Clínica veterinária.
                              </p>
                            )}
                        </div>
                        <Badge variant={ativo ? "secondary" : "outline"}>
                          {ativo ? "Liberado" : "Não liberado"}
                        </Badge>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <Button
                  onClick={() => salvar.mutate()}
                  disabled={!admin || !permiteSelecao || !alterado || salvar.isPending}
                >
                  <Save className="mr-2 size-4" />
                  {salvar.isPending ? "Salvando…" : "Salvar módulos"}
                </Button>
                {alterado && (
                  <span className="text-sm text-muted-foreground">Alterações não salvas</span>
                )}
              </div>
            </section>
            <section aria-label="Opções liberadas no menu">
              <div className="mb-3 flex items-center gap-2">
                <Settings2 className="size-4 text-primary" />
                <h2 className="font-display text-base font-semibold">Opções no menu</h2>
              </div>
              <p className="mb-4 text-xs text-muted-foreground">
                {alterado
                  ? "Prévia da seleção — o menu será atualizado após salvar."
                  : "Módulos liberados para a empresa."}{" "}
                As opções disponíveis respeitam o perfil de cada usuário.
              </p>
              {liberados.length === 0 && (
                <p className="border-y border-border py-5 text-sm text-muted-foreground">
                  Nenhum módulo adicional liberado.
                </p>
              )}
              <div className="space-y-5">
                {liberados.map((m) => (
                  <div key={m} className="border-b border-border pb-4">
                    <h3 className="flex items-center gap-2 text-sm font-semibold">
                      <CheckCircle2 className="size-4 text-primary" />
                      {MENU[m].grupo}
                    </h3>
                    <ul className="mt-2 grid gap-1 pl-6 text-sm text-muted-foreground">
                      {(m === "clinica" ? clinicaMenu : MENU[m].itens).map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                    {m === "clinica" && !clinicaMenu.length && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        Disponível para veterinário, gestão ou recepção, conforme as permissões.
                      </p>
                    )}
                    {MENU[m].relatorios && (
                      <p className="mt-2 pl-6 text-xs text-muted-foreground">
                        Relatórios: {MENU[m].relatorios?.join(" · ")}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </section>
          </div>
          <div className="mt-8 border-t border-border pt-4 text-xs text-muted-foreground">
            <p>
              Esta seleção não exige CNAE e não habilita emissão fiscal. Clínica veterinária também
              libera os cadastros de Pet shop.
            </p>
            <p className="mt-2">
              Personalização continua no Cadastro da empresa; Obras segue o ramo Materiais de
              construção.
            </p>
            <Button asChild variant="link" className="mt-2 px-0">
              <Link to="/empresa">Abrir cadastro da empresa</Link>
            </Button>
          </div>
        </>
      )}
    </>
  );
}
