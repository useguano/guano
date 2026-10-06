# @useguano/create

Scaffold a new [Guano](https://www.npmjs.com/package/@useguano/guano) site project.

```sh
npm create @useguano
```

Asks for a folder name (default `my-site`), creates it with `@useguano/guano`
as a dependency plus `dev`/`start`/`build` scripts, a `.env.example` and a
`.gitignore`, and runs `npm install`. Then:

```sh
cd my-site
npm run dev
```

Open `http://localhost:4174/admin` and create the first account. Pass the
folder as an argument to skip the prompt (`npm create @useguano my-site`), and
`--no-install` to skip the install step.
