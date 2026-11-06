# Timur Khakhalev's BB Plugins

Public collection of plugins for [BB](https://github.com/get-bb/bb).

## Plugins

| Plugin | Description | Status |
| --- | --- | --- |
| [Browser Annotate](./plugins/browser-annotate) | Comment on elements in a native BB Browser tab and send the comments to the current chat with screenshots and React component names. Also works when the BB server runs on a remote machine. Requires BB 0.49+. | 0.2.1 |

Personal, not in the collection: [Timur UI](./plugins/timur-ui), my own bb look (shorter composer plus Beautiful Chat's chat restyle).

## Install

Install a plugin from this repository by its collection name:

```sh
bb plugin install git:github.com/timurkhakhalev/timurkhakhalev-bb-plugins@browser-annotate/v0.2.0 --plugin browser-annotate
```

To receive compatible releases through `bb plugin update`, install a semver range instead of a fixed tag:

```sh
bb plugin install "git:https://github.com/timurkhakhalev/timurkhakhalev-bb-plugins.git@semver:browser-annotate/:^0.2.0" --subdirectory plugins/browser-annotate
```

Browser Annotate 0.2.0 is a major change from 0.1.x, so installs that track `^0.1.0` do not update to it. Remove the old install with `bb plugin remove browser-annotate`, then install 0.2.0. Removing it deletes the plugin's unsent drafts and the history behind the hover cards on annotations already sent.

For local development:

```sh
bb plugin install path:/absolute/path/to/timurkhakhalev-bb-plugins --plugin browser-annotate
```

BB reads [`.bb/plugins.json`](./.bb/plugins.json) only as an index. Each directory under `plugins/` remains an independent plugin package with its own manifest, dependencies, tests, documentation, and release version.

## Development

Run the current collection checks from the repository root:

```sh
bun run check
bun run build
```

Keep runtime dependencies local to each plugin. Add shared packages only after two plugins need the same maintained code and a standalone Git install can still build each plugin.

## Adding a plugin

1. Create `plugins/<plugin-id>/` as a complete BB plugin package.
2. Add it to `.bb/plugins.json`.
3. Give it its own README, tests, `PLUGIN_OVERVIEW.md`, engine ranges, and release checklist.
4. Verify direct installation with `bb plugin install path:<repository> --plugin <plugin-id>`.
5. Use plugin-prefixed release tags such as `<plugin-id>/v1.2.3` once plugins need independent Git release streams.
