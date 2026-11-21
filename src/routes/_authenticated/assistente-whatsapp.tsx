import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { queryOptions, useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { MessageCircle, Save } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  lerPreferenciasAssistente,
  salvarPreferenciasAssistente,
} from "@/lib/assistente-whatsapp.functions";
import {
  preferenciasAssistenteSchema,
  type PreferenciasAssistente,
} from "@/lib/assistente-whatsapp";

const preferenciasQuery = queryOptions({
  queryKey: ["wa-assistente-preferencias"],
  queryFn: () => lerPreferenciasAssistente(),
});

export const Route = createFileRoute("/_authenticated/assistente-whatsapp")({
  loader: ({ context }) => context.queryClient.ensureQueryData(preferenciasQuery),
  head: () => ({
    meta: [
      { title: "Assistente WhatsApp — ERP Ze Tech" },
      {
        name: "description",
        content: "Preferências do atendimento de leads por WhatsApp da empresa.",
      },
      { property: "og:title", content: "Assistente WhatsApp — ERP Ze Tech" },
      {
        property: "og:description",
        content: "Preparação do atendimento, orçamentos e encaminhamento ao responsável.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AssistenteWhatsApp,
});

function AssistenteWhatsApp() {
  const { data } = useSuspenseQuery(preferenciasQuery);
  return <Preferencias key={JSON.stringify(data)} inicial={data} />;
}

function Preferencias({ inicial }: { inicial: PreferenciasAssistente }) {
  const [valores, setValores] = useState(inicial);
  const qc = useQueryClient();
  const salvar = useServerFn(salvarPreferenciasAssistente);
  const mutation = useMutation({
    mutationFn: () => salvar({ data: preferenciasAssistenteSchema.parse(valores) }),
    onSuccess: () => {
      toast.success("Preferências salvas");
      void qc.invalidateQueries({ queryKey: preferenciasQuery.queryKey });
    },
    onError: (error: Error) =>
      toast.error("Não foi possível salvar", { description: error.message }),
  });
  return (
    <div className="space-y-6">
      <PageHeader
        title="Assistente WhatsApp"
        actions={<Badge variant="secondary">Não ativado</Badge>}
      />
      <div className="flex flex-wrap items-center gap-3 border-y border-border py-4">
        <MessageCircle className="size-5 text-primary" />
        <span className="font-medium">Serviço adicional</span>
        <span className="text-sm text-muted-foreground">
          Valor mensal a definir · Nenhuma cobrança ativa
        </span>
      </div>
      <form
        className="max-w-3xl space-y-6"
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
      >
        <section className="space-y-4">
          <h2 className="font-display text-lg font-semibold">Identidade do atendimento</h2>
          <div className="space-y-2">
            <Label htmlFor="assistente-nome">Nome do assistente</Label>
            <Input
              id="assistente-nome"
              required
              maxLength={80}
              value={valores.nome}
              onChange={(e) => setValores({ ...valores, nome: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="assistente-boas-vindas">Mensagem de boas-vindas</Label>
            <Textarea
              id="assistente-boas-vindas"
              required
              maxLength={1000}
              rows={4}
              value={valores.boas_vindas}
              onChange={(e) => setValores({ ...valores, boas_vindas: e.target.value })}
            />
          </div>
        </section>
        <section className="space-y-4 border-t border-border pt-5">
          <h2 className="font-display text-lg font-semibold">Preferências de atendimento</h2>
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="assistente-orcamentos">Orçamentos pelos preços cadastrados</Label>
            <Switch
              id="assistente-orcamentos"
              checked={valores.orcamentos}
              onCheckedChange={(v) => setValores({ ...valores, orcamentos: v })}
            />
          </div>
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="assistente-agendamentos">Agendamento de horários</Label>
            <Switch
              id="assistente-agendamentos"
              checked={valores.agendamentos}
              onCheckedChange={(v) => setValores({ ...valores, agendamentos: v })}
            />
          </div>
        </section>
        <section className="space-y-4 border-t border-border pt-5">
          <h2 className="font-display text-lg font-semibold">
            Responsável pelo atendimento humano
          </h2>
          <div className="space-y-2">
            <Label htmlFor="assistente-responsavel">WhatsApp do responsável</Label>
            <Input
              id="assistente-responsavel"
              inputMode="tel"
              maxLength={20}
              placeholder="55 + DDD + número"
              value={valores.responsavel_numero}
              onChange={(e) =>
                setValores({ ...valores, responsavel_numero: e.target.value.replace(/\D/g, "") })
              }
            />
          </div>
        </section>
        <Button type="submit" disabled={mutation.isPending}>
          <Save className="size-4" />
          {mutation.isPending ? "Salvando…" : "Salvar preferências"}
        </Button>
      </form>
    </div>
  );
}
