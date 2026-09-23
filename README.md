# Timur Khakhalev's BB Plugins

Public collection of plugins for [BB](https://github.com/get-bb/bb).

## Plugins

| Plugin | Description | Status |
| --- | --- | --- |
| [Browser Annotate](./plugins/browser-annotate) | Add comments to elements in a native BB Browser tab and send them with screenshots to the current chat. | 0.1.0 |

## Install

Install a plugin from this repository by its collection name:

```sh
bb plugin install git:github.com/timurkhakhalev/timurkhakhalev-bb-plugins@browser-annotate/v0.1.0 --plugin browser-annotate
```

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
