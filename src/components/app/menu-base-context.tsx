import { createContext, useContext } from "react";

/** Menu do sistema que a pessoa vê (já filtrado por permissão e módulo), antes da personalização da empresa. */
export type ItemMenuBase = { label: string; to?: string; secao?: string };
export type AreaMenuBase = { label: string; items: ItemMenuBase[] };

export const MenuBaseContext = createContext<AreaMenuBase[] | null>(null);

export const useMenuBase = () => useContext(MenuBaseContext);
