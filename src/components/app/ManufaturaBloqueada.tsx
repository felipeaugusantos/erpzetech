import { Lock } from "lucide-react";

/** Aviso mostrado enquanto a equipe não liberou a manufatura para a empresa (piloto fechado) ou quando o perfil não tem acesso. */
export function ManufaturaBloqueada({ motivo }: { motivo: "modulo" | "perfil" }) {
  return (
    <div className="panel mx-auto max-w-2xl p-6 text-center">
      <span className="mx-auto mb-3 grid size-11 place-items-center rounded-full bg-secondary">
        <Lock className="size-5 text-muted-foreground" />
      </span>
      <p className="font-display text-base font-semibold">
        {motivo === "modulo"
          ? "Manufatura ainda não está liberada"
          : "Seu perfil não tem acesso a esta tela"}
      </p>
      <p className="mt-2 text-sm text-muted-foreground">
        {motivo === "modulo"
          ? "A manufatura está em piloto fechado e é liberada pela equipe EZRA para cada empresa. Fale com a equipe para participar."
          : "Peça ao administrador da empresa para ajustar o seu perfil de acesso."}
      </p>
    </div>
  );
}
