# @useguano/create

Install [Guano](https://www.npmjs.com/package/@useguano/guano) on a server, or
scaffold a site project on your own machine.

```sh
npm create @useguano
```

Asks for a folder name (default `my-site`), then creates the folder with
`@useguano/guano` as a dependency plus `dev`/`start`/`build`/`connect` scripts,
a `.env.example` and a `.gitignore`, and runs `npm install`. Then:

```sh
cd my-site
npm run start
```

Open `http://localhost:4174/admin` and create the first account. From that
machine that is all it takes; from anywhere else the form asks for a **setup
code**, which the server prints in its own log the first time it starts — look
for *"the form asks for this code"*. It is what stands in for being at the
machine: without it, the first stranger to reach a fresh instance would become
its admin.

## Then add it in Guano Launcher

This is the **server installer**. Building a site — pages, components,
settings, publishing — happens in the Guano Launcher app on a Mac: Home →
Servers → **Add a server…**, then approve that Mac once in your browser. What
the instance you just installed serves is the site itself, its forms, and the
content view for the people you invite, who need nothing installed at all.

Two things follow from that, and both are chosen rather than missed: **every
builder needs a Mac**, and once a project lives on a server there is no offline
building.

## Claude

Not asked about, and not needed. The editor's own AI panel is Guano's main AI
integration and needs no wiring up — it is in the app, beside the page.

`--connect` is for the one case it was written for: a site on your own laptop,
with Claude Code or Claude Desktop pointed at it over MCP. It mints an API
token bound to the admin you create, writes the config of every Claude client
on the machine (quit Claude Desktop first), and takes `--main` / `--publish`
for the two agent permissions. `npm run connect` inside the project does the
same thing later.

## Flags

Pass the folder to skip that prompt (`npm create @useguano my-site`);
`--no-install` skips the install; `--connect` connects Claude, with `--main` /
`--publish` granting the agent permissions non-interactively and
`--config <path>` naming one client's config file. `--no-connect` is accepted
and is the default. Without a terminal (CI) nothing is asked.
