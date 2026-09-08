import type { Adapter } from "@toolroll/core";
import { tavilyAdapter } from "@toolroll/adapters-tavily";

/** 适配器注册表:接新服务商 = import 并 push 一行 */
const adapters: Adapter[] = [tavilyAdapter];

export const registry = new Map<string, Adapter>();
for (const a of adapters) {
  registry.set(a.provider, a);
}
