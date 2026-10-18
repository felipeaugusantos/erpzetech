import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { brl, num } from "@/lib/format";
import { custoPar, margemPar } from "@/lib/personalizacao";
import { PageHeader, StatCard } from "@/components/app/PageHeader";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/custo-par")({
  head: () => ({
    meta: [
      { title: "Custo por par — ERP Ze Tech" },
      { name: "description", content: "Calcule o custo real de cada par de chinelo: tira, solado e folha impressa." },
      { property: "og:title", content: "Custo por par — ERP Ze Tech" },
      { property: "og:description", content: "Custo da tira, do solado e da folha impressa em cada par, com margem sobre o preço." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CustoPar,
});

const n = (v: string) => {
  const x = Number(v.replace(",", "."));
  return Number.isFinite(x) ? x : 0;
};

function CustoPar() {
  const { data: produtos = [] } = useQuery({
    queryKey: ["produtos-custo-par"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("produtos")
        .select("id, descricao, codigo_interno, custo, preco_venda")
        .eq("ativo", true)
        .order("descricao");
      if (error) throw error;
      return data;
    },
  });

  const [tiraId, setTiraId] = useState("");
  const [soladoId, setSoladoId] = useState("");
  const [folhaId, setFolhaId] = useState("");
  const [tirasPorPar, setTirasPorPar] = useState("1");
  const [soladosPorPar, setSoladosPorPar] = useState("1");
  const [paresPorFolha, setParesPorFolha] = useState("1");
  const [outros, setOutros] = useState("0");
  const [preco, setPreco] = useState("");
  const [pares, setPares] = useState("1");

  const custoDe = (id: string) => Number(produtos.find((p) => p.id === id)?.custo ?? 0);
  const c = custoPar({
    tira: custoDe(tiraId), tirasPorPar: n(tirasPorPar),
    solado: custoDe(soladoId), soladosPorPar: n(soladosPorPar),
    folha: custoDe(folhaId), paresPorFolha: n(paresPorFolha),
    outros: n(outros),
  });
  const precoN = n(preco);
  const margem = margemPar(precoN, c.total);
  const qtd = Math.max(0, Math.floor(n(pares)));

  const escolha = (rotulo: string, valor: string, set: (v: string) => void) => (
    <div className="space-y-1">
      <Label>{rotulo}</Label>
      <Select value={valor} onValueChange={set}>
        <SelectTrigger><SelectValue placeholder="Escolha o produto" /></SelectTrigger>
        <SelectContent>
          {produtos.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.codigo_interno} — {p.descricao} ({brl(Number(p.custo ?? 0))})
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
  const campo = (rotulo: string, valor: string, set: (v: string) => void) => (
    <div className="space-y-1">
      <Label>{rotulo}</Label>
      <Input inputMode="decimal" value={valor} onChange={(e) => set(e.target.value)} />
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Custo por par"
        description="O custo de cada material vem do cadastro do produto, já calculado pelas notas de entrada."
      />

      <div className="grid gap-4 rounded-lg border bg-card p-4 md:grid-cols-2">
        {escolha("Tira", tiraId, setTiraId)}
        {campo("Tiras por par", tirasPorPar, setTirasPorPar)}
        {escolha("Solado", soladoId, setSoladoId)}
        {campo("Solados por par", soladosPorPar, setSoladosPorPar)}
        {escolha("Folha impressa", folhaId, setFolhaId)}
        {campo("Pares que uma folha rende", paresPorFolha, setParesPorFolha)}
        {campo("Outros gastos por par (R$) — tinta, embalagem, energia", outros, setOutros)}
        {campo("Preço de venda do par (R$)", preco, setPreco)}
        {campo("Quantidade de pares do pedido", pares, setPares)}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Tira" value={brl(c.tira)} />
        <StatCard label="Solado" value={brl(c.solado)} />
        <StatCard label="Folha impressa" value={brl(c.folha)} />
        <StatCard label="Outros" value={brl(c.outros)} />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Custo real do par" value={brl(c.total)} />
        <StatCard label="Lucro por par" value={precoN > 0 ? `${brl(precoN - c.total)} (${num(margem)}%)` : "Informe o preço"} />
        <StatCard
          label={`Pedido de ${num(qtd)} pares`}
          value={`Custo ${brl(c.total * qtd)}${precoN > 0 ? ` · Lucro ${brl((precoN - c.total) * qtd)}` : ""}`}
        />
      </div>
    </div>
  );
}
