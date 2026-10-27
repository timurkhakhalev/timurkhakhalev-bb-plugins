import type { BbPluginApi } from "@get-bb/plugin-sdk";

// The composer styles live in app.tsx; the server only declares settings.
export default async function plugin(bb: BbPluginApi) {
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
      default: false,
    },
  });
}
