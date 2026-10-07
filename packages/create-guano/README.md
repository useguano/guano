# @useguano/create

Scaffold a new [Guano](https://www.npmjs.com/package/@useguano/guano) site project.

```sh
npm create @useguano
```

Asks for a folder name (default `my-site`), whether to connect **Claude
Desktop** over MCP (default yes — quit Claude first), and the two agent
permissions (may it edit the live project, may it publish — both default no).
Then it creates the folder with `@useguano/guano` as a dependency plus
`dev`/`start`/`build`/`connect` scripts, a `.env.example` and a `.gitignore`,
runs `npm install`, and connects Claude. Then:

```sh
cd my-site
npm run dev
```

Open `http://localhost:4174/admin` and create the first account — the Claude
token is bound to it, and the form shows the permissions you chose. Change
them any time in Settings → MCP → Agent permissions.

Flags: pass the folder to skip that prompt (`npm create @useguano my-site`);
`--no-install` skips the install; `--no-connect` skips Claude, `--connect`
connects without asking, `--main` / `--publish` grant the permissions
non-interactively. Without a terminal (CI) nothing is asked and Claude is not
connected.
