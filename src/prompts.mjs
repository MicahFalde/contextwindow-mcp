// The two slash-command prompts. Both are pure instruction scripts: the text is the answer,
// so neither needs the network when the client only lists them.

/** Register `prep` and `brief` on `server`.
 *
 *  MCP-PROMPT-001, MCP-PROMPT-002 */
export function registerPrompts(server) {
  server.registerPrompt(
    "prep",
    {
      description:
        "Prepare this member's roundtable item: last seven days of commits, what else happened, a three-sentence draft, then the file choice.",
    },
    () => ({
      messages: [
        {
          role: "user",
          // MCP-PROMPT-001: the five steps are the whole script, in this order, and the
          // write waits for the member's own approval.
          content: {
            type: "text",
            text: [
              "Prepare the roundtable item for this member.",
              "1. Run git log for the last 7 days in the current directory.",
              "2. Ask the member what else they did.",
              "3. Draft a three-sentence roundtable item.",
              "4. Ask whether to attach any code.",
              "5. Call add_agenda_item only after the member approves.",
            ].join("\n"),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "brief",
    {
      description: "One-screen brief for the call: this member's agenda items and every shared project, grouped by member.",
    },
    () => ({
      messages: [
        {
          role: "user",
          // MCP-PROMPT-002: two reads, then one screen whose groups are the member logins.
          content: {
            type: "text",
            text: [
              "Build the one-screen brief for this call.",
              "1. Call list_agenda.",
              "2. Call get_projects.",
              "3. Present both as one screen grouped by member.",
            ].join("\n"),
          },
        },
      ],
    }),
  );
}
