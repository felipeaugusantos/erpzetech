import React from "react";
import { act, create } from "react-test-renderer";
import { expect, it } from "vitest";
import { Button } from "@/components/ui/button";

it("renders and updates a real Radix Slot through the shared React renderer", async () => {
  let tree: ReturnType<typeof create> | undefined;
  await act(async () => {
    tree = create(
      <Button asChild>
        <a href="/pdv">Caixa</a>
      </Button>,
    );
  });
  expect(tree?.root.findByType("a").props.href).toBe("/pdv");
  await act(async () => {
    tree?.update(
      <Button asChild>
        <a href="/frente-caixa">Balcão</a>
      </Button>,
    );
  });
  expect(tree?.root.findByType("a").props.href).toBe("/frente-caixa");
  await act(async () => tree?.unmount());
});
