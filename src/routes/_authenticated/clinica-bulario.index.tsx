import { useEffect, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";

import { ModuloBloqueado } from "@/components/app/ModuloCnae";
import { EmptyState, PageHeader } from "@/components/app/PageHeader";
import { ListaFavoritosBulario } from "@/components/app/FavoritosBulario";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { FONTE_MAPA, registroInativo, type MedicamentoBulario } from "@/lib/bulario";
import { useModulosCnae } from "@/lib/cnae";

export const Route = createFileRoute("/_authenticated/clinica-bulario/")({
  head: () => ({
    meta: [
      { title: "Bulário veterinário — EZRA ERP" },
      {
        name: "description",
        content:
          "Consulta dos produtos veterinários registrados no MAPA, por nome, fabricante ou princípio ativo.",
      },
    ],
  }),
  component: BularioModulo,
});

const LETRAS = ["#", ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("")];
const POR_PAGINA = 100;

type Resultado = { total: number; itens: MedicamentoBulario[] };
type Resumo = { total: number; atualizado_em: string | null; fabricantes: string[] };

function BularioModulo() {
  const modulos = useModulosCnae();
  if (modulos.carregando) return <div className="panel h-40 animate-pulse" />;
  if (!modulos.clinica) return <ModuloBloqueado modulo="clinica" />;
  return <Bulario />;
}

function useDebounce<T>(valor: T, ms = 300): T {
  const [v, setV] = useState(valor);
  useEffect(() => {
    const t = setTimeout(() => setV(valor), ms);
    return () => clearTimeout(t);
  }, [valor, ms]);
  return v;
}

function Bulario() {
  const [texto, setTexto] = useState("");
  const busca = useDebounce(texto);
  const [letra, setLetra] = useState<string | null>(null);
  const [fab, setFab] = useState("todos");
  const [pagina, setPagina] = useState(0);

  useEffect(() => setPagina(0), [busca, letra, fab]);

  const { data: resumo } = useQuery({
    queryKey: ["bulario-resumo"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("bulario_resumo");
      if (error) throw error;
      return data as unknown as Resumo;
    },
  });

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["bulario", busca, letra, fab, pagina],
    placeholderData: (anterior) => anterior,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("bulario_buscar", {
        p_busca: busca.trim() || (null as unknown as string),
        p_letra: letra ?? (null as unknown as string),
        p_fabricante: fab === "todos" ? (null as unknown as string) : fab,
        p_limite: POR_PAGINA,
        p_pagina: pagina,
      });
      if (error) throw error;
      return data as unknown as Resultado;
    },
  });

  const itens = data?.itens ?? [];
  const total = data?.total ?? 0;
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  const vazia = resumo?.total === 0;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Bulário veterinário"
        description="Produtos veterinários registrados no MAPA. Consulta de referência: não substitui a bula nem o juízo do veterinário."
      />

      <ListaFavoritosBulario />

      {vazia ? (
        <EmptyState
          title="A base do MAPA ainda não foi carregada"
          description="A equipe EZRA carrega o bulário; assim que estiver pronto, ele aparece aqui."
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-64 flex-1">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Busque medicamento, vacina, fabricante ou princípio ativo"
                aria-label="Buscar no bulário"
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
              />
            </div>
            <Select value={fab} onValueChange={setFab}>
              <SelectTrigger className="w-60" aria-label="Fabricante">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos os fabricantes</SelectItem>
                {(resumo?.fabricantes ?? []).map((f) => (
                  <SelectItem key={f} value={f}>
                    {f}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-wrap gap-1" role="group" aria-label="Índice alfabético">
            <Button
              size="sm"
              variant={letra === null ? "default" : "outline"}
              onClick={() => setLetra(null)}
            >
              Todos
            </Button>
            {LETRAS.map((l) => (
              <Button
                key={l}
                size="sm"
                className="w-8 px-0"
                variant={letra === l ? "default" : "outline"}
                onClick={() => setLetra(letra === l ? null : l)}
              >
                {l}
              </Button>
            ))}
          </div>

          {isError ? (
            <EmptyState
              title="Não foi possível consultar o bulário"
              {...(error instanceof Error ? { description: error.message } : {})}
            />
          ) : isLoading ? (
            <div className="panel h-40 animate-pulse" />
          ) : itens.length === 0 ? (
            <EmptyState
              title="Nenhum produto encontrado"
              description="Confira a grafia ou tire algum filtro."
            />
          ) : (
            <ul className="space-y-2">
              {itens.map((m) => (
                <li key={m.id}>
                  <Link
                    to="/clinica-bulario/$id"
                    params={{ id: m.id }}
                    className="flex w-full items-center justify-between gap-3 rounded-md border bg-card px-4 py-3 text-left text-sm transition-colors hover:bg-accent"
                  >
                    <span className="min-w-0 truncate">
                      {m.nome}
                      {registroInativo(m.situacao) && (
                        <Badge variant="destructive" className="ml-2">
                          {m.situacao}
                        </Badge>
                      )}
                    </span>
                    <span className="shrink-0 text-xs font-semibold uppercase text-muted-foreground">
                      {m.fabricante}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>
              {total.toLocaleString("pt-BR")} produto(s)
              {resumo?.atualizado_em
                ? ` · base atualizada em ${new Date(resumo.atualizado_em).toLocaleDateString("pt-BR")}`
                : ""}
              {" · Fonte: "}
              {FONTE_MAPA}
            </span>
            <span className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={pagina === 0}
                onClick={() => setPagina(pagina - 1)}
              >
                Anterior
              </Button>
              <span>
                {pagina + 1} de {paginas}
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={pagina + 1 >= paginas}
                onClick={() => setPagina(pagina + 1)}
              >
                Próxima
              </Button>
            </span>
          </div>
        </>
      )}
    </div>
  );
}
