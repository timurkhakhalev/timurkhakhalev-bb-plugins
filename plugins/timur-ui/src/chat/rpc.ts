// The changed-files list's RPC, shared by the server handler and the app.
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const rpcContract = defineRpcContract({
  turnChanges: {
    input: z.object({ threadId: z.string() }).strict(),
    output: z.object({
      environmentId: z.string().nullable(),
      turnId: z.string().nullable(),
      files: z.array(z.object({ path: z.string(), added: z.number(), removed: z.number() })),
    }),
  },
});
