import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

import { ZeLogo } from "@/components/app/ZeLogo";
import { Button } from "@/components/ui/button";
import { formatarVersaoLegal, VERSAO_LEGAL, type DocumentoLegal } from "@/lib/legal";

/** Página pública de um documento legal (Termos de Uso ou Política de Privacidade). */
export function LegalDocumento({
  doc,
  outro,
}: {
  doc: DocumentoLegal;
  outro: "/termos" | "/privacidade";
}) {
  return (
    <div className="min-h-screen">
      <header className="flex h-16 items-center justify-between border-b border-border px-5 sm:px-8">
        <Link to="/" className="flex items-center gap-2">
          <ZeLogo />
          <span className="font-display text-base font-bold tracking-wide">EZRA ERP</span>
        </Link>
        <Button asChild variant="ghost" size="sm">
          <Link to="/">
            <ArrowLeft className="mr-2 size-4" /> Início
          </Link>
        </Button>
      </header>
      <main className="mx-auto max-w-3xl px-5 py-10 sm:px-8 sm:py-14">
        <h1 className="font-display text-3xl font-extrabold sm:text-4xl">{doc.titulo}</h1>
        <p className="mt-2 text-xs text-muted-foreground">
          Versão de {formatarVersaoLegal(VERSAO_LEGAL)}
        </p>
        <p className="mt-4 text-sm text-muted-foreground">{doc.resumo}</p>
        <div className="mt-8 space-y-8">
          {doc.secoes.map((s) => (
            <section key={s.titulo}>
              <h2 className="font-display text-lg font-bold">{s.titulo}</h2>
              <div className="mt-2 space-y-3 text-sm leading-relaxed text-foreground/90">
                {s.paragrafos.map((p, i) => (
                  <p key={i}>{p}</p>
                ))}
              </div>
            </section>
          ))}
        </div>
        <p className="mt-12 border-t border-border pt-6 text-sm">
          <Link to={outro} className="font-medium underline underline-offset-4">
            {outro === "/termos" ? "Ler os Termos de Uso" : "Ler a Política de Privacidade"}
          </Link>
        </p>
      </main>
    </div>
  );
}
