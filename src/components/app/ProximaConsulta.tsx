import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { dateTimeBR } from "@/lib/format";
import { isoBrasilia } from "@/lib/fuso";
import { erroProximaConsulta, inicioProximaConsulta } from "@/lib/proxima-consulta";

type Opcoes = {
  meu_veterinario: string;
  profissionais: { id: string; nome: string }[];
  servicos: { id: string; nome: string; duracao_min: number }[];
  consultas: { id: string; inicio: string; veterinario: string; situacao: string }[];
};

export function ProximaConsulta({
  petId,
  petNome,
  diaSugerido = "",
  aoAgendar,
}: {
  petId: string;
  petNome: string;
  diaSugerido?: string;
  aoAgendar?: ((dia: string) => void) | undefined;
}) {
  const [aberto, setAberto] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setAberto(true)}>
        <CalendarPlus className="size-4" />
        Agendar próxima consulta
      </Button>
      {aberto && (
        <AgendarConsulta
          key={petId}
          petId={petId}
          petNome={petNome}
          diaSugerido={diaSugerido}
          aoFechar={() => setAberto(false)}
          aoAgendar={aoAgendar}
        />
      )}
    </>
  );
}

function AgendarConsulta({
  petId,
  petNome,
  diaSugerido,
  aoFechar,
  aoAgendar,
}: {
  petId: string;
  petNome: string;
  diaSugerido: string;
  aoFechar: () => void;
  aoAgendar?: ((dia: string) => void) | undefined;
}) {
  const qc = useQueryClient();
  // Sem data padrão: o veterinário escolhe o dia da próxima consulta.
  const [dia, setDia] = useState("");
  void diaSugerido;
  const [hora, setHora] = useState("");
  const [profissional, setProfissional] = useState("");
  const [servico, setServico] = useState("");
  const [observacoes, setObservacoes] = useState("");
  const [tentativa, setTentativa] = useState<{ assinatura: string; chave: string } | null>(null);
  const opcoes = useQuery({
    queryKey: ["clinica-proxima-consulta", petId],
    refetchOnMount: "always",
    queryFn: async () => {
      const r = await supabase.rpc("clinica_proxima_consulta_opcoes", { p_pet_id: petId });
      if (r.error) throw r.error;
      return r.data as unknown as Opcoes;
    },
  });
  const dados = opcoes.data;
  const vet = profissional || dados?.meu_veterinario || "";
  const sv = servico || (dados?.servicos.length === 1 ? dados.servicos[0]?.id : "") || "";
  const salvar = useMutation({
    mutationFn: async () => {
      const erro = erroProximaConsulta(dia, hora);
      if (erro) throw new Error(erro);
      const inicio = inicioProximaConsulta(dia, hora);
      if (!inicio || !vet || !sv) throw new Error("Escolha o veterinário e o serviço.");
      const payload = { pet_id: petId, profissional_id: vet, servico_id: sv, inicio, observacoes };
      const assinatura = JSON.stringify(payload);
      const chave = tentativa?.assinatura === assinatura ? tentativa.chave : crypto.randomUUID();
      setTentativa({ assinatura, chave });
      const r = await supabase.rpc("clinica_proxima_consulta_agendar", {
        p_chave: chave,
        p_dados: payload,
      });
      if (r.error) throw r.error;
      return r.data as unknown as { inicio: string; veterinario: string };
    },
    onSuccess: (r) => {
      for (const key of [
        "clinica-proxima-consulta",
        "pet-agenda",
        "pet-minha-agenda",
        "clinica-pacientes-atendidos",
        "clinica-painel-pacientes",
        "clinica-visao-veterinarios",
        "clinica-fila-agora",
        "dashboard-pet",
      ])
        void qc.invalidateQueries({ queryKey: [key] });
      aoAgendar?.(dia);
      toast.success("Próxima consulta agendada", {
        description: `${dateTimeBR(r.inicio)} · ${r.veterinario}`,
      });
      aoFechar();
    },
    onError: (e: Error) => toast.error("Não foi possível agendar", { description: e.message }),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && !salvar.isPending && aoFechar()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Próxima consulta de {petNome}</DialogTitle>
        </DialogHeader>
        {opcoes.isLoading ? (
          <div className="h-24 animate-pulse bg-muted" />
        ) : opcoes.error ? (
          <p role="alert" className="text-sm text-destructive">
            {(opcoes.error as Error).message}
          </p>
        ) : (
          dados && (
            <>
              {dados.consultas.length > 0 && (
                <div className="space-y-1 border-l-2 border-primary pl-3 text-sm">
                  <p className="font-semibold">Consultas já agendadas</p>
                  {dados.consultas.map((c) => (
                    <p key={c.id}>
                      {dateTimeBR(c.inicio)} · {c.veterinario}
                    </p>
                  ))}
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="pc-dia">Data</Label>
                  <Input
                    id="pc-dia"
                    type="date"
                    min={isoBrasilia()}
                    value={dia}
                    onChange={(e) => setDia(e.target.value)}
                    disabled={salvar.isPending}
                  />
                </div>
                <div>
                  <Label htmlFor="pc-hora">Horário (Brasília)</Label>
                  <Input
                    id="pc-hora"
                    type="time"
                    value={hora}
                    onChange={(e) => setHora(e.target.value)}
                    disabled={salvar.isPending}
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="pc-vet">Veterinário</Label>
                <Select value={vet} onValueChange={setProfissional} disabled={salvar.isPending}>
                  <SelectTrigger id="pc-vet">
                    <SelectValue placeholder="Escolha" />
                  </SelectTrigger>
                  <SelectContent>
                    {dados.profissionais.map((v) => (
                      <SelectItem key={v.id} value={v.id}>
                        {v.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="pc-servico">Serviço de consulta</Label>
                <Select value={sv} onValueChange={setServico} disabled={salvar.isPending}>
                  <SelectTrigger id="pc-servico">
                    <SelectValue placeholder="Escolha" />
                  </SelectTrigger>
                  <SelectContent>
                    {dados.servicos.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.nome} · {s.duracao_min} min
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {dados.servicos.length === 0 && (
                <p className="text-sm text-warning">
                  Nenhum serviço de consulta ativo. Peça à gestão para cadastrar o serviço e seu
                  preço.
                </p>
              )}
              <div>
                <Label htmlFor="pc-obs">Observações</Label>
                <Input
                  id="pc-obs"
                  value={observacoes}
                  onChange={(e) => setObservacoes(e.target.value)}
                  disabled={salvar.isPending}
                />
              </div>
            </>
          )
        )}
        <DialogFooter>
          <Button variant="outline" onClick={aoFechar} disabled={salvar.isPending}>
            Cancelar
          </Button>
          <Button
            disabled={!dados || !vet || !sv || !dia || !hora || salvar.isPending}
            onClick={() => salvar.mutate()}
          >
            {salvar.isPending ? "Agendando…" : "Confirmar agendamento"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
