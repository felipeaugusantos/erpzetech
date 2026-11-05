import { useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { PortalShell } from "@/components/portal/PortalShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { rotulo, ESPECIES } from "@/lib/pet";
import { esquecerCodigoGuardado, exigirSessaoPortal, lerCodigoGuardado } from "@/lib/portal-sessao";
import {
  chavePortal,
  codigoCompleto,
  formatarCodigo,
  normalizarCodigo,
  quandoVacina,
  type CadastroPortal,
} from "@/lib/portal-tutor";

export const Route = createFileRoute("/portal/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Meus animais — Portal do tutor" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  beforeLoad: exigirSessaoPortal,
  component: Inicio,
});

function Inicio() {
  const [outroCodigo, setOutroCodigo] = useState(false);
  const pets = useQuery({
    queryKey: chavePortal("pets"),
    staleTime: 0,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("portal_meus_pets");
      if (error) throw error;
      return (data ?? []) as unknown as CadastroPortal[];
    },
  });
  const cadastros = pets.data ?? [];

  return (
    <PortalShell>
      <h1 className="text-lg font-semibold">Meus animais</h1>

      {pets.isLoading ? (
        <div className="panel h-24 animate-pulse" />
      ) : pets.isError ? (
        <p className="panel p-4 text-sm text-destructive" role="alert">
          Não foi possível carregar seus animais: {(pets.error as Error).message}
        </p>
      ) : cadastros.length === 0 ? (
        <>
          <p className="text-sm text-muted-foreground">
            Sua conta ainda não está vinculada a nenhuma clínica. Use o código que a clínica te
            entregou.
          </p>
          <VincularCodigo />
        </>
      ) : (
        <>
          {cadastros.map((c) => (
            <section key={c.vinculo_id} className="space-y-3" aria-label={c.clinica ?? "Clínica"}>
              <div>
                <h2 className="text-base font-semibold">{c.clinica ?? "Clínica"}</h2>
                <p className="text-xs text-muted-foreground">Cadastro de {c.tutor}</p>
              </div>
              {c.pets.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum animal ativo neste cadastro.</p>
              ) : (
                c.pets.map((p) => (
                  <div key={p.id} className="panel space-y-2 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="break-words text-base font-semibold">{p.nome}</p>
                        <p className="text-xs text-muted-foreground">
                          {[rotulo(ESPECIES, p.especie), p.raca].filter(Boolean).join(" · ")}
                        </p>
                      </div>
                      <Button asChild size="sm" variant="outline">
                        <Link to="/portal/animal/$id" params={{ id: p.id }}>
                          Exames e receitas ({p.exames + p.receitas})
                        </Link>
                      </Button>
                    </div>
                    <div>
                      <h3 className="text-sm font-medium">Próximas vacinas</h3>
                      {p.vacinas.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          Nenhuma próxima dose registrada pela clínica.
                        </p>
                      ) : (
                        <ul
                          className="mt-1 divide-y divide-border text-sm"
                          aria-label={`Próximas vacinas de ${p.nome}`}
                        >
                          {p.vacinas.map((v) => (
                            <li
                              key={`${v.nome}-${v.proxima_dose_em}`}
                              className="flex flex-wrap items-center justify-between gap-2 py-1.5"
                            >
                              <span className="min-w-0 break-words">{v.nome}</span>
                              <span className="flex items-center gap-2">
                                <span className="text-xs text-muted-foreground">
                                  {new Date(
                                    `${v.proxima_dose_em.slice(0, 10)}T00:00:00`,
                                  ).toLocaleDateString("pt-BR")}
                                </span>
                                <Badge variant={v.atrasada ? "destructive" : "secondary"}>
                                  {quandoVacina(v.proxima_dose_em)}
                                </Badge>
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                ))
              )}
            </section>
          ))}
          <div>
            <button
              type="button"
              className="text-sm underline"
              onClick={() => setOutroCodigo((v) => !v)}
            >
              Tenho outro código de uma clínica
            </button>
            {outroCodigo && <VincularCodigo />}
          </div>
        </>
      )}
    </PortalShell>
  );
}

function VincularCodigo() {
  const qc = useQueryClient();
  const [codigo, setCodigo] = useState(() => formatarCodigo(lerCodigoGuardado()));
  const [erro, setErro] = useState<string | null>(null);

  const vincular = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("portal_resgatar_convite", {
        p_codigo: normalizarCodigo(codigo),
      });
      if (error) throw error;
      return data as unknown as { ok: boolean; erro?: string; clinica?: string };
    },
    onSuccess: (r) => {
      if (!r.ok) {
        setErro(r.erro ?? "Não foi possível usar este código.");
        return;
      }
      setErro(null);
      esquecerCodigoGuardado();
      setCodigo("");
      toast.success("Acesso liberado", {
        description: r.clinica ? `Vinculado a ${r.clinica}.` : undefined,
      });
      void qc.invalidateQueries({ queryKey: chavePortal("pets") });
    },
    onError: (e: Error) => setErro(e.message),
  });

  return (
    <form
      className="panel mt-2 space-y-3 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        setErro(null);
        vincular.mutate();
      }}
    >
      <div>
        <Label htmlFor="pt-codigo">Código da clínica</Label>
        <Input
          id="pt-codigo"
          autoComplete="off"
          autoCapitalize="characters"
          inputMode="text"
          placeholder="XXXX-XXXX-XXXX-XXXX"
          value={codigo}
          onChange={(e) => setCodigo(formatarCodigo(e.target.value))}
        />
      </div>
      {erro && (
        <p className="text-sm text-destructive" role="alert">
          {erro}
        </p>
      )}
      <Button type="submit" disabled={!codigoCompleto(codigo) || vincular.isPending}>
        {vincular.isPending ? "Verificando…" : "Vincular"}
      </Button>
    </form>
  );
}
