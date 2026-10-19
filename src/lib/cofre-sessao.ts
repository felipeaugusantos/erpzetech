// Cofre da clínica deste navegador: um só por aba, aberto com a senha e travado sozinho depois de um tempo sem uso ou ao sair do sistema.
import { useEffect, useSyncExternalStore } from "react";

import { supabase } from "@/integrations/supabase/client";
import { Cofre, CofreJaExisteError } from "@/lib/cofre";
import { armazemIndexedDb } from "@/lib/cofre-idb";

export type EstadoCofre = "carregando" | "sem_cofre" | "travado" | "aberto";

/** Minutos parado até o cofre travar sozinho. */
export const MINUTOS_PARA_TRAVAR = 15;

let cofre: Cofre | null = null;
let estado: EstadoCofre = "carregando";
let temporizador: ReturnType<typeof setTimeout> | null = null;
let iniciado = false;
const ouvintes = new Set<() => void>();

function mudar(novo: EstadoCofre) {
  estado = novo;
  for (const o of ouvintes) o();
}

export function obterCofre(): Cofre {
  cofre ??= new Cofre(armazemIndexedDb());
  return cofre;
}

function agendarTrava() {
  if (temporizador) clearTimeout(temporizador);
  temporizador = setTimeout(() => travarCofre(), MINUTOS_PARA_TRAVAR * 60_000);
}

export function travarCofre() {
  if (temporizador) clearTimeout(temporizador);
  temporizador = null;
  cofre?.travar();
  if (estado === "aberto") mudar("travado");
}

async function iniciar() {
  if (iniciado || typeof window === "undefined") return;
  iniciado = true;
  // sair do sistema trava o cofre (o conteúdo continua guardado, cifrado)
  supabase.auth.onAuthStateChange((evento) => {
    if (evento === "SIGNED_OUT") travarCofre();
  });
  try {
    mudar((await obterCofre().existe()) ? "travado" : "sem_cofre");
  } catch {
    mudar("sem_cofre");
  }
}

export async function criarCofre(senha: string) {
  try {
    await obterCofre().criar(senha);
  } catch (e) {
    // outra aba criou antes: esta passa a pedir a senha do cofre que já existe
    if (e instanceof CofreJaExisteError) mudar("travado");
    throw e;
  }
  agendarTrava();
  mudar("aberto");
}

export async function destravarCofre(senha: string): Promise<boolean> {
  const ok = await obterCofre().destravar(senha);
  if (ok) {
    agendarTrava();
    mudar("aberto");
  }
  return ok;
}

export async function apagarCofre() {
  await obterCofre().apagarTudo();
  if (temporizador) clearTimeout(temporizador);
  temporizador = null;
  mudar("sem_cofre");
}

export function useCofre() {
  const atual = useSyncExternalStore(
    (cb) => {
      ouvintes.add(cb);
      return () => ouvintes.delete(cb);
    },
    () => estado,
    () => "carregando" as EstadoCofre,
  );
  useEffect(() => {
    void iniciar();
  }, []);
  // qualquer uso da tela reinicia a contagem do bloqueio
  useEffect(() => {
    if (atual !== "aberto") return;
    const reiniciar = () => agendarTrava();
    window.addEventListener("pointerdown", reiniciar);
    window.addEventListener("keydown", reiniciar);
    return () => {
      window.removeEventListener("pointerdown", reiniciar);
      window.removeEventListener("keydown", reiniciar);
    };
  }, [atual]);
  return { estado: atual, cofre: obterCofre() };
}
