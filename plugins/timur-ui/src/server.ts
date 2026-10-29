import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { CHIP_STYLES, LOADERS } from "./chat/settings";
import { registerTurnChanges } from "./chat/turn-changes-server";

export { rpcContract } from "./chat/rpc";

// Styles live in app.tsx. The server declares the settings (composer first, then
// the chat look) and answers the changed-files list.
export default async function plugin(bb: BbPluginApi) {
  registerTurnChanges(bb);
  bb.settings.define({
    editorMaxLines: {
      type: "number",
      label: "Editor max lines",
      description: "How many lines the prompt grows to before it scrolls.",
      default: 8,
    },
    inlineFooter: {
      type: "boolean",
      label: "Footer in the action row",
      description:
        "Show project, machine, branch, and permissions next to the model picker instead of under the composer.",
      default: true,
    },
    animateCollapse: {
      type: "boolean",
      label: "Animate collapse and expand",
      description: "Smoothly resize the composer when it collapses or expands.",
      default: true,
    },
    keepExpandedAfterKeyboard: {
      type: "boolean",
      label: "Keep the draft open after closing the keyboard",
      description:
        "On touch devices, don't collapse a composer with a draft when the keyboard's Done button closes the keyboard.",
      default: true,
    },
    hideGitBar: {
      type: "boolean",
      label: "Hide the git changes bar",
      description: "Hide the files/+/- bar above the thread composer.",
      default: true,
    },
    loader: {
      type: "select",
      label: "Loading animation",
      description: "Icon on pending work rows. drive: pixel grid sweep; dots: round pixels; orbit: pixels circling the edge; coins: a ring of tumbling coins; bb: BB's own icon.",
      options: [...LOADERS],
      default: "drive",
    },
    shimmer: {
      type: "boolean",
      label: "Label shimmer",
      description: "BeautifulUI's brighter, faster shimmer on pending labels such as “Thinking…” and “Running”.",
      default: true,
    },
    toolChips: {
      type: "select",
      label: "Tool call rows",
      description: "surface: filled chip with a hairline; outline: hairline only; plain: no background or border.",
      options: [...CHIP_STYLES],
      default: "surface",
    },
    workRows: {
      type: "boolean",
      label: "Compact work rows",
      description: "Pill-shaped row headers, 12.5px text, monospace durations, a guide line under expanded details, smoother expand.",
      default: true,
    },
    streamingCaret: {
      type: "boolean",
      label: "Streaming caret",
      description: "A caret at the end of the reply while a run is live.",
      default: true,
    },
    approvalCard: {
      type: "boolean",
      label: "Approval cards",
      description: "Raised cards with pill buttons for permission requests and agent questions.",
      default: true,
    },
    userBubbles: {
      type: "boolean",
      label: "User message bubbles",
      description: "Soft filled bubbles for your messages.",
      default: true,
    },
    codeChips: {
      type: "boolean",
      label: "Code chips",
      description: "Hairline chips for inline code and hairline cards for code blocks.",
      default: true,
    },
    selectionPill: {
      type: "boolean",
      label: "Selection pill",
      description: "Pill style for the Add to chat / Reply in side chat popover on selected text.",
      default: true,
    },
    treeLines: {
      type: "boolean",
      label: "Tree lines",
      description: "Indent the rows of an expanded work group under its header and connect them with tree lines.",
      default: true,
    },
    mergedBanners: {
      type: "boolean",
      label: "Merged banner stack",
      description: "Group the cards above the composer (background commands, git, parent and child threads) into one card with hairline dividers.",
      default: true,
    },
    unreadMarker: {
      type: "boolean",
      label: "Unread marker",
      description: "Put NEW on the same line as the first unread row, in the success colour, without the rule line.",
      default: true,
    },
    messageActions: {
      type: "boolean",
      label: "Message actions",
      description: "Spatial tooltips that glide along rows of 3+ icon buttons, plus hover chips.",
      default: true,
    },
    turnChanges: {
      type: "boolean",
      label: "Changed files list",
      description: "Under the latest response, the files its turn edited with line counts: three at first, the rest on expand. Click one to open it.",
      default: true,
    },
  });
}
