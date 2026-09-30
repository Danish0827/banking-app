import { z } from "zod";

export const accountParamsSchema = z.object({
  accountId: z.uuid({ error: "Invalid account id" }),
});

export type AccountParams = z.infer<typeof accountParamsSchema>;
