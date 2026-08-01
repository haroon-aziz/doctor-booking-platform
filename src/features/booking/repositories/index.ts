import { env } from "@/lib/config/env";

import { InMemorySlotRepository } from "./in-memory-slot.repository";
import { PrismaSlotRepository } from "./prisma-slot.repository";
import type { SlotRepository } from "./slot.repository";

let instance: SlotRepository | undefined;

export function getSlotRepository(): SlotRepository {
  instance ??= env.DEMO_MODE ? new InMemorySlotRepository() : new PrismaSlotRepository();
  return instance;
}

export function setSlotRepository(repository: SlotRepository | undefined): void {
  instance = repository;
}

export type { SlotRepository } from "./slot.repository";
export { InMemorySlotRepository } from "./in-memory-slot.repository";
export { PrismaSlotRepository } from "./prisma-slot.repository";
